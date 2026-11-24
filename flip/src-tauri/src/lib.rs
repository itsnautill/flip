pub mod backup;
pub mod board;
pub mod clock;
pub mod commands;
pub mod discord;
pub mod settings;
pub mod state;
pub mod sync;
pub mod ticker;
pub mod timer;
pub mod update;
#[cfg(desktop)]
pub mod window_state;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Writes a file through a temporary neighbour and a rename, so an interrupted
/// save leaves the previous file intact instead of half a JSON document.
pub fn write_atomic(path: &Path, bytes: &[u8], label: &str) {
    let temp = path.with_extension("tmp");
    if let Err(e) = std::fs::write(&temp, bytes) {
        eprintln!("flip: could not write {label}: {e}");
        let _ = std::fs::remove_file(&temp);
        return;
    }
    if let Err(e) = std::fs::rename(&temp, path) {
        eprintln!("flip: could not replace {label}: {e}");
        let _ = std::fs::remove_file(&temp);
    }
}

use tauri::Manager;

use state::{Core, Mode, SharedCore};

/// Flip keeps its files in one stable, user-visible folder, so they survive
/// reinstall and never move when the app identifier changes. Only the Windows
/// data-folder helpers use it; a phone keeps its files in app storage.
#[cfg(windows)]
const DATA_DIR: &str = "FlipData";
const DATA_FILES: [&str; 2] = ["settings.json", "board.json"];

/// `C:\Users\<name>\AppData\Roaming\FlipData`, taken from the environment rather
/// than a hard-coded user name.
#[cfg(windows)]
fn preferred_data_dir() -> Option<PathBuf> {
    // %APPDATA% is `…\AppData\Roaming`.
    if let Some(roaming) = std::env::var_os("APPDATA") {
        return Some(PathBuf::from(roaming).join(DATA_DIR));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return Some(
            PathBuf::from(profile)
                .join("AppData")
                .join("Roaming")
                .join(DATA_DIR),
        );
    }
    None
}

#[cfg(not(windows))]
fn preferred_data_dir() -> Option<PathBuf> {
    None
}

/// Folders earlier builds wrote to, newest first: 0.1.0 - 0.1.3 used
/// `…\AppData\Local\Roaming`, which is not a folder Windows really has, and the
/// very first builds used `…\AppData\FlipData`.
#[cfg(windows)]
fn legacy_data_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(PathBuf::from(local).join("Roaming").join(DATA_DIR));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        dirs.push(PathBuf::from(&profile).join("AppData").join(DATA_DIR));
        if std::env::var_os("LOCALAPPDATA").is_none() {
            dirs.push(
                PathBuf::from(&profile)
                    .join("AppData")
                    .join("Local")
                    .join("Roaming")
                    .join(DATA_DIR),
            );
        }
    }
    dirs
}

#[cfg(not(windows))]
fn legacy_data_dirs() -> Vec<PathBuf> {
    Vec::new()
}

/// Moves the files from an older home into the current one the first time Flip
/// starts with it. A file already in the current folder always wins, and a file
/// that has been copied is removed from the old folder so there is one truth.
fn migrate(sources: &[PathBuf], data: &Path) {
    for name in DATA_FILES {
        let target = data.join(name);
        if target.exists() {
            continue;
        }
        for source in sources {
            if source.as_path() == data {
                continue;
            }
            let from = source.join(name);
            if !from.exists() {
                continue;
            }
            match std::fs::copy(&from, &target) {
                Ok(_) => {
                    println!("flip: moved {name} from {}", source.display());
                    let _ = std::fs::remove_file(&from);
                }
                Err(e) => eprintln!("flip: could not move {name}: {e}"),
            }
            break;
        }
    }
    migrate_backups(sources, data);
}

/// Backups are the user's safety net, so they travel with the settings rather
/// than being stranded in a folder nobody would look in.
fn migrate_backups(sources: &[PathBuf], data: &Path) {
    let target_dir = data.join("backups");
    for source in sources {
        if source.as_path() == data {
            continue;
        }
        let from_dir = source.join("backups");
        let Ok(entries) = std::fs::read_dir(&from_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name() else {
                continue;
            };
            let target = target_dir.join(name);
            if target.exists() {
                continue;
            }
            if let Err(e) = std::fs::create_dir_all(&target_dir) {
                eprintln!("flip: could not create backups folder: {e}");
                return;
            }
            match std::fs::copy(&path, &target) {
                Ok(_) => {
                    let _ = std::fs::remove_file(&path);
                }
                Err(e) => eprintln!("flip: could not move backup {}: {e}", path.display()),
            }
        }
    }
}

