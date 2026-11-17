//! Portable backups, CSV exports and the safety copies taken before a restore.
//!
//! Everything here is plain file work, so it can be tested without a window.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::board::Board;
use crate::settings::{self, Settings};

/// Bump when the backup shape changes in a way old builds cannot read.
pub const FORMAT_VERSION: u32 = 1;

/// A backup somebody made, as listed in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub created_at: String,
    pub size_bytes: u64,
    /// True for the copies Flip takes by itself before a restore.
    pub automatic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub format_version: u32,
    #[serde(default = "app_name")]
    pub app: String,
    #[serde(default)]
    pub created_at: String,
    pub settings: Settings,
    pub board: Board,
}

fn app_name() -> String {
    "Flip".into()
}

/// A backup that has been read and repaired, ready to be written over the
/// live files.
pub struct Restored {
    pub settings: Settings,
    pub board: Board,
    pub created_at: String,
}

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

/// Rejects anything that could escape the backups folder.
pub fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name.ends_with(".json")
        && !name.contains(['/', '\\'])
        && !name.contains("..")
        && name.chars().all(|c| !c.is_control())
}

pub fn encode(settings: &Settings, board: &Board) -> Result<String, String> {
    let file = BackupFile {
        format_version: FORMAT_VERSION,
        app: app_name(),
        created_at: chrono::Local::now().to_rfc3339(),
        settings: settings.clone(),
        board: board.clone(),
    };
    serde_json::to_string_pretty(&file).map_err(|_| "The backup could not be written.".to_string())
}

/// Reads a backup, repairing anything optional that is missing. A file from a
/// newer Flip is refused rather than half understood.
pub fn decode(raw: &str) -> Result<Restored, String> {
    let file: BackupFile =
        serde_json::from_str(raw).map_err(|_| "That file is not a Flip backup.".to_string())?;
    if file.format_version > FORMAT_VERSION {
        return Err(format!(
            "That backup was made by a newer version of Flip (format {}).",
            file.format_version
        ));
    }
    let mut board = file.board;
    board.sanitize();
    Ok(Restored {
        settings: settings::normalise(file.settings),
        board,
        created_at: file.created_at,
    })
}

pub fn write(
    data_dir: &Path,
    settings: &Settings,
    board: &Board,
    automatic: bool,
) -> Result<BackupInfo, String> {
    let folder = dir(data_dir);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Could not create the backups folder: {e}"))?;
    let body = encode(settings, board)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S").to_string();
    let prefix = if automatic {
        "flip-auto"
    } else {
        "flip-backup"
    };
    let mut name = format!("{prefix}-{stamp}.json");
    // Two backups in the same second must not overwrite each other.
    let mut counter = 2;
    while folder.join(&name).exists() {
        name = format!("{prefix}-{stamp}-{counter}.json");
        counter += 1;
    }
    let path = folder.join(&name);
    std::fs::write(&path, body).map_err(|e| format!("Could not save the backup: {e}"))?;
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupInfo {
        name,
        created_at: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
        size_bytes,
        automatic,
    })
}

pub fn list(data_dir: &Path) -> Vec<BackupInfo> {
    let folder = dir(data_dir);
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Vec::new();
    };
    let mut found: Vec<(std::time::SystemTime, BackupInfo)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_safe_name(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        let created_at: chrono::DateTime<chrono::Local> = modified.into();
        found.push((
            modified,
            BackupInfo {
                name: name.clone(),
                created_at: created_at.format("%Y-%m-%d %H:%M").to_string(),
                size_bytes: meta.len(),
                automatic: name.starts_with("flip-auto-"),
            },
        ));
    }
    found.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    found.into_iter().map(|(_, info)| info).collect()
}

/* ------------------------------------------------------------------- exports */

/// Excel only reads a UTF-8 CSV correctly when it starts with this mark. Three
/// bytes at the very top, written once, never twice.
pub const UTF8_BOM: &str = "\u{feff}";

/// Drops a byte-order mark so a file that came back through Excel still has a
/// readable first header ("Day", not "\u{feff}Day").
pub fn strip_bom(text: &str) -> &str {
    text.strip_prefix(UTF8_BOM).unwrap_or(text)
}

