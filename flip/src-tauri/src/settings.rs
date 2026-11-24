//! Persisted user preferences.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::board::{hue_from_hex, normalise_hue};

/// The hue the app ships with: blue, the one 1.3.6 opens on.
pub const DEFAULT_ACCENT_HUE: f64 = 258.0;

/// Bumped when the settings shape changes. Version 3 stores the accent as a
/// hue only; files that still carry an API key are read but never written back
/// with one.
pub const SETTINGS_VERSION: u32 = 3;

/// Dashboard widgets, in the order a fresh install shows them.
pub const DASH_WIDGETS: [&str; 6] = ["next", "today", "due", "tasks", "focus", "stats"];

/// The bases the app is painted from. A palette is laid over whichever of
/// these is chosen, so every theme works in light and in dark.
pub const THEMES: [&str; 3] = ["system", "light", "dark"];

/// The palettes that can be painted over a base.
pub const PALETTES: [&str; 5] = ["blossom", "paper", "mint", "slate", "midnight"];

/// "snappy" removes animation entirely for people who find it distracting.
pub const MOTIONS: [&str; 4] = ["extra", "normal", "fast", "snappy"];

/// Every interface sound, in the order the Sounds page lists them. A cue id
/// here is the same one the frontend uses in its sound table.
pub const SOUND_CUES: [&str; 17] = [
    "chime",
    "complete",
    "uncheck",
    "start",
    "pause",
    "reset",
    "tab",
    "dialog",
    "dismiss",
    "confirm",
    "remove",
    "open",
    "syncStart",
    "syncTick",
    "syncLink",
    "syncDone",
    "syncFail",
];

/// How a growing study streak is celebrated: the full cutscene, a toast, or
/// nothing at all.
pub const STREAK_EFFECTS: [&str; 3] = ["full", "notification", "none"];

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Shape of this file. Older files are converted on load.
    #[serde(default)]
    pub version: u32,
    pub use_12h: bool,
    pub timer_preset_secs: u32,
    /// One of `THEMES`: the light or dark base, or "system" to follow the
    /// computer. "light" unless the user picked another.
    pub theme: String,
    /// One of `PALETTES`, or empty for no palette. Painted over `theme`.
    pub palette: String,
    /// "en" (default) or "vi".
    pub language: String,
    /// Play the small interface sounds.
    pub sound: bool,
    /// Master volume for every interface sound, 0-100.
    pub sound_volume: u32,
    /// Cue ids the user switched off. Empty means every sound plays.
    pub sound_muted: Vec<String>,
    /// False until the first-run setup has been finished or skipped.
    pub onboarded: bool,
    /// One of `MOTIONS`: how lively the interface feels.
    pub motion: String,
    /// One of `STREAK_EFFECTS`: what happens when the study streak grows.
    pub streak_effects: String,
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
    /// 0-360. Only the hue is stored; the UI derives every weight and the ink
    /// that sits on top of it.
    #[serde(default)]
    pub accent_hue: Option<f64>,
    /// Files written before 1.1.2 stored the accent as `#RRGGBB`. Read once,
    /// then forgotten.
    #[serde(default, skip_serializing)]
    pub accent: String,
    /// Length of a focus session, in seconds.
    pub focus_secs: u32,
    /// Count every finished countdown in the study log, as if it were a focus
    /// session. On by default; the Set timer dialog can turn it off.
    #[serde(default = "default_true")]
    pub timer_focus: bool,
    /// The opening animation plays on launch unless this is off.
    #[serde(default = "default_true")]
    pub startup_anim: bool,
    pub dashboard: Dashboard,
    /// This install's own id, stamped on every board change so a sync can tell
    /// which copy is the newer one.
    pub device_id: String,
    /// The six digits another device types to sync with this one.
    pub sync_code: String,
    /// The six digits this device types to reach the other one. The address is
    /// never stored or shown: it is found from the code on the local network.
    pub peer_code: String,
    /// Keeps both boards level without pressing anything.
    pub sync_auto: bool,
}

/// A setting that arrived after the first release is on unless the file says
/// otherwise, so an older settings file keeps the new default.
fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            use_12h: false,
            timer_preset_secs: 300,
            theme: "light".into(),
            palette: String::new(),
            language: "en".into(),
            sound: true,
            sound_volume: 100,
            sound_muted: Vec::new(),
            onboarded: false,
            motion: "normal".into(),
            streak_effects: "full".into(),
            zoom: 100,
            wash: true,
            discord: true,
            touch: false,
            telemetry: false,
            install_id: String::new(),
            accent_hue: Some(DEFAULT_ACCENT_HUE),
            accent: String::new(),
            focus_secs: DEFAULT_FOCUS_SECS,
            timer_focus: true,
            startup_anim: true,
            dashboard: Dashboard::default(),
            device_id: String::new(),
            sync_code: String::new(),
            peer_code: String::new(),
            sync_auto: true,
        }
    }
}

