# Flip

A quiet study dashboard for Windows: a flip clock, a timer that gets out of your way, a timetable you can import from Excel, and a week board for the work in between.

Built with Rust and Tauri 2. Everything stays on your machine: no account, no sync, and no telemetry unless you switch on the optional, anonymous usage counter.

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-000000)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20Ti%E1%BA%BFng%20Vi%E1%BB%87t-2ea44f)
![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

English | [Tiếng Việt](README_VI.md)

<!--
Add screenshots here once you have them, for example:

![The flip clock](docs/clock.png)
![Timetable and task board](docs/timetable.png)
-->

---

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [About the Windows warning](#about-the-windows-warning)
- [First run](#first-run)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Your data](#your-data)
- [Updates](#updates)
- [Build from source](#build-from-source)
- [Project layout](#project-layout)
- [Tests](#tests)
- [Limitations](#limitations)
- [Credits](#credits)

---

## What it does

### Clock and timer

A split-flap clock that pauses to flip each digit, and a countdown timer that starts by typing. Type `25` and it becomes 25 minutes; type `1 30` and it becomes 90. Space starts, pauses and resumes.

Set a timer and Flip tracks the whole session: elapsed time, how long you actually focused versus paused, and which subject you were working on. When it finishes you get a chime and a card asking what you got done.

Both views have 12- and 24-hour formats, the window can go fullscreen for a distraction-free desk display, and the header buttons zoom the whole interface between 80% and 160%.

### Timetable

A week grid of periods and days, colour-coded per subject, with the current period and the next one marked so you can see where you are in the day.

- Fill cells by clicking, or **import a whole timetable from an `.xlsx`** file. Flip reads the first worksheet with its own ZIP + XML reader, so you do not need Excel or any extra dependency.
- Export a ready-to-fill template spreadsheet
- Hide weekends to fit a five-day week
- Duplicate one subject across every cell that shares its name

### Tasks

A week board of cards you can drag between days, or a flat list when you want to see everything at once.

- Due dates, priorities, notes and checklists
- Focus sessions attach to a task, so the time you spend lands somewhere
- Drag a card onto a column header to move it; the column glows while you hover

### Dashboard

Six widgets on one page: the next lesson, today's list, what is due, tasks in flight, the current focus session, and a small stats card. The greeting follows the clock: morning, afternoon or evening. Drag the widgets to reorder them, and hide the ones you do not want.

### Settings

| Section | What lives there |
| --- | --- |
| General | Language, clock format, animations, touch mode, Discord presence, sound effects, setup, updates |
| Appearance | Five themes, eight accent colours, gradient background |
| Data | Backups, restore, export |

**Animations** has four modes (*Extra*, *Normal*, *Fast* and *Snappy*), so the interface can feel lively, stay nearly still or drop movement altogether. `prefers-reduced-motion` always wins.

**Language** switches the whole interface between English and Vietnamese, including dates, durations and plural forms (`14 Thg 11`, `1g 30p`).

---

## Install

1. Download `Flip_1.1.0_x64-setup.exe` from [Releases](https://github.com/itsnautill/flip/releases/latest)
2. Run it. It installs per user, with no administrator prompt.
3. Windows will show *"Windows protected your PC"* because the installer is not code-signed. Click **Run anyway** (see [the next section](#about-the-windows-warning) if you want to know why).

Requires Windows 10 or 11 with WebView2. It is already present on current Windows, and the installer adds it if missing.

Uninstalling from **Settings → Apps** leaves your data untouched.

---

## About the Windows warning

> **VirusTotal says 2/71.** Arctic Wolf and SecureAge flag the installer; the other 69 engines, including Microsoft, Kaspersky, ESET, Bitdefender and Symantec, report clean. Both are heuristic verdicts on an unsigned, freshly built installer, not a detection of anything inside Flip.

The first run shows **"Windows protected your PC"** with *Publisher: Unknown publisher*. That means SmartScreen has no record of the file, not that it found something bad. The installer is not code-signed, so it starts with zero reputation.

**To install:** click **Run anyway**. Some Windows versions hide that button behind **More info** first.

**To check that your download is the one built here:**

```powershell
Get-FileHash .\Flip_1.1.0_x64-setup.exe -Algorithm SHA256
```

For 1.1.0 it should print:

```
e40ff37a63f43234413de6fe7ebf27f5796f778dd7ad1aefbc3246753ccfcb68
```

**To stop the warning on your own machine:** right-click the `.exe`, open **Properties**, tick **Unblock**, then **OK**.

For everyone else, the warning only goes away once the installer is signed, and even then a new build can warn until it has some downloads behind it. Free signing exists for open-source projects ([SignPath Foundation](https://signpath.org/)). Or skip binaries entirely and [build from source](#build-from-source).

---

## First run

A four-step setup appears the first time you open Flip:

1. **Choose your language**: English or Tiếng Việt, switches instantly
2. **Pick a look**: light or dark, and one of eight accent colours
3. **Your timetable**: weekdays shown, periods per day, sound on or off
4. **All set**: straight into the app, or into the timetable to start filling it

Every step can be skipped, and **Settings → General → Setup** runs it again at any time.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Start, pause or resume the timer |
| `Tab` | Switch between the clock and the timer |
| `0` – `9` | Type a duration while the timer is idle |
| `Backspace` | Delete the last typed digit |
| `S` | Open the set-timer dialog |
| `R` | Reset the timer |
| `T` | Switch 12/24-hour clock |
| `F` / `F11` | Toggle fullscreen |
| `Esc` | Leave fullscreen |
| `?` | Show the shortcut list |

`F`, `F11` and `?` work in every section; the rest apply to the timer. Everything else can be done with the mouse alone.

---

## Your data

Everything lives in one folder:

```
%APPDATA%\FlipData\
├── settings.json
├── board.json
└── backups\
    └── flip-backup-2026-11-14-0930.json
```

Both files are plain JSON that you can read and edit. Flip writes them through Rust, so a crash mid-write cannot leave a half-written file in place of a good one.

**Backups** take one click in **Settings → Data**. Older installs of Flip are adopted automatically on first start rather than overwritten.

**Export** produces CSV of your tasks and timetable, your settings as JSON, or a complete backup you can move to another machine.

There is no cloud and no account. The only network traffic is the update check when you ask for it, plus the optional usage counter described below.

### Discord presence

**On by default; one switch turns it off** in **Settings → General → Discord Rich Presence**. Flip talks to the Discord app on your own machine over its local socket, so nothing goes over the internet. The card shows only:

- the mode it is in: `Clock`, `Timer` or `Focus session`
- whether a countdown is running, with an elapsed-time counter while it is
- one button: **Download Flip** → <https://projectflip.site.je>

It never shows task titles, subject names, study totals, notes or file names, because none of them are ever put into the payload. With Discord closed, nothing is sent at all, and the connection is retried quietly in the background.

Discord only accepts presence from a registered application, so the client id lives in [`flip/src-tauri/src/discord.rs`](flip/src-tauri/src/discord.rs) as `CLIENT_ID`. To use your own, create an application at <https://discord.com/developers/applications> (a name is enough, no bot is needed), paste its Application ID there and rebuild. Left empty, Flip never opens the socket.

### Optional usage sharing

**Off by default.** Nothing is ever sent unless you switch it on in **Settings → General → Share anonymous usage**, and the toggle carries the full disclosure next to it. See also [PRIVACY.md](PRIVACY.md).

When it is on, Flip sends exactly one HTTPS request per day:

| Sent | Never sent |
| --- | --- |
| A random 32-character install id, generated on your machine | Tasks, subjects, timetable, notes |
| The app version | Timer history, settings, file names |
| Your interface language (`en` or `vi`) | Your name, account, hardware ids, location |
| The date, added by the server | Your IP address (it is not stored) |

The id is tied to one install and linked to nothing else, so the dashboard shows counts, not people. Turn the option off and the requests stop immediately.

The public dashboard is at <https://site-8afa0bdbe0764332b38e33193a775c95.freebuff.page> and the worker behind it is in [`stats/`](stats/).

---

## Updates

**Settings → General → Updates** compares your version with a manifest and then works in two steps. **Download update** fetches the installer into `%TEMP%\FlipUpdates\` in the background, and **Install and restart** runs it and closes Flip, so the installer replaces the old version.

The manifest is read from the repository first, with the release copy as a fallback:

```
https://raw.githubusercontent.com/itsnautill/flip/main/flip/update/latest.json
```

Downloads are only accepted over HTTPS from GitHub's release hosts, and the file has to look like a Windows installer before it is ever run. Nothing installs itself without that second click.

### Publishing a release

1. Bump the version in `flip/src-tauri/Cargo.toml`, `flip/src-tauri/tauri.conf.json`, `flip/update/latest.json` and this README (badge, installer name, SHA-256).
2. Build: `cd flip && cargo tauri build`.
3. Commit, tag and push (replace `X.Y.Z` with the new version):
   ```bash
   git add -A && git commit -m "Release X.Y.Z" && git tag vX.Y.Z && git push && git push --tags
   ```
4. On GitHub, go to **Releases → Draft a new release**, pick the tag, and attach `flip/src-tauri/target/release/bundle/nsis/Flip_X.Y.Z_x64-setup.exe`.

The manifest lives in the repository, so it needs no upload. See [`flip/update/README.md`](flip/update/README.md) for the internals.

---

## Build from source

**Requirements:** Rust (stable), the Tauri CLI and the WebView2 runtime.

```bash
cargo install tauri-cli --version "^2"
```

There is no npm step. The frontend is plain JavaScript served straight from `flip/ui`.

```bash
git clone https://github.com/itsnautill/flip.git
cd flip/flip
cargo tauri dev      # hot-reloading development window
cargo tauri build    # release build + NSIS installer
```

Output lands in `flip/src-tauri/target/release/`, with the installer in `bundle/nsis/`.

---

## Project layout

```
flip/
├── ui/                   frontend, no build step
│   ├── index.html        markup and script order
│   ├── style.css         all styling, including the motion modes
│   ├── app.js            tabs, settings, sound, shortcuts
│   ├── flipcard.js       the split-flap digit animation
│   ├── board.js          shared helpers, modals, drag and drop
│   ├── timetable.js      the week grid
│   ├── tasks.js          board and list views
│   ├── dashboard.js      the widget grid
│   ├── data.js           backups, restore, export
│   ├── xlsx.js           a minimal .xlsx reader and writer
│   ├── i18n.js           the English ↔ Vietnamese translation layer
│   ├── setup.js          the first-run wizard
│   ├── about.js          the About card
│   └── update.js         version check and manifest parsing
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs        app setup, data folder, command registration
│   │   ├── commands.rs   the IPC surface
│   │   ├── state.rs      the shared core and snapshots
│   │   ├── board.rs      timetable and task model
│   │   ├── timer.rs      countdown state machine
│   │   ├── clock.rs      12/24-hour, dates, durations
│   │   ├── ticker.rs     the one-second tick
│   │   ├── settings.rs   persisted preferences
│   │   └── backup.rs     backup encode/decode and CSV export
│   ├── icons/            icons plus make_icons.py
│   └── tauri.conf.json   window, bundle and version config
└── update/
    ├── latest.json       release manifest template
    └── README.md         release notes for publishers
```

Two rules keep the code honest: **Rust is the only thing that writes to disk**, and **the frontend never holds state that matters**. It renders snapshots and asks Rust to change things.

---

## Tests

```bash
cd flip/src-tauri
cargo test                                  # 52 tests
cargo clippy --all-targets -- -D warnings   # clean
cargo fmt --check
```

The Rust suite covers the timer state machine, timetable and task rules, backup round-trips, and the path checks that stop a backup name from escaping its folder.

The frontend has no test runner by design; it is verified by building and using the app.

---

## Limitations

- **Windows only.** The build targets x64 NSIS; macOS and Linux would need their own bundling.
- **Unsigned installer**, so SmartScreen warns on first run.
- **Updates run the new installer in place** but are not signed, so Windows asks before it runs and a heuristic engine or two may still flag a fresh build.
- **English and Vietnamese only**, and only the first worksheet of an imported `.xlsx` is read.

---

## Credits

Made by [@itsnautill](https://github.com/itsnautill). Built on [Tauri](https://tauri.app), [Rust](https://www.rust-lang.org) and [Chrono](https://github.com/chronotope/chrono).

Sound effects are synthesised at runtime with the Web Audio API, so there are no audio files in the repository.

Released under the [MIT License](LICENSE).
