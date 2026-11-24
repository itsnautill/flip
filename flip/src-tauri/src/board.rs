//! Timetable and task data. Pure logic: time is handed in, Tauri never leaks
//! in here, so the whole thing is testable without a window.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

/// Longest subject name and room label we accept.
pub const MAX_NAME: usize = 40;
/// Longest task title we accept.
pub const MAX_TITLE: usize = 200;
/// Longest task note we accept.
pub const MAX_NOTES: usize = 500;

/// Bumped when stored boards need converting. Version 2 stores a hue per
/// subject instead of a hex colour and allows a truly empty timetable.
pub const BOARD_VERSION: u32 = 2;

/// The hue a first subject gets: the warm rust Flip ships with.
/// Hues are OKLCH angles, where that rust sits at about 51 degrees.
pub const DEFAULT_HUE: f64 = 51.0;

/// The only day keys Flip stores, Monday first.
pub const DAY_KEYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// The gap used between periods until a quick setup says otherwise.
pub const DEFAULT_BREAK: u32 = 5;
pub const MAX_BREAK: u32 = 120;
/// A day column heading is short; anything longer is cut, not rejected.
pub const MAX_DAY_LABEL: usize = 24;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: String,
    pub name: String,
    /// 0 to 360. Only the hue is stored; the fill, border and ink are derived
    /// from it for the current theme when the timetable is drawn.
    #[serde(default, deserialize_with = "de_hue")]
    pub hue: f64,
    #[serde(default)]
    pub room: String,
    /// Files written before 1.1.1 stored a hex colour here. It is read once,
    /// converted to a hue, and never written again.
    #[serde(default, rename = "color", skip_serializing)]
    pub(crate) legacy_color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub id: String,
    pub label: String,
    pub start: String,
    pub end: String,
    #[serde(default, rename = "break")]
    pub is_break: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub subject_id: Option<String>,
    /// The day the task is planned for, `YYYY-MM-DD`.
    #[serde(default)]
    pub date: Option<String>,
    /// Optional deadline, `YYYY-MM-DD`.
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub done: bool,
}

/// A finished focus session, kept so the dashboard can show real study time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub task_id: Option<String>,
    pub subject_id: Option<String>,
    pub secs: u32,
    /// `YYYY-MM-DD` the session ended on.
    pub date: String,
}

/// How much focused time a day needs before it can join the streak. Short
/// timers still show up as study time, they just do not keep the run alive.
pub const STREAK_MIN_SECS: u32 = 10 * 60;

/// Study time for the dashboard, derived from the session log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusView {
    pub today_secs: u32,
    pub week_secs: u32,
    /// Consecutive days that each hold at least `STREAK_MIN_SECS`.
    pub streak: u32,
    pub sessions_today: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Board {
    pub version: u32,
    pub days: Vec<String>,
    pub periods: Vec<Period>,
    /// "<day>-<periodId>" -> subject id.
    pub cells: BTreeMap<String, String>,
    pub subjects: Vec<Subject>,
    pub tasks: Vec<Task>,
    /// task id -> the day the suggestion was snoozed on.
    pub snoozed: BTreeMap<String, String>,
    /// task ids that never get suggestions again.
    pub never: Vec<String>,
    /// Finished focus sessions, oldest first.
    pub sessions: Vec<Session>,
    pub week_start: String,
    /// True once the user built or skipped the quick setup, so the card does
    /// not greet them on every launch. Emptying the timetable brings it back.
    #[serde(default, alias = "guideDismissed")]
    pub setup_dismissed: bool,
    /// The break the quick-setup card was given, in minutes. "Add row" starts
    /// the next slot at the previous end plus this gap, so a new row rarely
    /// needs a typed time.
    pub break_minutes: u32,
    /// Day key -> the user's own name for that column. Missing means the usual
    /// "Mon", "Tue", ...
    pub day_labels: BTreeMap<String, String>,
    /// True while the timetable is read-only: every editing control (paint,
    /// add, rename, delete, import) stays hidden until it is unlocked.
    pub locked: bool,
    /// When this board last changed, in milliseconds since the epoch. A sync
    /// keeps whichever copy carries the later stamp.
    #[serde(default)]
    pub updated_ms: u64,
    /// The device that made that change, so an exact tie still has an answer.
    #[serde(default)]
    pub updated_by: String,
}

impl Default for Board {
    fn default() -> Self {
        Self {
            version: BOARD_VERSION,
            /* A new timetable is genuinely empty: no days, no rows, no
            subjects. The user builds it, and the empty-state card shows
            them how. */
            days: Vec::new(),
            periods: Vec::new(),
            cells: BTreeMap::new(),
            subjects: Vec::new(),
            tasks: Vec::new(),
            snoozed: BTreeMap::new(),
            never: Vec::new(),
            sessions: Vec::new(),
            week_start: "Mon".into(),
            setup_dismissed: false,
            break_minutes: DEFAULT_BREAK,
            day_labels: BTreeMap::new(),
            locked: false,
            updated_ms: 0,
            updated_by: String::new(),
        }
    }
}

/* ------------------------------------------------------------------ loading */

/// A missing, unreadable or corrupt file falls back to a fresh board. A file
/// that will not parse is copied aside first, so nothing is ever thrown away.
pub fn load(path: &Path) -> Board {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<Board>(&raw) {
            Ok(mut board) => {
                board.sanitize();
                board
            }
            Err(e) => {
                eprintln!("flip: ignoring unreadable timetable: {e}");
                keep_corrupt_copy(path);
                Board::default()
            }
        },
        Err(_) => Board::default(),
    }
}

/// Copies a file Flip could not read next to itself, with a timestamp, so a
/// corrupt or hand-edited board can be recovered instead of silently lost.
pub fn keep_corrupt_copy(path: &Path) {
    if !path.exists() {
        return;
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "board.json".into());
    let copy = path.with_file_name(format!("{name}.unreadable-{stamp}"));
    if let Err(e) = std::fs::copy(path, &copy) {
        eprintln!("flip: could not keep a copy of the unreadable file: {e}");
    }
}

pub fn save(path: &Path, board: &Board) {
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("flip: could not create data directory: {e}");
            return;
        }
    }
    match serde_json::to_string_pretty(board) {
        Ok(json) => crate::write_atomic(path, json.as_bytes(), "timetable"),
        Err(e) => eprintln!("flip: could not encode timetable: {e}"),
    }
}

impl Board {
    /// Drops anything a hand-edited file could get wrong. An empty timetable is
    /// a valid one, so nothing is invented here.
    pub(crate) fn sanitize(&mut self) {
        self.version = BOARD_VERSION;
        let mut days: Vec<String> = Vec::new();
        for day in &self.days {
            if DAY_KEYS.contains(&day.as_str()) && !days.contains(day) {
                days.push(day.clone());
            }
        }
        /* The stored order is the column order: the user may have moved a day. */
        self.days = days;
        self.break_minutes = self.break_minutes.min(MAX_BREAK);
        let present: HashSet<&str> = self.days.iter().map(String::as_str).collect();
        self.day_labels
            .retain(|key, label| present.contains(key.as_str()) && !label.trim().is_empty());
        for label in self.day_labels.values_mut() {
            *label = clamp(label.trim(), MAX_DAY_LABEL);
        }
        self.periods.truncate(24);
        for p in &mut self.periods {
            p.label = clamp(&p.label, 24);
            if parse_hhmm(&p.start).is_none() {
                p.start = "08:00".into();
            }
            if parse_hhmm(&p.end).is_none() {
                p.end = "08:45".into();
            }
            if parse_hhmm(&p.end) <= parse_hhmm(&p.start) {
                p.end = fmt_hhmm(parse_hhmm(&p.start).unwrap_or(480) + 45);
            }
        }
        if self.week_start != "Sun" {
            self.week_start = "Mon".into();
        }
        /* Same name, same class: earlier builds could leave two records with
        one name (renaming a single cell of a shared subject made a copy).
        Keep the oldest, point every cell and task at it, drop the rest. */
        let mut seen_names: BTreeMap<String, String> = BTreeMap::new();
        let mut merged: BTreeMap<String, String> = BTreeMap::new();
        let mut kept: Vec<Subject> = Vec::new();
        for subject in std::mem::take(&mut self.subjects) {
            let key = subject.name.trim().to_lowercase();
            if let Some(kept_id) = seen_names.get(&key).cloned() {
                merged.insert(subject.id.clone(), kept_id.clone());
                if let Some(existing) = kept.iter_mut().find(|s| s.id == kept_id) {
                    if existing.room.trim().is_empty() && !subject.room.trim().is_empty() {
                        existing.room = subject.room.clone();
                    }
                }
            } else {
                seen_names.insert(key, subject.id.clone());
                kept.push(subject);
            }
        }
        self.subjects = kept;
        if !merged.is_empty() {
            for id in self.cells.values_mut() {
                if let Some(target) = merged.get(id) {
                    *id = target.clone();
                }
            }
            for task in &mut self.tasks {
                if let Some(target) = task.subject_id.as_ref().and_then(|id| merged.get(id)) {
                    task.subject_id = Some(target.clone());
                }
            }
        }

        // Cells may only point at subjects and periods that still exist.
        let subject_ids: HashSet<String> = self.subjects.iter().map(|s| s.id.clone()).collect();
        let period_ids: HashSet<String> = self.periods.iter().map(|p| p.id.clone()).collect();
        let days = self.days.clone();
        self.cells.retain(|key, subject| {
            let mut parts = key.splitn(2, '-');
            let day = parts.next().unwrap_or("");
            let period = parts.next().unwrap_or("");
            days.iter().any(|d| d == day)
                && period_ids.contains(period)
                && subject_ids.contains(subject)
        });
        for t in &mut self.tasks {
            t.title = clamp(&t.title, MAX_TITLE);
            if let Some(subject) = &t.subject_id {
                if !subject_ids.contains(subject) {
                    t.subject_id = None;
                }
            }
        }
        self.tasks.retain(|t| !t.title.trim().is_empty());
        let task_ids: HashSet<String> = self.tasks.iter().map(|t| t.id.clone()).collect();
        self.snoozed.retain(|id, _| task_ids.contains(id));
        self.never.retain(|id| task_ids.contains(id));
        self.subjects.retain(|s| !s.name.trim().is_empty());
        /* Version 1 stored a hex colour; turn it into the nearest hue so the
        subject keeps the colour its owner chose. */
        for subject in &mut self.subjects {
            if !subject.legacy_color.is_empty() {
                if let Some(hue) = hue_from_hex(&subject.legacy_color) {
                    subject.hue = hue;
                }
                subject.legacy_color.clear();
            }
            subject.hue = normalise_hue(subject.hue);
        }
        // Sessions only need a real date and a sane length; links may dangle
        // because a session is history, not a reference.
        self.sessions
            .retain(|s| !s.date.is_empty() && parse_date(&s.date).is_some() && s.secs > 0);
        for s in &mut self.sessions {
            s.secs = s.secs.min(43_200);
        }
        let excess = self.sessions.len().saturating_sub(400);
        if excess > 0 {
            self.sessions.drain(..excess);
        }
    }

    /// The Monday (or Sunday) that starts the week containing `today`.
    fn week_start_date(&self, today: NaiveDate) -> NaiveDate {
        let weekday = i64::from(today.weekday().num_days_from_monday());
        let offset = if self.week_start == "Sun" {
            (weekday + 1) % 7
        } else {
            weekday
        };
        today - Duration::days(offset)
    }

    /// Adds a finished focus session, keeping the log bounded.
    pub fn add_session(
        &mut self,
        task_id: Option<String>,
        subject_id: Option<String>,
        secs: u32,
        date: &str,
    ) {
        if secs == 0 || parse_date(date).is_none() {
            return;
        }
        self.sessions.push(Session {
            id: format!("s{}", chrono::Local::now().timestamp_millis()),
            task_id,
            subject_id,
            secs: secs.min(43_200),
            date: date.to_string(),
        });
        let excess = self.sessions.len().saturating_sub(400);
        if excess > 0 {
            self.sessions.drain(..excess);
        }
    }