fn csv_cell(field: &str, separator: char) -> String {
    if field.contains(separator) || field.chars().any(|c| matches!(c, '"' | '\n' | '\r')) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn csv_row(cells: &[&str], separator: char) -> String {
    let mut line = cells
        .iter()
        .map(|cell| csv_cell(cell, separator))
        .collect::<Vec<_>>()
        .join(&separator.to_string());
    line.push_str("\r\n");
    line
}

pub fn tasks_csv(board: &Board, separator: char) -> String {
    let mut out = format!(
        "{UTF8_BOM}{}",
        csv_row(
            &["Title", "Subject", "Planned", "Due", "Time", "Priority", "Done", "Notes"],
            separator
        )
    );
    let mut tasks = board.tasks.clone();
    tasks.sort_by(|a, b| {
        a.date
            .clone()
            .unwrap_or_else(|| "9999-99-99".into())
            .cmp(&b.date.clone().unwrap_or_else(|| "9999-99-99".into()))
    });
    for task in &tasks {
        let subject = task
            .subject_id
            .as_ref()
            .and_then(|id| board.subjects.iter().find(|s| &s.id == id))
            .map(|s| s.name.clone())
            .unwrap_or_default();
        let priority = match task.priority {
            Some(crate::board::Priority::High) => "high",
            Some(crate::board::Priority::Medium) => "medium",
            Some(crate::board::Priority::Low) => "low",
            None => "",
        };
        out.push_str(&csv_row(
            &[
                &task.title,
                &subject,
                task.date.as_deref().unwrap_or(""),
                task.due.as_deref().unwrap_or(""),
                &task.time,
                priority,
                if task.done { "yes" } else { "no" },
                &task.notes,
            ],
            separator,
        ));
    }
    out
}

pub fn timetable_csv(board: &Board, separator: char) -> String {
    let mut out = format!(
        "{UTF8_BOM}{}",
        csv_row(&["Day", "Start", "End", "Subject", "Room"], separator)
    );
    for day in &board.days {
        for period in &board.periods {
            if period.is_break {
                continue;
            }
            let Some(subject_id) = board.cells.get(&format!("{day}-{}", period.id)) else {
                continue;
            };
            let Some(subject) = board.subjects.iter().find(|s| &s.id == subject_id) else {
                continue;
            };
            out.push_str(&csv_row(
                &[
                    day,
                    &period.start,
                    &period.end,
                    &subject.name,
                    &subject.room,
                ],
                separator,
            ));
        }
    }
    out
}

/* ------------------------------------------------------------ reading tables */

/// What one paste or CSV file turned into, counted the way the preview shows
/// it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImport {
    pub rows: Vec<crate::board::ImportRow>,
    pub days: usize,
    pub periods: usize,
    pub subjects: usize,
}

/// Splits one line on a separator, keeping quoted fields together and turning
/// a doubled quote back into a real one.
fn split_row(line: &str, separator: char) -> Vec<String> {
    let mut cells: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            _ if c == separator && !quoted => {
                cells.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(c),
        }
    }
    cells.push(current.trim().to_string());
    cells
}

/// Picks the separator a pasted table uses. Tabs win, then semicolons when
/// they outnumber commas, because that is what a Vietnamese Excel copies.
fn pick_separator(text: &str) -> char {
    let sample: Vec<&str> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(4)
        .collect();
    if sample.iter().any(|line| line.contains('\t')) {
        return '\t';
    }
    let commas: usize = sample.iter().map(|line| line.matches(',').count()).sum();
    let semicolons: usize = sample.iter().map(|line| line.matches(';').count()).sum();
    if semicolons > commas {
        ';'
    } else {
        ','
    }
}

fn clean(value: &str) -> String {
    value.trim().to_string()
}

fn day_of(value: &str) -> Option<String> {
    let key = value
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    let three: String = key.chars().take(3).collect();
    match three.as_str() {
        "mon" => Some("Mon".into()),
        "tue" => Some("Tue".into()),
        "wed" => Some("Wed".into()),
        "thu" => Some("Thu".into()),
        "fri" => Some("Fri".into()),
        "sat" => Some("Sat".into()),
        "sun" => Some("Sun".into()),
        _ => None,
    }
}

fn minute_of(value: &str) -> Option<u32> {
    let text = value
        .trim()
        .to_ascii_lowercase()
        .replace(['.', 'h', ' '], ":");
    let mut parts = text.split(':').filter(|p| !p.is_empty());
    let hour: u32 = parts.next()?.parse().ok()?;
    let minute: u32 = parts.next().unwrap_or("0").parse().ok()?;
    if hour > 23 || minute > 59 {
        return None;
    }
    Some(hour * 60 + minute)
}

fn clock_text(minutes: u32) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

