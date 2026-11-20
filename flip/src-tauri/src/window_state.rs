//! Desktop window comfort: Flip reopens at the size, place and pin it was left.
//! A phone has no window to remember, so this module is desktop only.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const FILE: &str = "window.json";

/// Only the geometry is kept here; everything else about the window is config.
#[derive(Default, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    size: Option<[u32; 2]>,
    #[serde(default)]
    place: Option<[i32; 2]>,
    #[serde(default)]
    maximized: bool,
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

/// Puts the window back where it was, before the first paint, so nothing jumps.
pub fn restore(app: &AppHandle, dir: &Path) {
    let state = load(dir);
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Some([width, height]) = state.size {
        /* The config's minimum: a stale tiny size must not hide the header. */
        if width >= 480 && height >= 300 {
            if let Err(e) = window.set_size(PhysicalSize::new(width, height)) {
                eprintln!("flip: could not restore window size: {e}");
            }
        }
    }

    if let Some([x, y]) = state.place {
        if on_screen(&window, x, y) {
            if let Err(e) = window.set_position(PhysicalPosition::new(x, y)) {
                eprintln!("flip: could not restore window position: {e}");
            }
        }
    }

    if state.maximized {
        if let Err(e) = window.maximize() {
            eprintln!("flip: could not restore the maximised window: {e}");
        }
    }

    if state.on_top {
        if let Err(e) = window.set_always_on_top(true) {
            eprintln!("flip: could not keep the window on top: {e}");
        }
    }
}

/// A window saved on a monitor that is no longer plugged in must not open off
/// every screen: the centred default is better than an invisible window.
fn on_screen(window: &WebviewWindow, x: i32, y: i32) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        return true;
    };
    if monitors.is_empty() {
        return true;
    }
    monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let size = monitor.size();
        /* Keep at least a corner of the header within reach. */
        x >= origin.x - 120
            && y >= origin.y - 60
            && x <= origin.x + size.width as i32 - 120
            && y <= origin.y + size.height as i32 - 60
    })
}

/// Called when the window is asked to close, while it still has a geometry.
pub fn save(app: &AppHandle, dir: &Path) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let mut state = load(dir);
    state.maximized = window.is_maximized().unwrap_or(false);
    /* A maximised or fullscreened window keeps the size it will return to. */
    let floating = !window.is_fullscreen().unwrap_or(false);
    if !state.maximized && floating {
        if let (Ok(size), Ok(place)) = (window.outer_size(), window.outer_position()) {
            state.size = Some([size.width, size.height]);
            state.place = Some([place.x, place.y]);
        }
    }
    store(dir, &state);
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