    /// Today's and this week's study time plus a run of consecutive study days.
    pub fn focus_view(&self, today: NaiveDate) -> FocusView {
        let start = self.week_start_date(today);
        let end = start + Duration::days(6);
        let today_text = fmt_date(today);
        let mut today_secs: u32 = 0;
        let mut week_secs: u32 = 0;
        let mut sessions_today: u32 = 0;
        let mut studied: HashMap<NaiveDate, u32> = HashMap::new();
        for session in &self.sessions {
            week_secs = week_secs.saturating_add(session.secs);
            let Some(date) = parse_date(&session.date) else {
                continue;
            };
            let day_secs = studied.entry(date).or_insert(0);
            *day_secs = day_secs.saturating_add(session.secs);
            if session.date == today_text {
                today_secs = today_secs.saturating_add(session.secs);
                sessions_today += 1;
            }
            if date < start || date > end {
                week_secs = week_secs.saturating_sub(session.secs);
            }
        }
        /* A day joins the streak only once it holds a real study session, so a
           one-second timer cannot keep the run going. */
        let counts = |day: NaiveDate| {
            studied
                .get(&day)
                .map_or(false, |secs| *secs >= STREAK_MIN_SECS)
        };
        // A streak survives until the end of today, so yesterday still counts.
        let mut streak = 0;
        let mut cursor = if counts(today) {
            today
        } else {
            today - Duration::days(1)
        };
        while counts(cursor) {
            streak += 1;
            cursor -= Duration::days(1);
        }
        FocusView {
            today_secs,
            week_secs,
            streak,
            sessions_today,
        }
    }
}

/// One lesson row read from an imported spreadsheet or the AI parser.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    /// "Mon" to "Sun".
    pub day: String,
    /// "HH:MM".
    pub start: String,
    pub end: String,
    pub subject: String,
    #[serde(default)]
    pub room: String,
}

/// One cell address, as the grid passes it back for brush painting.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellRef {
    pub day: String,
    #[serde(rename = "periodId")]
    pub period_id: String,
}

/* ------------------------------------------------------------------ actions */

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BoardAction {
    SaveCell {
        day: String,
        #[serde(rename = "periodId")]
        period_id: String,
        name: String,
        /// 0-360. Missing means "keep this subject's hue, or pick a new one".
        #[serde(default)]
        hue: Option<f64>,
        #[serde(default)]
        room: String,
        #[serde(default, rename = "applyAll")]
        apply_all: bool,
    },
    AddDay {
        day: String,
    },
    RemoveDay {
        day: String,
    },
    /// Gives a day column its own heading. An empty label restores "Mon".
    RenameDay {
        day: String,
        #[serde(default)]
        label: String,
    },
    /// Moves a day column left (-1) or right (+1).
    MoveDay {
        day: String,
        offset: i32,
    },
    /// The gap "Add row" leaves after the previous slot, in minutes.
    SetBreak {
        #[serde(rename = "minutes")]
        minutes: u32,
    },
    /// Locks the grid read-only, or opens it for editing again.
    SetLocked {
        locked: bool,
    },
    /// Closes (or reopens) the empty-timetable guide.
    SetGuide {
        #[serde(rename = "dismissed")]
        dismissed: bool,
    },
    /// Places one subject on the day it was typed into, plus any extra days
    /// the user ticked in the same popover.
    SaveCellMany {
        day: String,
        #[serde(rename = "periodId")]
        period_id: String,
        name: String,
        #[serde(default)]
        hue: Option<f64>,
        #[serde(default)]
        room: String,
        #[serde(default)]
        also: Vec<String>,
    },
    /// Fills a whole grid from the quick-setup card: days and time slots only.
    CreateGrid {
        days: Vec<String>,
        start: String,
        #[serde(rename = "periodMins")]
        period_mins: u32,
        #[serde(rename = "breakMins")]
        break_mins: u32,
        count: u32,
        #[serde(default, rename = "longAfter")]
        long_after: Option<u32>,
        #[serde(default, rename = "longMins")]
        long_mins: u32,
    },
    /// Closes or reopens the quick-setup card.
    SetSetup {
        dismissed: bool,
    },
    /// Drag and drop: the two cells swap when the target is already taken, so
    /// nothing is ever silently overwritten.
    MoveCell {
        #[serde(rename = "fromDay")]
        from_day: String,
        #[serde(rename = "fromPeriod")]
        from_period: String,
        #[serde(rename = "toDay")]
        to_day: String,
        #[serde(rename = "toPeriod")]
        to_period: String,
    },
    /// Brush mode: paints one subject into the listed cells.
    PaintCells {
        #[serde(rename = "subjectId")]
        subject_id: String,
        cells: Vec<CellRef>,
    },
    /// Removes a subject and every cell that used it.
    RemoveSubject {
        id: String,
    },
    /// Moves a row up (-1) or down (+1) in the list.
    MovePeriod {
        id: String,
        offset: i32,
    },
    ClearCell {
        day: String,
        #[serde(rename = "periodId")]
        period_id: String,
    },
    UpdatePeriod {
        id: String,
        label: String,
        start: String,
        end: String,
        #[serde(default, rename = "isBreak")]
        is_break: bool,
        /// When the times move, shift every later row by the same amount so the
        /// day stays in one piece.
        #[serde(default, rename = "shiftLater")]
        shift_later: bool,
    },
    AddPeriod,
    RemovePeriod {
        id: String,
    },
    SetWeekend {
        show: bool,
    },
    SetWeekStart {
        start: String,
    },
    ResetTimetable,
    /// Adds lessons read from a spreadsheet or the AI parser. `merge` keeps the
    /// rows and subjects already on the timetable instead of starting fresh.
    ImportTimetable {
        rows: Vec<ImportRow>,
        #[serde(default)]
        merge: bool,
    },
    AddTask {
        title: String,
        #[serde(default, rename = "subjectId")]
        subject_id: Option<String>,
        #[serde(default)]
        date: Option<String>,
        #[serde(default)]
        due: Option<String>,
        #[serde(default)]
        time: String,
        #[serde(default)]
        notes: String,
        #[serde(default)]
        priority: Option<Priority>,
    },
    UpdateTask {
        id: String,
        title: String,
        #[serde(default, rename = "subjectId")]
        subject_id: Option<String>,
        #[serde(default)]
        date: Option<String>,
        #[serde(default)]
        due: Option<String>,
        #[serde(default)]
        time: String,
        #[serde(default)]
        notes: String,
        #[serde(default)]
        priority: Option<Priority>,
    },
    ToggleTask {
        id: String,
    },
    DeleteTask {
        id: String,
    },
    ScheduleTask {
        id: String,
        date: String,
    },
    Unschedule {
        id: String,
    },
    Snooze {
        ids: Vec<String>,
    },
    NeverSuggest {
        ids: Vec<String>,
    },
}

impl Board {
    /// Applies one edit. `today` is the local date as `YYYY-MM-DD`.
    pub fn apply(&mut self, action: BoardAction, today: &str) -> Result<(), String> {
        match action {
            BoardAction::SaveCell {
                day,
                period_id,
                name,
                hue,
                room,
                apply_all,
            } => self.save_cell(&day, &period_id, &name, hue, &room, apply_all),
            BoardAction::SaveCellMany {
                day,
                period_id,
                name,
                hue,
                room,
                also,
            } => self.save_cell_many(&day, &period_id, &name, hue, &room, &also),
            BoardAction::CreateGrid {
                days,
                start,
                period_mins,
                break_mins,
                count,
                long_after,
                long_mins,
            } => self.create_grid(
                &days,
                &start,
                period_mins,
                break_mins,
                count,
                long_after,
                long_mins,
            ),
            BoardAction::SetSetup { dismissed } => {
                self.setup_dismissed = dismissed;
                Ok(())
            }
            BoardAction::MoveCell {
                from_day,
                from_period,
                to_day,
                to_period,
            } => self.move_cell(&from_day, &from_period, &to_day, &to_period),
            BoardAction::PaintCells { subject_id, cells } => self.paint_cells(&subject_id, &cells),
            BoardAction::RemoveSubject { id } => self.remove_subject(&id),
            BoardAction::MovePeriod { id, offset } => self.move_period(&id, offset),
            BoardAction::AddDay { day } => self.add_day(&day),
            BoardAction::RemoveDay { day } => self.remove_day(&day),
            BoardAction::RenameDay { day, label } => self.rename_day(&day, &label),
            BoardAction::MoveDay { day, offset } => self.move_day(&day, offset),
            BoardAction::SetBreak { minutes } => {
                self.break_minutes = minutes.min(MAX_BREAK);
                Ok(())
            }
            BoardAction::SetLocked { locked } => {
                self.locked = locked;
                Ok(())
            }
            BoardAction::SetGuide { dismissed } => {
                self.setup_dismissed = dismissed;
                Ok(())
            }
            BoardAction::ClearCell { day, period_id } => {
                self.clear_cell(&day, &period_id);
                Ok(())
            }
            BoardAction::UpdatePeriod {
                id,
                label,
                start,
                end,
                is_break,
                shift_later,
            } => self.update_period(&id, &label, &start, &end, is_break, shift_later),
            BoardAction::AddPeriod => self.add_period(),
            BoardAction::RemovePeriod { id } => self.remove_period(&id),
            BoardAction::SetWeekend { show } => {
                self.days.retain(|d| d != "Sat" && d != "Sun");
                if show {
                    /* Appended, so a column order the user arranged stays put. */
                    self.days.push("Sat".into());
                    self.days.push("Sun".into());
                }
                self.day_labels.retain(|key, _| self.days.contains(key));
                Ok(())
            }
            BoardAction::SetWeekStart { start } => {
                self.week_start = if start == "Sun" { "Sun" } else { "Mon" }.into();
                Ok(())
            }
            BoardAction::ImportTimetable { rows, merge } => self.import_timetable(rows, merge),
            BoardAction::ResetTimetable => {
                /* Reset means a blank timetable, not the old default rows:
                the user starts again from the guide. */
                self.days.clear();
                self.day_labels.clear();
                self.periods.clear();
                self.cells.clear();
                self.week_start = "Mon".into();
                self.setup_dismissed = false;
                // Subjects that tasks still point at stay, so their chips keep a name.
                let linked: HashSet<String> = self
                    .tasks
                    .iter()
                    .filter_map(|t| t.subject_id.clone())
                    .collect();
                self.subjects.retain(|s| linked.contains(&s.id));
                Ok(())
            }
            BoardAction::AddTask {
                title,
                subject_id,
                date,
                due,
                time,
                notes,
                priority,
            } => {
                let mut task =
                    self.clean_task(None, &title, subject_id, date, due, &time, &notes)?;
                task.priority = priority;
                self.tasks.push(task);
                Ok(())
            }
            BoardAction::UpdateTask {
                id,
                title,
                subject_id,
                date,
                due,
                time,
                notes,
                priority,
            } => {
                let mut updated =
                    self.clean_task(Some(&id), &title, subject_id, date, due, &time, &notes)?;
                updated.priority = priority;
                match self.tasks.iter_mut().find(|t| t.id == id) {
                    Some(task) => {
                        updated.done = task.done;
                        *task = updated;
                        Ok(())
                    }
                    None => Err("That task no longer exists.".into()),
                }
            }
            BoardAction::ToggleTask { id } => match self.tasks.iter_mut().find(|t| t.id == id) {
                Some(task) => {
                    task.done = !task.done;
                    Ok(())
                }
                None => Err("That task no longer exists.".into()),
            },
            BoardAction::DeleteTask { id } => {
                self.tasks.retain(|t| t.id != id);
                self.snoozed.remove(&id);
                self.never.retain(|x| x != &id);
                Ok(())
            }
            BoardAction::ScheduleTask { id, date } => {
                if parse_date(&date).is_none() {
                    return Err("Pick a valid day first.".into());
                }
                match self.tasks.iter_mut().find(|t| t.id == id) {
                    Some(task) => {
                        task.date = Some(date);
                        Ok(())
                    }
                    None => Err("That task no longer exists.".into()),
                }
            }
            BoardAction::Unschedule { id } => match self.tasks.iter_mut().find(|t| t.id == id) {
                Some(task) => {
                    task.date = None;
                    Ok(())
                }
                None => Err("That task no longer exists.".into()),
            },
            BoardAction::Snooze { ids } => {
                for id in ids {
                    if self.tasks.iter().any(|t| t.id == id) {
                        self.snoozed.insert(id, today.to_string());
                    }
                }
                Ok(())
            }
            BoardAction::NeverSuggest { ids } => {
                for id in ids {
                    if self.tasks.iter().any(|t| t.id == id) && !self.never.contains(&id) {
                        self.never.push(id);
                    }
                }
                Ok(())
            }
        }
    }

