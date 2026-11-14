# How updates work in Flip

Flip has no server. An update check is one HTTP request for one small JSON file,
and the comparison happens on your machine.

## The three pieces

1. **The version inside the app.** `flip/src-tauri/Cargo.toml` has
   `version = "0.1.0"`. Tauri copies the same number from
   `flip/src-tauri/tauri.conf.json`, so both must match. The app reads it from
   Rust (`app_version` command) and shows it in the About card and Settings.
2. **The manifest on the web.** A file called `latest.json` (this folder is a
   template) that says what the newest version is and where its installer lives.
3. **The comparison.** `flip/ui/update.js` fetches the manifest, splits both
   versions on `.`, compares the numbers one by one, and decides whether the
   manifest is newer. Newer: it shows "Version X is available" and a download
   button that opens the installer link in your browser. Same or older: "You're
   up to date". No network: "Could not check for updates". Nothing is installed
   silently.

## One-time setup

Put the manifest somewhere public and paste that address into
`flip/ui/update.js`:

```js
var MANIFEST_URL = "https://github.com/itsnautill/flip/releases/latest/download/latest.json";
```

Good free homes, easiest first:

- **GitHub Releases** — attach `latest.json` and the installer to a release,
  then use the raw asset URL.
- **GitHub Pages / Cloudflare Pages / Netlify** — drop both files in a folder.
- Anything that serves `application/json` over HTTPS.

The address must be `https` for real use. `http` only makes sense against your
own machine while testing.

## Publishing an update

1. Change the version in **both** `Cargo.toml` and `tauri.conf.json`
   (e.g. `0.1.0` → `0.2.0`).
2. Build:

   ```bash
   cd flip
   cargo tauri build
   ```

   Installers land in `src-tauri/target/release/bundle/` (`.msi` and `-setup.exe`).
3. Upload the new `.exe` (or `.msi`) where people can download it.
4. Edit `latest.json`:

   ```json
   {
     "version": "0.2.0",
     "notes": "Faster dashboard, fixed the Wednesday date pill.",
     "url": "https://github.com/you/flip/releases/download/v0.2.0/Flip_0.2.0_x64-setup.exe"
   }
   ```

5. Upload the edited `latest.json` to the manifest address.

Every install from then on sees the new version the next time someone presses
**Check for updates** (Settings → General → Updates, or the About card).

## Testing it locally

```bash
cd flip/update
python -m http.server 8777
```

Then, in `flip/ui/update.js`, point `MANIFEST_URL` at
`http://127.0.0.1:8777/latest.json`, set the manifest's `version` above the
app's, rebuild, and press the button. Remember to put the real URL back.

## What this is not

This is a **check + download** system. The installer runs like any other
download, so Windows may show a SmartScreen warning for an unsigned build.

If you later want one-click updates that install in place and restart the app,
that is Tauri's `tauri-plugin-updater`: you generate a signing keypair, add the
public key and an endpoint to `tauri.conf.json`, build with
`createUpdaterArtifacts` enabled, and sign each release with the private key
(`TAURI_SIGNING_PRIVATE_KEY`). It is more setup, and the private key becomes
something you must never lose — which is why the simpler flow above is the
starting point.
