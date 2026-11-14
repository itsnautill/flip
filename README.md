# Flip

A quiet study dashboard for Windows: a flip clock, a timer that gets out of your way, a timetable you can import from Excel, and a week board for the work in between.

Built with Rust and Tauri 2. Everything stays on your machine - no account, no sync, no telemetry.

![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D4)
![Built with](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri%202-000000)
![Languages](https://img.shields.io/badge/languages-English%20%7C%20Tiếng%20Việt-2ea44f)
![Version](https://img.shields.io/badge/version-1.0.1-blue)

---

## Windows will warn you - that is expected

The first time you run the installer, Windows shows a blue box:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.
> App: `Flip_1.0.1_x64-setup.exe`
> Publisher: Unknown publisher

This is not a virus detection. SmartScreen says *unrecognized*, not *detected*. The installer is not code-signed, so Windows has no publisher name to show, and an unsigned file starts with zero reputation - the warning stays until enough people have downloaded and run that exact file.

**To install:** click **Run anyway**. On some Windows versions the button is hidden until you click **More info** first.

The whole source is in this repository, so you can read or [build it yourself](#build-from-source) instead of trusting a binary.

### Check the file is the one that was built

Every release ships a SHA-256 hash. For 1.0.1:

```
11e146e751bbf95ba7d621ff0b814c0355fcae8e31749fb82ccfa29deadf47fd
```

Compare it after downloading - in PowerShell:

```powershell
Get-FileHash .\Flip_1.0.1_x64-setup.exe -Algorithm SHA256
```

or from a command prompt:

```
certutil -hashfile Flip_1.0.1_x64-setup.exe SHA256
```

If the hash does not match, delete the file and download it again.

### Silence the warning for yourself

Right-click the downloaded `.exe` > **Properties** > tick **Unblock** > **OK**. In PowerShell that is:

```powershell
Unblock-File .\Flip_1.0.1_x64-setup.exe
```

This clears Windows' "downloaded from the internet" mark for that file only. Everyone else still sees the warning.

### Remove it for everyone: code signing

The notice disappears for all users only when the installer is signed by a certificate SmartScreen recognizes. The realistic options, cheapest first:

| Route | Cost | Publisher name users see |
| --- | --- | --- |
| [SignPath Foundation](https://signpath.org/) (open source) | free for OSI-licensed projects | SignPath Foundation |
| Certum Open Source certificate | from about 49 EUR/year | Open Source Developer, plus your name |
| Standard OV certificate (DigiCert, Sectigo, ...) | about 150-300 USD/year | your verified name |
| EV certificate | 400+ USD/year | your verified name |

Two things worth knowing before buying one:

- Signing does not finish the job by itself. A freshly signed build is still a new file to SmartScreen, and Microsoft says a warning can persist for weeks until that hash or certificate gathers clean downloads. Reputation only carries over between releases signed by the same publisher.
- An EV certificate no longer bypasses SmartScreen the way it used to; Microsoft stopped granting it immediate reputation in 2024.

Flip is unsigned today, which is why the notice appears. Signing it is on the list for a future release.

---

## Contents

- [Windows will warn you](#windows-will-warn-you---that-is-expected)
- [What it does](#what-it-does)
- [Install](#install)
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

Both views have 12- and 24-hour formats, and the window can go fullscreen for a distraction-free desk display.

### Timetable

A week grid of periods and days, colour-coded per subject, with the current period and the next one marked so you can see where you are in the day.

- Fill cells by clicking, or **import a whole timetable from an `.xlsx`** file (Flip reads the first worksheet with its own ZIP + XML reader - no Excel required, no extra dependency)
- Export a ready-to-fill template spreadsheet
- Hide weekends to fit a five-day week
- Duplicate one subject across every cell that shares its name

### Tasks

A week board of cards you can drag between days, or a flat list when you want to see everything at once.

- Due dates, priorities, notes and checklists
- Focus sessions attach to a task, so the time you spend lands somewhere
- Drag a card onto a column header to move it; the column glows while you hover

### Dashboard

Six widgets on one page: the next lesson, today's list, what is due, tasks in flight, the current focus session, and a small stats card. The greeting follows the clock - morning, afternoon or evening. Drag them to reorder, hide the ones you do not want.

### Settings

| Section | What lives there |
| --- | --- |
| General | Language, clock format, animations, sound effects, setup, updates |
| Appearance | Light and dark, eight accent colours |
| Data | Backups, restore, export |

**Animations** has three modes - *Extra*, *Normal* and *Fast* - so the interface can feel lively or stay nearly still. `prefers-reduced-motion` always wins.

**Language** switches the whole interface between English and Vietnamese, including dates, durations and plural forms (`14 Thg 11`, `1g 30p`).

---

## Install

1. Download `Flip_1.0.1_x64-setup.exe` from [Releases](../../releases/latest)
2. Run it - it installs per user, no administrator prompt
3. Windows will show *"Windows protected your PC"* because the installer is not code-signed - see [Windows will warn you](#windows-will-warn-you---that-is-expected) for why, how to check the file, and how to get rid of the notice

Requires Windows 10 or 11 with WebView2 (already present on current Windows; the installer adds it if missing).

Uninstalling from **Settings → Apps** leaves your data untouched.

---

## First run

A four-step setup appears the first time you open Flip:

1. **Choose your language** - English or Tiếng Việt, switches instantly
2. **Pick a look** - light or dark, and one of eight accent colours
3. **Your timetable** - weekdays shown, periods per day, sound on or off
4. **All set** - straight into the app, or into the timetable to start filling it

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

`F`, `F11` and `?` work in every section; the rest apply to the timer. Everything else is reachable with the mouse alone.

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

Both files are plain JSON you can read and edit. Flip writes them through Rust, so a crash mid-write cannot leave a half-written file in place of a good one.

**Backups** are one click in **Settings → Data**, and older installs of Flip are adopted automatically on first start rather than being overwritten.

**Export** produces CSV of your tasks and timetable, the settings as JSON, or a complete backup you can move to another machine.

There is no cloud, no account and no network traffic except the update check when you ask for it.

### Optional usage sharing

**Off by default.** Nothing is ever sent unless you switch it on in **Settings → General → Share anonymous usage**, and the toggle carries the full disclosure next to it.

When it is on, Flip sends exactly one HTTPS request per day:

| Sent | Never sent |
| --- | --- |
| A random 32-character install id, generated on your machine | Tasks, subjects, timetable, notes |
| The app version | Timer history, settings, file names |
| Your interface language (`en` or `vi`) | Your name, account, hardware ids, location |
| The date, added by the server | Your IP address is not stored |

The id is capped by the machine and linked to nothing, so the dashboard shows counts, not people. Turn it off and the requests stop immediately.

The public dashboard lives at <https://site-8afa0bdbe0764332b38e33193a775c95.freebuff.page> and the worker behind it is in [`stats/`](stats/).


---

## Updates

Flip checks a small manifest and compares dotted versions:

```
https://github.com/itsnautill/flip/releases/latest/download/latest.json
```

**Settings → General → Updates** shows the current version and, if one exists, what changed in the new one. The download opens in your browser - Flip does not replace its own files.

For the full picture - how the comparison works, where to host the manifest, how to test it
locally against `python -m http.server`, and what a signed in-place updater would take -
see [`flip/update/README.md`](flip/update/README.md).

### Publishing a release

```bash
# 1. bump the version in both files
#    flip/src-tauri/Cargo.toml
#    flip/src-tauri/tauri.conf.json

# 2. build
cd flip
cargo tauri build

# 3. commit, tag, push
cd ..
git add -A
git commit -m "Release 0.2.0"
git tag v0.2.0
git push && git push --tags
```

Then on GitHub: **Releases → Draft a new release**, pick the tag, and attach two files:

- `flip/src-tauri/target/release/bundle/nsis/Flip_0.2.0_x64-setup.exe`
- `flip/update/latest.json`, with the new version and the exact asset URL

Because the manifest is fetched from `releases/latest/download/`, the URL in the app never has to change again.

---

## Build from source

**Requirements:** Rust (stable), the Tauri CLI, and the WebView2 runtime.

```bash
cargo install tauri-cli --version "^2"
```

There is no npm step - the frontend is plain JavaScript served straight from `flip/ui`.

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

Two rules keep the code honest: **Rust is the only thing that writes to disk**, and **the frontend never holds state that matters** - it renders snapshots and asks Rust to change things.

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
- **Updates are download-and-install manually**, not in-place. Tauri's signed updater is the natural upgrade path if that becomes worth the key management.
- **English and Vietnamese only**, and only the first worksheet of an imported `.xlsx` is read.

---

## Credits

Made by [@itsnautill](https://github.com/itsnautill). Built on [Tauri](https://tauri.app), [Rust](https://www.rust-lang.org) and [Chrono](https://github.com/chronotope/chrono).

Sound effects are synthesised at runtime with the Web Audio API - there are no audio files in the repository.
