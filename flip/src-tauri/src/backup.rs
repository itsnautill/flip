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

fn csv_cell(field: &str) -> String {
    if field.chars().any(|c| matches!(c, ',' | '"' | '\n' | '\r')) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

fn csv_row(cells: &[&str]) -> String {
    let mut line = cells
        .iter()
        .map(|cell| csv_cell(cell))
        .collect::<Vec<_>>()
        .join(",");
    line.push_str("\r\n");
    line
}

pub fn tasks_csv(board: &Board) -> String {
    let mut out = String::from("Title,Subject,Planned,Due,Time,Priority,Done,Notes\r\n");
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
        out.push_str(&csv_row(&[
            &task.title,
            &subject,
            task.date.as_deref().unwrap_or(""),
            task.due.as_deref().unwrap_or(""),
            &task.time,
            priority,
            if task.done { "yes" } else { "no" },
            &task.notes,
        ]));
    }
    out
}

pub fn timetable_csv(board: &Board) -> String {
    let mut out = String::from("Day,Start,End,Subject,Room\r\n");
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
            out.push_str(&csv_row(&[
                day,
                &period.start,
                &period.end,
                &subject.name,
                &subject.room,
            ]));
        }
    }
    out
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
            accent: "#6f8f5b".into(),
            ..Settings::default()
        };
        let raw = encode(&settings, &board).unwrap();
        let restored = decode(&raw).unwrap();
        assert_eq!(restored.settings.accent, "#6F8F5B");
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
        let row = csv_row(&["Essay, draft", "say \"hi\""]);
        assert_eq!(row, "\"Essay, draft\",\"say \"\"hi\"\"\"\r\n");
    }

    #[test]
    fn tasks_csv_names_the_subject_and_skips_breaks() {
        let mut board = Board::default();
        board.subjects.push(crate::board::Subject {
            id: "s1".into(),
            name: "Math".into(),
            color: "#B4622D".into(),
            room: "B12".into(),
        });
        board.periods[0].is_break = true;
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
        let tasks = tasks_csv(&board);
        assert!(tasks.contains("\"Essay, draft\",Math"));
        let timetable = timetable_csv(&board);
        assert!(timetable.contains("Mon,08:20,09:05,Math,B12"));
        assert_eq!(timetable.lines().count(), 2);
    }
}
