//! Persisted user preferences.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The accent the app ships with: a warm rust that suits the light theme.
pub const DEFAULT_ACCENT: &str = "#B4622D";

/// Dashboard widgets, in the order a fresh install shows them.
pub const DASH_WIDGETS: [&str; 6] = ["next", "today", "due", "tasks", "focus", "stats"];

/// The looks the app ships with. `light` and `dark` are the defaults; the
/// high-contrast pair and `flat` are for people who want less decoration.
pub const THEMES: [&str; 5] = ["light", "light-hc", "dark", "dark-hc", "flat"];

/// "snappy" removes animation entirely for people who find it distracting.
pub const MOTIONS: [&str; 4] = ["extra", "normal", "fast", "snappy"];

/// Interface zoom, in percent. The window buttons step by ten.
pub const MIN_ZOOM: u32 = 80;
pub const MAX_ZOOM: u32 = 160;
pub const ZOOM_STEP: i32 = 10;

/// Rounds to a ten and keeps it inside the allowed range.
pub fn normalise_zoom(value: i32) -> u32 {
    let stepped = ((value as f64 / ZOOM_STEP as f64).round() as i32) * ZOOM_STEP;
    stepped.clamp(MIN_ZOOM as i32, MAX_ZOOM as i32) as u32
}

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
    /// One of `THEMES`; "light" unless the user picked another.
    pub theme: String,
    /// "en" (default) or "vi".
    pub language: String,
    /// Play the small interface sounds.
    pub sound: bool,
    /// False until the first-run setup has been finished or skipped.
    pub onboarded: bool,
    /// One of `MOTIONS`: how lively the interface feels.
    pub motion: String,
    /// Interface zoom in percent; 100 is normal.
    pub zoom: u32,
    /// The soft accent gradient behind the app, on by default.
    pub wash: bool,
    /// Discord Rich Presence: on unless the user turns it off.
    pub discord: bool,
    /// Bigger buttons, rows and spacing, for touch screens and shaky hands.
    pub touch: bool,
    /// Opt-in: send one anonymous ping a day. Off until the user turns it on.
    pub telemetry: bool,
    /// Random id made on this machine when telemetry is switched on. Not tied
    /// to an account, an email, or any hardware.
    pub install_id: String,
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
            theme: "light".into(),
            language: "en".into(),
            sound: true,
            onboarded: false,
            motion: "normal".into(),
            zoom: 100,
            wash: true,
            discord: true,
            touch: false,
            telemetry: false,
            install_id: String::new(),
            accent: DEFAULT_ACCENT.into(),
            focus_secs: DEFAULT_FOCUS_SECS,
            dashboard: Dashboard::default(),
        }
    }
}

/// Older builds stored "beige" and "dark"; both still load.
pub fn normalise_theme(value: &str) -> String {
    match value.trim() {
        "dark" => "dark",
        "light-hc" => "light-hc",
        "dark-hc" => "dark-hc",
        "flat" => "flat",
        _ => "light",
    }
    .to_string()
}

pub fn normalise_motion(value: &str) -> String {
    match value.trim() {
        "extra" => "extra",
        "fast" => "fast",
        "snappy" => "snappy",
        _ => "normal",
    }
    .to_string()
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

/// A random id for this install, made without pulling in a random-number crate.
/// Two freshly seeded hashers over the clock and the process id give 128 bits of
/// hex; nothing about the machine can be derived from it.
pub fn new_install_id() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut id = String::with_capacity(24);
    for _ in 0..2 {
        let mut hasher = RandomState::new().build_hasher();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        hasher.write_u128(nanos);
        hasher.write_u32(std::process::id());
        id.push_str(&format!("{:016x}", hasher.finish()));
    }
    id
}

/// Keeps an install id only if it looks like one we made, so a hand-edited
/// settings file cannot smuggle anything else into the ping.
pub fn normalise_install_id(value: &str) -> String {
    let trimmed = value.trim();
    let ok = (8..=64).contains(&trimmed.len())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && trimmed.chars().any(|c| c.is_ascii_digit());
    if ok {
        trimmed.to_string()
    } else {
        String::new()
    }
}

/// Every value a stored or restored settings object can get wrong, repaired in
/// one place so loading, restoring and importing all agree.
pub fn normalise(mut settings: Settings) -> Settings {
    settings.theme = normalise_theme(&settings.theme);
    settings.motion = normalise_motion(&settings.motion);
    settings.zoom = settings.zoom.clamp(MIN_ZOOM, MAX_ZOOM);
    if settings.language != "vi" {
        settings.language = "en".into();
    }
    settings.accent = normalise_accent(&settings.accent);
    settings.install_id = normalise_install_id(&settings.install_id);
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
    fn themes_and_motions_are_known_values_only() {
        assert_eq!(normalise_theme("beige"), "light");
        assert_eq!(normalise_theme("dark-hc"), "dark-hc");
        assert_eq!(normalise_theme("neon"), "light");
        assert_eq!(normalise_motion("snappy"), "snappy");
        assert_eq!(normalise_motion("wobble"), "normal");
        assert_eq!(normalise_zoom(105), 110);
        assert_eq!(normalise_zoom(10), 80);
        assert_eq!(normalise_zoom(400), 160);
    }

    #[test]
    fn normalise_clamps_focus_and_repairs_theme() {
        let settings = normalise(Settings {
            theme: "neon".into(),
            accent: "nope".into(),
            focus_secs: 7,
            ..Settings::default()
        });
        assert_eq!(settings.theme, "light");
        assert_eq!(settings.motion, "normal");
        assert_eq!(settings.accent, DEFAULT_ACCENT);
        assert_eq!(settings.focus_secs, 60);
    }
}
