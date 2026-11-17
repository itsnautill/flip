/* Flip frontend: no build step. Every key press is forwarded to Rust, and the
   Snapshot Rust returns (or emits) is the only source of truth we render. */
(function () {
  "use strict";

  var tauri = window.__TAURI__;
  var invoke = tauri.core.invoke;
  var listen = tauri.event.listen;

  var clockGroup = document.getElementById("clock-group");
  var timerGroup = document.getElementById("timer-group");
  var dots = Array.prototype.slice.call(document.querySelectorAll("#dots .dot"));
  var zoomOutButton = document.getElementById("zoom-out");
  var zoomInButton = document.getElementById("zoom-in");
  var shortcutsButton = document.getElementById("shortcuts-btn");
  var settingsButton = document.getElementById("settings-btn");
  var fullscreenButton = document.getElementById("fullscreen-btn");
  var setTimerButton = document.getElementById("timer-set");
  var resetTimerButton = document.getElementById("timer-clear");

  clockGroup.classList.add("l2");

  var clockH = new FlipCard(clockGroup, { ampm: true });
  var clockM = new FlipCard(clockGroup);
  var timerH = new FlipCard(timerGroup, { className: "hours" });
  var timerM = new FlipCard(timerGroup);
  var timerS = new FlipCard(timerGroup);

  var ampm = clockH.ampm;
  var finishedTimeout = 0;
  var shakeTimeout = 0;
  var currentView = "dashboard";
  var lastSnapshot = null;
  var snapshotListeners = [];

  function text(value, fallback) {
    return value === undefined || value === null ? fallback : String(value);
  }

  /* ------------------------------------------------------------------- theme */

  var THEMES = ["light", "light-hc", "dark", "dark-hc", "flat"];

  function applyTheme(theme) {
    var wanted = THEMES.indexOf(theme) >= 0 ? theme : "light";
    if (document.documentElement.getAttribute("data-theme") !== wanted) {
      document.documentElement.setAttribute("data-theme", wanted);
      /* Subject colours and the accent are derived per theme, so anything
         already painted asks for a fresh coat. */
      window.dispatchEvent(new CustomEvent("flip-theme"));
    }
  }

  if (fullscreenButton) {
    fullscreenButton.addEventListener("click", function () {
      send("toggle_fullscreen");
    });
  }

  /* A phone has no window to expand, so the same slot holds an orientation
     switch instead. The flip clock needs width, so a portrait phone is asked
     to turn rather than shown a squeezed clock. */
  var ANDROID = /android/i.test(navigator.userAgent || "");
  var orientButton = document.getElementById("orient-btn");
  var rotateNote = document.getElementById("rotate-note");
  var rotateGo = document.getElementById("rotate-go");
  var portraitQuery = window.matchMedia("(orientation: portrait)");

  function isPortrait() {
    return Boolean(portraitQuery.matches);
  }

  function paintOrientation() {
    if (!ANDROID) return;
    var portrait = isPortrait();
    document.documentElement.classList.toggle("android-portrait", portrait);
    if (rotateNote) rotateNote.hidden = !portrait;
    if (orientButton) {
      var label = portrait ? "Switch to landscape" : "Switch to portrait";
      orientButton.setAttribute("aria-label", label);
      orientButton.title = label;
      orientButton.setAttribute("aria-pressed", String(!portrait));
    }
  }

  function askOrientation(landscape) {
    invoke("set_orientation", { landscape: Boolean(landscape) }).catch(function (err) {
      console.error("flip: set_orientation failed", err);
    });
  }

  if (ANDROID) {
    document.documentElement.classList.add("is-android");
    if (fullscreenButton) fullscreenButton.hidden = true;
    if (orientButton) {
      orientButton.hidden = false;
      orientButton.addEventListener("click", function () {
        askOrientation(isPortrait());
      });
    }
    if (rotateGo) {
      rotateGo.addEventListener("click", function () {
        askOrientation(true);
      });
    }
    if (portraitQuery.addEventListener) {
      portraitQuery.addEventListener("change", paintOrientation);
    }
    paintOrientation();
  }

  /* Zoom steps by ten percent and is remembered by Rust, so it also comes back
     after a restart. The buttons respond straight away, including on a fast
     double click, so hold the value locally until a snapshot lands. */
  var zoomPending = 0;

  function paintZoom(zoom) {
    if (zoomOutButton) {
      zoomOutButton.disabled = zoom <= 80;
      zoomOutButton.title = "Zoom out (" + zoom + "%)";
    }
    if (zoomInButton) {
      zoomInButton.disabled = zoom >= 160;
      zoomInButton.title = "Zoom in (" + zoom + "%)";
    }
  }

  function changeZoom(delta) {
    var current = zoomPending || Number(lastSnapshot && lastSnapshot.zoom) || 100;
    var next = Math.max(80, Math.min(160, current + delta));
    if (next === current) return;
    zoomPending = next;
    paintZoom(next);
    invoke("set_zoom", { percent: next })
      .then(render)
      .catch(function (err) {
        zoomPending = 0;
        console.error("flip: set_zoom failed", err);
      });
  }

  if (zoomOutButton) {
    zoomOutButton.addEventListener("click", function () {
      changeZoom(-10);
    });
  }
  if (zoomInButton) {
    zoomInButton.addEventListener("click", function () {
      changeZoom(10);
    });
  }

  /* ------------------------------------------------------------------ accent */

  /* Flip stores one hue. Every weight, the ink that sits on it and the wash
     come from the shared colour helper, so the app and the timetable agree. */
  function applyAccent(hue) {
    if (!window.FlipColor) return;
    window.FlipColor.applyAccent(hue);
    try {
      window.localStorage.setItem("flip.accentHue", String(Math.round(Number(hue))));
    } catch (_) {
      /* storage can be refused; the snapshot still paints the accent */
    }
  }

  /* --------------------------------------------------------------- shortcuts */

  var SHORTCUTS = [
    ["Space / Enter", "Start, pause or resume the timer"],
    ["Tab", "Switch between the clock and the timer"],
    ["0 – 9", "Type a duration while the timer is idle"],
    ["Backspace", "Delete the last typed digit"],
    ["S", "Open the set-timer dialog"],
    ["R", "Reset the timer"],
    ["T", "Switch 12/24-hour clock"],
    ["F or F11", "Toggle fullscreen"],
    ["Esc", "Leave fullscreen"],
    ["?", "Show this list"],
  ];

  function openShortcuts() {
    var body = Board.el("div", "form-grid");
    body.appendChild(
      Board.el(
        "p",
        "shortcut-note",
        "F, F11 and ? work in every section. The rest apply to the Timer. XD"
      )
    );
    var list = Board.el("div", "shortcut-list");
    SHORTCUTS.forEach(function (row) {
      var line = Board.el("div", "shortcut-row");
      line.appendChild(Board.el("span", "", row[1]));
      var key = document.createElement("kbd");
      key.textContent = row[0];
      line.appendChild(key);
      list.appendChild(line);
    });
    body.appendChild(list);

    Board.modal({
      title: "Keyboard shortcuts",
      body: body,
      saveLabel: "Close",
      hideCancel: true,
      onSave: function () {},
    });
  }

  /* ---------------------------------------------------------- set timer dialog */

  function openSetTimer() {
    var timer = (lastSnapshot && lastSnapshot.timer) || {};
    var total = Number(timer.secs || 0);
    if (!total) total = Number(timer.h || 0) * 3600 + Number(timer.m || 0) * 60 + Number(timer.s || 0);

    var body = Board.el("div", "form-grid timer-set");

    var row = Board.el("div", "time-row");
    var inputs = {};
    [
      ["h", "Hours", 99, "h"],
      ["m", "Minutes", 59, "m"],
      ["s", "Seconds", 59, "s"],
    ].forEach(function (spec) {
      var field = Board.el("label", "time-field");
      field.appendChild(Board.el("span", "", spec[1]));
      var input = document.createElement("input");
      input.type = "number";
      input.className = "time-input";
      input.min = "0";
      input.max = String(spec[2]);
      input.step = "1";
      input.inputMode = "numeric";
      input.setAttribute("aria-label", spec[1]);
      input.value = String(
        spec[0] === "h"
          ? Math.floor(total / 3600)
          : spec[0] === "m"
            ? Math.floor((total % 3600) / 60)
            : total % 60
      );
      field.appendChild(input);
      field.appendChild(Board.el("em", "time-unit", spec[3]));
      row.appendChild(field);
      inputs[spec[0]] = input;
    });
    body.appendChild(row);

    function currentSecs() {
      var h = Math.min(99, Math.max(0, Math.floor(Number(inputs.h.value) || 0)));
      var m = Math.min(59, Math.max(0, Math.floor(Number(inputs.m.value) || 0)));
      var s = Math.min(59, Math.max(0, Math.floor(Number(inputs.s.value) || 0)));
      return h * 3600 + m * 60 + s;
    }

    function describe(secs) {
      if (!secs) return "Choose at least one second";
      var units = [
        [Math.floor(secs / 3600), "hour"],
        [Math.floor((secs % 3600) / 60), "minute"],
        [secs % 60, "second"],
      ];
      var parts = [];
      units.forEach(function (pair) {
        if (!pair[0]) return;
        parts.push(pair[0] + " " + pair[1] + (pair[0] === 1 ? "" : "s"));
      });
      return parts.join(" ");
    }

    var summary = Board.el("p", "timer-total", describe(total));
    body.appendChild(summary);

    var presets = Board.el("div", "preset-grid");
    var chips = [5, 10, 15, 25, 45, 60].map(function (minutes) {
      var chip = Board.el("button", "chip-btn", minutes + "m");
      chip.type = "button";
      chip.addEventListener("click", function () {
        inputs.h.value = String(Math.floor(minutes / 60));
        inputs.m.value = String(minutes % 60);
        inputs.s.value = "0";
        sync();
      });
      presets.appendChild(chip);
      return { chip: chip, secs: minutes * 60 };
    });
    body.appendChild(presets);

    function sync() {
      var secs = currentSecs();
      summary.textContent = describe(secs);
      summary.classList.toggle("empty-total", secs === 0);
      chips.forEach(function (entry) {
        var on = entry.secs === secs;
        entry.chip.classList.toggle("active", on);
        entry.chip.setAttribute("aria-pressed", String(on));
      });
    }

    Object.keys(inputs).forEach(function (key) {
      inputs[key].addEventListener("input", sync);
    });
    sync();

    Board.modal({
      title: "Set timer",
      body: body,
      saveLabel: "Set timer",
      onSave: function () {
        var secs = currentSecs();
        if (secs <= 0) return "Choose a duration of at least one second.";
        return invoke("timer_set", { secs: secs })
          .then(render)
          .catch(function (err) {
            return String(err && err.message ? err.message : err);
          });
      },
    });
  }

  /* ---------------------------------------------------------------- settings */

  var pendingAccent = null;

  var THEME_CHOICES = [
    ["light", "Light", "Soft off-white with warm accents."],
    ["light-hc", "Light High Contrast", "Black text on white, stronger borders."],
    ["dark", "Dark", "Grey panels rather than pure black."],
    ["dark-hc", "Dark High Contrast", "White on black with brighter accents."],
    ["flat", "Flat", "Square corners, thin borders, no shadows."],
  ];

  function themePreview() {
    var box = Board.el("div", "theme-preview");
    var bar = Board.el("div", "tp-bar");
    for (var i = 0; i < 3; i++) bar.appendChild(Board.el("i"));
    box.appendChild(bar);
    box.appendChild(Board.el("div", "tp-head"));
    var row = Board.el("div", "tp-body");
    var card = Board.el("div", "tp-card");
    card.appendChild(Board.el("i"));
    row.appendChild(card);
    row.appendChild(Board.el("div", "tp-side"));
    box.appendChild(row);
    return box;
  }

  function switchControl(label, checked, onChange) {
    var button = Board.el("button", "switch");
    button.type = "button";
    button.setAttribute("role", "switch");
    button.setAttribute("aria-checked", String(checked));
    button.setAttribute("aria-label", label);
    button.addEventListener("click", function () {
      var next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      onChange(next);
    });
    return button;
  }

  function settingRow(title, control, sub) {
    var row = Board.el("div", "setting-row");
    var text = Board.el("div", "setting-text");
    text.appendChild(Board.el("div", "setting-title", title));
    if (sub) text.appendChild(Board.el("div", "sub", sub));
    row.appendChild(text);
    if (control) row.appendChild(control);
    return row;
  }

  function segControl(label, options, current, onPick) {
    var seg = Board.el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", label);
    var buttons = options.map(function (option) {
      var on = option[0] === current;
      var button = Board.el("button", "seg-btn" + (on ? " active" : ""), option[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", String(on));
      button.addEventListener("click", function () {
        if (option[0] === current) return;
        current = option[0];
        buttons.forEach(function (node) {
          node.classList.toggle("active", node === button);
          node.setAttribute("aria-pressed", String(node === button));
        });
        onPick(option[0]);
      });
      seg.appendChild(button);
      return button;
    });
    return seg;
  }

  function openSettings() {
    var snap = lastSnapshot || {};
    var current = String(snap.accent || "#B4622D").toUpperCase();
    var isTwelve = Boolean(snap.clock && snap.clock.is12h);
    var currentLang = String(snap.language || "en");
    var theme = String(snap.theme || "light");
    var motion = String(snap.motion || "normal");

    var body = Board.el("div", "settings");
    var nav = Board.el("nav", "settings-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Settings sections");

    var appearancePane = Board.el("div", "settings-pane");
    var generalPane = Board.el("div", "settings-pane");
    var dataPane = Board.el("div", "settings-pane");
    generalPane.hidden = true;
    dataPane.hidden = true;

    var navButtons = [];
    [
      ["appearance", "Appearance"],
      ["general", "General"],
      ["data", "Data"],
    ].forEach(function (entry) {
      var button = Board.el("button", entry[0] === "appearance" ? "active" : "", entry[1]);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(entry[0] === "appearance"));
      button.addEventListener("click", function () {
        showPane(entry[0]);
      });
      nav.appendChild(button);
      navButtons.push({ name: entry[0], button: button });
    });

    function showPane(which) {
      appearancePane.hidden = which !== "appearance";
      generalPane.hidden = which !== "general";
      dataPane.hidden = which !== "data";
      navButtons.forEach(function (entry) {
        var on = entry.name === which;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-selected", String(on));
      });
      /* Only the pane scrolls, so this is the one and only scroll reset. */
      var pane = { appearance: appearancePane, general: generalPane, data: dataPane }[which];
      if (pane) pane.scrollTop = 0;
    }

    /* ---- appearance ---- */

    appearancePane.appendChild(Board.el("h3", "", "Theme"));

    var grid = Board.el("div", "theme-grid");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Theme");
    var cards = [];
    THEME_CHOICES.forEach(function (choice) {
      var card = Board.el("button", "theme-card");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("data-theme-preview", choice[0]);
      card.setAttribute("aria-checked", String(choice[0] === theme));
      card.appendChild(themePreview());
      var name = Board.el("span", "theme-name");
      name.appendChild(Board.el("span", "theme-dot"));
      name.appendChild(Board.el("span", "", choice[1]));
      card.appendChild(name);
      card.appendChild(Board.el("span", "theme-note", choice[2]));
      card.addEventListener("click", function () {
        if (choice[0] === theme) return;
        theme = choice[0];
        paintThemes();
        invoke("set_theme", { theme: choice[0] })
          .then(render)
          .catch(function (err) {
            console.error("flip: set_theme failed", err);
          });
      });
      grid.appendChild(card);
      cards.push({ name: choice[0], card: card });
    });

    function paintThemes() {
      cards.forEach(function (entry) {
        entry.card.setAttribute("aria-checked", String(entry.name === theme));
      });
    }
    appearancePane.appendChild(grid);

    appearancePane.appendChild(Board.el("h3", "", "Accent"));

    var accentRow = Board.el("div", "setting-row column");
    var presetRow = Board.el("div", "accent-presets");
    presetRow.setAttribute("role", "group");
    presetRow.setAttribute("aria-label", "Accent colour");
    var accentHue = window.FlipColor ? Number(snap.accentHue) || 51 : 51;
    var presetButtons = [];

    function markPresets(hue) {
      presetButtons.forEach(function (entry) {
        entry.button.setAttribute("aria-pressed", String(Math.round(hue) === entry.hue));
      });
    }

    if (window.FlipColor) {
      window.FlipColor.presets.forEach(function (preset) {
        var swatch = window.FlipColor.subjectColorFromHue(preset.hue);
        var button = Board.el("button", "accent-swatch");
        button.type = "button";
        button.style.setProperty("--sw", swatch.border);
        button.setAttribute("aria-label", preset.name);
        button.title = preset.name;
        button.setAttribute("aria-pressed", String(Math.round(accentHue) === preset.hue));
        button.addEventListener("click", function () {
          accentHue = preset.hue;
          markPresets(accentHue);
          slider.set(accentHue);
          pendingAccent = null;
          applyAccent(accentHue);
          commitAccent(accentHue);
        });
        presetRow.appendChild(button);
        presetButtons.push({ button: button, hue: preset.hue });
      });
    }
    accentRow.appendChild(presetRow);

    var slider = window.FlipColor
      ? window.FlipColor.hueSlider({
          value: accentHue,
          label: "Custom accent hue",
          accent: true,
          onChange: function (hue) {
            accentHue = hue;
            markPresets(hue);
            /* Live paint without touching the disk until the drag settles. */
            pendingAccent = hue;
            applyAccent(hue);
          },
          onCommit: function (hue) {
            accentHue = hue;
            markPresets(hue);
            commitAccent(hue);
          },
        })
      : null;
    if (slider) accentRow.appendChild(slider.element);
    appearancePane.appendChild(accentRow);

    appearancePane.appendChild(
      settingRow(
        "Gradient background",
        switchControl("Gradient background", snap.wash === true, function (on) {
          document.documentElement.setAttribute("data-wash", on ? "on" : "off");
          invoke("set_wash", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_wash failed", err);
            });
        }),
        "Paints the older accent wash behind the app. Off gives the plain theme backdrop."
      )
    );

    /* ---- general ---- */

    generalPane.appendChild(Board.el("h3", "", "Clock and sound"));

    generalPane.appendChild(
      settingRow(
        "Clock",
        segControl(
          "Clock format",
          [[false, "24-hour"], [true, "12-hour"]],
          isTwelve,
          function (value) {
            invoke("set_hour_format", { use12h: value })
              .then(render)
              .catch(function (err) {
                console.error("flip: set_hour_format failed", err);
              });
          }
        )
      )
    );

    generalPane.appendChild(
      settingRow(
        "Sound effects",
        switchControl("Sound effects", snap.sound !== false, function (on) {
          invoke("set_sound", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_sound failed", err);
            });
        })
      )
    );

    generalPane.appendChild(
      settingRow(
        "Touch mode",
        switchControl("Touch mode", snap.touch === true, function (on) {
          document.documentElement.setAttribute("data-touch", on ? "on" : "off");
          invoke("set_touch", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_touch failed", err);
            });
        }),
        "Bigger buttons, rows and spacing for touch screens."
      )
    );

    generalPane.appendChild(Board.el("h3", "", "Language and motion"));

    generalPane.appendChild(
      settingRow(
        "Language",
        segControl(
          "Language",
          [["en", "English"], ["vi", "Tiếng Việt"]],
          currentLang,
          function (value) {
            if (value === currentLang) return;
            invoke("set_language", { language: value }).then(function () {
              location.reload();
            });
          }
        )
      )
    );

    generalPane.appendChild(
      settingRow(
        "Animations",
        segControl(
          "Animations",
          [
            ["extra", "Extra"],
            ["normal", "Normal"],
            ["fast", "Fast"],
            ["snappy", "Snappy"],
          ],
          motion,
          function (value) {
            invoke("set_motion", { motion: value })
              .then(render)
              .catch(function (err) {
                console.error("flip: set_motion failed", err);
              });
          }
        )
      )
    );

    /* ---- what this build sends, and what it never sends ---- */

    generalPane.appendChild(Board.el("h3", "", "Privacy"));

    generalPane.appendChild(
      settingRow(
        "Discord Rich Presence",
        switchControl("Discord Rich Presence", snap.discord !== false, function (on) {
          invoke("set_discord", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_discord failed", err);
            });
        }),
        "Shows Flip is open, and whether a timer is running. Never your tasks, subjects or study time."
      )
    );

    var telemetryRow = Board.el("div", "setting-row column");
    var telemetryHead = Board.el("div", "setting-row");
    var telemetryLabel = Board.el("div", "setting-text");
    telemetryLabel.appendChild(Board.el("div", "setting-title", "Share anonymous usage"));
    telemetryLabel.appendChild(
      Board.el("div", "sub", "Off unless you turn it on. One ping a day, and nothing personal.")
    );
    telemetryHead.appendChild(telemetryLabel);
    telemetryHead.appendChild(
      switchControl("Share anonymous usage", snap.telemetry === true, function (on) {
        invoke("set_telemetry", { enabled: on })
          .then(function (next) {
            render(next);
            if (on && window.FlipTelemetry) window.FlipTelemetry.pingNow();
          })
          .catch(function (err) {
            console.error("flip: set_telemetry failed", err);
          });
      })
    );
    telemetryRow.appendChild(telemetryHead);

    var telemetryDetail = Board.el("div", "setting-detail");
    telemetryDetail.appendChild(
      Board.el("div", "", "Sends: a random install id made on this computer, the app version, your interface language, and the date.")
    );
    telemetryDetail.appendChild(
      Board.el("div", "", "Never sends: tasks, subjects, timetable, notes, timers, settings, file names, your name, or anything that identifies your PC.")
    );
    telemetryDetail.appendChild(
      Board.el("div", "", "Your IP address is not stored, and nothing is linked to an account.")
    );
    telemetryRow.appendChild(telemetryDetail);
    generalPane.appendChild(telemetryRow);

    /* ---- app-level actions ---- */

    generalPane.appendChild(Board.el("h3", "", "This copy"));

    var updateBox = Board.el("div", "setting-row column");
    var updateText = Board.el("div", "setting-text");
    updateText.appendChild(Board.el("div", "setting-title", "Updates"));
    updateBox.appendChild(updateText);
    if (window.FlipUpdate) window.FlipUpdate.mount(updateBox);
    generalPane.appendChild(updateBox);

    var setupRow = Board.el("div", "setting-row");
    var setupText = Board.el("div", "setting-text");
    setupText.appendChild(Board.el("div", "setting-title", "Setup"));
    setupRow.appendChild(setupText);
    var setupButton = Board.el("button", "btn small", "Run setup");
    setupButton.type = "button";
    setupButton.addEventListener("click", function () {
      Board.closeModal();
      if (window.FlipSetup) window.FlipSetup.open();
    });
    setupRow.appendChild(setupButton);
    generalPane.appendChild(setupRow);

    /* ---- data ---- */

    if (window.FlipData) {
      dataPane.appendChild(window.FlipData.section());
    } else {
      dataPane.appendChild(Board.el("p", "sub", "Backups are unavailable in this build."));
    }

    function commitAccent(hue) {
      var value = typeof hue === "number" ? hue : accentHue;
      if (pendingAccent === null && typeof hue !== "number") return;
      pendingAccent = null;
      invoke("set_accent_hue", { hue: value })
        .then(render)
        .catch(function (err) {
          console.error("flip: set_accent_hue failed", err);
        });
    }

    body.appendChild(nav);
    body.appendChild(appearancePane);
    body.appendChild(generalPane);
    body.appendChild(dataPane);

    Board.modal({
      title: "Settings",
      body: body,
      saveLabel: "Done",
      hideCancel: true,
      className: "modal-settings",
      onSave: function () {
        commitAccent();
      },
      onClose: function () {
        if (pendingAccent !== null) commitAccent(pendingAccent);
      },
    });

    /* The dialog is built at the top; focusing the first tab must not move it. */
    appearancePane.scrollTop = 0;
    setTimeout(function () {
      if (navButtons[0]) navButtons[0].button.focus({ preventScroll: true });
      appearancePane.scrollTop = 0;
    }, 0);
  }

  if (settingsButton) {
    settingsButton.addEventListener("click", openSettings);
  }

  if (shortcutsButton) {
    shortcutsButton.addEventListener("click", openShortcuts);
  }

  if (setTimerButton) {
    setTimerButton.addEventListener("click", function () {
      ensureAudio();
      openSetTimer();
    });
  }

  if (resetTimerButton) {
    resetTimerButton.addEventListener("click", function () {
      send("timer_reset");
    });
  }

  /* ------------------------------------------------------------------ render */

  /* How lively the interface is: extra, normal, fast or snappy (none). */
  function applyMotion(mode) {
    var wanted = ["extra", "fast", "snappy"].indexOf(mode) >= 0 ? mode : "normal";
    if (document.documentElement.getAttribute("data-motion") !== wanted) {
      document.documentElement.setAttribute("data-motion", wanted);
    }
  }

  function render(snap) {
    if (!snap) return;
    soundOn = snap.sound !== false;
    applyMotion(snap.motion);
    document.documentElement.setAttribute("data-touch", snap.touch === true ? "on" : "off");
    document.documentElement.setAttribute("data-wash", snap.wash === true ? "on" : "off");

    zoomPending = 0;
    paintZoom(Number(snap.zoom) || 100);
    if (window.FlipTelemetry) window.FlipTelemetry.send(snap);
    lastSnapshot = snap;
    applyTheme(snap.theme);
    /* A preview inside the settings dialog wins until it is committed. */
    if (pendingAccent === null) applyAccent(snap.accentHue);

    var isClock = snap.mode === "clock";
    clockGroup.classList.toggle("active", isClock);
    timerGroup.classList.toggle("active", !isClock);
    if (dots[0]) dots[0].classList.toggle("active", isClock);
    if (dots[1]) dots[1].classList.toggle("active", !isClock);

    var clock = snap.clock || {};
    clockH.set(text(clock.h, "--"));
    clockM.set(text(clock.m, "--"));
    if (ampm) {
      ampm.textContent = clock.pm ? "PM" : "AM";
      ampm.style.display = clock.is12h ? "" : "none";
    }

    var timer = snap.timer || {};
    timerH.set(text(timer.h, "00"));
    timerM.set(text(timer.m, "00"));
    timerS.set(text(timer.s, "00"));

    var showHours = Boolean(timer.showHours);
    timerGroup.classList.toggle("l3", showHours);
    timerGroup.classList.toggle("l2", !showHours);
    timerGroup.classList.toggle("paused", timer.state === "paused");
    timerGroup.classList.toggle("typing", Boolean(timer.typing));

    for (var i = 0; i < snapshotListeners.length; i++) {
      try {
        snapshotListeners[i](snap);
      } catch (err) {
        console.error("flip: snapshot listener failed", err);
      }
    }
  }

  function send(command, args) {
    return invoke(command, args)
      .then(render)
      .catch(function (err) {
        console.error("flip: " + command + " failed", err);
      });
  }

  /* -------------------------------------------------------------------- tabs */

  function setView(name, fromHistory) {
    if (name === currentView) return;
    currentView = name;
    /* One entry per section, so Android's back button and the browser's back
       both walk through the app instead of leaving it. */
    if (!fromHistory) {
      try {
        window.history.pushState({ flipView: name }, "");
      } catch (_) {
        /* no history is still a working app */
      }
    }
    document.body.dataset.view = name;
    if (window.Dashboard) {
      if (name === "dashboard") window.Dashboard.show();
      else window.Dashboard.hide();
    }

    Array.prototype.forEach.call(document.querySelectorAll(".view"), function (section) {
      var active = section.dataset.view === name;
      section.classList.toggle("active", active);
      section.hidden = !active;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      var active = tab.dataset.view === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });

    playSound("tab");
    var fresh = document.querySelector('.view[data-view="' + name + '"]');
    if (fresh) {
      fresh.classList.remove("stagger");
      void fresh.offsetWidth;
      fresh.classList.add("stagger");
      setTimeout(function () {
        fresh.classList.remove("stagger");
      }, 800);
    }

    if (name !== "timer") {
      window.Board.tooltip.hide();
      document.body.classList.remove("hide-cursor");
    } else {
      render(lastSnapshot);
      armCursorHide();
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
    tab.addEventListener("click", function () {
      setView(tab.dataset.view);
    });
  });

  window.addEventListener("popstate", function (event) {
    /* An open dialog owns its own history entry and closes itself. */
    if (window.Board && window.Board.isModalOpen()) return;
    var state = event.state || {};
    if (state.flipView) setView(state.flipView, true);
    else if (currentView !== "dashboard") setView("dashboard", true);
  });

  /* On a phone the on-screen keyboard covers the bottom of the window; bring
     the field being typed into back into view once the keyboard has settled. */
  document.addEventListener("focusin", function (event) {
    var node = event.target;
    if (!node || !/^(INPUT|TEXTAREA)$/i.test(String(node.tagName || ""))) return;
    if (String(node.type || "").toLowerCase() === "range") return;
    setTimeout(function () {
      var rect = node.getBoundingClientRect();
      var viewport = window.innerHeight || document.documentElement.clientHeight;
      /* A keyboard opening on a phone covers the bottom third; a field that is
         already fully in view must not move the page at all. */
      if (rect.top >= 8 && rect.bottom <= viewport - 8) return;
      try {
        node.scrollIntoView({ block: "nearest" });
      } catch (_) {
        /* older webviews ignore the options object */
      }
    }, 260);
  });

  /* ---- audio ------------------------------------------------------------ */

  var ctx = null;

  function ensureAudio() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {
        ctx = null;
      }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function chime() {
    if (!soundOn) return;
    ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    [
      [880, 0, 0.14],
      [1175, 0.16, 0.22],
    ].forEach(function (tone) {
      var f = tone[0];
      var s = tone[1];
      var d = tone[2];
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + s);
      g.gain.linearRampToValueAtTime(0.25, t + s + 0.02);
      g.gain.setValueAtTime(0.25, t + s + Math.max(0.02, d - 0.12));
      g.gain.linearRampToValueAtTime(0, t + s + d);
      o.connect(g).connect(ctx.destination);
      o.start(t + s);
      o.stop(t + s + d + 0.02);
    });
  }

  var soundOn = true;

  function tone(freq, start, dur, gain, type) {
    var at = ctx.currentTime + start;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + dur + 0.03);
  }

  var SOUNDS = {
    tab: function () {
      tone(520, 0, 0.07, 0.04, "triangle");
    },
    complete: function () {
      tone(784, 0, 0.09, 0.08, "sine");
      tone(1174, 0.07, 0.17, 0.06, "sine");
    },
    uncheck: function () {
      tone(392, 0, 0.1, 0.05, "sine");
    },
    chime: chime
  };

  function playSound(name) {
    if (!soundOn) return;
    ensureAudio();
    if (!ctx || !SOUNDS[name]) return;
    try {
      SOUNDS[name]();
    } catch (_) {
      /* audio is a nicety; never let it break a click */
    }
  }

  window.FlipSound = {
    play: playSound,
    get enabled() {
      return soundOn;
    }
  };

  /* ---- feedback cues ---------------------------------------------------- */

  function pulse() {
    timerGroup.classList.remove("finished-pulse");
    void timerGroup.offsetWidth;
    timerGroup.classList.add("finished-pulse");
    clearTimeout(finishedTimeout);
    finishedTimeout = setTimeout(function () {
      timerGroup.classList.remove("finished-pulse");
    }, 1200);
  }

  function shake() {
    timerGroup.classList.remove("shake");
    void timerGroup.offsetWidth;
    timerGroup.classList.add("shake");
    clearTimeout(shakeTimeout);
    shakeTimeout = setTimeout(function () {
      timerGroup.classList.remove("shake");
    }, 300);
  }

  /* ---- idle cursor hide ------------------------------------------------- */

  var cursorTimeout = 0;

  function looksFullscreen() {
    if (document.fullscreenElement) return true;
    if (typeof screen === "undefined") return false;
    return (
      window.innerWidth >= screen.availWidth - 2 &&
      window.innerHeight >= screen.availHeight - 2
    );
  }

  function armCursorHide() {
    clearTimeout(cursorTimeout);
    document.body.classList.remove("hide-cursor");
    cursorTimeout = setTimeout(function () {
      if (currentView === "timer" && looksFullscreen()) {
        document.body.classList.add("hide-cursor");
      }
    }, 2000);
  }

  window.addEventListener("mousemove", armCursorHide);
  window.addEventListener("resize", armCursorHide);
  armCursorHide();

  /* ---- keyboard --------------------------------------------------------- */

  function isField(node) {
    if (!node) return false;
    var tag = String(node.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable;
  }

  function isControl(node) {
    if (!node) return false;
    var tag = String(node.tagName || "").toLowerCase();
    return tag === "button" || tag === "a";
  }

  window.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (window.Board && window.Board.isModalOpen()) return;
    if (isField(e.target)) return;

    ensureAudio();

    /* Keys that belong to the whole app, not just the timer section. */
    if (e.key === "F11") {
      e.preventDefault();
      if (!e.repeat) send("toggle_fullscreen");
      return;
    }

    if (e.key === "?") {
      e.preventDefault();
      if (!e.repeat) openShortcuts();
      return;
    }

    if (e.key === "Escape") {
      send("exit_fullscreen");
      return;
    }

    if (e.key.toLowerCase() === "f") {
      e.preventDefault();
      if (!e.repeat) send("toggle_fullscreen");
      return;
    }

    if (currentView !== "timer") return;

    if (isControl(e.target) && (e.key === " " || e.key === "Enter")) {
      return; // let a focused button do its own job
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (!e.repeat) send("switch_mode");
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) send("timer_toggle");
      return;
    }

    if (e.key === "Enter") {
      if (!e.repeat) send("timer_toggle");
      return;
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      send("timer_backspace");
      return;
    }

    if (/^[0-9]$/.test(e.key)) {
      if (!e.repeat) send("timer_digit", { d: Number(e.key) });
      return;
    }

    var key = e.key.toLowerCase();
    if (key === "r") {
      if (!e.repeat) send("timer_reset");
      return;
    }
    if (key === "s") {
      e.preventDefault();
      if (!e.repeat) openSetTimer();
      return;
    }
    if (key === "t") {
      if (!e.repeat) send("toggle_hour_format");
      return;
    }
  });

  /* ---- startup ---------------------------------------------------------- */

  async function start() {
    try {
      var first = await invoke("get_snapshot");
      render(first);
      if (!first.onboarded && window.FlipSetup) window.FlipSetup.resume();
    } catch (err) {
      console.error("flip: get_snapshot failed", err);
    }
    try {
      await listen("snapshot", function (event) {
        render(event.payload);
      });
      await listen("timer-finished", function () {
        pulse();
        chime();
        if (!lastSnapshot || !lastSnapshot.focusActive) {
          window.Board.toast("Time's up");
        }
      });
      await listen("shake", function () {
        shake();
      });
      await listen("board-changed", function () {
        window.Board.load().catch(function (err) {
          console.error("flip: board reload failed", err);
        });
      });
      await listen("focus-finished", function (event) {
        var secs = Number(event && event.payload ? event.payload : 0);
        window.Board.toast(
          "Focus session saved · " +
            window.I18n.count(Math.max(1, Math.round(secs / 60)), "minute", "minutes")
        );
      });
    } catch (err) {
      console.error("flip: could not subscribe to events", err);
    }
  }

  window.addEventListener("pointerdown", ensureAudio, { once: true });

  /* Small shared surface for the dashboard and the data pane. */
  window.Flip = {
    snapshot: function () {
      return lastSnapshot;
    },
    apply: render,
    go: function (view) {
      setView(view);
    },
    subscribe: function (fn) {
      snapshotListeners.push(fn);
      if (lastSnapshot) fn(lastSnapshot);
      return function off() {
        snapshotListeners = snapshotListeners.filter(function (item) {
          return item !== fn;
        });
      };
    },
  };

  document.body.dataset.view = currentView;
  paintOrientation();

  /* The board sections register their renderers first, then load their data. */
  window.Dashboard.init();
  window.Dashboard.show();
  window.Timetable.init();
  window.Tasks.init();
  window.Board.load().catch(function (err) {
    console.error("flip: get_board failed", err);
  });

  start();
})();
