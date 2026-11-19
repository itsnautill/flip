//! Tauri commands. Every command answers with fresh data so the frontend can
//! render the return value directly.

use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::Timelike;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::backup;
use crate::board::{self, BoardAction, BoardView};
use crate::settings::{self, Dashboard, Settings};
use crate::state::{lock, FocusTarget, Mode, SharedCore, Snapshot};
use crate::timer::{Timer, ToggleResult};

fn shot(core: &SharedCore) -> Snapshot {
    lock(core).snapshot(Instant::now())
}

fn now_parts() -> (chrono::NaiveDate, u32) {
    let local = chrono::Local::now();
    (local.date_naive(), local.hour() * 60 + local.minute())
}

fn board_view(core: &SharedCore) -> BoardView {
    let (today, minutes) = now_parts();
    let c = lock(core);
    let mut view = c.board.view(today, minutes);
    view.can_undo = !c.undo_stack.is_empty();
    view.can_redo = !c.redo_stack.is_empty();
    view
}

#[tauri::command]
pub fn get_snapshot(core: State<'_, SharedCore>) -> Snapshot {
    shot(core.inner())
}

#[tauri::command]
pub fn switch_mode(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    c.mode = match c.mode {
        Mode::Clock => Mode::Timer,
        Mode::Timer => Mode::Clock,
    };
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn timer_digit(core: State<'_, SharedCore>, d: u8) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    if c.mode == Mode::Timer {
        c.timer.digit(d);
    }
    c.snapshot(now)
}

#[tauri::command]
pub fn timer_backspace(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    if c.mode == Mode::Timer {
        c.timer.backspace();
    }
    c.snapshot(now)
}

#[tauri::command]
pub fn timer_toggle(app: AppHandle, core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    if c.mode != Mode::Timer {
        return c.snapshot(now);
    }
    let result = c.timer.toggle(now);
    let snapshot = c.snapshot(now);
    let mut updated: Option<Settings> = None;
    if result == ToggleResult::Started {
        updated = Some(Settings {
            timer_preset_secs: c.timer.preset_secs(),
            ..c.settings.clone()
        });
    }
    let path = c.settings_path.clone();
    drop(c);

    if let Some(settings) = updated {
        settings::save(&path, &settings);
    }
    if result == ToggleResult::Refused {
        if let Err(e) = app.emit("shake", ()) {
            eprintln!("flip: could not emit shake: {e}");
        }
    }
    snapshot
}

#[tauri::command]
pub fn timer_set(core: State<'_, SharedCore>, secs: u32) -> Result<Snapshot, String> {
    if secs == 0 {
        return Err("Choose a duration of at least one second.".into());
    }
    let mut c = lock(core.inner());
    let now = Instant::now();
    /* Setting a duration *is* a timer action, so bring the timer into view
    instead of refusing and showing an error banner. */
    c.mode = Mode::Timer;
    c.timer.set_preset(secs);
    let snapshot = c.snapshot(now);
    let updated = Settings {
        timer_preset_secs: c.timer.preset_secs(),
        ..c.settings.clone()
    };
    let path = c.settings_path.clone();
    drop(c);

    settings::save(&path, &updated);
    Ok(snapshot)
}

#[tauri::command]
pub fn timer_reset(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    if c.mode == Mode::Timer {
        c.timer.reset();
    }
    c.snapshot(now)
}

#[tauri::command]
pub fn toggle_hour_format(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    if c.mode != Mode::Clock {
        return c.snapshot(now);
    }
    c.settings.use_12h = !c.settings.use_12h;
    let updated = c.settings.clone();
    let snapshot = c.snapshot(now);
    let path = c.settings_path.clone();
    drop(c);

    settings::save(&path, &updated);
    snapshot
}

