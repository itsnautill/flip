//! Downloading and running a newer installer.
//!
//! Flip never overwrites its own files. It fetches the setup program into a
//! temporary folder, then hands over to it: the installer replaces the old
//! version and removes it, which is what a normal Windows upgrade looks like.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Release downloads only ever come from these hosts, so a tampered manifest
/// cannot point the updater at somewhere else.
const ALLOWED_HOSTS: [&str; 4] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "raw.githubusercontent.com",
];

const FOLDER: &str = "FlipUpdates";
const FIRST_BYTES: &[u8; 2] = b"MZ";
/// Anything smaller than this is a truncated download or an error page.
const MIN_BYTES: u64 = 500_000;

pub fn url_is_allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.split(':').next().unwrap_or("");
    ALLOWED_HOSTS.contains(&host)
}

/// `1.0.2` becomes `flip-update-1.0.2.exe`; odd characters are dropped rather
/// than trusted from a downloaded manifest.
pub fn installer_name(version: &str) -> String {
    let clean: String = version
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    let clean = clean.trim_matches('.').to_string();
    if clean.is_empty() {
        "flip-update.exe".to_string()
    } else {
        format!("flip-update-{clean}.exe")
    }
}

fn check_download(dest: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(dest).map_err(|_| "The update did not download.".to_string())?;
    if meta.len() < MIN_BYTES {
        return Err("The downloaded update looks incomplete.".into());
    }
    use std::io::Read;
    let mut head = [0u8; 2];
    std::fs::File::open(dest)
        .and_then(|mut file| file.read_exact(&mut head))
        .map_err(|_| "The downloaded update cannot be read.".to_string())?;
    if &head != FIRST_BYTES {
        return Err("The downloaded file is not a Windows installer.".into());
    }
    Ok(())
}

#[cfg(windows)]
fn fetch(url: &str, dest: &Path) -> Result<(), String> {
    use std::process::Command;

    let system_curl = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("curl.exe"))
        .filter(|path| path.exists());

    let mut errors: Vec<String> = Vec::new();

    if let Some(curl) = system_curl.as_ref() {
        let status = Command::new(curl)
            .args([
                "-L",
                "--fail",
                "--silent",
                "--show-error",
                "--retry",
                "2",
                "--connect-timeout",
                "20",
                "--max-time",
                "600",
                "-o",
            ])
            .arg(dest)
            .arg(url)
            .status();
        match status {
            Ok(code) if code.success() => return Ok(()),
            Ok(code) => errors.push(format!("curl exited with {code}")),
            Err(err) => errors.push(format!("curl: {err}")),
        }
    }

    // Windows PowerShell is on every supported machine, so it is the fallback
    // rather than another dependency.
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
        url,
        dest.display()
    );
    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status();
    match status {
        Ok(code) if code.success() => Ok(()),
        Ok(code) => {
            errors.push(format!("powershell exited with {code}"));
            Err(errors.join("; "))
        }
        Err(err) => {
            errors.push(format!("powershell: {err}"));
            Err(errors.join("; "))
        }
    }
}

#[cfg(not(windows))]
fn fetch(_url: &str, _dest: &Path) -> Result<(), String> {
    Err("Updates are only supported on Windows.".into())
}

pub fn download_into(url: &str, dest: &Path) -> Result<(), String> {
    if !url_is_allowed(url) {
        return Err("This update does not come from Flip's releases.".into());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("No place to save it: {err}"))?;
    }
    let _ = std::fs::remove_file(dest);
    fetch(url, dest)?;
    check_download(dest)
}

#[cfg(windows)]
fn run_installer(file: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    /// Keeps a console window from flashing up next to the installer.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let exe = std::env::current_exe()
        .map_err(|err| format!("Could not find this copy of Flip: {err}"))?;
    let script = relaunch_script(file, &exe)?;

    /* The script lives next to the download, not in a fresh folder: Windows
    will not run a batch file from a directory it considers unsafe. */
    let folder = std::env::temp_dir().join(FOLDER);
    std::fs::create_dir_all(&folder).map_err(|err| format!("No place to save it: {err}"))?;
    let path = folder.join(format!("install-{}.cmd", std::process::id()));
    std::fs::write(&path, script)
        .map_err(|err| format!("Could not prepare the installer: {err}"))?;

    std::process::Command::new("cmd")
        .arg("/C")
        .arg(&path)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("Could not start the installer: {err}"))
}

/// A silent NSIS /UPDATE replaces the files and quits without starting Flip
/// again, so the update is run from a small script: wait for the install to
/// finish, then start the newly installed copy.
#[cfg(windows)]
fn relaunch_script(installer: &Path, exe: &Path) -> Result<String, String> {
    fn quoted(path: &Path) -> Result<String, String> {
        let text = path.to_string_lossy();
        if text.contains('"') || text.contains(['\r', '\n']) {
            return Err("The update path has characters Flip cannot use.".into());
        }
        Ok(format!("\"{text}\""))
    }

    let installer = quoted(installer)?;
    let exe = quoted(exe)?;
    Ok(format!(
        "@echo off\r\n\
         rem Written by Flip: replace this copy, then open it again.\r\n\
         start /wait \"\" {installer} /S /UPDATE\r\n\
         start \"\" {exe}\r\n\
         del \"%~f0\"\r\n"
    ))
}

#[cfg(not(windows))]
fn run_installer(_file: &Path) -> Result<(), String> {
    Err("Updates are only supported on Windows.".into())
}

/// Where a downloaded installer is allowed to live.
pub fn update_dir(temp: &Path) -> PathBuf {
    temp.join(FOLDER)
}