    fn save_cell(
        &mut self,
        day: &str,
        period_id: &str,
        name: &str,
        hue: Option<f64>,
        room: &str,
        apply_all: bool,
    ) -> Result<(), String> {
        if !self.days.iter().any(|d| d == day) {
            return Err("That day is not on the timetable.".into());
        }
        match self.periods.iter().find(|p| p.id == period_id) {
            Some(period) if !period.is_break => {}
            Some(_) => return Err("That row is a break - pick a class period.".into()),
            None => return Err("That period no longer exists.".into()),
        }
        let name = name.trim();
        if name.is_empty() {
            return Err("Subject name is required.".into());
        }
        if name.chars().count() > MAX_NAME {
            return Err(format!(
                "Subject names are limited to {MAX_NAME} characters."
            ));
        }
        let room = room.trim();
        if room.chars().count() > MAX_NAME {
            return Err(format!("Room names are limited to {MAX_NAME} characters."));
        }
        let key = cell_key(day, period_id);
        let current = self.cells.get(&key).cloned();
        let current_hue = current
            .as_ref()
            .and_then(|id| self.subjects.iter().find(|s| &s.id == id).map(|s| s.hue));
        let hue = match hue {
            Some(value) => normalise_hue(value),
            None => current_hue.unwrap_or_else(|| self.next_hue()),
        };

        if apply_all {
            let old_name = current.as_ref().and_then(|old_id| {
                self.subjects
                    .iter()
                    .find(|s| &s.id == old_id)
                    .map(|s| s.name.clone())
            });
            if let Some(old_name) = old_name {
                for subject in &mut self.subjects {
                    if subject.name.eq_ignore_ascii_case(&old_name) {
                        subject.name = name.into();
                    }
                }
            }
        }

        match current {
            Some(id) => {
                let shared = self.cells.values().filter(|v| **v == id).count() > 1;
                let renamed = self
                    .subjects
                    .iter()
                    .find(|s| s.id == id)
                    .is_some_and(|s| s.name != name);
                if shared && !apply_all && renamed {
                    // Editing one cell should not rename the same subject
                    // elsewhere - but if that name already belongs to another
                    // subject, use it instead of making a duplicate.
                    let existing = self
                        .subjects
                        .iter_mut()
                        .find(|s| s.id != id && s.name.eq_ignore_ascii_case(name))
                        .map(|subject| {
                            subject.hue = hue;
                            subject.legacy_color.clear();
                            if !room.is_empty() {
                                subject.room = room.into();
                            }
                            subject.id.clone()
                        });
                    let new_id = match existing {
                        Some(id) => id,
                        None => {
                            let fresh = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                            self.subjects.push(Subject {
                                id: fresh.clone(),
                                name: name.into(),
                                hue,
                                room: room.into(),
                                legacy_color: String::new(),
                            });
                            fresh
                        }
                    };
                    self.cells.insert(key, new_id);
                } else if let Some(subject) = self.subjects.iter_mut().find(|s| s.id == id) {
                    subject.name = name.into();
                    subject.hue = hue;
                    subject.room = room.into();
                }
            }
            None => {
                // Reuse a subject with the same name so the dot and tooltip are shared.
                if let Some(existing) = self
                    .subjects
                    .iter_mut()
                    .find(|s| s.name.eq_ignore_ascii_case(name))
                {
                    let id = existing.id.clone();
                    existing.hue = hue;
                    existing.legacy_color.clear();
                    self.cells.insert(key, id);
                } else {
                    let new_id = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                    self.subjects.push(Subject {
                        id: new_id.clone(),
                        name: name.into(),
                        hue,
                        room: room.into(),
                        legacy_color: String::new(),
                    });
                    self.cells.insert(key, new_id);
                }
            }
        }
        Ok(())
    }

    /// A hue for a new subject: the golden angle away from what is already
    /// there, so two subjects never come out the same colour.
    fn next_hue(&self) -> f64 {
        if self.subjects.is_empty() {
            return DEFAULT_HUE;
        }
        let taken: Vec<f64> = self.subjects.iter().map(|s| s.hue).collect();
        let start = taken[taken.len() - 1];
        let mut best = normalise_hue(start + 137.5);
        let mut best_gap = 0.0;
        for step in 1..=24 {
            let candidate = normalise_hue(start + 137.5 * f64::from(step));
            let gap = taken
                .iter()
                .map(|hue| hue_distance(candidate, *hue))
                .fold(360.0, f64::min);
            if gap > best_gap {
                best = candidate;
                best_gap = gap;
            }
            if gap >= 48.0 {
                break;
            }
        }
        best
    }

    fn add_day(&mut self, day: &str) -> Result<(), String> {
        let trimmed = day.trim();
        let Some(key) = DAY_KEYS.iter().find(|d| d.eq_ignore_ascii_case(trimmed)) else {
            return Err("Days must be Mon to Sun.".into());
        };
        if self.days.iter().any(|d| d == key) {
            return Err(format!("{key} is already on the timetable."));
        }
        if self.days.len() >= 7 {
            return Err("Every day is already on the timetable.".into());
        }
        /* Inserted at its weekday place, so a column order the user moved by
        hand keeps working instead of snapping back to Mon..Sun. */
        let rank = DAY_KEYS.iter().position(|k| k == key).unwrap_or(0);
        let at = self
            .days
            .iter()
            .position(|d| DAY_KEYS.iter().position(|k| k == d).unwrap_or(0) > rank)
            .unwrap_or(self.days.len());
        self.days.insert(at, (*key).to_string());
        self.setup_dismissed = false;
        Ok(())
    }

    fn rename_day(&mut self, day: &str, label: &str) -> Result<(), String> {
        if !self.days.iter().any(|d| d == day) {
            return Err("That day is not on the timetable.".into());
        }
        let clean = clamp(label, MAX_DAY_LABEL);
        if clean.is_empty() {
            self.day_labels.remove(day);
        } else {
            self.day_labels.insert(day.to_string(), clean);
        }
        Ok(())
    }

    fn move_day(&mut self, day: &str, offset: i32) -> Result<(), String> {
        let Some(at) = self.days.iter().position(|d| d == day) else {
            return Err("That day is not on the timetable.".into());
        };
        let to = at as i32 + offset;
        /* The ends simply do not move: no error, nothing to explain. */
        if to >= 0 && (to as usize) < self.days.len() {
            self.days.swap(at, to as usize);
        }
        Ok(())
    }

    fn remove_day(&mut self, day: &str) -> Result<(), String> {
        if !self.days.iter().any(|d| d == day) {
            return Err("That day is not on the timetable.".into());
        }
        self.days.retain(|d| d != day);
        self.day_labels.remove(day);
        let prefix = format!("{day}-");
        self.cells.retain(|key, _| !key.starts_with(&prefix));
        Ok(())
    }

    /// Replaces the timetable with spreadsheet rows. Everything is validated
    /// first so a bad file can never leave half a timetable behind.
    fn import_timetable(&mut self, rows: Vec<ImportRow>, merge: bool) -> Result<(), String> {
        if rows.is_empty() {
            return Err("That sheet has no lessons to import.".into());
        }
        if rows.len() > 500 {
            return Err("That sheet has more than 500 rows.".into());
        }

        let mut lessons: Vec<(String, u32, u32, String, String)> = Vec::with_capacity(rows.len());
        for (index, row) in rows.iter().enumerate() {
            // Spreadsheet rows are 1-based and the first one is the header.
            let line = index + 2;
            let day = DAY_KEYS
                .iter()
                .find(|key| key.eq_ignore_ascii_case(row.day.trim()))
                .ok_or_else(|| format!("Row {line}: the day must be Mon to Sun."))?;
            let start = parse_hhmm(&row.start)
                .ok_or_else(|| format!("Row {line}: the start time must look like 08:00."))?;
            let end = parse_hhmm(&row.end)
                .ok_or_else(|| format!("Row {line}: the end time must look like 08:45."))?;
            if end <= start {
                return Err(format!("Row {line}: the end time must be after the start."));
            }
            let subject = row.subject.trim();
            if subject.is_empty() {
                return Err(format!("Row {line}: the subject is empty."));
            }
            if subject.chars().count() > MAX_NAME || row.room.trim().chars().count() > MAX_NAME {
                return Err(format!(
                    "Row {line}: names are limited to {MAX_NAME} characters."
                ));
            }
            lessons.push((
                (*day).to_string(),
                start,
                end,
                subject.to_string(),
                row.room.trim().to_string(),
            ));
        }

        // One timetable row per distinct pair of times, earliest first.
        let mut slots: Vec<(u32, u32)> = lessons.iter().map(|row| (row.1, row.2)).collect();
        slots.sort_unstable();
        slots.dedup();
        if slots.len() > 24 {
            return Err("A timetable can have at most 24 rows.".into());
        }

        if !merge {
            self.days.clear();
            self.cells.clear();
            self.periods = slots
                .iter()
                .enumerate()
                .map(|(index, (start, end))| Period {
                    id: format!("p{}", index + 1),
                    label: format!("Period {}", index + 1),
                    start: fmt_hhmm(*start),
                    end: fmt_hhmm(*end),
                    is_break: false,
                })
                .collect();
        } else {
            for (start, end) in &slots {
                let known = self.periods.iter().any(|p| {
                    parse_hhmm(&p.start) == Some(*start) && parse_hhmm(&p.end) == Some(*end)
                });
                if known {
                    continue;
                }
                if self.periods.len() >= 24 {
                    return Err("A timetable can have at most 24 rows.".into());
                }
                let count = self.periods.iter().filter(|p| !p.is_break).count() + 1;
                self.periods.push(Period {
                    id: next_id("p", self.periods.iter().map(|p| p.id.as_str())),
                    label: format!("Period {count}"),
                    start: fmt_hhmm(*start),
                    end: fmt_hhmm(*end),
                    is_break: false,
                });
            }
        }

        // A column only exists for a day that really has a lesson. New days
        // join in the order the sheet listed them, so a column order the user
        // arranged by hand is not reshuffled by an import.
        for day in lessons.iter().map(|row| row.0.clone()) {
            if !self.days.contains(&day) {
                self.days.push(day);
            }
        }

        // Subjects keep their identity by name, so their tasks stay attached.
        let linked: HashSet<String> = self
            .tasks
            .iter()
            .filter_map(|t| t.subject_id.clone())
            .collect();
        if !merge {
            self.subjects.retain(|s| linked.contains(&s.id));
        }
        let mut by_name: HashMap<String, String> = self
            .subjects
            .iter()
            .map(|s| (s.name.to_lowercase(), s.id.clone()))
            .collect();

        for (day, start, end, subject, room) in &lessons {
            /* A sheet lists break rows too ("Ra chơi", "Nghỉ trưa"). They match a
            period, but they are not lessons and must not create a subject. */
            let period_id = {
                let Some(period) = self.periods.iter().find(|p| {
                    parse_hhmm(&p.start) == Some(*start) && parse_hhmm(&p.end) == Some(*end)
                }) else {
                    continue;
                };
                if period.is_break {
                    continue;
                }
                period.id.clone()
            };

            let key = subject.to_lowercase();
            let id = match by_name.get(&key) {
                Some(id) => id.clone(),
                None => {
                    let id = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                    let hue = self.next_hue();
                    self.subjects.push(Subject {
                        id: id.clone(),
                        name: subject.clone(),
                        hue,
                        room: room.clone(),
                        legacy_color: String::new(),
                    });
                    by_name.insert(key, id.clone());
                    id
                }
            };
            if !room.is_empty() {
                if let Some(existing) = self.subjects.iter_mut().find(|s| s.id == id) {
                    if existing.room.is_empty() {
                        existing.room = room.clone();
                    }
                }
            }
            self.cells.insert(cell_key(day, &period_id), id);
        }

        let used: HashSet<String> = self.cells.values().cloned().collect();
        self.subjects
            .retain(|s| used.contains(&s.id) || linked.contains(&s.id));
        Ok(())
    }

