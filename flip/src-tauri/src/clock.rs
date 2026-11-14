//! Pure clock formatting: the wall clock itself comes from the caller.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockView {
    pub h: String,
    pub m: String,
    pub pm: bool,
    #[serde(rename = "is12h")]
    pub is_12h: bool,
}

pub fn clock_view(hour: u32, minute: u32, use_12h: bool) -> ClockView {
    let hour = hour % 24;
    let minute = minute % 60;
    if use_12h {
        let twelve = hour % 12;
        let h = if twelve == 0 { 12 } else { twelve };
        ClockView {
            h: format!("{h:02}"),
            m: format!("{minute:02}"),
            pm: hour >= 12,
            is_12h: true,
        }
    } else {
        ClockView {
            h: format!("{hour:02}"),
            m: format!("{minute:02}"),
            pm: false,
            is_12h: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midnight_and_early_morning() {
        let twenty_four = clock_view(0, 5, false);
        assert_eq!(
            (twenty_four.h.as_str(), twenty_four.m.as_str()),
            ("00", "05")
        );
        assert!(!twenty_four.pm);
        assert!(!twenty_four.is_12h);

        let twelve = clock_view(0, 5, true);
        assert_eq!((twelve.h.as_str(), twelve.m.as_str()), ("12", "05"));
        assert!(!twelve.pm);
        assert!(twelve.is_12h);
    }

    #[test]
    fn noon_and_afternoon() {
        let twenty_four = clock_view(12, 0, false);
        assert_eq!(
            (twenty_four.h.as_str(), twenty_four.m.as_str()),
            ("12", "00")
        );
        assert!(!twenty_four.pm);

        let twelve = clock_view(12, 0, true);
        assert_eq!((twelve.h.as_str(), twelve.m.as_str()), ("12", "00"));
        assert!(twelve.pm);

        let afternoon = clock_view(13, 30, true);
        assert_eq!((afternoon.h.as_str(), afternoon.m.as_str()), ("01", "30"));
        assert!(afternoon.pm);
    }

    #[test]
    fn late_evening() {
        let twenty_four = clock_view(23, 59, false);
        assert_eq!(
            (twenty_four.h.as_str(), twenty_four.m.as_str()),
            ("23", "59")
        );
        assert!(!twenty_four.pm);

        let twelve = clock_view(23, 59, true);
        assert_eq!((twelve.h.as_str(), twelve.m.as_str()), ("11", "59"));
        assert!(twelve.pm);
    }
}
