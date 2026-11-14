pub mod backup;
pub mod board;
pub mod clock;
pub mod commands;
pub mod settings;
pub mod state;
pub mod ticker;
pub mod timer;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::Manager;

use state::{Core, Mode, SharedCore};

/// Flip keeps its files in one stable, user-visible folder, so they survive
/// reinstall and never move when the app identifier changes.
const DATA_DIR: &str = "FlipData";
const DATA_FILES: [&str; 2] = ["settings.json", "board.json"];

/// `C:\Users\<name>\AppData\Local\Roaming\FlipData`, taken from the environment
/// rather than a hard-coded user name.
#[cfg(windows)]
fn preferred_data_dir() -> Option<PathBuf> {
    // %LOCALAPPDATA% is `…\AppData\Local`.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return Some(PathBuf::from(local).join("Roaming").join(DATA_DIR));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return Some(
            PathBuf::from(profile)
                .join("AppData")
                .join("Local")
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

/// The `…\AppData\FlipData` folder an earlier build used.
#[cfg(windows)]
fn previous_data_dir() -> Option<PathBuf> {
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return Some(PathBuf::from(profile).join("AppData").join(DATA_DIR));
    }
    None
}

#[cfg(not(windows))]
fn previous_data_dir() -> Option<PathBuf> {
    None
}

/// Adopts the files from older homes, newest first, the first time Flip starts
/// with the current one. A file already in the current folder always wins, and
/// the older folders are left in place as backups.
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
                Ok(_) => println!("flip: kept {name} from {}", source.display()),
                Err(e) => eprintln!("flip: could not copy {name}: {e}"),
            }
            break;
        }
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
            let mut sources: Vec<PathBuf> = Vec::new();
            if let Some(previous) = previous_data_dir() {
                sources.push(previous);
            }
            if let Some(identifier) = identifier_dir {
                sources.push(identifier);
            }
            migrate(&sources, &data_dir);
            let settings_path = data_dir.join("settings.json");
            let board_path = data_dir.join("board.json");
            let settings = settings::load(&settings_path);
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

            let shared: SharedCore = Arc::new(Mutex::new(core));
            app.manage(shared);

            ticker::spawn(app.handle().clone());
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
            commands::set_accent,
            commands::set_language,
            commands::set_sound,
            commands::set_onboarded,
            commands::set_motion,
            commands::open_url,
            commands::app_version,
            commands::save_template,
            commands::toggle_theme,
            commands::toggle_fullscreen,
            commands::exit_fullscreen,
            commands::get_board,
            commands::board_action,
            commands::start_focus,
            commands::cancel_focus,
            commands::set_dashboard,
            commands::make_backup,
            commands::list_backups,
            commands::delete_backup,
            commands::restore_backup,
            commands::export_data,
            commands::open_folder
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
    fn migrate_skips_missing_legacy_folders() {
        let root = scratch("migrate-missing");
        let data = root.join("data");
        std::fs::create_dir_all(&data).unwrap();

        migrate(&[root.join("gone"), root.join("also-gone")], &data);
        assert!(std::fs::read_dir(&data).unwrap().next().is_none());

        let _ = std::fs::remove_dir_all(&root);
    }
}