    /// Places a subject on one cell, and on every extra day the popover was
    /// given, so a subject taught five times a week costs one tap each.
    fn save_cell_many(
        &mut self,
        day: &str,
        period_id: &str,
        name: &str,
        hue: Option<f64>,
        room: &str,
        also: &[String],
    ) -> Result<(), String> {
        self.save_cell(day, period_id, name, hue, room, false)?;
        let Some(subject_id) = self.cells.get(&cell_key(day, period_id)).cloned() else {
            return Ok(());
        };
        for extra in also {
            if extra == day || !self.days.iter().any(|d| d == extra) {
                continue;
            }
            let usable = self
                .periods
                .iter()
                .find(|p| p.id == period_id)
                .is_some_and(|p| !p.is_break);
            if !usable {
                continue;
            }
            self.cells
                .insert(cell_key(extra, period_id), subject_id.clone());
        }
        Ok(())
    }

    /// Builds days and time slots from one small form. No subjects are added.
    #[allow(clippy::too_many_arguments)]
    fn create_grid(
        &mut self,
        days: &[String],
        start: &str,
        period_mins: u32,
        break_mins: u32,
        count: u32,
        long_after: Option<u32>,
        long_mins: u32,
    ) -> Result<(), String> {
        let mut picked: Vec<String> = Vec::new();
        for day in days {
            if !DAY_KEYS.contains(&day.as_str()) {
                return Err("Days must be Mon to Sun.".into());
            }
            if !picked.contains(day) {
                picked.push(day.clone());
            }
        }
        if picked.is_empty() {
            return Err("Pick at least one day.".into());
        }
        let start_min = parse_hhmm(start).ok_or("The first period must start like 07:30.")?;
        if !(15..=180).contains(&period_mins) {
            return Err("A period is between 15 and 180 minutes.".into());
        }
        if break_mins > 120 {
            return Err("A break is at most 120 minutes.".into());
        }
        if !(1..=16).contains(&count) {
            return Err("Create between 1 and 16 periods.".into());
        }
        if let Some(after) = long_after {
            if after == 0 || after > count {
                return Err("The long break must come after a period that exists.".into());
            }
            if long_mins > 180 {
                return Err("A long break is at most 180 minutes.".into());
            }
        }

        sort_days(&mut picked);
        self.days = picked;
        self.day_labels.clear();
        self.break_minutes = break_mins;
        self.periods.clear();
        self.cells.clear();
        /* Subjects that tasks still point at stay, so their chips keep a name. */
        let linked: HashSet<String> = self
            .tasks
            .iter()
            .filter_map(|t| t.subject_id.clone())
            .collect();
        self.subjects.retain(|s| linked.contains(&s.id));

        let mut cursor = i64::from(start_min);
        for index in 0..count {
            let end = (cursor + i64::from(period_mins)).min(24 * 60 - 1);
            self.periods.push(Period {
                id: format!("p{}", index + 1),
                label: format!("Period {}", index + 1),
                start: fmt_hhmm(cursor as u32),
                end: fmt_hhmm(end as u32),
                is_break: false,
            });
            cursor = end + i64::from(break_mins);
            if long_after == Some(index + 1) {
                cursor += i64::from(long_mins);
            }
            if cursor >= 24 * 60 {
                break;
            }
        }
        self.setup_dismissed = true;
        Ok(())
    }

    /// Moves a lesson, swapping when the destination already holds one, so a
    /// drop never deletes anything.
    fn move_cell(
        &mut self,
        from_day: &str,
        from_period: &str,
        to_day: &str,
        to_period: &str,
    ) -> Result<(), String> {
        if from_day == to_day && from_period == to_period {
            return Ok(());
        }
        for (day, period) in [(from_day, from_period), (to_day, to_period)] {
            if !self.days.iter().any(|d| d == day) {
                return Err("That day is not on the timetable.".into());
            }
            match self.periods.iter().find(|p| p.id == period) {
                Some(row) if !row.is_break => {}
                Some(_) => return Err("That row is a break - pick a class period.".into()),
                None => return Err("That period no longer exists.".into()),
            }
        }
        let from_key = cell_key(from_day, from_period);
        let to_key = cell_key(to_day, to_period);
        let Some(moving) = self.cells.remove(&from_key) else {
            return Ok(());
        };
        if let Some(displaced) = self.cells.insert(to_key, moving) {
            self.cells.insert(from_key, displaced);
        }
        Ok(())
    }

    /// Brush mode: paints one existing subject into the given cells.
    fn paint_cells(&mut self, subject_id: &str, cells: &[CellRef]) -> Result<(), String> {
        if !self.subjects.iter().any(|s| s.id == subject_id) {
            return Err("That subject no longer exists.".into());
        }
        if cells.len() > 200 {
            return Err("Paint fewer cells at once.".into());
        }
        for cell in cells {
            if !self.days.iter().any(|d| d == &cell.day) {
                continue;
            }
            let usable = self
                .periods
                .iter()
                .find(|p| p.id == cell.period_id)
                .is_some_and(|p| !p.is_break);
            if !usable {
                continue;
            }
            self.cells
                .insert(cell_key(&cell.day, &cell.period_id), subject_id.to_string());
        }
        Ok(())
    }

    fn remove_subject(&mut self, id: &str) -> Result<(), String> {
        if !self.subjects.iter().any(|s| s.id == id) {
            return Err("That subject no longer exists.".into());
        }
        self.cells.retain(|_, subject| subject != id);
        for task in &mut self.tasks {
            if task.subject_id.as_deref() == Some(id) {
                task.subject_id = None;
            }
        }
        self.subjects.retain(|s| s.id != id);
        Ok(())
    }

    fn move_period(&mut self, id: &str, offset: i32) -> Result<(), String> {
        let index = self
            .periods
            .iter()
            .position(|p| p.id == id)
            .ok_or("That period no longer exists.")?;
        let target = index as i64 + i64::from(offset);
        if target < 0 || target >= self.periods.len() as i64 {
            return Ok(());
        }
        let period = self.periods.remove(index);
        self.periods.insert(target as usize, period);
        Ok(())
    }

    fn clear_cell(&mut self, day: &str, period_id: &str) {
        if let Some(id) = self.cells.remove(&cell_key(day, period_id)) {
            let used_in_cells = self.cells.values().any(|v| v == &id);
            let used_by_tasks = self
                .tasks
                .iter()
                .any(|t| t.subject_id.as_deref() == Some(id.as_str()));
            if !used_in_cells && !used_by_tasks {
                self.subjects.retain(|s| s.id != id);
            }
        }
    }

    fn update_period(
        &mut self,
        id: &str,
        label: &str,
        start: &str,
        end: &str,
        is_break: bool,
        shift_later: bool,
    ) -> Result<(), String> {
        let start_min = parse_hhmm(start).ok_or("Start time must look like 07:30.")?;
        let end_min = parse_hhmm(end).ok_or("End time must look like 08:15.")?;
        if end_min <= start_min {
            return Err("End time must be after the start time.".into());
        }
        let previous_start = self
            .periods
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| parse_hhmm(&p.start));

        if shift_later {
            /* Every later row moves by the same amount, so a changed first
            period never lands on top of the second one. */
            if let Some(old_start) = previous_start {
                let delta = i64::from(start_min) - i64::from(old_start);
                if delta != 0 {
                    let index = match self.periods.iter().position(|p| p.id == id) {
                        Some(index) => index,
                        None => return Err("That period no longer exists.".into()),
                    };
                    for period in self.periods.iter_mut().skip(index + 1) {
                        if let (Some(a), Some(b)) =
                            (parse_hhmm(&period.start), parse_hhmm(&period.end))
                        {
                            let moved_start = (i64::from(a) + delta).clamp(0, 24 * 60 - 1);
                            let moved_end = (i64::from(b) + delta).clamp(moved_start + 1, 24 * 60);
                            period.start = fmt_hhmm(moved_start as u32);
                            period.end = fmt_hhmm(moved_end as u32);
                        }
                    }
                }
            }
        } else {
            for other in &self.periods {
                if other.id == id {
                    continue;
                }
                let (other_start, other_end) =
                    match (parse_hhmm(&other.start), parse_hhmm(&other.end)) {
                        (Some(a), Some(b)) => (a, b),
                        _ => continue,
                    };
                if start_min < other_end && other_start < end_min {
                    return Err(format!("That overlaps {}.", other.label));
                }
            }
        }
        let fallback = format!("Period {}", self.period_number(id));
        match self.periods.iter_mut().find(|p| p.id == id) {
            Some(period) => {
                period.label = if label.trim().is_empty() {
                    fallback
                } else {
                    clamp(label.trim(), 24)
                };
                period.start = fmt_hhmm(start_min);
                period.end = fmt_hhmm(end_min);
                period.is_break = is_break;
                Ok(())
            }
            None => Err("That period no longer exists.".into()),
        }
    }

    fn period_number(&self, id: &str) -> usize {
        self.periods
            .iter()
            .filter(|p| !p.is_break)
            .position(|p| p.id == id)
            .map_or(0, |i| i + 1)
    }

    fn add_period(&mut self) -> Result<(), String> {
        if self.periods.len() >= 24 {
            return Err("That is already the maximum number of rows.".into());
        }
        /* An empty timetable starts its first row at a normal morning hour; an
        existing one continues after the gap the user chose in setup. */
        let start = match self.periods.last() {
            Some(last) => parse_hhmm(&last.end).map_or(7 * 60 + 30, |end| end + self.break_minutes),
            None => 7 * 60 + 30,
        };
        let start = start.min(23 * 60 + 14);
        let end = (start + 45).min(23 * 60 + 59);
        let count = self.periods.iter().filter(|p| !p.is_break).count() + 1;
        let id = next_id("p", self.periods.iter().map(|p| p.id.as_str()));
        self.periods.push(Period {
            id,
            label: format!("Period {count}"),
            start: fmt_hhmm(start),
            end: fmt_hhmm(end),
            is_break: false,
        });
        Ok(())
    }

    fn remove_period(&mut self, id: &str) -> Result<(), String> {
        /* The last row may go too: an empty timetable is a valid one and the
        guide takes over. */
        if !self.periods.iter().any(|p| p.id == id) {
            return Err("That period no longer exists.".into());
        }
        self.periods.retain(|p| p.id != id);
        self.cells
            .retain(|key, _| key.split_once('-').is_none_or(|(_, period)| period != id));
        Ok(())
    }

    /// Builds a validated task. `id` is only used when updating.
    #[allow(clippy::too_many_arguments)]
    fn clean_task(
        &self,
        existing_id: Option<&str>,
        title: &str,
        subject_id: Option<String>,
        date: Option<String>,
        due: Option<String>,
        time: &str,
        notes: &str,
    ) -> Result<Task, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("Give the task a title first.".into());
        }
        if title.chars().count() > MAX_TITLE {
            return Err(format!(
                "Task titles are limited to {MAX_TITLE} characters."
            ));
        }
        if notes.chars().count() > MAX_NOTES {
            return Err(format!("Notes are limited to {MAX_NOTES} characters."));
        }
        let subject_id = match subject_id {
            Some(id) if self.subjects.iter().any(|s| s.id == id) => Some(id),
            Some(_) => return Err("That subject no longer exists.".into()),
            None => None,
        };
        let date = clean_date(date)?;
        let due = clean_date(due)?;
        let time = match time.trim() {
            "" => String::new(),
            value => match parse_hhmm(value) {
                Some(minutes) => fmt_hhmm(minutes),
                None => return Err("Time must look like 14:30.".into()),
            },
        };
        let id = match existing_id {
            Some(id) => id.to_string(),
            None => next_id("t", self.tasks.iter().map(|t| t.id.as_str())),
        };
        Ok(Task {
            id,
            title: title.into(),
            subject_id,
            date,
            due,
            time,
            notes: notes.trim().into(),
            priority: None,
            done: false,
        })
    }
}

