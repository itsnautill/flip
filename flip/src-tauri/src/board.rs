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
/// Colour swatches offered in the UI.
pub const COLORS: [&str; 8] = [
    "#B4622D", "#C9974A", "#6F8F5B", "#4F7F8C", "#7A6BA8", "#B25C6B", "#8A7A65", "#55708C",
];

const DAY_KEYS: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub room: String,
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

/// Study time for the dashboard, derived from the session log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusView {
    pub today_secs: u32,
    pub week_secs: u32,
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
}

impl Default for Board {
    fn default() -> Self {
        Self {
            version: 1,
            days: ordered_days(false),
            periods: default_periods(),
            cells: BTreeMap::new(),
            subjects: Vec::new(),
            tasks: Vec::new(),
            snoozed: BTreeMap::new(),
            never: Vec::new(),
            sessions: Vec::new(),
            week_start: "Mon".into(),
        }
    }
}

/// Eight class periods with a recess and a lunch row between them.
fn default_periods() -> Vec<Period> {
    let row = |id: &str, label: &str, start: &str, end: &str, is_break: bool| Period {
        id: id.into(),
        label: label.into(),
        start: start.into(),
        end: end.into(),
        is_break,
    };
    vec![
        row("p1", "Period 1", "07:30", "08:15", false),
        row("p2", "Period 2", "08:20", "09:05", false),
        row("p3", "Period 3", "09:10", "09:55", false),
        row("p4", "Recess", "10:00", "10:20", true),
        row("p5", "Period 4", "10:25", "11:10", false),
        row("p6", "Period 5", "11:15", "12:00", false),
        row("p7", "Lunch", "12:05", "12:45", true),
        row("p8", "Period 6", "12:50", "13:35", false),
        row("p9", "Period 7", "13:40", "14:25", false),
        row("p10", "Period 8", "14:30", "15:15", false),
    ]
}

fn ordered_days(show_weekend: bool) -> Vec<String> {
    let mut days: Vec<String> = DAY_KEYS[..5].iter().map(|d| (*d).to_string()).collect();
    if show_weekend {
        days.push("Sat".into());
        days.push("Sun".into());
    }
    days
}

/* ------------------------------------------------------------------ loading */

/// A missing, unreadable or corrupt file falls back to a fresh board.
pub fn load(path: &Path) -> Board {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<Board>(&raw) {
            Ok(mut board) => {
                board.sanitize();
                board
            }
            Err(e) => {
                eprintln!("flip: ignoring unreadable timetable: {e}");
                Board::default()
            }
        },
        Err(_) => Board::default(),
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
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                eprintln!("flip: could not write timetable: {e}");
            }
        }
        Err(e) => eprintln!("flip: could not encode timetable: {e}"),
    }
}