/// Most of Flip's memory belongs to WebView2's own processes, not to the page.
/// The low-memory target is the runtime's own knob for handing idle caches
/// back, and it costs nothing on a phone (there is no WebView2 there).
#[cfg(windows)]
fn trim_webview_memory(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    };
    use windows_core::Interface;

    let trimmed = window.with_webview(|webview| {
        // SAFETY: both calls go through the live controller of this window's
        // webview, and an older runtime simply fails the cast.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            if let Ok(newer) = core.cast::<ICoreWebView2_19>() {
                let _ = newer.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
            }
        }
    });
    if let Err(e) = trimmed {
        eprintln!("flip: could not reach the webview to lower its memory target: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let identifier_dir = app.path().app_config_dir().ok();
            let data_dir = preferred_data_dir()
                .or_else(|| identifier_dir.clone())
                .unwrap_or_else(|| std::env::temp_dir().join("flip-data"));
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("flip: could not create data directory: {e}");
            }
            let mut sources: Vec<PathBuf> = legacy_data_dirs();
            if let Some(identifier) = identifier_dir {
                sources.push(identifier);
            }
            migrate(&sources, &data_dir);
            let settings_path = data_dir.join("settings.json");
            let board_path = data_dir.join("board.json");
            let settings = settings::load(&settings_path);
            let saved_zoom = settings.zoom;
            let board = board::load(&board_path);
            let timer = timer::Timer::new(settings.timer_preset_secs);
            let core = Core::new(
                Mode::Clock,
                timer,
                settings,
                settings_path,
                board,
                board_path,
            );

            /* The saved zoom has to reach the window, not just the settings file.
            Phones ignore it: the page is sized for the screen instead. */
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.set_zoom(saved_zoom as f64 / 100.0) {
                    eprintln!("flip: could not restore zoom: {e}");
                }
            }
            #[cfg(not(desktop))]
            let _ = saved_zoom;

            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                trim_webview_memory(&window);
            }

            /* Only the pin survives a restart: the window always opens at the
            small default size in the middle of the screen. */
            #[cfg(desktop)]
            window_state::restore(app.handle(), &data_dir);

            let shared: SharedCore = Arc::new(Mutex::new(core));
            app.manage(Arc::clone(&shared));
            /* Discord lives on the desktop; phones have no such IPC socket. */
            #[cfg(desktop)]
            app.manage(discord::spawn());

            ticker::spawn(app.handle().clone());
            /* Both devices host the same small endpoint, answer the same
            code lookup and watch the other, so a sync works whichever way
            round the two were set up. */
            sync::spawn(app.handle().clone(), Arc::clone(&shared));
            sync::spawn_finder(Arc::clone(&shared));
            sync::watch(app.handle().clone(), Arc::clone(&shared));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::switch_mode,
            commands::timer_digit,
            commands::timer_backspace,
            commands::timer_toggle,
            commands::timer_set,
            commands::timer_reset,
            commands::toggle_hour_format,
            commands::set_hour_format,
            commands::set_accent_hue,
            commands::set_language,
            commands::set_sound,
            commands::set_sound_volume,
            commands::set_sound_cue,
            commands::set_all_sound_cues,
            commands::set_streak_effects,
            commands::set_startup_anim,
            commands::set_onboarded,
            commands::set_motion,
            commands::set_telemetry,
            commands::open_url,
            commands::app_version,
            commands::save_template,
            commands::toggle_theme,
            commands::toggle_fullscreen,
            commands::exit_fullscreen,
            commands::set_on_top,
            commands::set_orientation,
            commands::set_immersive,
            commands::get_board,
            commands::board_action,
            commands::undo_board,
            commands::redo_board,
            commands::start_focus,
            commands::cancel_focus,
            commands::set_dashboard,
            commands::set_timer_focus,
            commands::make_backup,
            commands::list_backups,
            commands::delete_backup,
            commands::restore_backup,
            commands::export_data,
            commands::save_export,
            commands::read_timetable_table,
            commands::open_folder,
            commands::set_theme,
            commands::set_palette,
            commands::set_touch,
            commands::set_zoom,
            commands::set_wash,
            commands::set_discord,
            commands::sync_info,
            commands::set_pair_code,
            commands::sync_now,
            update::download_update,
            update::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Flip");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("flip-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    #[test]
    fn migrate_adopts_old_files_without_overwriting() {
        let root = scratch("migrate");
        let legacy = root.join("legacy");
        let data = root.join("data");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(legacy.join("board.json"), "{\"old\":true}").unwrap();
        std::fs::write(legacy.join("settings.json"), "{\"old\":true}").unwrap();

        migrate(std::slice::from_ref(&legacy), &data);
        assert!(data.join("board.json").exists());
        assert!(data.join("settings.json").exists());

        std::fs::write(data.join("board.json"), "{\"new\":true}").unwrap();
        migrate(&[legacy], &data);
        assert_eq!(
            std::fs::read_to_string(data.join("board.json")).unwrap(),
            "{\"new\":true}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_prefers_the_newest_folder_that_has_each_file() {
        let root = scratch("migrate-order");
        let newer = root.join("newer");
        let older = root.join("older");
        let data = root.join("data");
        for dir in [&newer, &older, &data] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(newer.join("board.json"), "{\"newer\":true}").unwrap();
        std::fs::write(older.join("board.json"), "{\"older\":true}").unwrap();
        std::fs::write(older.join("settings.json"), "{\"older\":true}").unwrap();

        migrate(&[newer, older], &data);
        assert_eq!(
            std::fs::read_to_string(data.join("board.json")).unwrap(),
            "{\"newer\":true}"
        );
        // Settings only existed in the older folder, so they are still adopted.
        assert_eq!(
            std::fs::read_to_string(data.join("settings.json")).unwrap(),
            "{\"older\":true}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_moves_backups_and_clears_the_old_home() {
        let root = scratch("migrate-backups");
        let legacy = root.join("legacy");
        let data = root.join("data");
        std::fs::create_dir_all(legacy.join("backups")).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(legacy.join("settings.json"), "{}").unwrap();
        std::fs::write(legacy.join("backups").join("flip-backup-2026.json"), "{}").unwrap();

        migrate(std::slice::from_ref(&legacy), &data);

        assert!(data.join("settings.json").exists());
        assert!(data.join("backups").join("flip-backup-2026.json").exists());
        assert!(!legacy.join("settings.json").exists());
        assert!(!legacy
            .join("backups")
            .join("flip-backup-2026.json")
            .exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_skips_missing_legacy_folders() {
        let root = scratch("migrate-missing");
        let data = root.join("data");
        std::fs::create_dir_all(&data).unwrap();

        migrate(&[root.join("gone"), root.join("also-gone")], &data);
        assert!(std::fs::read_dir(&data).unwrap().next().is_none());

        let _ = std::fs::remove_dir_all(&root);
    }
}