/* --------------------------------------------------------------------- view */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellView {
    pub subject_id: String,
    pub name: String,
    /// The only colour data Flip stores; the UI derives the rest.
    pub hue: f64,
    pub room: String,
    /// Tasks still open for this subject.
    pub pending: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectView {
    pub id: String,
    pub name: String,
    pub hue: f64,
    pub room: String,
    pub pending: usize,
    /// True when the subject still has a place on the timetable.
    pub in_timetable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayView {
    pub key: String,
    pub label: String,
    pub is_today: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekDayView {
    pub date: String,
    pub label: String,
    pub day_key: String,
    pub is_today: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekView {
    pub start: String,
    pub end: String,
    pub label: String,
    pub days: Vec<WeekDayView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedTask {
    pub id: String,
    pub title: String,
    pub due: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub id: String,
    /// "today", "tonight" or "due".
    pub kind: String,
    pub subject_id: String,
    pub subject_name: String,
    pub subject_hue: f64,
    /// Day the tasks would be scheduled on, `YYYY-MM-DD`.
    pub date: String,
    pub title: String,
    pub question: String,
    pub tasks: Vec<SuggestedTask>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    pub days: Vec<DayView>,
    pub periods: Vec<Period>,
    pub cells: BTreeMap<String, CellView>,
    pub subjects: Vec<SubjectView>,
    pub tasks: Vec<Task>,
    pub today: String,
    pub week: WeekView,
    pub current_period: Option<String>,
    /// Study time derived from the session log.
    pub focus: FocusView,
    pub suggestions: Vec<Suggestion>,
    pub suggestion_count: usize,
    pub show_weekend: bool,
    pub week_start: String,
    /// True once the user built or skipped the quick setup.
    pub setup_dismissed: bool,
    /// Read-only grid: the UI hides every editing control while this is set.
    pub locked: bool,
    /// False while the in-memory history has nothing to take back or put back.
    pub can_undo: bool,
    pub can_redo: bool,
}

impl Board {
    pub fn view(&self, today: NaiveDate, now_minutes: u32) -> BoardView {
        let today_key = day_key(today);
        let mut pending: HashMap<&str, usize> = HashMap::new();
        for task in self.tasks.iter().filter(|t| !t.done) {
            if let Some(id) = task.subject_id.as_deref() {
                *pending.entry(id).or_insert(0) += 1;
            }
        }

        /* A break row is not a lesson. Sheets imported before this rule can still
        hold cells on those rows, and they used to show up as paint colours. */
        let breaks: HashSet<&str> = self
            .periods
            .iter()
            .filter(|p| p.is_break)
            .map(|p| p.id.as_str())
            .collect();
        let on_break = |key: &str| {
            key.split_once('-')
                .is_some_and(|(_, id)| breaks.contains(id))
        };

        let mut cells = BTreeMap::new();
        for (key, subject_id) in &self.cells {
            if on_break(key) {
                continue;
            }
            if let Some(subject) = self.subjects.iter().find(|s| &s.id == subject_id) {
                cells.insert(
                    key.clone(),
                    CellView {
                        subject_id: subject.id.clone(),
                        name: subject.name.clone(),
                        hue: subject.hue,
                        room: subject.room.clone(),
                        pending: pending.get(subject.id.as_str()).copied().unwrap_or(0),
                    },
                );
            }
        }

        let days = self
            .days
            .iter()
            .map(|key| DayView {
                key: key.clone(),
                label: self
                    .day_labels
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| key.clone()),
                is_today: key == today_key,
            })
            .collect();

        /* A subject whose only cells sit on break rows was never a lesson; it is
        a leftover from such an import and has no business in the paint bar or
        a subject picker. Anything a task still points at is kept. */
        let break_only = |id: &str| -> bool {
            let mut seen = false;
            for (key, subject_id) in &self.cells {
                if subject_id != id {
                    continue;
                }
                seen = true;
                if !on_break(key) {
                    return false;
                }
            }
            seen
        };

        let subjects = self
            .subjects
            .iter()
            .filter(|s| {
                let linked = self
                    .tasks
                    .iter()
                    .any(|t| t.subject_id.as_deref() == Some(s.id.as_str()));
                linked || !break_only(&s.id)
            })
            .map(|s| SubjectView {
                id: s.id.clone(),
                name: s.name.clone(),
                hue: s.hue,
                room: s.room.clone(),
                pending: pending.get(s.id.as_str()).copied().unwrap_or(0),
                in_timetable: cells.values().any(|c| c.subject_id == s.id),
            })
            .collect();

        let current_period = if self.days.iter().any(|d| d == today_key) {
            self.periods
                .iter()
                .find(|p| {
                    let start = parse_hhmm(&p.start);
                    let end = parse_hhmm(&p.end);
                    match (start, end) {
                        (Some(a), Some(b)) => now_minutes >= a && now_minutes < b,
                        _ => false,
                    }
                })
                .map(|p| p.id.clone())
        } else {
            None
        };

        let suggestions = self.suggestions(today, today_key);
        BoardView {
            days,
            periods: self.periods.clone(),
            cells,
            subjects,
            tasks: self.tasks.clone(),
            today: fmt_date(today),
            week: self.week_view(today),
            current_period,
            focus: self.focus_view(today),
            suggestion_count: suggestions.len(),
            suggestions,
            show_weekend: self.days.iter().any(|d| d == "Sat"),
            locked: self.locked,
            can_undo: false,
            can_redo: false,
            week_start: self.week_start.clone(),
            setup_dismissed: self.setup_dismissed,
        }
    }

    fn week_view(&self, today: NaiveDate) -> WeekView {
        let offset = if self.week_start == "Sun" {
            today.weekday().num_days_from_sunday()
        } else {
            today.weekday().num_days_from_monday()
        };
        let start = today - Duration::days(i64::from(offset));
        let end = start + Duration::days(6);
        let days = (0..7)
            .map(|i| {
                let date = start + Duration::days(i);
                WeekDayView {
                    date: fmt_date(date),
                    label: format!("{} {}", month_short(date), date.day()),
                    day_key: day_key(date).to_string(),
                    is_today: date == today,
                }
            })
            .collect();
        let label = if start.year() == end.year() {
            format!(
                "{} {} to {} {}, {}",
                month_short(start),
                start.day(),
                month_short(end),
                end.day(),
                end.year()
            )
        } else {
            format!(
                "{} {}, {} to {} {}, {}",
                month_short(start),
                start.day(),
                start.year(),
                month_short(end),
                end.day(),
                end.year()
            )
        };
        WeekView {
            start: fmt_date(start),
            end: fmt_date(end),
            label,
            days,
        }
    }

    /// Suggestions for today: a class today, a class tomorrow, or a deadline
    /// that lands before the next class.
    fn suggestions(&self, today: NaiveDate, today_key: &str) -> Vec<Suggestion> {
        let today_text = fmt_date(today);
        let tomorrow = today + Duration::days(1);
        let tomorrow_key = day_key(tomorrow);

        // Which days each subject appears on.
        let mut class_days: HashMap<&str, HashSet<&str>> = HashMap::new();
        for (key, subject_id) in &self.cells {
            if let Some((day, _)) = key.split_once('-') {
                class_days
                    .entry(subject_id.as_str())
                    .or_default()
                    .insert(day);
            }
        }

        // Open tasks with no planned day, grouped per subject.
        let mut open: BTreeMap<&str, Vec<&Task>> = BTreeMap::new();
        for task in &self.tasks {
            if task.done || task.date.is_some() {
                continue;
            }
            if self.never.iter().any(|id| id == &task.id) {
                continue;
            }
            if self.snoozed.get(&task.id).map(String::as_str) == Some(today_text.as_str()) {
                continue;
            }
            if let Some(subject_id) = task.subject_id.as_deref() {
                open.entry(subject_id).or_default().push(task);
            }
        }

        let mut out = Vec::new();
        for (subject_id, tasks) in open {
            let Some(subject) = self.subjects.iter().find(|s| s.id == subject_id) else {
                continue;
            };
            let Some(days) = class_days.get(subject_id) else {
                continue;
            };

            let (kind, title) = if days.contains(today_key) {
                ("today", format!("You have {} today.", subject.name))
            } else if days.contains(tomorrow_key) {
                ("tonight", format!("{} is tomorrow.", subject.name))
            } else {
                let next_class = next_class_date(days, today);
                let due_soon = tasks.iter().any(|task| {
                    task.due.as_deref().and_then(parse_date).is_some_and(|due| {
                        due <= today || next_class.is_some_and(|next| due < next)
                    })
                });
                if !due_soon {
                    continue;
                }
                ("due", format!("Due before {}'s next class.", subject.name))
            };

            let question = match kind {
                "tonight" => "Want to schedule this for tonight?",
                _ => "Want to schedule this for today?",
            };

            out.push(Suggestion {
                id: format!("{subject_id}:{kind}"),
                kind: kind.into(),
                subject_id: subject.id.clone(),
                subject_name: subject.name.clone(),
                subject_hue: subject.hue,
                date: today_text.clone(),
                title,
                question: question.into(),
                tasks: tasks
                    .iter()
                    .map(|t| SuggestedTask {
                        id: t.id.clone(),
                        title: t.title.clone(),
                        due: t.due.clone(),
                    })
                    .collect(),
            });
        }

        out.sort_by(|a, b| {
            let rank = |kind: &str| match kind {
                "today" => 0,
                "tonight" => 1,
                _ => 2,
            };
            rank(&a.kind).cmp(&rank(&b.kind)).then_with(|| {
                a.subject_name
                    .to_lowercase()
                    .cmp(&b.subject_name.to_lowercase())
            })
        });
        out
    }
}

/* ------------------------------------------------------------------ helpers */

fn cell_key(day: &str, period_id: &str) -> String {
    format!("{day}-{period_id}")
}

fn next_id<'a>(prefix: &str, ids: impl Iterator<Item = &'a str>) -> String {
    let mut max = 0u32;
    for id in ids {
        if let Some(rest) = id.strip_prefix(prefix) {
            if let Ok(n) = rest.parse::<u32>() {
                max = max.max(n);
            }
        }
    }
    format!("{prefix}{}", max + 1)
}

fn clamp(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// Keeps a hue inside 0-360, and repairs anything that is not a real number.
pub fn normalise_hue(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_HUE;
    }
    ((value % 360.0) + 360.0) % 360.0
}

/// The shortest way round the colour wheel between two hues, 0-180.
pub fn hue_distance(a: f64, b: f64) -> f64 {
    let diff = (normalise_hue(a) - normalise_hue(b)).abs();
    diff.min(360.0 - diff)
}

/// Reads the hue out of an old `#RRGGBB` colour, for files from before 1.1.1.
///
/// The angle is measured in OKLCH, the same space the interface derives its
/// colours in: HSL hue 24 is a red there, while this rust is a warm orange at
/// about 51 degrees.
pub fn hue_from_hex(value: &str) -> Option<f64> {
    let hex = value.trim().trim_start_matches('#');
    let expanded: String = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 => hex.to_string(),
        _ => return None,
    };
    if !expanded.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| -> f64 {
        f64::from(u8::from_str_radix(&expanded[start..start + 2], 16).unwrap_or(0)) / 255.0
    };
    let linear = |c: f64| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let (r, g, b) = (linear(channel(0)), linear(channel(2)), linear(channel(4)));
    let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
    let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
    let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
    let a = 1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s;
    let bb = 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s;
    if a.abs() < 1e-6 && bb.abs() < 1e-6 {
        // A grey has no hue; give it the warm one Flip starts with.
        return Some(DEFAULT_HUE);
    }
    Some(normalise_hue(bb.atan2(a).to_degrees()))
}

/// Accepts a number, or a hex string left over from an older file.
fn de_hue<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::Number(number) => normalise_hue(number.as_f64().unwrap_or(DEFAULT_HUE)),
        serde_json::Value::String(text) => hue_from_hex(&text).unwrap_or(DEFAULT_HUE),
        _ => DEFAULT_HUE,
    })
}

