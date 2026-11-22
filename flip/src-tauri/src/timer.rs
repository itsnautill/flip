//! Pure timer engine. Time is always passed in, so tests never sleep and the
//! core never depends on Tauri.

use std::time::{Duration, Instant};

use serde::Serialize;

/// Largest timer value we accept: 99:59:59.
pub const MAX_SECS: u32 = 359_999;

/// Longest microwave-style digit buffer: HHMMSS.
const MAX_DIGITS: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TimerState {
    Idle,
    Running,
    Paused,
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleResult {
    Started,
    Paused,
    Resumed,
    Reset,
    Refused,
}

/// What the UI needs to draw one timer frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerView {
    pub state: TimerState,
    pub h: String,
    pub m: String,
    pub s: String,
    pub show_hours: bool,
    pub typing: bool,
}

#[derive(Debug, Clone)]
pub struct Timer {
    state: TimerState,
    /// Digits typed in Idle mode, most significant last.
    buffer: Vec<u8>,
    preset_secs: u32,
    remaining: Duration,
    deadline: Option<Instant>,
}

impl Timer {
    pub fn new(preset_secs: u32) -> Self {
        let preset_secs = preset_secs.min(MAX_SECS);
        Self {
            state: TimerState::Idle,
            buffer: Vec::new(),
            preset_secs,
            remaining: Duration::from_secs(u64::from(preset_secs)),
            deadline: None,
        }
    }

    pub fn state(&self) -> TimerState {
        self.state
    }

    pub fn preset_secs(&self) -> u32 {
        self.preset_secs
    }

    pub fn digit(&mut self, d: u8) {
        if d > 9 {
            return;
        }
        if self.state == TimerState::Finished {
            self.reset();
        }
        if self.state != TimerState::Idle {
            return;
        }
        if d == 0 && self.buffer.is_empty() {
            return;
        }
        if self.buffer.len() >= MAX_DIGITS {
            return;
        }
        self.buffer.push(d);
    }

    pub fn backspace(&mut self) {
        if self.state == TimerState::Finished {
            self.reset();
        }
        if self.state != TimerState::Idle {
            return;
        }
        self.buffer.pop();
    }

    pub fn toggle(&mut self, now: Instant) -> ToggleResult {
        match self.state {
            TimerState::Idle => {
                let total = self.idle_secs();
                if total == 0 {
                    return ToggleResult::Refused;
                }
                self.preset_secs = total;
                self.remaining = Duration::from_secs(u64::from(total));
                self.deadline = Some(now + self.remaining);
                self.buffer.clear();
                self.state = TimerState::Running;
                ToggleResult::Started
            }
            TimerState::Running => {
                let deadline = self.deadline.unwrap_or(now);
                self.remaining = deadline.saturating_duration_since(now);
                self.deadline = None;
                self.state = TimerState::Paused;
                ToggleResult::Paused
            }
            TimerState::Paused => {
                self.deadline = Some(now + self.remaining);
                self.state = TimerState::Running;
                ToggleResult::Resumed
            }
            TimerState::Finished => {
                self.reset();
                ToggleResult::Reset
            }
        }
    }

    pub fn reset(&mut self) {
        self.state = TimerState::Idle;
        self.buffer.clear();
        self.deadline = None;
        self.remaining = Duration::from_secs(u64::from(self.preset_secs));
    }

    /// Replaces the duration from the set-timer dialog and stops the timer.
    pub fn set_preset(&mut self, secs: u32) {
        self.preset_secs = secs.min(MAX_SECS);
        self.reset();
    }

    /// Returns true exactly once, when a running timer reaches its deadline.
    pub fn tick(&mut self, now: Instant) -> bool {
        if self.state != TimerState::Running {
            return false;
        }
        match self.deadline {
            Some(deadline) if now >= deadline => {
                self.state = TimerState::Finished;
                self.remaining = Duration::ZERO;
                self.deadline = None;
                true
            }
            _ => false,
        }
    }

    pub fn display_secs(&self, now: Instant) -> u32 {
        let secs = match self.state {
            TimerState::Idle => self.idle_secs(),
            TimerState::Running => match self.deadline {
                Some(deadline) => ceil_secs(deadline.saturating_duration_since(now)),
                None => 0,
            },
            TimerState::Paused => ceil_secs(self.remaining),
            TimerState::Finished => 0,
        };
        secs.min(MAX_SECS)
    }