/// Reads a time range written as one cell: "07:30-08:15", "7:30 – 8:15",
/// "07:30 08:15" or "07:30".
fn time_range(value: &str) -> Option<(String, String)> {
    let text = value.replace(['–', '—'], "-");
    let normalised = text
        .replace(" to ", "-")
        .replace(" đến ", "-")
        .replace('–', "-");
    let mut parts = normalised
        .split('-')
        .map(str::trim)
        .filter(|p| !p.is_empty());
    let start = minute_of(parts.next()?)?;
    match parts.next() {
        Some(end) => {
            let end = minute_of(end)?;
            if end <= start {
                None
            } else {
                Some((clock_text(start), clock_text(end)))
            }
        }
        None => None,
    }
}

fn header_columns(cells: &[String]) -> Option<(usize, usize, usize, usize, Option<usize>)> {
    let mut day = None;
    let mut start = None;
    let mut end = None;
    let mut subject = None;
    let mut room = None;
    for (index, cell) in cells.iter().enumerate() {
        let key: String = cell
            .trim()
            .to_ascii_lowercase()
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .collect();
        match key.as_str() {
            "day" | "weekday" => day = Some(index),
            "start" | "starts" | "from" => start = Some(index),
            "end" | "ends" | "to" => end = Some(index),
            "subject" | "class" | "lesson" => subject = Some(index),
            "room" | "teacher" | "location" => room = Some(index),
            _ => {}
        }
    }
    match (day, start, end, subject) {
        (Some(day), Some(start), Some(end), Some(subject)) => {
            Some((day, start, end, subject, room))
        }
        _ => None,
    }
}

/// Turns pasted cells - or a CSV file - into lessons. It understands the two
/// shapes people actually copy: a grid with days across the top and times down
/// the side, and a list with Day, Start, End, Subject columns.
pub fn parse_table(text: &str) -> Result<TableImport, String> {
    let body = strip_bom(text).replace("\r\n", "\n").replace('\r', "\n");
    if body.trim().is_empty() {
        return Err("Paste a table first.".into());
    }
    if body.len() > 200_000 {
        return Err("That table is too large to read.".into());
    }
    let separator = pick_separator(&body);
    let grid: Vec<Vec<String>> = body
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| split_row(line, separator))
        .collect();
    if grid.is_empty() {
        return Err("That table has no rows.".into());
    }

    let mut rows: Vec<crate::board::ImportRow> = Vec::new();

    if let Some((day_col, start_col, end_col, subject_col, room_col)) = header_columns(&grid[0]) {
        for (index, line) in grid.iter().enumerate().skip(1) {
            let get = |at: usize| line.get(at).map(|v| clean(v)).unwrap_or_default();
            let subject = get(subject_col);
            if subject.is_empty() {
                continue;
            }
            let day = day_of(&get(day_col))
                .ok_or_else(|| format!("Row {}: the day must be Mon to Sun.", index + 1))?;
            let start = minute_of(&get(start_col))
                .ok_or_else(|| format!("Row {}: the start time looks wrong.", index + 1))?;
            let end = minute_of(&get(end_col))
                .ok_or_else(|| format!("Row {}: the end time looks wrong.", index + 1))?;
            if end <= start {
                return Err(format!(
                    "Row {}: the end time is not after the start.",
                    index + 1
                ));
            }
            rows.push(crate::board::ImportRow {
                day,
                start: clock_text(start),
                end: clock_text(end),
                subject,
                room: room_col.map(get).unwrap_or_default(),
            });
        }
    } else {
        let header = &grid[0];
        let mut day_columns: Vec<Option<String>> = header
            .iter()
            .enumerate()
            .map(|(index, cell)| if index == 0 { None } else { day_of(cell) })
            .collect();
        day_columns[0] = None;
        let known = day_columns.iter().filter(|d| d.is_some()).count();
        if known == 0 {
            return Err("The first row should list days - Mon, Tue, Wed…".into());
        }
        for (row_index, line) in grid.iter().enumerate().skip(1) {
            let Some((start, end)) = time_range(&line[0]) else {
                return Err(format!(
                    "Row {}: the first cell should hold a time like 07:30-08:15.",
                    row_index + 1
                ));
            };
            for (index, day) in day_columns.iter().enumerate() {
                let Some(day) = day else { continue };
                let Some(subject) = line.get(index).map(|v| clean(v)) else {
                    continue;
                };
                if subject.is_empty() {
                    continue;
                }
                rows.push(crate::board::ImportRow {
                    day: day.clone(),
                    start: start.clone(),
                    end: end.clone(),
                    subject,
                    room: String::new(),
                });
            }
        }
    }

    if rows.is_empty() {
        return Err("That table has no lessons in it.".into());
    }
    if rows.len() > 500 {
        return Err("That table has more than 500 lessons.".into());
    }
    let days = rows
        .iter()
        .map(|row| row.day.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let periods = rows
        .iter()
        .map(|row| (row.start.clone(), row.end.clone()))
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let subjects = rows
        .iter()
        .map(|row| row.subject.to_lowercase())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    Ok(TableImport {
        rows,
        days,
        periods,
        subjects,
    })
}