#[tauri::command]
pub fn set_sound(core: State<'_, SharedCore>, enabled: bool) -> Snapshot {
    let mut c = lock(core.inner());
    if c.settings.sound != enabled {
        c.settings.sound = enabled;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_onboarded(core: State<'_, SharedCore>, done: bool) -> Snapshot {
    let mut c = lock(core.inner());
    if c.settings.onboarded != done {
        c.settings.onboarded = done;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_telemetry(core: State<'_, SharedCore>, enabled: bool) -> Snapshot {
    let mut c = lock(core.inner());
    let mut changed = c.settings.telemetry != enabled;
    if enabled && c.settings.install_id.is_empty() {
        c.settings.install_id = settings::new_install_id();
        changed = true;
    }
    if changed {
        c.settings.telemetry = enabled;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_motion(core: State<'_, SharedCore>, motion: String) -> Snapshot {
    let mut c = lock(core.inner());
    let motion = settings::normalise_motion(&motion);
    if c.settings.motion != motion {
        c.settings.motion = motion;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_hour_format(core: State<'_, SharedCore>, use12h: bool) -> Snapshot {
    let mut c = lock(core.inner());
    if c.settings.use_12h != use12h {
        c.settings.use_12h = use12h;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_language(core: State<'_, SharedCore>, language: String) -> Snapshot {
    let mut c = lock(core.inner());
    let language = if language == "vi" {
        "vi".to_string()
    } else {
        "en".to_string()
    };
    if c.settings.language != language {
        c.settings.language = language;
        let updated = c.settings.clone();
        let snapshot = c.snapshot(Instant::now());
        let path = c.settings_path.clone();
        drop(c);
        settings::save(&path, &updated);
        return snapshot;
    }
    c.snapshot(Instant::now())
}

#[tauri::command]
pub fn set_accent_hue(core: State<'_, SharedCore>, hue: f64) -> Snapshot {
    change(&core, |s| s.accent_hue = Some(hue))
}

/// Reads a table the user pasted, without touching anything yet: the UI shows
/// the counts and asks Replace or Merge before applying.
#[tauri::command]
pub fn read_timetable_table(text: String) -> Result<backup::TableImport, String> {
    backup::parse_table(&text)
}

/// Writes the timetable template the import button hands out into Downloads.
#[tauri::command]
pub fn save_template(app: AppHandle, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 1_000_000 {
        return Err("The template could not be built.".into());
    }
    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let path = dir.join("Flip timetable template.xlsx");
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the template: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Writes one settings change, normalises it, saves it and answers with a
/// fresh snapshot. Nothing is saved when the value was already correct.
fn change<F>(core: &State<'_, SharedCore>, apply: F) -> Snapshot
where
    F: FnOnce(&mut settings::Settings),
{
    let mut c = lock(core.inner());
    let before = c.settings.clone();
    apply(&mut c.settings);
    if c.settings == before {
        return c.snapshot(Instant::now());
    }
    c.settings = settings::normalise(c.settings.clone());
    let updated = c.settings.clone();
    let snapshot = c.snapshot(Instant::now());
    let path = c.settings_path.clone();
    drop(c);
    settings::save(&path, &updated);
    snapshot
}

#[tauri::command]
pub fn set_theme(core: State<'_, SharedCore>, theme: String) -> Snapshot {
    change(&core, |s| s.theme = theme)
}

#[tauri::command]
pub fn set_touch(core: State<'_, SharedCore>, enabled: bool) -> Snapshot {
    change(&core, |s| s.touch = enabled)
}

#[tauri::command]
pub fn set_wash(core: State<'_, SharedCore>, enabled: bool) -> Snapshot {
    change(&core, |s| s.wash = enabled)
}

#[tauri::command]
pub fn set_discord(core: State<'_, SharedCore>, enabled: bool) -> Snapshot {
    change(&core, |s| s.discord = enabled)
}

/// Steps the interface zoom and tells the window about it straight away.
#[tauri::command]
pub fn set_zoom(app: AppHandle, core: State<'_, SharedCore>, percent: i32) -> Snapshot {
    let wanted = settings::normalise_zoom(percent);
    let snapshot = change(&core, |s| s.zoom = wanted);
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_zoom(snapshot.zoom as f64 / 100.0) {
            eprintln!("flip: could not set zoom: {e}");
        }
    }
    snapshot
}

/// The header button flips between the plain light and dark looks, whichever
/// pair the user is currently in.
#[tauri::command]
pub fn toggle_theme(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    c.settings.theme = if c.settings.theme.starts_with("dark") {
        "light".into()
    } else {
        "dark".into()
    };
    let updated = c.settings.clone();
    let snapshot = c.snapshot(Instant::now());
    let path = c.settings_path.clone();
    drop(c);

    settings::save(&path, &updated);
    snapshot
}

#[tauri::command]
pub fn toggle_fullscreen(app: AppHandle, core: State<'_, SharedCore>) -> Snapshot {
    /* Fullscreen is a desktop window concept; phones have no window to expand. */
    #[cfg(desktop)]
    match app.get_webview_window("main") {
        Some(window) => {
            let fullscreen = window.is_fullscreen().unwrap_or(false);
            if let Err(e) = window.set_fullscreen(!fullscreen) {
                eprintln!("flip: could not toggle fullscreen: {e}");
            }
        }
        None => eprintln!("flip: main window unavailable"),
    }
    #[cfg(not(desktop))]
    let _ = app;
    shot(core.inner())
}

#[tauri::command]
pub fn exit_fullscreen(app: AppHandle, core: State<'_, SharedCore>) -> Snapshot {
    #[cfg(desktop)]
    match app.get_webview_window("main") {
        Some(window) => {
            if window.is_fullscreen().unwrap_or(false) {
                if let Err(e) = window.set_fullscreen(false) {
                    eprintln!("flip: could not leave fullscreen: {e}");
                }
            }
        }
        None => eprintln!("flip: main window unavailable"),
    }
    #[cfg(not(desktop))]
    let _ = app;
    shot(core.inner())
}

/* ----------------------------------------------------------- phone orientation */

/// Asks the Android activity for landscape or portrait. A desktop window has no
/// orientation, so the call is a no-op there and the frontend keeps its layout.
#[tauri::command]
pub fn set_orientation(app: AppHandle, landscape: bool) -> bool {
    #[cfg(target_os = "android")]
    {
        /* Touching the activity off the UI thread is not allowed, and a Tauri
        command runs on a worker, so the call is posted to the main loop. */
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = android_orientation(landscape) {
                eprintln!("flip: could not change orientation: {e}");
            }
        });
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, landscape);
    landscape
}

/// Hides the status bar and the navigation bar while the clock is idle. On the
/// desktop it is a no-op, exactly like the orientation call.
#[tauri::command]
pub fn set_immersive(app: AppHandle, on: bool) -> bool {
    #[cfg(target_os = "android")]
    {
        let _ = app.run_on_main_thread(move || {
            if let Err(e) = android_static_bool("setSystemBarsHidden", on) {
                eprintln!("flip: could not change the system bars: {e}");
            }
        });
    }
    #[cfg(not(target_os = "android"))]
    let _ = (app, on);
    on
}

#[cfg(target_os = "android")]
fn android_orientation(landscape: bool) -> Result<(), String> {
    android_static_bool("setOrientation", landscape)
}

/// Calls a `static void name(boolean)` method on the Android activity.
#[cfg(target_os = "android")]
fn android_static_bool(method: &str, value: bool) -> Result<(), String> {
    use jni::objects::{JClass, JObject, JValue};

    let ctx = ndk_context::android_context();
    // SAFETY: ndk-context keeps a global reference to the live JVM.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("no Java VM: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("no JNI environment: {e}"))?;

    /* A native thread is attached without Java frames, so looking a class up by
    name would use the system loader and miss the app's classes. Ask the
    context for its loader and go through that instead. */
    let context = unsafe { JObject::from_raw(ctx.context().cast()) };
    let loader = env
        .call_method(&context, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])
        .map_err(|e| format!("no class loader: {e}"))?
        .l()
        .map_err(|e| format!("no class loader object: {e}"))?;
    let name = env
        .new_string("com.nautill.flip.MainActivity")
        .map_err(|e| format!("no class name: {e}"))?;
    let class = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&name)],
        )
        .map_err(|e| format!("MainActivity missing: {e}"))?
        .l()
        .map_err(|e| format!("MainActivity missing: {e}"))?;
    let class = unsafe { JClass::from_raw(class.into_raw()) };

    match env.call_static_method(
        &class,
        method,
        "(Z)V",
        &[JValue::Bool(u8::from(value))],
    ) {
        Ok(_) => Ok(()),
        Err(e) => {
            env.exception_describe().ok();
            env.exception_clear().ok();
            Err(format!("{method} failed: {e}"))
        }
    }
}

/* ------------------------------------------------------------ timetable/tasks */

#[tauri::command]
pub fn get_board(core: State<'_, SharedCore>) -> BoardView {
    board_view(core.inner())
}

/// One entry point for every timetable and task edit, so the UI only ever has
/// to render the view that comes back.
#[tauri::command]
pub fn board_action(core: State<'_, SharedCore>, action: BoardAction) -> Result<BoardView, String> {
    let (today, minutes) = now_parts();
    let today_text = today.format("%Y-%m-%d").to_string();
    let mut c = lock(core.inner());
    let before = c.board.clone();
    /* Locking is a view state, not an edit: Ctrl+Z must not put the lock back. */
    let view_only = matches!(action, BoardAction::SetLocked { .. });
    c.board.apply(action, &today_text)?;
    if !view_only {
        c.remember(before);
    }
    let path = c.board_path.clone();
    let saved = c.board.clone();
    let mut view = c.board.view(today, minutes);
    view.can_undo = !c.undo_stack.is_empty();
    view.can_redo = !c.redo_stack.is_empty();
    drop(c);

    board::save(&path, &saved);
    Ok(view)
}

/// Steps one timetable edit back. The history is in memory, so a restart
/// simply starts a new one; what is on disk is always what the grid shows.
#[tauri::command]
pub fn undo_board(core: State<'_, SharedCore>) -> Result<BoardView, String> {
    let (today, minutes) = now_parts();
    let mut c = lock(core.inner());
    if c.undo().is_none() {
        return Err("Nothing to undo.".into());
    }
    let path = c.board_path.clone();
    let saved = c.board.clone();
    let mut view = c.board.view(today, minutes);
    view.can_undo = !c.undo_stack.is_empty();
    view.can_redo = !c.redo_stack.is_empty();
    drop(c);

    board::save(&path, &saved);
    Ok(view)
}

#[tauri::command]
pub fn redo_board(core: State<'_, SharedCore>) -> Result<BoardView, String> {
    let (today, minutes) = now_parts();
    let mut c = lock(core.inner());
    if c.redo().is_none() {
        return Err("Nothing to redo.".into());
    }
    let path = c.board_path.clone();
    let saved = c.board.clone();
    let mut view = c.board.view(today, minutes);
    view.can_undo = !c.undo_stack.is_empty();
    view.can_redo = !c.redo_stack.is_empty();
    drop(c);

    board::save(&path, &saved);
    Ok(view)
}

/* ------------------------------------------------------------------- focus */

/// Sets the countdown, switches to the timer and starts it in one step.
#[tauri::command]
pub fn start_focus(
    core: State<'_, SharedCore>,
    secs: u32,
    task_id: Option<String>,
) -> Result<Snapshot, String> {
    let secs = secs.clamp(60, 7200);
    let mut c = lock(core.inner());
    let now = Instant::now();
    let subject_id = task_id.as_ref().and_then(|id| {
        c.board
            .tasks
            .iter()
            .find(|task| &task.id == id)
            .and_then(|task| task.subject_id.clone())
    });
    c.mode = Mode::Timer;
    c.timer.set_preset(secs);
    c.timer.toggle(now);
    c.focus_target = Some(FocusTarget {
        task_id,
        subject_id,
    });
    c.settings.focus_secs = secs;
    let snapshot = c.snapshot(now);
    let updated = c.settings.clone();
    let path = c.settings_path.clone();
    drop(c);

    settings::save(&path, &updated);
    Ok(snapshot)
}

/// Leaving a focus session early keeps it out of the study history.
#[tauri::command]
pub fn cancel_focus(core: State<'_, SharedCore>) -> Snapshot {
    let mut c = lock(core.inner());
    let now = Instant::now();
    c.focus_target = None;
    c.timer.reset();
    c.snapshot(now)
}

#[tauri::command]
pub fn set_dashboard(
    core: State<'_, SharedCore>,
    order: Vec<String>,
    hidden: Vec<String>,
) -> Snapshot {
    let mut c = lock(core.inner());
    let mut dashboard = Dashboard { order, hidden };
    dashboard.sanitize();
    if c.settings.dashboard == dashboard {
        return c.snapshot(Instant::now());
    }
    c.settings.dashboard = dashboard;
    let updated = c.settings.clone();
    let snapshot = c.snapshot(Instant::now());
    let path = c.settings_path.clone();
    drop(c);

    settings::save(&path, &updated);
    snapshot
}

/* ------------------------------------------------------ backup and restore */

/// Flip's own folder, derived from where settings live.
fn data_dir(core: &SharedCore) -> PathBuf {
    let c = lock(core);
    c.settings_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::temp_dir().join("flip-data"))
}

#[tauri::command]
pub fn make_backup(core: State<'_, SharedCore>) -> Result<backup::BackupInfo, String> {
    let (settings, board, dir) = {
        let c = lock(core.inner());
        (
            c.settings.clone(),
            c.board.clone(),
            c.settings_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| std::env::temp_dir().join("flip-data")),
        )
    };
    backup::write(&dir, &settings, &board, false)
}

#[tauri::command]
pub fn list_backups(core: State<'_, SharedCore>) -> Vec<backup::BackupInfo> {
    backup::list(&data_dir(core.inner()))
}

#[tauri::command]
pub fn delete_backup(
    core: State<'_, SharedCore>,
    name: String,
) -> Result<Vec<backup::BackupInfo>, String> {
    if !backup::is_safe_name(&name) {
        return Err("That backup name is not valid.".into());
    }
    let dir = data_dir(core.inner());
    let path = backup::dir(&dir).join(&name);
    std::fs::remove_file(&path).map_err(|e| format!("Could not delete that backup: {e}"))?;
    Ok(backup::list(&dir))
}

/// Reads and validates the backup first, copies the current data aside, then
/// swaps both files. A bad file leaves everything exactly as it was.
#[tauri::command]
pub fn restore_backup(
    app: AppHandle,
    core: State<'_, SharedCore>,
    name: String,
) -> Result<Snapshot, String> {
    if !backup::is_safe_name(&name) {
        return Err("That backup name is not valid.".into());
    }
    let (dir, settings_path, board_path) = {
        let c = lock(core.inner());
        (
            c.settings_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| std::env::temp_dir().join("flip-data")),
            c.settings_path.clone(),
            c.board_path.clone(),
        )
    };
    let raw = std::fs::read_to_string(backup::dir(&dir).join(&name))
        .map_err(|_| "That backup could not be read.".to_string())?;
    let restored = backup::decode(&raw)?;

    // Safety copy of the live data before anything is overwritten.
    let (current_settings, current_board) = {
        let c = lock(core.inner());
        (c.settings.clone(), c.board.clone())
    };
    backup::write(&dir, &current_settings, &current_board, true)?;

    settings::save(&settings_path, &restored.settings);
    board::save(&board_path, &restored.board);

    let snapshot = {
        let mut c = lock(core.inner());
        c.settings = restored.settings.clone();
        c.board = restored.board.clone();
        c.timer = Timer::new(restored.settings.timer_preset_secs);
        c.focus_target = None;
        c.snapshot(Instant::now())
    };

    if let Err(e) = app.emit("snapshot", &snapshot) {
        eprintln!("flip: could not emit snapshot: {e}");
    }
    if let Err(e) = app.emit("board-changed", ()) {
        eprintln!("flip: could not emit board-changed: {e}");
    }
    Ok(snapshot)
}

/// Where a downloaded file goes. Phones have no Downloads folder the app can
/// write to, so they fall back to Flip's own data folder.
fn export_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// Rejects names that could climb out of the folder or upset a filesystem.
fn safe_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let ok = !trimmed.is_empty()
        && trimmed.len() <= 120
        && !trimmed.contains(['/', '\\', ':'])
        && !trimmed.contains("..")
        && trimmed.chars().all(|c| !c.is_control());
    if ok {
        Ok(trimmed.to_string())
    } else {
        Err("That file name is not valid.".into())
    }
}

/// Writes a CSV or settings export into Downloads and answers with the path.
/// `separator` is only used by the CSVs: Excel with Vietnamese regional
/// settings expects `;`, most other tools expect `,`.
#[tauri::command]
pub fn export_data(
    app: AppHandle,
    core: State<'_, SharedCore>,
    kind: String,
    separator: Option<String>,
) -> Result<String, String> {
    let (settings, board) = {
        let c = lock(core.inner());
        (c.settings.clone(), c.board.clone())
    };
    let sep = match separator.as_deref() {
        Some(";") => ';',
        _ => ',',
    };
    let (name, body) = match kind.as_str() {
        "tasks" => ("Flip tasks.csv", backup::tasks_csv(&board, sep)),
        "timetable" => ("Flip timetable.csv", backup::timetable_csv(&board, sep)),
        "settings" => ("Flip settings.json", backup::settings_json(&settings)?),
        _ => return Err("Unknown export.".into()),
    };
    let name = safe_file_name(name)?;
    let path = export_dir(&app).join(&name);
    std::fs::write(&path, body).map_err(|e| format!("Could not write {name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Saves bytes the frontend built (an .xlsx workbook) next to the other
/// exports. Byte-for-byte, so Unicode never passes through a code page.
#[tauri::command]
pub fn save_export(app: AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 8_000_000 {
        return Err("That file is empty or far too large.".into());
    }
    let name = safe_file_name(&name)?;
    let path = export_dir(&app).join(&name);
    std::fs::write(&path, bytes).map_err(|e| format!("Could not write {name}: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(windows)]
fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open that folder: {e}"))
}

#[cfg(not(windows))]
fn reveal(_path: &Path) -> Result<(), String> {
    Err("Opening folders is only wired up on Windows.".into())
}

#[cfg(windows)]
fn open_link(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open that link: {e}"))
}

#[cfg(not(windows))]
fn open_link(_url: &str) -> Result<(), String> {
    Err("Opening links is only wired up on Windows.".into())
}

/// Opens a web link in the user's browser. Only http(s) is accepted, so a
/// tampered update manifest cannot ask the app to launch a local file.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("Only web links can be opened.".into());
    }
    open_link(trimmed)
}

/// The version this build was compiled with.
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn open_folder(core: State<'_, SharedCore>, kind: String) -> Result<(), String> {
    let dir = data_dir(core.inner());
    let target = if kind == "backups" {
        backup::dir(&dir)
    } else {
        dir
    };
    if !target.exists() {
        return Err("That folder does not exist yet.".into());
    }
    reveal(&target)
}