/// Monday first, then Tuesday, and so on, whatever order days were added in.
fn sort_days(days: &mut [String]) {
    days.sort_by_key(|day| {
        DAY_KEYS
            .iter()
            .position(|key| key == day)
            .unwrap_or(DAY_KEYS.len())
    });
}

/// Reads a wall-clock time from the shapes a person or a model may write:
/// `07:30`, `7:30`, `7h30`, `7.30` and a bare hour.
pub fn parse_clock_text(value: &str) -> Option<u32> {
    let text = value.trim().to_lowercase().replace(' ', "");
    if text.is_empty() {
        return None;
    }
    let normalised = text.replace(['h', '.'], ":");
    let (hours, minutes) = match normalised.split_once(':') {
        Some((h, m)) => (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?),
        None => (normalised.parse::<u32>().ok()?, 0),
    };
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn parse_hhmm(value: &str) -> Option<u32> {
    let (h, m) = value.trim().split_once(':')?;
    let hours: u32 = h.trim().parse().ok()?;
    let minutes: u32 = m.trim().parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

fn fmt_hhmm(minutes: u32) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

fn parse_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok()
}

fn clean_date(value: Option<String>) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(text) if text.trim().is_empty() => Ok(None),
        Some(text) => match parse_date(&text) {
            Some(date) => Ok(Some(fmt_date(date))),
            None => Err("Dates must look like 2026-11-09.".into()),
        },
    }
}

fn fmt_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

fn day_key(date: NaiveDate) -> &'static str {
    match date.weekday() {
        Weekday::Mon => "Mon",
        Weekday::Tue => "Tue",
        Weekday::Wed => "Wed",
        Weekday::Thu => "Thu",
        Weekday::Fri => "Fri",
        Weekday::Sat => "Sat",
        Weekday::Sun => "Sun",
    }
}

fn month_short(date: NaiveDate) -> &'static str {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS[(date.month0() as usize).min(11)]
}

