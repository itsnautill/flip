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

  /* Replace this with the address of your own latest.json. */
  var MANIFEST_URL = "https://example.com/flip/latest.json";

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

  function check() {
    return ready.then(function (current) {
      return fetch(MANIFEST_URL, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        })
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

    button.addEventListener("click", function () {
      if (target) {
        open(target);
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
        button.textContent = "Download update";
        button.classList.add("primary");
      });
    });

    return row;
  }

  window.FlipUpdate = {
    manifest: MANIFEST_URL,
    check: check,
    open: open,
    mount: mount,
    ready: ready,
    compare: compare
  };
})();