pub fn settings_json(settings: &Settings) -> Result<String, String> {
    serde_json::to_string_pretty(settings).map_err(|_| "Settings could not be exported.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{BoardAction, Task};

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("flip-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn vietnamese_board() -> Board {
        let mut board = Board {
            days: vec![
                "Mon".into(),
                "Tue".into(),
                "Wed".into(),
                "Thu".into(),
                "Fri".into(),
            ],
            periods: vec![
                crate::board::Period {
                    id: "p1".into(),
                    label: "Period 1".into(),
                    start: "07:30".into(),
                    end: "08:15".into(),
                    is_break: false,
                },
                crate::board::Period {
                    id: "p2".into(),
                    label: "Period 2".into(),
                    start: "08:20".into(),
                    end: "09:05".into(),
                    is_break: false,
                },
            ],
            ..Board::default()
        };
        let names = [
            "Thể dục",
            "Địa",
            "Tiếng Anh",
            "Công Dân",
            "HĐTN",
            "Địa Phương",
        ];
        for (index, name) in names.iter().enumerate() {
            let id = format!("s{}", index + 1);
            board.subjects.push(crate::board::Subject {
                id: id.clone(),
                name: (*name).into(),
                hue: 40.0 + index as f64 * 40.0,
                room: String::new(),
                legacy_color: String::new(),
            });
            let day = board.days[index % board.days.len()].clone();
            let period = board.periods[index % board.periods.len()].id.clone();
            board.cells.insert(format!("{day}-{period}"), id);
        }
        board
    }

    #[test]
    fn the_timetable_csv_starts_with_a_bom_and_keeps_vietnamese_intact() {
        let board = vietnamese_board();
        let csv = timetable_csv(&board, ',');
        let bytes = csv.as_bytes();
        assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "no UTF-8 BOM");
        assert!(csv.starts_with(UTF8_BOM));
        assert_eq!(csv.matches('\u{feff}').count(), 1, "BOM written twice");
        for name in ["Thể dục", "Địa", "Tiếng Anh", "Công Dân", "HĐTN"] {
            assert!(csv.contains(name), "lost {name}");
        }
        assert!(csv.contains("\r\n"), "line endings are not CRLF");
    }

    #[test]
    fn a_csv_round_trips_through_the_parser() {
        let board = vietnamese_board();
        let csv = timetable_csv(&board, ',');
        let parsed = parse_table(&csv).expect("CSV parses");
        assert_eq!(parsed.rows.len(), board.cells.len());
        assert_eq!(parsed.days, 5);

        let mut copy = Board::default();
        copy.apply(
            crate::board::BoardAction::ImportTimetable {
                rows: parsed.rows,
                merge: false,
            },
            "2026-11-16",
        )
        .expect("import applies");
        let before: Vec<(String, String)> = board
            .cells
            .iter()
            .map(|(key, id)| {
                let name = board
                    .subjects
                    .iter()
                    .find(|s| &s.id == id)
                    .map(|s| s.name.clone())
                    .unwrap_or_default();
                (key.clone(), name)
            })
            .collect();
        let after: Vec<(String, String)> = copy
            .cells
            .iter()
            .map(|(key, id)| {
                let name = copy
                    .subjects
                    .iter()
                    .find(|s| &s.id == id)
                    .map(|s| s.name.clone())
                    .unwrap_or_default();
                (key.clone(), name)
            })
            .collect();
        assert_eq!(before, after, "the round trip changed the timetable");
    }

    #[test]
    fn a_bom_and_no_bom_both_import() {
        let plain = "Day,Start,End,Subject,Room\r\nMon,07:30,08:15,Thể dục,Sân\r\n";
        let with_bom = format!("{UTF8_BOM}{plain}");
        for text in [plain.to_string(), with_bom] {
            let parsed = parse_table(&text).expect("parses");
            assert_eq!(parsed.rows.len(), 1);
            assert_eq!(parsed.rows[0].day, "Mon");
            assert_eq!(parsed.rows[0].subject, "Thể dục");
            assert_eq!(parsed.rows[0].room, "Sân");
        }
    }

    #[test]
    fn semicolons_and_quoted_commas_survive() {
        let csv = timetable_csv(&vietnamese_board(), ';');
        assert!(csv.contains("Mon;07:30;08:15;Thể dục"));
        let parsed = parse_table(&csv).expect("semicolon CSV parses");
        assert_eq!(parsed.rows[0].subject, "Thể dục");

        let quoted = "Day;Start;End;Subject;Room\r\nMon;07:30;08:15;\"Văn, nâng cao\";\"Phòng \"\"A\"\"\"\r\n";
        let parsed = parse_table(quoted).expect("quoted CSV parses");
        assert_eq!(parsed.rows[0].subject, "Văn, nâng cao");
        assert_eq!(parsed.rows[0].room, "Phòng \"A\"");
    }

    #[test]
    fn a_copied_grid_of_days_and_times_becomes_lessons() {
        let grid = "Buổi\tMon\tTue\tWed\n07:30-08:15\tToán\tLý\tHóa\n08:20-09:05\tVăn\t\tSinh";
        let parsed = parse_table(grid).expect("grid parses");
        assert_eq!(parsed.rows.len(), 5);
        assert_eq!(parsed.days, 3);
        assert_eq!(parsed.periods, 2);
        assert!(parsed.rows.iter().any(|row| row.subject == "Toán"));
    }

    #[test]
    fn a_table_that_makes_no_sense_says_so() {
        assert!(parse_table("").is_err());
        assert!(parse_table("hello world").is_err());
        let bad = "Mon\t07:30-08:15\nToán\tVăn";
        assert!(parse_table(bad).is_err());
    }

    #[test]
    fn a_backup_round_trips_settings_and_tasks() {
        let mut board = Board::default();
        board
            .apply(
                BoardAction::AddTask {
                    title: "Read chapter 4".into(),
                    subject_id: None,
                    date: Some("2026-11-11".into()),
                    due: None,
                    time: "16:00".into(),
                    notes: "pages 80-96".into(),
                    priority: None,
                },
                "2026-11-11",
            )
            .unwrap();
        let settings = Settings {
            accent_hue: Some(140.0),
            ..Settings::default()
        };
        let raw = encode(&settings, &board).unwrap();
        let restored = decode(&raw).unwrap();
        assert_eq!(restored.settings.accent_hue, Some(140.0));
        assert_eq!(restored.board.tasks.len(), 1);
        assert_eq!(restored.board.tasks[0].title, "Read chapter 4");
    }

    #[test]
    fn rubbish_and_newer_formats_are_refused() {
        assert!(decode("not json").is_err());
        assert!(decode("{\"formatVersion\":99,\"settings\":{},\"board\":{}}").is_err());
    }

    #[test]
    fn names_cannot_escape_the_backups_folder() {
        assert!(is_safe_name("flip-backup-2026.json"));
        assert!(!is_safe_name("../secrets.json"));
        assert!(!is_safe_name("C:\\secrets.json"));
        assert!(!is_safe_name("notes.txt"));
    }

    #[test]
    fn writing_twice_in_one_second_keeps_both_files() {
        let root = scratch("twice");
        let board = Board::default();
        let settings = Settings::default();
        let first = write(&root, &settings, &board, false).unwrap();
        let second = write(&root, &settings, &board, false).unwrap();
        assert_ne!(first.name, second.name);
        assert_eq!(list(&root).len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn csv_quotes_commas_and_quotes() {
        let row = csv_row(&["Essay, draft", "say \"hi\""], ',');
        assert_eq!(row, "\"Essay, draft\",\"say \"\"hi\"\"\"\r\n");
    }

    #[test]
    fn tasks_csv_names_the_subject_and_skips_breaks() {
        let mut board = Board::default();
        board.days = vec!["Mon".into()];
        board.periods = vec![
            crate::board::Period {
                id: "p1".into(),
                label: "Recess".into(),
                start: "09:00".into(),
                end: "09:20".into(),
                is_break: true,
            },
            crate::board::Period {
                id: "p2".into(),
                label: "Period 1".into(),
                start: "09:30".into(),
                end: "10:15".into(),
                is_break: false,
            },
        ];
        board.subjects.push(crate::board::Subject {
            id: "s1".into(),
            name: "Math".into(),
            hue: 24.0,
            room: "B12".into(),
            legacy_color: String::new(),
        });
        board.cells.insert("Mon-p2".into(), "s1".into());
        board.tasks.push(Task {
            id: "t1".into(),
            title: "Essay, draft".into(),
            subject_id: Some("s1".into()),
            date: None,
            due: None,
            time: String::new(),
            notes: String::new(),
            priority: None,
            done: false,
        });
        let tasks = tasks_csv(&board, ',');
        assert!(tasks.contains("\"Essay, draft\",Math"));
        let timetable = timetable_csv(&board, ',');
        assert!(timetable.contains("Mon,09:30,10:15,Math,B12"));
        assert_eq!(timetable.lines().count(), 2);
    }
}