    /// Whole seconds already run down. A focus session stopped early credits
    /// this, so the minutes spent still count.
    pub fn spent_secs(&self, now: Instant) -> u32 {
        self.preset_secs.saturating_sub(self.display_secs(now))
    }

    pub fn view(&self, now: Instant) -> TimerView {
        let secs = self.display_secs(now);
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;
        TimerView {
            state: self.state,
            h: format!("{h:02}"),
            m: format!("{m:02}"),
            s: format!("{s:02}"),
            show_hours: h > 0,
            typing: self.state == TimerState::Idle && !self.buffer.is_empty(),
        }
    }

    fn idle_secs(&self) -> u32 {
        if self.buffer.is_empty() {
            self.preset_secs.min(MAX_SECS)
        } else {
            buffer_secs(&self.buffer)
        }
    }
}

fn ceil_secs(d: Duration) -> u32 {
    let millis = d.as_millis();
    let secs = millis.div_ceil(1000);
    u32::try_from(secs).unwrap_or(MAX_SECS).min(MAX_SECS)
}

/// Reads the digit buffer as HHMMSS, right aligned and zero padded on the left.
fn buffer_secs(buffer: &[u8]) -> u32 {
    let mut secs: u32 = 0;
    for (i, digit) in buffer.iter().rev().enumerate() {
        let weight = match i {
            0 => 1,
            1 => 10,
            2 => 60,
            3 => 600,
            4 => 3600,
            _ => 36_000,
        };
        secs = secs.saturating_add(u32::from(*digit) * weight);
    }
    secs.min(MAX_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(timer: &mut Timer, digits: &[u8]) {
        for d in digits {
            timer.digit(*d);
        }
    }

    #[test]
    fn four_digits_are_minutes_and_seconds() {
        let mut t = Timer::new(300);
        typed(&mut t, &[1, 5, 0, 0]);
        let now = Instant::now();
        let view = t.view(now);
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("00", "15", "00")
        );
        assert!(!view.show_hours);
        assert!(view.typing);
    }

    #[test]
    fn five_digits_grow_into_hours() {
        let mut t = Timer::new(300);
        typed(&mut t, &[1, 2, 3, 0, 0]);
        let view = t.view(Instant::now());
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("01", "23", "00")
        );
        assert!(view.show_hours);
    }

    #[test]
    fn backspace_removes_the_last_digit() {
        let mut t = Timer::new(300);
        typed(&mut t, &[1, 5, 0, 0]);
        t.backspace();
        let view = t.view(Instant::now());
        assert_eq!((view.m.as_str(), view.s.as_str()), ("01", "50"));
        t.backspace();
        t.backspace();
        t.backspace();
        assert_eq!(t.display_secs(Instant::now()), 300);
        assert!(!t.view(Instant::now()).typing);
    }

    #[test]
    fn six_digits_max_and_extra_ignored() {
        let mut t = Timer::new(300);
        typed(&mut t, &[1, 2, 3, 4, 5, 6, 7]);
        let view = t.view(Instant::now());
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("12", "34", "56")
        );
    }

    #[test]
    fn leading_zero_is_ignored() {
        let mut t = Timer::new(300);
        t.digit(0);
        assert!(!t.view(Instant::now()).typing);
        assert_eq!(t.display_secs(Instant::now()), 300);
        t.digit(0);
        assert!(!t.view(Instant::now()).typing);
        t.digit(5);
        assert_eq!(t.display_secs(Instant::now()), 5);
    }

    #[test]
    fn ninety_seconds_starts_as_one_thirty() {
        let mut t = Timer::new(90);
        let now = Instant::now();
        assert_eq!(t.toggle(now), ToggleResult::Started);
        let view = t.view(now);
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("00", "01", "30")
        );
        assert!(!view.show_hours);
    }

    #[test]
    fn seventy_five_minutes_becomes_three_cards() {
        let mut t = Timer::new(300);
        typed(&mut t, &[7, 5, 0, 0]);
        let now = Instant::now();
        assert_eq!(t.toggle(now), ToggleResult::Started);
        let view = t.view(now);
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("01", "15", "00")
        );
        assert!(view.show_hours);
    }

    #[test]
    fn total_is_capped_at_99_59_59() {
        let mut t = Timer::new(400_000);
        let now = Instant::now();
        assert_eq!(t.toggle(now), ToggleResult::Started);
        let view = t.view(now);
        assert_eq!(
            (view.h.as_str(), view.m.as_str(), view.s.as_str()),
            ("99", "59", "59")
        );
        assert_eq!(t.preset_secs(), MAX_SECS);
    }

    #[test]
    fn zero_is_refused() {
        let mut t = Timer::new(0);
        let now = Instant::now();
        assert_eq!(t.toggle(now), ToggleResult::Refused);
        assert_eq!(t.state(), TimerState::Idle);
        assert_eq!(t.display_secs(now), 0);
    }

    #[test]
    fn pause_and_resume_keep_the_remaining_time() {
        let mut t = Timer::new(100);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert_eq!(t.toggle(t0 + Duration::from_secs(10)), ToggleResult::Paused);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(10)), 90);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(40)), 90);
        assert_eq!(
            t.toggle(t0 + Duration::from_secs(40)),
            ToggleResult::Resumed
        );
        assert_eq!(t.display_secs(t0 + Duration::from_secs(40)), 90);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(90)), 40);
    }

    #[test]
    fn display_rounds_up_so_the_first_second_is_whole() {
        let mut t = Timer::new(300);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert_eq!(t.display_secs(t0), 300);
        assert_eq!(t.display_secs(t0 + Duration::from_millis(1)), 300);
        assert_eq!(t.display_secs(t0 + Duration::from_millis(1000)), 299);
        assert_eq!(t.display_secs(t0 + Duration::from_millis(1500)), 299);
        assert_eq!(t.display_secs(t0 + Duration::from_millis(299_999)), 1);
    }

    #[test]
    fn spent_time_grows_while_the_clock_runs() {
        let mut t = Timer::new(1800);
        let t0 = Instant::now();
        assert_eq!(t.spent_secs(t0), 0);
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert_eq!(t.spent_secs(t0 + Duration::from_secs(720)), 720);
        /* A pause freezes what has been spent, not the remaining time. */
        assert_eq!(
            t.toggle(t0 + Duration::from_secs(720)),
            ToggleResult::Paused
        );
        assert_eq!(t.spent_secs(t0 + Duration::from_secs(900)), 720);
        assert_eq!(
            t.toggle(t0 + Duration::from_secs(900)),
            ToggleResult::Resumed
        );
        assert_eq!(t.spent_secs(t0 + Duration::from_secs(960)), 780);
    }

    #[test]
    fn finishing_reports_exactly_once() {
        let mut t = Timer::new(2);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert!(!t.tick(t0 + Duration::from_secs(1)));
        assert!(t.tick(t0 + Duration::from_secs(2)));
        assert!(!t.tick(t0 + Duration::from_secs(3)));
        assert_eq!(t.state(), TimerState::Finished);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(3)), 0);
    }

    #[test]
    fn reset_returns_to_the_preset() {
        let mut t = Timer::new(300);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        t.reset();
        assert_eq!(t.state(), TimerState::Idle);
        assert_eq!(t.preset_secs(), 300);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(30)), 300);
    }

    #[test]
    fn toggle_from_finished_resets_to_idle() {
        let mut t = Timer::new(1);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert!(t.tick(t0 + Duration::from_secs(1)));
        assert_eq!(t.toggle(t0 + Duration::from_secs(2)), ToggleResult::Reset);
        assert_eq!(t.state(), TimerState::Idle);
        assert_eq!(t.display_secs(t0 + Duration::from_secs(2)), 1);
    }

    #[test]
    fn set_preset_replaces_the_duration_and_stops_the_clock() {
        let mut t = Timer::new(300);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        t.set_preset(1500);
        assert_eq!(t.state(), TimerState::Idle);
        assert_eq!(t.preset_secs(), 1500);
        assert_eq!(t.display_secs(t0), 1500);
        t.set_preset(500_000);
        assert_eq!(t.preset_secs(), MAX_SECS);
    }

    #[test]
    fn digits_are_ignored_while_running() {
        let mut t = Timer::new(30);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        typed(&mut t, &[9, 9]);
        assert_eq!(t.display_secs(t0), 30);
        assert!(!t.view(t0).typing);
        t.backspace();
        assert_eq!(t.display_secs(t0), 30);
    }

    #[test]
    fn digits_after_finish_start_a_new_buffer() {
        let mut t = Timer::new(1);
        let t0 = Instant::now();
        assert_eq!(t.toggle(t0), ToggleResult::Started);
        assert!(t.tick(t0 + Duration::from_secs(1)));
        t.digit(5);
        assert_eq!(t.state(), TimerState::Idle);
        assert_eq!(t.display_secs(t0), 5);
    }
}