/// Older builds stored "beige", the high-contrast pair and "flat"; those land
/// on the two bases. "system" follows the computer.
pub fn normalise_theme(value: &str) -> String {
    match value.trim() {
        "system" => "system",
        "dark" => "dark",
        "dark-hc" => "dark",
        _ => "light",
    }
    .to_string()
}

/// A palette name, or empty for none. Anything else means none.
pub fn normalise_palette(value: &str) -> String {
    let trimmed = value.trim();
    if PALETTES.contains(&trimmed) {
        trimmed.to_string()
    } else {
        String::new()
    }
}

/// The base a palette used to be painted on, before every palette could sit on
/// either base. Only needed to read an older settings file.
fn palette_base(value: &str) -> Option<&'static str> {
    match value.trim() {
        "blossom" | "paper" | "mint" | "slate" => Some("light"),
        "midnight" => Some("dark"),
        _ => None,
    }
}

pub fn normalise_streak_effects(value: &str) -> String {
    match value.trim() {
        "notification" => "notification",
        "none" => "none",
        _ => "full",
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

/// Keeps a hue inside the colour wheel; anything else falls back to rust.
pub fn normalise_accent_hue(value: f64) -> f64 {
    if value.is_finite() {
        normalise_hue(value)
    } else {
        DEFAULT_ACCENT_HUE
    }
}

/// A six-digit code another device has to type. Made the same way as the
/// install id: two seeded hashers over the clock and the process id, so no
/// random-number crate is needed.
fn new_sync_code() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut hasher = RandomState::new().build_hasher();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    hasher.write_u128(nanos);
    hasher.write_u32(std::process::id());
    format!("{:06}", hasher.finish() % 1_000_000)
}

fn is_sync_code(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() == 6 && trimmed.chars().all(|c| c.is_ascii_digit())
}

/// A pairing code is digits only; anything else is simply dropped.
pub fn normalise_pair_code(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(char::is_ascii_digit)
        .take(8)
        .collect()
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
    /* Files from before 1.4 kept the palette in `theme`. Split it apart and
    keep the base that palette used to be painted on. */
    if let Some(base) = palette_base(&settings.theme) {
        settings.palette = settings.theme.clone();
        settings.theme = base.to_string();
    }
    settings.theme = normalise_theme(&settings.theme);
    settings.palette = normalise_palette(&settings.palette);
    settings.motion = normalise_motion(&settings.motion);
    settings.streak_effects = normalise_streak_effects(&settings.streak_effects);
    settings.sound_volume = settings.sound_volume.min(100);
    settings
        .sound_muted
        .retain(|id| SOUND_CUES.contains(&id.as_str()));
    settings.sound_muted.sort();
    settings.sound_muted.dedup();
    settings.zoom = settings.zoom.clamp(MIN_ZOOM, MAX_ZOOM);
    if settings.language != "vi" {
        settings.language = "en".into();
    }
    settings.version = SETTINGS_VERSION;
    /* A file from before 1.1.2 has a hex accent and no hue. Turn it into the
    nearest hue; a brand-new file already has one. */
    let hue = settings
        .accent_hue
        .unwrap_or_else(|| hue_from_hex(&settings.accent).unwrap_or(DEFAULT_ACCENT_HUE));
    settings.accent_hue = Some(normalise_accent_hue(hue));
    settings.accent.clear();
    settings.install_id = normalise_install_id(&settings.install_id);
    /* Every copy of Flip needs an identity and a pairing code before it can
    sync, so both are made on first use and then kept. */
    settings.device_id = normalise_install_id(&settings.device_id);
    if settings.device_id.is_empty() {
        settings.device_id = new_install_id();
    }
    settings.sync_code = if is_sync_code(&settings.sync_code) {
        settings.sync_code.trim().to_string()
    } else {
        new_sync_code()
    };
    settings.peer_code = normalise_pair_code(&settings.peer_code);
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
            Ok(settings) => {
                let settings = normalise(settings);
                /* A file from before Wi-Fi sync has no device id or pairing
                code. Write them back once, so the code another device was
                told keeps working after a restart. */
                if !raw.contains("\"syncCode\"") || !raw.contains("\"deviceId\"") {
                    save(path, &settings);
                }
                settings
            }
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
        Ok(json) => crate::write_atomic(path, json.as_bytes(), "settings"),
        Err(e) => eprintln!("flip: could not encode settings: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_and_streak_preferences_are_kept_sane() {
        assert_eq!(normalise_streak_effects("wobble"), "full");
        assert_eq!(normalise_streak_effects(" notification "), "notification");
        assert_eq!(STREAK_EFFECTS.len(), 3);

        let settings = normalise(Settings {
            sound_volume: 240,
            sound_muted: vec!["bogus".into(), "tab".into(), "tab".into()],
            streak_effects: "none".into(),
            ..Settings::default()
        });
        assert_eq!(settings.sound_volume, 100);
        assert_eq!(settings.sound_muted, vec!["tab".to_string()]);
        assert_eq!(settings.streak_effects, "none");
        assert_eq!(Settings::default().streak_effects, "full");
        assert_eq!(Settings::default().sound_volume, 100);
        assert!(Settings::default().sound_muted.is_empty());
    }

    #[test]
    fn accent_hues_stay_on_the_wheel() {
        assert_eq!(normalise_accent_hue(370.0), 10.0);
        assert_eq!(normalise_accent_hue(-30.0), 330.0);
        assert_eq!(normalise_accent_hue(f64::NAN), DEFAULT_ACCENT_HUE);
    }

    #[test]
    fn a_saved_hex_accent_becomes_a_hue() {
        let settings = normalise(Settings {
            accent: "#4F7F8C".into(),
            accent_hue: None,
            ..Settings::default()
        });
        let hue = settings.accent_hue.expect("hue");
        assert!((hue - 217.0).abs() < 6.0, "hue was {hue}");
        assert!(settings.accent.is_empty());
        assert_eq!(settings.version, SETTINGS_VERSION);
    }

    /// Files from 1.1.2 and later carry an API key for the retired timetable
    /// parser. Reading must ignore it, and the next save must not write it
    /// back, so an old key cannot linger on disk.
    #[test]
    fn an_old_api_key_is_read_past_and_dropped_on_save() {
        let old = r#"{
            "version": 2,
            "language": "vi",
            "accentHue": 148,
            "aiKey": "legacy-placeholder-key",
            "aiModel": "gpt-4o-mini",
            "aiBaseUrl": "https://api.openai.com/v1"
        }"#;
        let settings: Settings = serde_json::from_str(old).expect("old settings still load");
        assert_eq!(settings.language, "vi");

        let normalised = normalise(settings);
        let saved = serde_json::to_string_pretty(&normalised).expect("settings save");
        assert!(!saved.contains("aiKey"), "saved settings kept aiKey");
        assert!(
            !saved.contains("legacy-placeholder-key"),
            "saved settings kept the key"
        );
        assert!(!saved.contains("aiModel"), "saved settings kept aiModel");
        assert_eq!(normalised.version, SETTINGS_VERSION);
    }

    #[test]
    fn a_fresh_settings_file_gets_a_code_and_a_device_id() {
        let settings = normalise(Settings::default());
        assert_eq!(settings.sync_code.len(), 6);
        assert!(settings.sync_code.chars().all(|c| c.is_ascii_digit()));
        assert!(!settings.device_id.is_empty());
        assert!(settings.peer_code.is_empty());
        assert!(settings.sync_auto);

        /* A code the user already has is never replaced. */
        let kept = normalise(Settings {
            sync_code: "123456".into(),
            device_id: settings.device_id.clone(),
            ..Settings::default()
        });
        assert_eq!(kept.sync_code, "123456");
    }

    #[test]
    fn a_typed_code_keeps_only_its_digits() {
        assert_eq!(normalise_pair_code(" 48-29 13 "), "482913");
        assert_eq!(normalise_pair_code("abc"), "");
        assert_eq!(normalise_pair_code("1234567890"), "12345678");
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
        assert_eq!(normalise_theme("dark-hc"), "dark");
        assert_eq!(normalise_theme("system"), "system");
        assert_eq!(normalise_theme("blossom"), "light");
        assert_eq!(normalise_theme("neon"), "light");
        assert_eq!(normalise_palette("blossom"), "blossom");
        assert_eq!(normalise_palette("neon"), "");
        assert_eq!(normalise_palette("  mint "), "mint");
        assert_eq!(normalise_motion("snappy"), "snappy");
        assert_eq!(normalise_motion("wobble"), "normal");
        assert_eq!(normalise_zoom(105), 110);
        assert_eq!(normalise_zoom(10), 80);
        assert_eq!(normalise_zoom(400), 160);
    }

    /// A palette saved as the theme by an older build becomes a palette on the
    /// base it used to paint, so the look does not change under the user.
    #[test]
    fn a_saved_palette_becomes_a_palette_on_its_base() {
        let midnight = normalise(Settings {
            theme: "midnight".into(),
            ..Settings::default()
        });
        assert_eq!(midnight.theme, "dark");
        assert_eq!(midnight.palette, "midnight");

        let blossom = normalise(Settings {
            theme: "blossom".into(),
            ..Settings::default()
        });
        assert_eq!(blossom.theme, "light");
        assert_eq!(blossom.palette, "blossom");
    }

    #[test]
    fn normalise_clamps_focus_and_repairs_theme() {
        let settings = normalise(Settings {
            theme: "neon".into(),
            accent: "nope".into(),
            accent_hue: None,
            focus_secs: 7,
            ..Settings::default()
        });
        assert_eq!(settings.theme, "light");
        assert_eq!(settings.motion, "normal");
        assert_eq!(settings.accent_hue, Some(DEFAULT_ACCENT_HUE));
        assert_eq!(settings.focus_secs, 60);
    }
}