pub fn install(app_temp: &Path, requested: &str) -> Result<(), String> {
    let file = PathBuf::from(requested);
    if !file.starts_with(update_dir(app_temp)) {
        return Err("That file is not a downloaded Flip update.".into());
    }
    if file.extension().and_then(|ext| ext.to_str()) != Some("exe") || !file.exists() {
        return Err("The downloaded installer is missing.".into());
    }
    check_download(&file)?;
    run_installer(&file)
}

/// Fetches the installer into the temporary update folder and answers with its
/// path, so the frontend can offer to install once it is really there.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    version: String,
) -> Result<String, String> {
    let temp = app.path().temp_dir().map_err(|err| err.to_string())?;
    let dest = update_dir(&temp).join(installer_name(&version));
    let target = dest.clone();
    tauri::async_runtime::spawn_blocking(move || download_into(&url, &target))
        .await
        .map_err(|err| err.to_string())??;
    Ok(dest.to_string_lossy().to_string())
}

/// Starts the downloaded installer and steps out of the way. The installer
/// replaces this version and removes the old one.
#[tauri::command]
pub fn install_update(app: AppHandle, path: String) -> Result<(), String> {
    let temp = app.path().temp_dir().map_err(|err| err.to_string())?;
    install(&temp, &path)?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_release_hosts_are_allowed() {
        assert!(url_is_allowed(
            "https://github.com/itsnautill/flip/releases/download/v1.0.2/Flip_1.0.2_x64-setup.exe"
        ));
        assert!(url_is_allowed(
            "https://raw.githubusercontent.com/itsnautill/flip/main/x"
        ));
        assert!(!url_is_allowed(
            "https://evil.example.com/Flip_1.0.2_x64-setup.exe"
        ));
        assert!(!url_is_allowed(
            "http://github.com/itsnautill/flip/releases/download/v1.0.2/x.exe"
        ));
        assert!(!url_is_allowed("github.com/itsnautill/flip"));
        assert!(!url_is_allowed(""));
    }

    /// Run with `cargo test -- --ignored` on a machine with network access.
    #[test]
    #[ignore = "downloads a release installer from GitHub"]
    fn downloads_a_real_release_installer() {
        let dir = std::env::temp_dir().join(format!("flip-update-live-{}", std::process::id()));
        let dest = dir.join(installer_name("1.0.1"));
        download_into(
            "https://github.com/itsnautill/flip/releases/download/v1.0.1/Flip_1.0.1_x64-setup.exe",
            &dest,
        )
        .expect("download");
        let size = std::fs::metadata(&dest).unwrap().len();
        assert!(size > 2_000_000, "installer looked too small: {size} bytes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn installer_names_are_plain_file_names() {
        assert_eq!(installer_name("1.0.2"), "flip-update-1.0.2.exe");
        assert_eq!(installer_name("v2.0"), "flip-update-2.0.exe");
        assert_eq!(installer_name("../../etc/passwd"), "flip-update.exe");
        assert_eq!(installer_name(""), "flip-update.exe");
    }

    #[test]
    fn a_short_or_foreign_file_is_refused() {
        let dir = std::env::temp_dir().join(format!("flip-update-check-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let small = dir.join("small.exe");
        std::fs::write(&small, b"MZ").unwrap();
        assert!(check_download(&small).is_err());

        let not_installer = dir.join("page.exe");
        std::fs::write(&not_installer, vec![b'<'; MIN_BYTES as usize]).unwrap();
        assert!(check_download(&not_installer).is_err());

        let ok = dir.join("ok.exe");
        let mut bytes = vec![0u8; MIN_BYTES as usize + 1];
        bytes[0] = b'M';
        bytes[1] = b'Z';
        std::fs::write(&ok, bytes).unwrap();
        assert!(check_download(&ok).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn relaunch_script_installs_then_starts_flip() {
        let script = relaunch_script(
            Path::new("C:\\Temp\\FlipUpdates\\flip-update-1.3.3.exe"),
            Path::new("C:\\Users\\me\\AppData\\Local\\Flip\\flip.exe"),
        )
        .expect("script");
        let install = script.find("/S /UPDATE").expect("silent update flag");
        let start = script.find("start \"\" \"C:\\Users").expect("restart");
        assert!(install < start, "the restart has to follow the install");
        assert!(script.contains("\"C:\\Temp\\FlipUpdates\\flip-update-1.3.3.exe\""));
        assert!(script.starts_with("@echo off"));

        let odd = relaunch_script(Path::new("C:\\a\"b.exe"), Path::new("C:\\flip.exe"));
        assert!(
            odd.is_err(),
            "a quote in a path is refused, not escaped blindly"
        );
    }

    #[test]
    fn install_refuses_a_file_outside_the_update_folder() {
        let temp = std::env::temp_dir().join(format!("flip-update-home-{}", std::process::id()));
        let elsewhere = std::env::temp_dir().join("Flip_update_escape.exe");
        let _ = std::fs::create_dir_all(&temp);
        std::fs::write(&elsewhere, b"MZ").unwrap();
        assert!(install(&temp, &elsewhere.to_string_lossy()).is_err());
        let inside = update_dir(&temp).join("flip-update-1.0.2.exe");
        std::fs::create_dir_all(update_dir(&temp)).unwrap();
        std::fs::write(&inside, b"MZ").unwrap();
        // A real download is verified first, and this stub is too small.
        assert!(install(&temp, &inside.to_string_lossy()).is_err());
        let _ = std::fs::remove_dir_all(&temp);
        let _ = std::fs::remove_file(&elsewhere);
    }
}
