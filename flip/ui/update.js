/* Update checks.

   Flip does not install updates by itself. This module asks a small JSON file
   on the web what the newest version is, compares it with the running build,
   and offers a link to the installer. That keeps the app dependency-free and
   means a release is just "build, upload, edit one file".

   The manifest looks like this:

     { "version": "0.2.0",
       "notes": "What changed",
       "url": "https://example.com/Flip_0.2.0_x64-setup.exe" }
*/
(function () {
  "use strict";

  /* Where the manifest is read from, in order. The copy in the repository is
     first because raw.githubusercontent.com answers with CORS headers, which a
     release download does not - a manifest attached to a release can never be
     fetched from the app itself. The release copy stays as a fallback so a
     manifest uploaded there is used the day it exists. */
  var MANIFEST_URLS = [
    "https://raw.githubusercontent.com/itsnautill/flip/main/flip/update/latest.json",
    "https://github.com/itsnautill/flip/releases/latest/download/latest.json"
  ];

  var MANIFEST_URL = MANIFEST_URLS[0];

  var invoke =
    window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /* "0.2.0" -> [0, 2, 0]; anything odd becomes zeros so we never throw. */
  function parts(value) {
    return String(value || "")
      .replace(/^v/i, "")
      .split(".")
      .map(function (piece) {
        var digits = String(piece).replace(/[^0-9].*$/, "");
        return digits ? Number(digits) : 0;
      });
  }

  /** 1 when a is newer, -1 when b is newer, 0 when they match. */
  function compare(a, b) {
    var left = parts(a);
    var right = parts(b);
    var length = Math.max(left.length, right.length);
    for (var i = 0; i < length; i++) {
      var one = left[i] || 0;
      var two = right[i] || 0;
      if (one > two) return 1;
      if (one < two) return -1;
    }
    return 0;
  }

  var ready = invoke ? invoke("app_version") : Promise.resolve("0.1.0");

  function fetchOne(url) {
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    });
  }

  /* Tries each address until one answers; the last error is the one reported. */
  function fetchManifest() {
    var index = 0;

    function attempt() {
      var url = MANIFEST_URLS[index++];
      return fetchOne(url).catch(function (err) {
        if (index >= MANIFEST_URLS.length) throw err;
        return attempt();
      });
    }

    return attempt();
  }

  function check() {
    return ready.then(function (current) {
      return fetchManifest()
        .then(function (data) {
          var latest = String((data && data.version) || "").trim();
          if (!latest) throw new Error("That file has no version.");
          return {
            ok: true,
            current: current,
            latest: latest,
            notes: String((data && data.notes) || ""),
            url: String((data && data.url) || ""),
            newer: compare(latest, current) > 0
          };
        })
        .catch(function (err) {
          return {
            ok: false,
            current: current,
            error: String((err && err.message) || err)
          };
        });
    });
  }

  function open(url) {
    if (!invoke) return Promise.resolve();
    return invoke("open_url", { url: url });
  }

  /** Builds the status line + button used by Settings and the About card. */
  function mount(container) {
    var row = el("div", "update-row");
    var status = el("p", "sub update-status", "");
    var button = el("button", "btn small", "Check for updates");
    button.type = "button";
    row.appendChild(status);
    row.appendChild(button);
    container.appendChild(row);

    ready.then(function (version) {
      status.textContent = "Version " + version;
    });

    var target = "";
    var latest = "";
    var installer = "";
    var phase = "check"; // check -> download -> install

    function download() {
      phase = "download";
      button.disabled = true;
      status.textContent = "Downloading…";
      invoke("download_update", { url: target, version: latest })
        .then(function (path) {
          installer = path;
          phase = "install";
          button.disabled = false;
          button.textContent = "Install and restart";
          status.textContent = "Ready to install";
        })
        .catch(function (err) {
          console.error("flip: download_update failed", err);
          button.disabled = false;
          status.textContent = "Could not download the update";
        });
    }

    button.addEventListener("click", function () {
      if (phase === "install") {
        button.disabled = true;
        status.textContent = "Installing…";
        invoke("install_update", { path: installer }).catch(function (err) {
          console.error("flip: install_update failed", err);
          button.disabled = false;
          status.textContent = "Could not start the installer";
        });
        return;
      }
      if (phase === "download") {
        download();
        return;
      }
      button.disabled = true;
      status.textContent = "Checking…";
      check().then(function (result) {
        button.disabled = false;
        if (!result.ok) {
          status.textContent = "Could not check for updates";
          return;
        }
        if (!result.newer) {
          status.textContent = "You're up to date";
          return;
        }
        status.textContent = "Version " + result.latest + " is available";
        if (!result.url) return;
        target = result.url;
        latest = result.latest;
        phase = "download";
        button.textContent = "Download update";
        button.classList.add("primary");
      });
    });

    return row;
  }

  window.FlipUpdate = {
    manifest: MANIFEST_URL,
    manifests: MANIFEST_URLS,
    check: check,
    open: open,
    mount: mount,
    ready: ready,
    compare: compare
  };
})();
