//! Persisted user preferences.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The accent the app ships with: a warm rust that suits the beige palette.
pub const DEFAULT_ACCENT: &str = "#B4622D";

/// Dashboard widgets, in the order a fresh install shows them.
pub const DASH_WIDGETS: [&str; 6] = ["next", "today", "due", "tasks", "focus", "stats"];

/// How long a focus session runs by default: 25 minutes.
pub const DEFAULT_FOCUS_SECS: u32 = 25 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Dashboard {
    /// Widget ids in display order.
    pub order: Vec<String>,
    /// Widget ids the user turned off.
    pub hidden: Vec<String>,
}

impl Default for Dashboard {
    fn default() -> Self {
        Self {
            order: DASH_WIDGETS.iter().map(|w| (*w).to_string()).collect(),
            hidden: Vec::new(),
        }
    }
}

impl Dashboard {
    /// Keeps only known widgets, drops duplicates and appends anything new so
    /// an older `settings.json` never hides a newly added widget.
    pub fn sanitize(&mut self) {
        let mut order: Vec<String> = Vec::new();
        let wanted = self
            .order
            .clone()
            .into_iter()
            .chain(DASH_WIDGETS.iter().map(|w| (*w).to_string()));
        for id in wanted {
            if DASH_WIDGETS.contains(&id.as_str()) && !order.contains(&id) {
                order.push(id);
            }
        }
        self.order = order;
        self.hidden.retain(|id| DASH_WIDGETS.contains(&id.as_str()));
        self.hidden.dedup();
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub use_12h: bool,
    pub timer_preset_secs: u32,
    /// "beige" (default) or "dark".
    pub theme: String,
    /// "en" (default) or "vi".
    pub language: String,
    /// Play the small interface sounds.
    pub sound: bool,
    /// False until the first-run setup has been finished or skipped.
    pub onboarded: bool,
    /// "extra", "normal" or "fast" — how lively the interface feels.
    pub motion: String,
    /// Any colour the user picked, `#RRGGBB`. The UI adapts its weight per theme.
    pub accent: String,
    /// Length of a focus session, in seconds.
    pub focus_secs: u32,
    pub dashboard: Dashboard,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            use_12h: false,
            timer_preset_secs: 300,
            theme: "beige".into(),
            language: "en".into(),
            sound: true,
            onboarded: false,
            motion: "normal".into(),
            accent: DEFAULT_ACCENT.into(),
            focus_secs: DEFAULT_FOCUS_SECS,
            dashboard: Dashboard::default(),
        }
    }
}

/// Accepts `#rgb` or `#rrggbb`, upper-cased; anything else falls back to rust.
pub fn normalise_accent(value: &str) -> String {
    let hex = value.trim().trim_start_matches('#');
    let expanded: String = match hex.len() {
        3 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 => hex.to_string(),
        _ => return DEFAULT_ACCENT.into(),
    };
    if !expanded.chars().all(|c| c.is_ascii_hexdigit()) {
        return DEFAULT_ACCENT.into();
    }
    format!("#{}", expanded.to_ascii_uppercase())
}

/// Every value a stored or restored settings object can get wrong, repaired in
/// one place so loading, restoring and importing all agree.
pub fn normalise(mut settings: Settings) -> Settings {
    if settings.theme != "dark" {
        settings.theme = "beige".into();
    }
    if settings.language != "vi" {
        settings.language = "en".into();
    }
    settings.accent = normalise_accent(&settings.accent);
    if settings.timer_preset_secs > crate::timer::MAX_SECS {
        settings.timer_preset_secs = crate::timer::MAX_SECS;
    }
    settings.focus_secs = settings.focus_secs.clamp(60, 7200);
    settings.dashboard.sanitize();
    settings
}

/// Any read or parse failure quietly falls back to the defaults.
pub fn load(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
            Ok(settings) => normalise(settings),
            Err(e) => {
                eprintln!("flip: ignoring unreadable settings: {e}");
                Settings::default()
            }
        },
        Err(_) => Settings::default(),
    }
}

pub fn save(path: &Path, settings: &Settings) {
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("flip: could not create settings directory: {e}");
            return;
        }
    }
    match serde_json::to_string_pretty(settings) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                eprintln!("flip: could not write settings: {e}");
            }
        }
        Err(e) => eprintln!("flip: could not encode settings: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accent_accepts_short_and_long_hex() {
        assert_eq!(normalise_accent("#abc"), "#AABBCC");
        assert_eq!(normalise_accent("b4622d"), "#B4622D");
        assert_eq!(normalise_accent("#zzz"), DEFAULT_ACCENT);
        assert_eq!(normalise_accent(""), DEFAULT_ACCENT);
    }

    #[test]
    fn dashboard_keeps_known_widgets_and_appends_new_ones() {
        let mut dash = Dashboard {
            order: vec!["tasks".into(), "tasks".into(), "nope".into()],
            hidden: vec!["due".into(), "ghost".into(), "due".into()],
        };
        dash.sanitize();
        assert_eq!(dash.order[0], "tasks");
        assert_eq!(dash.order.len(), DASH_WIDGETS.len());
        assert!(dash.order.contains(&"next".to_string()));
        assert!(dash.order.contains(&"stats".to_string()));
        assert_eq!(dash.hidden, vec!["due".to_string()]);
    }

    #[test]
    fn normalise_clamps_focus_and_repairs_theme() {
        let settings = normalise(Settings {
            theme: "neon".into(),
            accent: "nope".into(),
            focus_secs: 7,
            ..Settings::default()
        });
        assert_eq!(settings.theme, "beige");
        assert_eq!(settings.accent, DEFAULT_ACCENT);
        assert_eq!(settings.focus_secs, 60);
    }
}
