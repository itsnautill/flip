//! Shared application state and the snapshot handed to the frontend.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use chrono::Timelike;
use serde::Serialize;

use crate::board::Board;
use crate::clock::{clock_view, ClockView};
use crate::settings::{Dashboard, Settings};
use crate::timer::{Timer, TimerView};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Clock,
    Timer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub mode: Mode,
    pub clock: ClockView,
    pub timer: TimerView,
    pub theme: String,
    /// "en" or "vi"; the UI picks its strings from this.
    pub language: String,
    /// Whether interface sounds are on.
    pub sound: bool,
    /// False only before the first-run setup has been dealt with.
    pub onboarded: bool,
    /// The colour the user picked; the UI derives weights and ink from it.
    pub accent: String,
    /// Length of one focus session, in seconds.
    pub focus_secs: u32,
    /// Widget order and visibility for the dashboard.
    pub dashboard: Dashboard,
    /// True while the running countdown is a focus session.
    pub focus_active: bool,
}

/// What the running countdown is being timed for, if anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusTarget {
    pub task_id: Option<String>,
    pub subject_id: Option<String>,
}

pub struct Core {
    pub mode: Mode,
    pub timer: Timer,
    pub settings: Settings,
    pub settings_path: PathBuf,
    pub board: Board,
    pub board_path: PathBuf,
    /// Set while the timer is a focus session; cleared when it is logged.
    pub focus_target: Option<FocusTarget>,
}

pub type SharedCore = Arc<Mutex<Core>>;

impl Core {
    pub fn new(
        mode: Mode,
        timer: Timer,
        settings: Settings,
        settings_path: PathBuf,
        board: Board,
        board_path: PathBuf,
    ) -> Self {
        Self {
            mode,
            timer,
            settings,
            settings_path,
            board,
            board_path,
            focus_target: None,
        }
    }

    pub fn snapshot(&self, now: Instant) -> Snapshot {
        let local = chrono::Local::now();
        Snapshot {
            mode: self.mode,
            clock: clock_view(local.hour(), local.minute(), self.settings.use_12h),
            timer: self.timer.view(now),
            theme: self.settings.theme.clone(),
            language: self.settings.language.clone(),
            sound: self.settings.sound,
            onboarded: self.settings.onboarded,
            accent: self.settings.accent.clone(),
            focus_secs: self.settings.focus_secs,
            dashboard: self.settings.dashboard.clone(),
            focus_active: self.focus_target.is_some(),
        }
    }

    pub fn tick(&mut self, now: Instant) -> bool {
        self.timer.tick(now)
    }
}

/// A poisoned lock must not take the app down: recover the inner value instead.
pub fn lock(core: &SharedCore) -> MutexGuard<'_, Core> {
    core.lock().unwrap_or_else(|e| e.into_inner())
}