fn next_class_date(days: &HashSet<&str>, today: NaiveDate) -> Option<NaiveDate> {
    (1..=14)
        .map(|i| today + Duration::days(i))
        .find(|date| days.contains(day_key(*date)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").expect("test date")
    }

    #[test]
    fn a_streak_day_needs_ten_minutes_of_focus() {
        let today = date("2026-11-09");
        let mut board = Board::default();

        /* A timer stopped after a couple of seconds, plus a short run, still
           add up to less than a session: no streak, but the study time stays. */
        board.add_session(None, None, 1, "2026-11-09");
        board.add_session(None, None, 300, "2026-11-09");
        let short = board.focus_view(today);
        assert_eq!(short.streak, 0);
        assert_eq!(short.today_secs, 301);

        // Ten minutes today, reached in two goes, on top of ten yesterday.
        board.add_session(None, None, 599, "2026-11-09");
        board.add_session(None, None, 300, "2026-11-08");
        board.add_session(None, None, 300, "2026-11-08");
        assert_eq!(board.focus_view(today).streak, 2);
    }

    fn period(id: &str, label: &str, start: &str, end: &str, is_break: bool) -> Period {
        Period {
            id: id.into(),
            label: label.into(),
            start: start.into(),
            end: end.into(),
            is_break,
        }
    }

    fn board_with_class() -> Board {
        let mut board = Board {
            days: vec!["Mon".into(), "Tue".into()],
            periods: vec![period("p1", "Period 1", "07:30", "08:15", false)],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Math".into(),
                    hue: Some(210.0),
                    room: "B12".into(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .expect("save cell");
        board
    }

    fn add_task(board: &mut Board, title: &str, subject: Option<&str>, date: Option<&str>) {
        board
            .apply(
                BoardAction::AddTask {
                    title: title.into(),
                    subject_id: subject.map(str::to_string),
                    date: date.map(str::to_string),
                    due: None,
                    time: String::new(),
                    notes: String::new(),
                    priority: None,
                },
                "2026-11-09",
            )
            .expect("add task");
    }

    fn import_rows() -> Vec<ImportRow> {
        vec![
            ImportRow {
                day: "Mon".into(),
                start: "08:00".into(),
                end: "08:45".into(),
                subject: "Math".into(),
                room: "B12".into(),
            },
            ImportRow {
                day: "Tue".into(),
                start: "08:00".into(),
                end: "08:45".into(),
                subject: "Physics".into(),
                room: "Lab".into(),
            },
            ImportRow {
                day: "Mon".into(),
                start: "09:00".into(),
                end: "09:45".into(),
                subject: "Physics".into(),
                room: String::new(),
            },
        ]
    }

    fn import(board: &mut Board, rows: Vec<ImportRow>) -> Result<(), String> {
        board.apply(
            BoardAction::ImportTimetable { rows, merge: false },
            "2026-11-09",
        )
    }

    #[test]
    fn a_fresh_board_is_completely_empty() {
        let board = Board::default();
        assert!(board.days.is_empty());
        assert!(board.periods.is_empty());
        assert!(board.cells.is_empty());
        assert!(board.subjects.is_empty());
        assert!(!board.setup_dismissed);
        // And it still renders.
        let view = board.view(date("2026-11-09"), 480);
        assert!(view.days.is_empty());
        assert!(view.periods.is_empty());
        assert!(view.cells.is_empty());
        assert!(view.current_period.is_none());
    }

    #[test]
    fn an_empty_board_survives_a_round_trip() {
        let path = std::env::temp_dir().join("flip-board-empty.json");
        let board = Board::default();
        save(&path, &board);
        let reloaded = load(&path);
        assert!(reloaded.days.is_empty());
        assert!(reloaded.periods.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_saved_hex_colour_becomes_a_hue() {
        let path = std::env::temp_dir().join("flip-board-legacy.json");
        std::fs::write(
            &path,
            r##"{"version":1,"days":["Mon"],"periods":[{"id":"p1","label":"Period 1","start":"07:30","end":"08:15"}],"cells":{"Mon-p1":"s1"},"subjects":[{"id":"s1","name":"Math","color":"#4F7F8C"}]}"##,
        )
        .unwrap();
        let board = load(&path);
        let hue = board.subjects[0].hue;
        assert!((hue - 217.0).abs() < 6.0, "hue was {hue}");
        assert!(!board.cells.is_empty());
        assert_eq!(board.version, BOARD_VERSION);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn import_builds_rows_and_shares_subjects() {
        let mut board = Board::default();
        import(&mut board, import_rows()).expect("import");

        assert_eq!(board.periods.len(), 2);
        assert_eq!(board.periods[0].start, "08:00");
        assert_eq!(board.periods[1].label, "Period 2");
        assert!(!board.periods[0].is_break);
        assert_eq!(board.cells.len(), 3);

        let physics = board
            .subjects
            .iter()
            .find(|s| s.name == "Physics")
            .expect("physics");
        assert_eq!(board.cells["Mon-p2"], physics.id);
        assert_eq!(board.cells["Tue-p1"], physics.id);
        assert_eq!(physics.room, "Lab");

        let view = board.view(date("2026-11-09"), 8 * 60);
        assert_eq!(view.cells["Mon-p1"].name, "Math");
        assert_eq!(view.cells["Mon-p1"].room, "B12");
    }

    #[test]
    fn import_rejects_a_bad_time_and_keeps_the_timetable() {
        let mut board = board_with_class();
        let mut rows = import_rows();
        rows[1].end = "08:00".into();

        assert!(import(&mut board, rows).is_err());
        assert!(board.cells.contains_key("Mon-p1"));
        assert_eq!(board.periods.len(), 1);
        assert_eq!(board.subjects.len(), 1);
    }

    #[test]
    fn import_keeps_a_subject_that_still_has_tasks() {
        let mut board = board_with_class();
        let math = board.subjects[0].id.clone();
        add_task(&mut board, "Revise chapter 5", Some(&math), None);

        let rows = vec![ImportRow {
            day: "Tue".into(),
            start: "08:00".into(),
            end: "08:45".into(),
            subject: "Physics".into(),
            room: String::new(),
        }];
        import(&mut board, rows).expect("import");

        // Math is gone from the timetable but its task still points at it.
        assert!(board.subjects.iter().any(|s| s.id == math));
        assert!(!board.cells.values().any(|id| *id == math));
    }

    #[test]
    fn import_skips_a_row_that_is_a_break() {
        let mut board = Board {
            days: vec!["Mon".into()],
            periods: vec![
                period("p1", "Truy bài đầu giờ", "07:30", "07:45", true),
                period("p2", "Period 1", "07:50", "08:35", false),
            ],
            ..Board::default()
        };
        let rows = vec![
            ImportRow {
                day: "Mon".into(),
                start: "07:30".into(),
                end: "07:45".into(),
                subject: "Truy bài đầu giờ".into(),
                room: String::new(),
            },
            ImportRow {
                day: "Mon".into(),
                start: "07:50".into(),
                end: "08:35".into(),
                subject: "Toán".into(),
                room: String::new(),
            },
        ];
        board
            .apply(
                BoardAction::ImportTimetable { rows, merge: true },
                "2026-11-09",
            )
            .expect("merge");

        assert_eq!(board.cells.len(), 1, "the break row takes no lesson");
        assert!(board.cells.contains_key("Mon-p2"));
        assert!(
            !board.subjects.iter().any(|s| s.name == "Truy bài đầu giờ"),
            "a break label must not become a subject"
        );
    }

    #[test]
    fn a_break_cell_from_older_data_never_reaches_the_view() {
        let mut board = Board {
            days: vec!["Mon".into()],
            periods: vec![
                period("p1", "Ra chơi", "08:35", "09:00", true),
                period("p2", "Period 1", "09:05", "09:50", false),
            ],
            subjects: vec![
                Subject {
                    id: "s1".into(),
                    name: "Ra chơi".into(),
                    hue: 30.0,
                    room: String::new(),
                    legacy_color: String::new(),
                },
                Subject {
                    id: "s2".into(),
                    name: "Toán".into(),
                    hue: 120.0,
                    room: String::new(),
                    legacy_color: String::new(),
                },
            ],
            cells: [
                ("Mon-p1".to_string(), "s1".to_string()),
                ("Mon-p2".to_string(), "s2".to_string()),
            ]
            .into_iter()
            .collect(),
            ..Board::default()
        };

        let view = board.view(date("2026-11-09"), 9 * 60);
        assert!(
            !view.cells.contains_key("Mon-p1"),
            "a break row shows no cell"
        );
        assert_eq!(view.subjects.len(), 1);
        assert_eq!(view.subjects[0].name, "Toán");
        assert!(
            view.subjects.iter().all(|s| s.in_timetable),
            "nothing outside the timetable is offered as a paint colour"
        );

        // A task still pointing at the leftover subject keeps it available.
        add_task(&mut board, "Bring the form back", Some("s1"), None);
        let view = board.view(date("2026-11-09"), 9 * 60);
        assert!(view.subjects.iter().any(|s| s.id == "s1"));
        assert_eq!(
            view.subjects.iter().find(|s| s.id == "s1").unwrap().pending,
            1
        );
    }

    #[test]
    fn import_only_adds_the_days_that_are_used() {
        let mut board = Board::default();
        let rows = vec![ImportRow {
            day: "Sat".into(),
            start: "10:00".into(),
            end: "10:45".into(),
            subject: "Art".into(),
            room: String::new(),
        }];

        import(&mut board, rows).expect("import");
        assert_eq!(board.days, vec!["Sat".to_string()]);
    }

    #[test]
    fn merging_an_import_keeps_what_is_already_there() {
        let mut board = board_with_class();
        let rows = vec![ImportRow {
            day: "Tue".into(),
            start: "08:20".into(),
            end: "09:05".into(),
            subject: "Physics".into(),
            room: String::new(),
        }];
        board
            .apply(
                BoardAction::ImportTimetable { rows, merge: true },
                "2026-11-09",
            )
            .expect("merge");
        assert_eq!(board.cells.len(), 2);
        assert!(board.cells.contains_key("Mon-p1"));
        assert_eq!(board.periods.len(), 2);
        assert!(board.subjects.iter().any(|s| s.name == "Math"));
        assert!(board.subjects.iter().any(|s| s.name == "Physics"));
    }

    #[test]
    fn days_can_be_added_and_removed() {
        let mut board = Board::default();
        board
            .apply(BoardAction::AddDay { day: "Wed".into() }, "2026-11-09")
            .expect("add Wed");
        board
            .apply(BoardAction::AddDay { day: "Mon".into() }, "2026-11-09")
            .expect("add Mon");
        assert_eq!(board.days, vec!["Mon".to_string(), "Wed".to_string()]);
        assert!(board
            .apply(BoardAction::AddDay { day: "Wed".into() }, "2026-11-09")
            .is_err());
        board
            .apply(BoardAction::RemoveDay { day: "Mon".into() }, "2026-11-09")
            .expect("remove");
        assert_eq!(board.days, vec!["Wed".to_string()]);
    }

    #[test]
    fn two_subjects_with_one_name_become_one_on_load() {
        let mut board = Board {
            days: vec!["Mon".into()],
            periods: vec![
                period("p1", "Period 1", "07:30", "08:15", false),
                period("p2", "Period 2", "08:20", "09:05", false),
            ],
            subjects: vec![
                Subject {
                    id: "a".into(),
                    name: "Toán".into(),
                    hue: 51.0,
                    room: "B12".into(),
                    legacy_color: String::new(),
                },
                Subject {
                    id: "b".into(),
                    name: " toan ".into(),
                    hue: 200.0,
                    room: "A04".into(),
                    legacy_color: String::new(),
                },
            ],
            tasks: vec![Task {
                id: "t1".into(),
                title: "Homework".into(),
                subject_id: Some("b".into()),
                date: None,
                due: None,
                time: String::new(),
                notes: String::new(),
                priority: None,
                done: false,
            }],
            ..Board::default()
        };
        board.cells.insert("Mon-p1".into(), "a".into());
        board.cells.insert("Mon-p2".into(), "b".into());

        board.sanitize();

        /* "Toán" and " toan " differ by a space, not by accent, so they stay
        apart; the same name with different case is one subject. */
        assert_eq!(board.subjects.len(), 2);

        board.subjects[1].name = "toán".into();
        board.sanitize();
        assert_eq!(board.subjects.len(), 1, "one subject after the merge");
        assert_eq!(board.subjects[0].id, "a");
        assert_eq!(board.subjects[0].room, "B12", "first room kept");
        assert!(board.cells.values().all(|id| id == "a"));
        assert_eq!(board.tasks[0].subject_id.as_deref(), Some("a"));
    }

    #[test]
    fn renaming_one_cell_reuses_a_subject_with_that_name() {
        let mut board = Board {
            days: vec!["Mon".into(), "Tue".into()],
            periods: vec![
                period("p1", "Period 1", "07:30", "08:15", false),
                period("p2", "Period 2", "08:20", "09:05", false),
            ],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Math".into(),
                    hue: Some(51.0),
                    room: String::new(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .expect("first");
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Tue".into(),
                    period_id: "p2".into(),
                    name: "Physics".into(),
                    hue: Some(200.0),
                    room: String::new(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .expect("second");
        assert_eq!(board.subjects.len(), 2);

        /* Both cells share "Math"; renaming one to "Physics" must land on the
        existing Physics subject, not a third record of the same name. */
        board
            .cells
            .insert("Mon-p2".into(), board.cells["Mon-p1"].clone());
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Physics".into(),
                    hue: Some(300.0),
                    room: String::new(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .expect("rename one");
        assert_eq!(board.subjects.len(), 2, "no duplicate Physics");
        assert_eq!(board.cells["Mon-p1"], board.cells["Tue-p2"]);
    }

    #[test]
    fn a_locked_timetable_stays_locked_through_a_save_and_reload() {
        let mut board = board_with_class();
        assert!(!board.view(date("2026-11-09"), 480).locked);
        board
            .apply(BoardAction::SetLocked { locked: true }, "2026-11-09")
            .expect("lock");
        assert!(board.view(date("2026-11-09"), 480).locked);

        /* The lock lives in board.json, so it survives a restart. */
        let json = serde_json::to_string(&board).expect("encode");
        let mut reloaded: Board = serde_json::from_str(&json).expect("decode");
        reloaded.sanitize();
        assert!(reloaded.locked);
        assert_eq!(reloaded.cells.len(), board.cells.len(), "lessons kept");

        reloaded
            .apply(BoardAction::SetLocked { locked: false }, "2026-11-09")
            .expect("unlock");
        assert!(!reloaded.view(date("2026-11-09"), 480).locked);
    }

    #[test]
    fn a_day_can_be_renamed_and_named_back() {
        let mut board = Board {
            days: vec!["Mon".into(), "Tue".into()],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::RenameDay {
                    day: "Mon".into(),
                    label: "Thu 2 (sang)".into(),
                },
                "2026-11-09",
            )
            .expect("rename");
        let view = board.view(date("2026-11-09"), 480);
        assert_eq!(view.days[0].label, "Thu 2 (sang)");
        assert_eq!(view.days[0].key, "Mon");
        assert_eq!(view.days[1].label, "Tue");

        /* A blank label is how a name goes back to the weekday. */
        board
            .apply(
                BoardAction::RenameDay {
                    day: "Mon".into(),
                    label: "  ".into(),
                },
                "2026-11-09",
            )
            .expect("clear");
        assert_eq!(board.view(date("2026-11-09"), 480).days[0].label, "Mon");
    }

    #[test]
    fn a_very_long_day_name_is_cut_not_rejected() {
        let mut board = Board {
            days: vec!["Mon".into()],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::RenameDay {
                    day: "Mon".into(),
                    label: "x".repeat(80),
                },
                "2026-11-09",
            )
            .expect("rename");
        assert_eq!(board.day_labels["Mon"].chars().count(), MAX_DAY_LABEL);
    }

    #[test]
    fn day_columns_can_be_moved_and_the_order_survives_a_reload() {
        let mut board = Board {
            days: vec!["Mon".into(), "Tue".into(), "Wed".into()],
            periods: vec![period("p1", "Period 1", "07:30", "08:15", false)],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::MoveDay {
                    day: "Wed".into(),
                    offset: -1,
                },
                "2026-11-09",
            )
            .expect("move");
        assert_eq!(board.days, vec!["Mon", "Wed", "Tue"]);
        /* Moving past either end is a quiet no-op, not an error. */
        board
            .apply(
                BoardAction::MoveDay {
                    day: "Mon".into(),
                    offset: -1,
                },
                "2026-11-09",
            )
            .expect("edge");
        assert_eq!(board.days, vec!["Mon", "Wed", "Tue"]);

        /* The stored order is the column order, so loading must not sort it. */
        let mut reloaded = board.clone();
        reloaded.sanitize();
        assert_eq!(reloaded.days, vec!["Mon", "Wed", "Tue"]);
        let labels: Vec<String> = reloaded
            .view(date("2026-11-09"), 480)
            .days
            .into_iter()
            .map(|day| day.label)
            .collect();
        assert_eq!(labels, vec!["Mon", "Wed", "Tue"]);
    }

    #[test]
    fn removing_a_day_forgets_its_name_and_drops_stale_names() {
        let mut board = Board {
            days: vec!["Mon".into(), "Tue".into()],
            ..Board::default()
        };
        board
            .apply(
                BoardAction::RenameDay {
                    day: "Tue".into(),
                    label: "Lab day".into(),
                },
                "2026-11-09",
            )
            .expect("rename");
        board
            .apply(BoardAction::RemoveDay { day: "Tue".into() }, "2026-11-09")
            .expect("remove");
        assert!(!board.day_labels.contains_key("Tue"));

        board.day_labels.insert("Fri".into(), "Ghost".into());
        board.sanitize();
        assert!(board.day_labels.is_empty(), "stale name kept");
    }

    #[test]
    fn add_period_continues_after_the_break_from_setup() {
        let mut board = Board::default();
        board
            .apply(
                BoardAction::CreateGrid {
                    days: vec!["Mon".into(), "Tue".into()],
                    start: "07:30".into(),
                    period_mins: 45,
                    break_mins: 10,
                    count: 2,
                    long_after: None,
                    long_mins: 0,
                },
                "2026-11-09",
            )
            .expect("grid");
        assert_eq!(board.break_minutes, 10);
        board
            .apply(BoardAction::AddPeriod, "2026-11-09")
            .expect("row");
        let last = board.periods.last().expect("row");
        assert_eq!(
            last.start, "09:20",
            "the 09:10 end plus the 10 minute break"
        );
        assert_eq!(last.end, "10:05");
    }

    #[test]
    fn a_typed_break_is_remembered_for_the_next_row() {
        let mut board = Board {
            periods: vec![period("p1", "Period 1", "07:30", "08:15", false)],
            ..Board::default()
        };
        board
            .apply(BoardAction::SetBreak { minutes: 20 }, "2026-11-09")
            .expect("break");
        board
            .apply(BoardAction::AddPeriod, "2026-11-09")
            .expect("row");
        assert_eq!(
            board.periods.last().map(|p| p.start.as_str()),
            Some("08:35")
        );
        /* A silly value is clamped, not stored as-is. */
        board
            .apply(BoardAction::SetBreak { minutes: 9999 }, "2026-11-09")
            .expect("break");
        assert_eq!(board.break_minutes, MAX_BREAK);
    }

    #[test]
    fn a_new_subject_keeps_its_distance_from_the_others() {
        let mut board = Board {
            days: vec!["Mon".into()],
            periods: vec![
                period("p1", "Period 1", "07:30", "08:15", false),
                period("p2", "Period 2", "08:20", "09:05", false),
            ],
            ..Board::default()
        };
        for (period_id, name) in [("p1", "Math"), ("p2", "Physics")] {
            board
                .apply(
                    BoardAction::SaveCell {
                        day: "Mon".into(),
                        period_id: period_id.into(),
                        name: name.into(),
                        hue: None,
                        room: String::new(),
                        apply_all: false,
                    },
                    "2026-11-09",
                )
                .expect("save cell");
        }
        let hues: Vec<f64> = board.subjects.iter().map(|s| s.hue).collect();
        assert_eq!(hues.len(), 2);
        assert!(hue_distance(hues[0], hues[1]) > 40.0);
    }

    #[test]
    fn subject_saves_to_the_cell_and_reloads() {
        let board = board_with_class();
        let view = board.view(date("2026-11-09"), 8 * 60);
        let cell = view.cells.get("Mon-p1").expect("cell");
        assert_eq!(cell.name, "Math");
        assert_eq!(cell.room, "B12");
        assert_eq!(cell.pending, 0);

        // Round-trip through disk.
        let path = std::env::temp_dir().join("flip-board-test.json");
        save(&path, &board);
        let reloaded = load(&path);
        assert_eq!(
            reloaded.cells.get("Mon-p1").expect("cell").as_str(),
            board.cells["Mon-p1"]
        );
        assert_eq!(reloaded.subjects[0].name, "Math");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn apply_all_renames_every_matching_cell() {
        let mut board = board_with_class();
        board
            .cells
            .insert("Tue-p2".into(), board.cells["Mon-p1"].clone());
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Maths".into(),
                    hue: Some(320.0),
                    room: String::new(),
                    apply_all: true,
                },
                "2026-11-09",
            )
            .expect("rename");
        let view = board.view(date("2026-11-09"), 8 * 60);
        assert_eq!(view.cells["Mon-p1"].name, "Maths");
        assert_eq!(view.cells["Tue-p2"].name, "Maths");
    }

    #[test]
    fn a_single_cell_rename_keeps_its_twin_untouched() {
        let mut board = board_with_class();
        board
            .cells
            .insert("Tue-p2".into(), board.cells["Mon-p1"].clone());
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Maths".into(),
                    hue: Some(210.0),
                    room: String::new(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .expect("rename");
        let view = board.view(date("2026-11-09"), 8 * 60);
        assert_eq!(view.cells["Mon-p1"].name, "Maths");
        assert_eq!(view.cells["Tue-p2"].name, "Math");
    }

    #[test]
    fn clearing_a_cell_drops_unused_subjects_but_keeps_linked_ones() {
        let mut board = board_with_class();
        add_task(&mut board, "Chapter 5", Some("s1"), None);
        board
            .apply(
                BoardAction::ClearCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                },
                "2026-11-09",
            )
            .expect("clear cell");
        assert!(board.cells.is_empty());
        // Tasks keep the subject alive so the chip still has a name.
        assert_eq!(board.subjects.len(), 1);
        assert!(!board.view(date("2026-11-09"), 0).subjects[0].in_timetable);
    }

    #[test]
    fn periods_reject_bad_or_overlapping_times() {
        let mut board = Board {
            periods: vec![
                period("p1", "Period 1", "07:30", "08:15", false),
                period("p2", "Period 2", "08:20", "09:05", false),
            ],
            ..Board::default()
        };
        let overlap = board.apply(
            BoardAction::UpdatePeriod {
                id: "p1".into(),
                label: "Period 1".into(),
                start: "07:30".into(),
                end: "08:40".into(),
                is_break: false,
                shift_later: false,
            },
            "2026-11-09",
        );
        assert!(overlap.is_err());
        let backwards = board.apply(
            BoardAction::UpdatePeriod {
                id: "p1".into(),
                label: "Period 1".into(),
                start: "09:00".into(),
                end: "08:00".into(),
                is_break: false,
                shift_later: false,
            },
            "2026-11-09",
        );
        assert!(backwards.is_err());
        let ok = board.apply(
            BoardAction::UpdatePeriod {
                id: "p1".into(),
                label: "Homeroom".into(),
                start: "07:00".into(),
                end: "07:25".into(),
                is_break: false,
                shift_later: false,
            },
            "2026-11-09",
        );
        assert!(ok.is_ok());
        assert_eq!(board.periods[0].label, "Homeroom");
    }

    #[test]
    fn weekend_toggle_changes_the_columns() {
        let mut board = board_with_class();
        board
            .apply(BoardAction::SetWeekend { show: true }, "2026-11-09")
            .expect("weekend on");
        assert_eq!(board.days, vec!["Mon", "Tue", "Sat", "Sun"]);
        board
            .apply(BoardAction::SetWeekend { show: false }, "2026-11-09")
            .expect("weekend off");
        assert_eq!(board.days, vec!["Mon", "Tue"]);
    }

    #[test]
    fn class_today_produces_a_suggestion() {
        let mut board = board_with_class();
        add_task(&mut board, "Chapter 5", Some("s1"), None);
        // 2026-11-09 is a Monday.
        let view = board.view(date("2026-11-09"), 8 * 60);
        assert_eq!(view.suggestions.len(), 1);
        let suggestion = &view.suggestions[0];
        assert_eq!(suggestion.kind, "today");
        assert_eq!(suggestion.subject_name, "Math");
        assert_eq!(suggestion.tasks.len(), 1);
        assert_eq!(view.suggestion_count, 1);
    }

    #[test]
    fn class_tomorrow_produces_a_tonight_suggestion() {
        let mut board = board_with_class();
        add_task(&mut board, "Chapter 5", Some("s1"), None);
        // Sunday: Math is tomorrow.
        let view = board.view(date("2026-11-08"), 20 * 60);
        let suggestion = view.suggestions.first().expect("suggestion");
        assert_eq!(suggestion.kind, "tonight");
        assert_eq!(suggestion.date, "2026-11-08");
    }

    #[test]
    fn scheduled_done_and_hidden_tasks_are_not_suggested() {
        let mut board = board_with_class();
        add_task(&mut board, "Planned", Some("s1"), Some("2026-11-10"));
        add_task(&mut board, "Finished", Some("s1"), None);
        board
            .apply(BoardAction::ToggleTask { id: "t2".into() }, "2026-11-09")
            .expect("toggle");
        assert!(board.view(date("2026-11-09"), 480).suggestions.is_empty());

        add_task(&mut board, "Open", Some("s1"), None);
        board
            .apply(
                BoardAction::Snooze {
                    ids: vec!["t3".into()],
                },
                "2026-11-09",
            )
            .expect("snooze");
        assert!(board.view(date("2026-11-09"), 480).suggestions.is_empty());
        // A later class day brings it back.
        assert_eq!(board.view(date("2026-11-16"), 480).suggestions.len(), 1);

        board
            .apply(
                BoardAction::NeverSuggest {
                    ids: vec!["t3".into()],
                },
                "2026-11-09",
            )
            .expect("never");
        assert!(board.view(date("2026-11-16"), 480).suggestions.is_empty());
    }

    #[test]
    fn subjects_without_a_class_never_get_suggestions() {
        let mut board = board_with_class();
        add_task(&mut board, "Chapter 5", Some("s1"), None);
        board
            .apply(
                BoardAction::ClearCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                },
                "2026-11-09",
            )
            .expect("clear");
        assert!(board.view(date("2026-11-09"), 480).suggestions.is_empty());
    }

    #[test]
    fn due_before_the_next_class_suggests_today() {
        let mut board = board_with_class();
        // Wednesday is after Monday's class, and Tuesday/Wed are free of Math.
        add_task(&mut board, "Revise", Some("s1"), None);
        let mut task = board.tasks[0].clone();
        task.due = Some("2026-11-10".into());
        board.tasks[0] = task;
        // Tuesday: no Math class today, none tomorrow, but the deadline lands
        // before next Monday's class, so today gets a nudge.
        let view = board.view(date("2026-11-10"), 480);
        assert_eq!(view.suggestions.len(), 1);
        assert_eq!(view.suggestions[0].kind, "due");
    }

    #[test]
    fn current_period_tracks_the_wall_clock() {
        let board = board_with_class();
        let view = board.view(date("2026-11-09"), 7 * 60 + 40);
        assert_eq!(view.current_period.as_deref(), Some("p1"));
        let later = board.view(date("2026-11-09"), 10 * 60 + 10);
        assert_eq!(later.current_period, None);
        // Saturday has no column, so there is never a current period there.
        let weekend = board.view(date("2026-11-14"), 7 * 60 + 40);
        assert_eq!(weekend.current_period, None);
    }

    #[test]
    fn reset_clears_the_timetable_but_keeps_tasks() {
        let mut board = board_with_class();
        add_task(&mut board, "Chapter 5", Some("s1"), None);
        board
            .apply(BoardAction::ResetTimetable, "2026-11-09")
            .expect("reset");
        assert!(board.cells.is_empty());
        assert!(board.days.is_empty());
        assert!(board.periods.is_empty());
        assert_eq!(board.tasks.len(), 1);
        assert_eq!(board.subjects.len(), 1);
    }

    #[test]
    fn week_label_and_days_follow_the_start_setting() {
        let mut board = Board::default();
        let view = board.view(date("2026-11-09"), 480);
        assert_eq!(view.week.start, "2026-11-09");
        assert_eq!(view.week.end, "2026-11-15");
        assert_eq!(view.week.label, "Nov 9 to Nov 15, 2026");
        assert_eq!(view.week.days.len(), 7);

        board
            .apply(
                BoardAction::SetWeekStart {
                    start: "Sun".into(),
                },
                "2026-11-09",
            )
            .expect("week start");
        let view = board.view(date("2026-11-09"), 480);
        assert_eq!(view.week.start, "2026-11-08");
        assert_eq!(view.week.end, "2026-11-14");
    }

    #[test]
    fn bad_input_is_rejected_with_a_message() {
        let mut board = Board::default();
        let empty = board.apply(
            BoardAction::SaveCell {
                day: "Mon".into(),
                period_id: "p1".into(),
                name: "   ".into(),
                hue: None,
                room: String::new(),
                apply_all: false,
            },
            "2026-11-09",
        );
        assert!(empty.is_err());
        let long = "x".repeat(MAX_NAME + 1);
        assert!(board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: long,
                    hue: None,
                    room: String::new(),
                    apply_all: false,
                },
                "2026-11-09",
            )
            .is_err());
        assert!(board
            .apply(
                BoardAction::AddTask {
                    title: "   ".into(),
                    subject_id: None,
                    date: None,
                    due: None,
                    time: String::new(),
                    notes: String::new(),
                    priority: None,
                },
                "2026-11-09",
            )
            .is_err());
        board
            .periods
            .push(period("p9", "Recess", "10:00", "10:20", true));
        let break_row = board.apply(
            BoardAction::SaveCell {
                day: "Mon".into(),
                period_id: "p9".into(),
                name: "Math".into(),
                hue: None,
                room: String::new(),
                apply_all: false,
            },
            "2026-11-09",
        );
        assert!(break_row.is_err());
    }

    #[test]
    fn corrupt_files_fall_back_to_an_empty_board_and_are_kept() {
        let path =
            std::env::temp_dir().join(format!("flip-board-corrupt-{}.json", std::process::id()));
        std::fs::write(&path, "not json at all").expect("write");
        let board = load(&path);
        assert!(board.days.is_empty());
        assert!(board.periods.is_empty());
        assert!(board.cells.is_empty());
        let kept: Vec<_> = std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name().to_string_lossy().starts_with(&format!(
                    "flip-board-corrupt-{}.json.unreadable-",
                    std::process::id()
                ))
            })
            .collect();
        assert_eq!(kept.len(), 1, "the unreadable file should be copied aside");
        for entry in kept {
            let _ = std::fs::remove_file(entry.path());
        }
        let _ = std::fs::remove_file(&path);
    }
}
