# Running Flip on Android

Flip uses the same Tauri 2 codebase on the desktop and on a phone, so the phone
build shares the timetable, tasks, timer and dashboard. Everything stays local:
`FlipData` lives in the app's private storage. The app makes no network
requests on Android: there is no permission for them in the release manifest.

## What already works on a phone

- The layout switches at 720 px: a bottom bar instead of the top tabs, larger
  touch targets, safe-area insets and `100dvh` so the address/navigation bars
  never cover the content.
- The Android back button closes an open dialog first, then returns to the
  dashboard, then leaves the app - one history entry per dialog and view.
- The header keeps one slot for the screen: desktop gets fullscreen, a phone
  gets a landscape/portrait switch (`set_orientation`, one JNI call on the
  activity). The flip clock only appears in landscape; in portrait the Timer
  tab asks you to turn the phone and offers the same switch.
- The bottom bar is a floating dock with its own radius, and every view leaves
  room for it, so the last card never hides underneath.
- Text uses Inter (`ui/fonts/Inter.woff2`), shipped with the app: no machine
  font, and no SF Pro, is required for the design to look right.
- Zoom, fullscreen, folder reveal, link opening, installer updates and Discord
  Rich Presence are desktop-only and are compiled out or refused on mobile.
- Files are saved through a temporary neighbour and a rename, so a phone that
  kills the app mid-save keeps the previous file.

## Prerequisites (one-time, on the build machine)

1. JDK 17 or newer (`java -version`).
2. Android Studio with the SDK, command-line tools and an NDK, or the
   standalone command-line tools. Set `ANDROID_HOME` and `NDK_HOME`
   (for example `%LOCALAPPDATA%\Android\Sdk`).
3. The Rust targets:

   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi \
     i686-linux-android x86_64-linux-android
   ```

4. `local.properties` and any `.jks`/`.keystore` file stay out of git; the
   repository `.gitignore` already excludes them.

## Commands

`tauri android` reads the SDK from the environment, so export these first (Git
Bash shown; `set` in cmd, `$env:` in PowerShell):

```bash
export ANDROID_HOME="C:/Android/Sdk"
export NDK_HOME="C:/Android/Sdk/ndk/27.0.12077973"
export JAVA_HOME="C:/Program Files/Microsoft/jdk-17.0.21.21-hotspot"
```

```bash
cd flip

# generates src-tauri/gen/android from tauri.conf.json (identifier com.nautill.flip)
cargo tauri android init

# run on a connected phone or a running emulator
cargo tauri android dev

# an emulator needs a matching ABI: x86_64 for the x86_64 system image
cargo tauri android build --apk --debug --target x86_64

# one debug APK, arm64 only (fastest useful check)
cargo tauri android build --apk --debug --target aarch64

# a release APK
cargo tauri android build --apk --split-per-abi
```

The APK lands in `src-tauri/gen/android/app/build/outputs/apk/`.

For a signed release, create a keystore and set these variables before
building - never commit the keystore or its passwords:

```bash
export NDK_HOME=...            # Windows: set NDK_HOME=...
export KEYSTORE_PATH=/absolute/path/to/flip-release.jks
export KEYSTORE_PASSWORD=...   # or let the build sign with a debug key
export KEY_ALIAS=flip
export KEY_PASSWORD=...
cargo tauri android build --apk
```

## State of the Android build

A debug APK builds today with the SDK above:

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

The only Rust change the phone needed was to keep the desktop-only
`set_fullscreen` calls behind `#[cfg(desktop)]`.

Network: the release manifest requests no permissions at all. Debug builds keep
`android.permission.INTERNET` in `app/src/debug/AndroidManifest.xml` because the
dev server is served over loopback; `processArmReleaseMainManifest` confirms the
release manifest has no `INTERNET` entry.

Not verified on a device here: installing the APK, the `.xlsx` file picker, the
save dialog for CSV/Excel, and the back button behaviour. Those need a phone or
an emulator (`cargo tauri android dev`).

The desktop build is unaffected by anything above.
