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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub mode: Mode,
    pub clock: ClockView,
    pub timer: TimerView,
    pub theme: String,
    /// The palette painted over the base; empty for none.
    pub palette: String,
    /// "en" or "vi"; the UI picks its strings from this.
    pub language: String,
    /// Whether interface sounds are on.
    pub sound: bool,
    /// Master volume for every interface sound, 0-100.
    pub sound_volume: u32,
    /// Cue ids the user switched off.
    pub sound_muted: Vec<String>,
    /// False only before the first-run setup has been dealt with.
    pub onboarded: bool,
    /// One of the animation modes; "snappy" means none.
    pub motion: String,
    /// "full", "notification" or "none".
    pub streak_effects: String,
    /// Whether the window plays its opening animation.
    pub startup_anim: bool,
    /// Bigger targets and spacing for touch screens.
    pub touch: bool,
    /// Interface zoom in percent; the window applies it.
    pub zoom: u32,
    /// Whether the accent wash gradient is painted behind the app.
    pub wash: bool,
    /// Whether Flip shares a small presence card with Discord.
    pub discord: bool,
    /// Whether the anonymous daily ping is on.
    pub telemetry: bool,
    /// Random per-install id; empty until telemetry is switched on.
    pub install_id: String,
    /// Hue of the accent the user picked; the UI derives every weight, the
    /// wash and the ink from it.
    pub accent_hue: f64,
    /// True while a timetable edit can be taken back. The history lives in
    /// memory only and never reaches the disk.
    pub can_undo: bool,
    pub can_redo: bool,
    /// Length of one focus session, in seconds.
    pub focus_secs: u32,
    /// True when a plain countdown is logged as study time too.
    pub timer_focus: bool,
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
    /// Timetable snapshots taken before each edit, newest last. At most
    /// `HISTORY_STEPS` of them, and never written to a file.
    pub undo_stack: Vec<Board>,
    pub redo_stack: Vec<Board>,
}

/// How many timetable edits can be taken back in one run.
pub const HISTORY_STEPS: usize = 40;

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
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    /// Stamps the board with the moment and the device, so a sync can tell
    /// which of two copies is the newer one. Called on every local change.
    pub fn touch_board(&mut self) {
        self.board.updated_ms = crate::sync::now_ms();
        self.board.updated_by = self.settings.device_id.clone();
    }

    /// Remembers the board as it was before an edit, and forgets any redo
    /// branch, exactly like a text editor would.
    pub fn remember(&mut self, before: Board) {
        self.undo_stack.push(before);
        if self.undo_stack.len() > HISTORY_STEPS {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    /// Puts the previous snapshot back and returns the one it replaced.
    pub fn undo(&mut self) -> Option<Board> {
        let previous = self.undo_stack.pop()?;
        let current = std::mem::replace(&mut self.board, previous);
        self.redo_stack.push(current);
        if self.redo_stack.len() > HISTORY_STEPS {
            self.redo_stack.remove(0);
        }
        Some(self.board.clone())
    }

    pub fn redo(&mut self) -> Option<Board> {
        let next = self.redo_stack.pop()?;
        let current = std::mem::replace(&mut self.board, next);
        self.undo_stack.push(current);
        Some(self.board.clone())
    }

    pub fn snapshot(&self, now: Instant) -> Snapshot {
        let local = chrono::Local::now();
        Snapshot {
            mode: self.mode,
            clock: clock_view(local.hour(), local.minute(), self.settings.use_12h),
            timer: self.timer.view(now),
            theme: self.settings.theme.clone(),
            palette: self.settings.palette.clone(),
            language: self.settings.language.clone(),
            sound: self.settings.sound,
            sound_volume: self.settings.sound_volume,
            sound_muted: self.settings.sound_muted.clone(),
            onboarded: self.settings.onboarded,
            motion: self.settings.motion.clone(),
            streak_effects: self.settings.streak_effects.clone(),
            startup_anim: self.settings.startup_anim,
            touch: self.settings.touch,
            zoom: self.settings.zoom,
            wash: self.settings.wash,
            discord: self.settings.discord,
            telemetry: self.settings.telemetry,
            install_id: self.settings.install_id.clone(),
            accent_hue: self
                .settings
                .accent_hue
                .unwrap_or(crate::settings::DEFAULT_ACCENT_HUE),
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            focus_secs: self.settings.focus_secs,
            timer_focus: self.settings.timer_focus,
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
