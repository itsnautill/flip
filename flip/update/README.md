# How updates work in Flip

Flip has no update server. A check is one HTTP request for one small JSON file,
and the comparison happens on your machine.

## The pieces

1. **The version inside the app.** `flip/src-tauri/Cargo.toml` holds it and
   `flip/src-tauri/tauri.conf.json` repeats it, so both must match. Rust answers
   with `app_version`, and the About card and Settings show it.
2. **The manifest.** `latest.json` in this folder says what the newest version
   is and where its installer lives. The app reads the copy in the repository
   first, because `raw.githubusercontent.com` sends CORS headers that a release
   download does not:

   ```js
   var MANIFEST_URLS = [
     "https://raw.githubusercontent.com/itsnautill/flip/main/flip/update/latest.json",
     "https://github.com/itsnautill/flip/releases/latest/download/latest.json"
   ];
   ```

   The second entry is only a fallback for a manifest attached to a release.
3. **The comparison.** `flip/ui/update.js` fetches the manifest, splits both
   versions on `.` and compares them number by number. Newer: "Version X is
   available" and a **Download update** button. Same or older: "You're up to
   date". No network: "Could not check for updates".

## What the buttons actually do

- **Download update** asks Rust for `download_update`, which fetches the
  installer into `%TEMP%\FlipUpdates\` with `curl.exe` (PowerShell as fallback).
  The URL must be `https` on a GitHub release host, and the result must be a
  Windows executable of plausible size, or it is thrown away.
- **Install and restart** calls `install_update`, which starts the downloaded
  installer with `/S /UPDATE` and closes Flip. The installer replaces the old
  version and removes it, which is what a normal Windows upgrade looks like.

Nothing is installed without that second click, and nothing is downloaded
before the first one.

## Publishing an update

1. Bump `version` in `Cargo.toml` and `tauri.conf.json`, and bump the version,
   notes, installer name and SHA-256 in `README.md`.
2. Edit `latest.json`:

   ```json
   {
     "version": "1.0.3",
     "notes": "What changed.",
     "url": "https://github.com/itsnautill/flip/releases/download/v1.0.3/Flip_1.0.3_x64-setup.exe"
   }
   ```

3. Build: `cd flip && cargo tauri build`. Installers land in
   `src-tauri/target/release/bundle/`.
4. Commit, tag, push, then attach the installer to a GitHub release for that
   tag. The manifest does not need to be attached anywhere: the copy in the
   repository is what the app reads.

## Testing it locally

```bash
cd flip/update
python -m http.server 8777
```

Point the first entry of `MANIFEST_URLS` at `http://127.0.0.1:8777/latest.json`,
set the manifest's `version` above the app's, rebuild, and press the button.
Put the real address back afterwards.

## Not signed

The installer is not code-signed yet, so SmartScreen asks before it runs and a
downloaded build can be flagged by a heuristic engine or two. Signing is the
fix; the updater itself does not verify a signature, so a tampered manifest
could still be served from a compromised repository.
