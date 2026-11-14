//! Background ticker: the only place that turns time into UI events.

use std::thread;
use std::time::{Duration, Instant};

use chrono::Local;
use tauri::{AppHandle, Emitter, Manager};

use crate::board::{self, Board};
use crate::state::{lock, SharedCore, Snapshot};

const TICK_MS: u64 = 50;

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let mut last: Option<Snapshot> = None;
        loop {
            thread::sleep(Duration::from_millis(TICK_MS));

            let Some(shared) = app.try_state::<SharedCore>() else {
                continue;
            };

            let mut saved_board: Option<(std::path::PathBuf, Board)> = None;
            let mut focus_done: Option<u32> = None;

            let (snapshot, finished) = {
                let mut core = lock(shared.inner());
                let now = Instant::now();
                let finished = core.tick(now);

                /* A finished focus session is logged once, then forgotten, so a
                plain timer run never shows up in the study history. */
                if finished {
                    if let Some(target) = core.focus_target.take() {
                        let secs = core.timer.preset_secs();
                        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
                        core.board
                            .add_session(target.task_id, target.subject_id, secs, &today);
                        saved_board = Some((core.board_path.clone(), core.board.clone()));
                        focus_done = Some(secs);
                    }
                }

                (core.snapshot(now), finished)
            };

            if let Some((path, board)) = saved_board {
                board::save(&path, &board);
                if let Err(e) = app.emit("board-changed", ()) {
                    eprintln!("flip: could not emit board-changed: {e}");
                }
            }

            if last.as_ref() != Some(&snapshot) {
                if let Err(e) = app.emit("snapshot", &snapshot) {
                    eprintln!("flip: could not emit snapshot: {e}");
                }
                last = Some(snapshot);
            }

            if finished {
                if let Err(e) = app.emit("timer-finished", ()) {
                    eprintln!("flip: could not emit timer-finished: {e}");
                }
                if let Some(secs) = focus_done {
                    if let Err(e) = app.emit("focus-finished", secs) {
                        eprintln!("flip: could not emit focus-finished: {e}");
                    }
                }
            }
        }
    });
}