impl Board {
    /// Drops anything a hand-edited file could get wrong.
    pub(crate) fn sanitize(&mut self) {
        if self.days.is_empty() {
            self.days = ordered_days(false);
        }
        self.days.retain(|d| DAY_KEYS.contains(&d.as_str()));
        if self.days.is_empty() {
            self.days = ordered_days(false);
        }
        if self.periods.is_empty() {
            self.periods = default_periods();
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
        let mut studied: HashSet<NaiveDate> = HashSet::new();
        for session in &self.sessions {
            week_secs = week_secs.saturating_add(session.secs);
            let Some(date) = parse_date(&session.date) else {
                continue;
            };
            studied.insert(date);
            if session.date == today_text {
                today_secs = today_secs.saturating_add(session.secs);
                sessions_today += 1;
            }
            if date < start || date > end {
                week_secs = week_secs.saturating_sub(session.secs);
            }
        }
        // A streak survives until the end of today, so yesterday still counts.
        let mut streak = 0;
        let mut cursor = if studied.contains(&today) {
            today
        } else {
            today - Duration::days(1)
        };
        while studied.contains(&cursor) {
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

/// One lesson row read from an imported spreadsheet.
#[derive(Debug, Clone, Deserialize)]
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

/* ------------------------------------------------------------------ actions */

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BoardAction {
    SaveCell {
        day: String,
        #[serde(rename = "periodId")]
        period_id: String,
        name: String,
        #[serde(default)]
        color: String,
        #[serde(default)]
        room: String,
        #[serde(default, rename = "applyAll")]
        apply_all: bool,
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
    /// Replaces the whole timetable with lessons read from a spreadsheet.
    ImportTimetable {
        rows: Vec<ImportRow>,
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
                color,
                room,
                apply_all,
            } => self.save_cell(&day, &period_id, &name, &color, &room, apply_all),
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
            } => self.update_period(&id, &label, &start, &end, is_break),
            BoardAction::AddPeriod => self.add_period(),
            BoardAction::RemovePeriod { id } => self.remove_period(&id),
            BoardAction::SetWeekend { show } => {
                self.days = ordered_days(show);
                Ok(())
            }
            BoardAction::SetWeekStart { start } => {
                self.week_start = if start == "Sun" { "Sun" } else { "Mon" }.into();
                Ok(())
            }
            BoardAction::ImportTimetable { rows } => self.import_timetable(rows),
            BoardAction::ResetTimetable => {
                self.days = ordered_days(false);
                self.periods = default_periods();
                self.cells.clear();
                self.week_start = "Mon".into();
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
        color: &str,
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
        let color = normalise_color(color);
        let key = cell_key(day, period_id);
        let current = self.cells.get(&key).cloned();

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
                    // Editing one cell should not rename the same subject elsewhere.
                    let new_id = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                    self.subjects.push(Subject {
                        id: new_id.clone(),
                        name: name.into(),
                        color,
                        room: room.into(),
                    });
                    self.cells.insert(key, new_id);
                } else if let Some(subject) = self.subjects.iter_mut().find(|s| s.id == id) {
                    subject.name = name.into();
                    subject.color = color;
                    subject.room = room.into();
                }
            }
            None => {
                // Reuse a subject with the same name so the dot and tooltip are shared.
                if let Some(existing) = self
                    .subjects
                    .iter()
                    .find(|s| s.name.eq_ignore_ascii_case(name))
                {
                    let id = existing.id.clone();
                    self.cells.insert(key, id);
                } else {
                    let new_id = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                    self.subjects.push(Subject {
                        id: new_id.clone(),
                        name: name.into(),
                        color,
                        room: room.into(),
                    });
                    self.cells.insert(key, new_id);
                }
            }
        }
        Ok(())
    }

    /// Replaces the timetable with spreadsheet rows. Everything is validated
    /// first so a bad file can never leave half a timetable behind.
    fn import_timetable(&mut self, rows: Vec<ImportRow>) -> Result<(), String> {
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

        self.days = ordered_days(lessons.iter().any(|row| row.0 == "Sat" || row.0 == "Sun"));
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
        self.cells.clear();

        // Subjects keep their identity by name, so their tasks stay attached.
        let linked: HashSet<String> = self
            .tasks
            .iter()
            .filter_map(|t| t.subject_id.clone())
            .collect();
        self.subjects.retain(|s| linked.contains(&s.id));
        let mut by_name: HashMap<String, String> = self
            .subjects
            .iter()
            .map(|s| (s.name.to_lowercase(), s.id.clone()))
            .collect();
        let mut created = 0usize;

        for (day, start, end, subject, room) in &lessons {
            let key = subject.to_lowercase();
            let id = match by_name.get(&key) {
                Some(id) => id.clone(),
                None => {
                    let id = next_id("s", self.subjects.iter().map(|s| s.id.as_str()));
                    self.subjects.push(Subject {
                        id: id.clone(),
                        name: subject.clone(),
                        color: COLORS[created % COLORS.len()].to_string(),
                        room: room.clone(),
                    });
                    created += 1;
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
            if let Some(index) = slots
                .iter()
                .position(|slot| slot.0 == *start && slot.1 == *end)
            {
                self.cells
                    .insert(cell_key(day, &format!("p{}", index + 1)), id);
            }
        }

        let used: HashSet<String> = self.cells.values().cloned().collect();
        self.subjects
            .retain(|s| used.contains(&s.id) || linked.contains(&s.id));
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
    ) -> Result<(), String> {
        let start_min = parse_hhmm(start).ok_or("Start time must look like 07:30.")?;
        let end_min = parse_hhmm(end).ok_or("End time must look like 08:15.")?;
        if end_min <= start_min {
            return Err("End time must be after the start time.".into());
        }
        for other in &self.periods {
            if other.id == id {
                continue;
            }
            let (other_start, other_end) = match (parse_hhmm(&other.start), parse_hhmm(&other.end))
            {
                (Some(a), Some(b)) => (a, b),
                _ => continue,
            };
            if start_min < other_end && other_start < end_min {
                return Err(format!("That overlaps {}.", other.label));
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
        let start = self
            .periods
            .last()
            .and_then(|p| parse_hhmm(&p.end))
            .unwrap_or(480);
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
        if self.periods.len() <= 1 {
            return Err("Keep at least one row on the timetable.".into());
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
    pub color: String,
    pub room: String,
    /// Tasks still open for this subject.
    pub pending: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectView {
    pub id: String,
    pub name: String,
    pub color: String,
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
    pub subject_color: String,
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
    pub colors: Vec<&'static str>,
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

        let mut cells = BTreeMap::new();
        for (key, subject_id) in &self.cells {
            if let Some(subject) = self.subjects.iter().find(|s| &s.id == subject_id) {
                cells.insert(
                    key.clone(),
                    CellView {
                        subject_id: subject.id.clone(),
                        name: subject.name.clone(),
                        color: subject.color.clone(),
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
                label: key.clone(),
                is_today: key == today_key,
            })
            .collect();

        let subjects = self
            .subjects
            .iter()
            .map(|s| SubjectView {
                id: s.id.clone(),
                name: s.name.clone(),
                color: s.color.clone(),
                room: s.room.clone(),
                pending: pending.get(s.id.as_str()).copied().unwrap_or(0),
                in_timetable: self.cells.values().any(|v| v == &s.id),
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
            week_start: self.week_start.clone(),
            colors: COLORS.to_vec(),
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
                subject_color: subject.color.clone(),
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

fn normalise_color(value: &str) -> String {
    let value = value.trim().to_uppercase();
    if COLORS.iter().any(|c| *c == value) {
        value
    } else {
        COLORS[0].to_string()
    }
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

    fn board_with_class() -> Board {
        let mut board = Board::default();
        board
            .apply(
                BoardAction::SaveCell {
                    day: "Mon".into(),
                    period_id: "p1".into(),
                    name: "Math".into(),
                    color: COLORS[0].into(),
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
        board.apply(BoardAction::ImportTimetable { rows }, "2026-11-09")
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
        assert_eq!(board.periods.len(), default_periods().len());
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
    fn import_shows_the_weekend_when_saturday_is_used() {
        let mut board = Board::default();
        let rows = vec![ImportRow {
            day: "Sat".into(),
            start: "10:00".into(),
            end: "10:45".into(),
            subject: "Art".into(),
            room: String::new(),
        }];

        import(&mut board, rows).expect("import");
        assert_eq!(board.days.len(), 7);
        assert_eq!(board.days[5], "Sat");
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
                    color: COLORS[1].into(),
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
                    color: COLORS[0].into(),
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
        let mut board = Board::default();
        let overlap = board.apply(
            BoardAction::UpdatePeriod {
                id: "p1".into(),
                label: "Period 1".into(),
                start: "07:30".into(),
                end: "08:40".into(),
                is_break: false,
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
            },
            "2026-11-09",
        );
        assert!(ok.is_ok());
        assert_eq!(board.periods[0].label, "Homeroom");
    }

    #[test]
    fn weekend_toggle_changes_the_columns() {
        let mut board = Board::default();
        assert_eq!(board.days.len(), 5);
        board
            .apply(BoardAction::SetWeekend { show: true }, "2026-11-09")
            .expect("weekend on");
        assert_eq!(board.days.len(), 7);
        board
            .apply(BoardAction::SetWeekend { show: false }, "2026-11-09")
            .expect("weekend off");
        assert_eq!(board.days.len(), 5);
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
        let board = Board::default();
        let view = board.view(date("2026-11-09"), 7 * 60 + 40);
        assert_eq!(view.current_period.as_deref(), Some("p1"));
        let later = board.view(date("2026-11-09"), 10 * 60 + 10);
        assert_eq!(later.current_period.as_deref(), Some("p4")); // recess row
                                                                 // Saturday has no column while the weekend is hidden.
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
        assert_eq!(board.periods.len(), default_periods().len());
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
                color: String::new(),
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
                    color: String::new(),
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
        let break_row = board.apply(
            BoardAction::SaveCell {
                day: "Mon".into(),
                period_id: "p4".into(),
                name: "Math".into(),
                color: String::new(),
                room: String::new(),
                apply_all: false,
            },
            "2026-11-09",
        );
        assert!(break_row.is_err());
    }

    #[test]
    fn corrupt_files_fall_back_to_defaults() {
        let path = std::env::temp_dir().join("flip-board-corrupt.json");
        std::fs::write(&path, "not json at all").expect("write");
        let board = load(&path);
        assert_eq!(board.days.len(), 5);
        assert!(board.cells.is_empty());
        let _ = std::fs::remove_file(&path);
    }
}
