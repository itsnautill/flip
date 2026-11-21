//! Desktop window comfort: Flip always opens at the configured default size,
//! centred, and remembers only whether the window was pinned on top.
//! A phone has no window to remember, so this module is desktop only.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE: &str = "window.json";

/// Only the pin survives a restart; size and place come from tauri.conf.json.
#[derive(Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    on_top: bool,
}

fn file(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

fn load(dir: &Path) -> State {
    std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn store(dir: &Path, state: &State) {
    let Ok(text) = serde_json::to_vec_pretty(state) else {
        return;
    };
    crate::write_atomic(&file(dir), &text, FILE);
}

/// Re-applies the pin before the first paint. The window itself keeps the size
/// and place the config asks for, so it opens small and centred every time.
pub fn restore(app: &AppHandle, dir: &Path) {
    let state = load(dir);
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if state.on_top {
        if let Err(e) = window.set_always_on_top(true) {
            eprintln!("flip: could not keep the window on top: {e}");
        }
    }
}

/// Keeps the window above the others and records the choice for next launch.
pub fn set_on_top(app: &AppHandle, dir: &Path, on: bool) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if let Err(e) = window.set_always_on_top(on) {
        eprintln!("flip: could not change the window pin: {e}");
        return false;
    }
    let mut state = load(dir);
    state.on_top = on;
    store(dir, &state);
    on
}
