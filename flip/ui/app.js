/* Flip frontend: no build step. Every key press is forwarded to Rust, and the
   Snapshot Rust returns (or emits) is the only source of truth we render. */
(function () {
  "use strict";

  var tauri = window.__TAURI__;
  var invoke = tauri.core.invoke;
  var listen = tauri.event.listen;

  var clockGroup = document.getElementById("clock-group");
  var timerGroup = document.getElementById("timer-group");
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll("#dots .mode-btn"));
  var modeIsClock = true;
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

  /* The two buttons under the clock are the phone's only way to swap the flip
     clock for the timer and back, so they are real controls, not dots. */
  modeButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      var wantClock = button.dataset.mode === "clock";
      if (wantClock === modeIsClock) return;
      send("switch_mode");
    });
  });

  var ampm = clockH.ampm;
  var finishedTimeout = 0;
  var shakeTimeout = 0;
  var currentView = "dashboard";
  var VIEW_ORDER = ["dashboard", "timer", "timetable", "tasks"];
  /* While the first paint happens, a restored section must not chirp. */
  var booting = true;
  var lastSnapshot = null;
  var snapshotListeners = [];

  function text(value, fallback) {
    return value === undefined || value === null ? fallback : String(value);
  }

  /* ------------------------------------------------------------------- theme */

  /* A mode is the base (system, light or dark) and a palette is painted over
     it, so every theme works in both light and dark. System is a choice, not
     an attribute: it resolves to the base the computer is using, and follows
     that base when the computer switches. */
  var currentMode = "light";
  var currentPalette = "";

  function applyTheme(mode, palette) {
    if (!window.FlipThemes) return;
    var nextMode = window.FlipThemes.modeKnown(mode) ? String(mode) : "light";
    var nextPalette = window.FlipThemes.paletteOf(palette) ? String(palette) : "";
    currentMode = nextMode;
    currentPalette = nextPalette;
    var root = document.documentElement;
    var before = root.getAttribute("data-theme") + "|" + (root.getAttribute("data-palette") || "");
    window.FlipThemes.paint(nextMode, nextPalette);
    var after = root.getAttribute("data-theme") + "|" + (root.getAttribute("data-palette") || "");
    if (before !== after) {
      /* Subject colours and the accent are derived per theme, so anything
         already painted asks for a fresh coat. */
      window.dispatchEvent(new CustomEvent("flip-theme"));
      if (lastSnapshot) applyAccent(lastSnapshot.accentHue);
    }
  }

  if (window.FlipThemes) {
    window.FlipThemes.watchSystem(function () {
      if (currentMode === "system") applyTheme("system", currentPalette);
    });
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
    /* Upright the warning is on screen, so nothing should be hidden. */
    if (portrait) {
      document.body.classList.remove("is-idle");
      setImmersive(false);
    }
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

  /* ------------------------------------------------------------ keep on top */

  /* Pinning Flip above other windows is a desktop idea. Rust owns the window,
     so the button only remembers the choice and asks Rust for it again. */
  var pinButton = document.getElementById("pin-btn");
  var pinned = false;
  try {
    pinned = window.localStorage.getItem("flip.keepOnTop") === "1";
  } catch (_) {
    pinned = false;
  }

  function paintPin() {
    if (!pinButton) return;
    pinButton.setAttribute("aria-pressed", String(pinned));
    var label = pinned ? "Stop keeping Flip on top" : "Keep Flip on top";
    pinButton.setAttribute("aria-label", label);
    pinButton.title = label;
  }

  function askPin(on) {
    pinned = Boolean(on);
    try {
      window.localStorage.setItem("flip.keepOnTop", pinned ? "1" : "0");
    } catch (_) {
      /* the choice still holds for this run */
    }
    paintPin();
    invoke("set_on_top", { on: pinned }).catch(function (err) {
      console.error("flip: set_on_top failed", err);
    });
  }

  if (pinButton && !ANDROID) {
    pinButton.hidden = false;
    pinButton.addEventListener("click", function () {
      askPin(!pinned);
    });
    paintPin();
    if (pinned) askPin(true);
  }

  /* -------------------------------------------------------------- focus chip */

  /* A focus session keeps counting while the user is on another section, so
     the header carries a live clock with a stop button. Stopping credits the
     whole minutes already spent. */
  var focusChip = null;
  var focusChipTime = null;
  var focusStopping = false;

  function buildFocusChip() {
    var right = document.querySelector(".chrome-right");
    if (!right) return;

    var wrap = document.createElement("div");
    wrap.id = "focus-chip";
    wrap.hidden = true;

    var dot = document.createElement("span");
    dot.className = "focus-chip-dot";
    dot.setAttribute("aria-hidden", "true");
    wrap.appendChild(dot);

    var time = document.createElement("button");
    time.type = "button";
    time.className = "focus-chip-time";
    time.addEventListener("click", function () {
      setView("timer");
      wakeClock();
    });
    wrap.appendChild(time);

    var stop = document.createElement("button");
    stop.type = "button";
    stop.className = "focus-chip-stop";
    stop.setAttribute("aria-label", "Stop focus session");
    stop.title = "Stop focus session";
    stop.innerHTML =
      '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">' +
      '<path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    stop.addEventListener("click", function () {
      stopFocus();
    });
    wrap.appendChild(stop);

    right.insertBefore(wrap, right.firstChild);
    focusChip = wrap;
    focusChipTime = time;
  }

  function paintFocusChip(snap) {
    if (!focusChip) return;
    var timer = (snap && snap.timer) || {};
    var on = Boolean(snap && snap.focusActive);
    focusChip.hidden = !on;
    focusChip.classList.toggle("paused", Boolean(on && timer.state === "paused"));
    if (!on) return;
    focusChipTime.textContent =
      String(timer.h || "00") + ":" + String(timer.m || "00") + ":" + String(timer.s || "00");
    var t = window.I18n ? window.I18n.t : function (s) { return s; };
    var label = t("Focus session") + " · " + t("Open timer");
    focusChipTime.title = label;
    focusChipTime.setAttribute("aria-label", label);
  }

  /** Whole seconds a running focus session has already used up. */
  function focusSpentSecs() {
    var snap = lastSnapshot;
    if (!snap || !snap.focusActive) return 0;
    var timer = snap.timer || {};
    var left =
      Number(timer.h || 0) * 3600 + Number(timer.m || 0) * 60 + Number(timer.s || 0);
    return Math.max(0, (Number(snap.focusSecs) || 0) - left);
  }

  function stopFocus() {
    if (focusStopping || !lastSnapshot || !lastSnapshot.focusActive) return;
    focusStopping = true;
    var minutes = Math.floor(focusSpentSecs() / 60);
    invoke("cancel_focus")
      .then(function (next) {
        if (next) render(next);
        var t = window.I18n ? window.I18n.t : function (s) { return s; };
        var message =
          minutes > 0
            ? t("Focus stopped") +
              " · " +
              window.I18n.count(minutes, "minute", "minutes") +
              " " +
              t("saved")
            : t("Focus session cancelled");
        window.Board.toast(message);
      })
      .catch(function (err) {
        console.error("flip: cancel_focus failed", err);
      })
      .then(function () {
        focusStopping = false;
      });
  }

  buildFocusChip();

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
    ["N", "New task"],
    ["Ctrl + 1 – 4", "Jump to a section"],
    ["?", "Show this list"],
  ];

  function openShortcuts() {
    var body = Board.el("div", "form-grid");
    body.appendChild(
      Board.el(
        "p",
        "shortcut-note",
        "F, F11, ?, N and Ctrl+1–4 work everywhere. The rest apply to the Timer."
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

  /* The open sync panel, if there is one, so a sync that happens on its own
     can paint into it and be heard without anything being pressed. */
  var syncSheet = null;

  function syncLabel(result) {
    var t = window.I18n ? window.I18n.t : function (s) { return s; };
    if (result && result.changed && result.name) {
      return t("Synced with") + " " + result.name + ".";
    }
    return t(String((result && result.message) || ""));
  }

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
    var theme =
      window.FlipThemes && window.FlipThemes.modeKnown(snap.theme) ? String(snap.theme) : "light";
    var palette = String(snap.palette || "");
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

    /* The mode and the palette move independently, so a palette keeps
       whatever base is chosen and the Light/Dark row always says which base
       the app is painted from. A new palette also brings its own accent hue,
       which the Accent section can still override afterwards. */
    function pickTheme(nextMode, nextPalette) {
      if (!window.FlipThemes) return;
      if (!window.FlipThemes.modeKnown(nextMode)) nextMode = "light";
      if (!window.FlipThemes.paletteOf(nextPalette)) nextPalette = "";
      if (nextMode === theme && nextPalette === palette) return;
      var paletteChanged = nextPalette !== palette;
      theme = nextMode;
      palette = nextPalette;
      applyTheme(theme, palette);
      paintThemes();
      var hue = paletteChanged ? window.FlipThemes.hueFor(palette) : null;
      if (hue !== null) {
        accentHue = hue;
        if (slider) slider.set(hue);
        markPresets(hue);
        pendingAccent = null;
        applyAccent(hue);
      }
      invoke("set_theme", { theme: theme })
        .then(function () {
          return invoke("set_palette", { palette: palette });
        })
        .then(function () {
          if (hue === null) return invoke("get_snapshot");
          return invoke("set_accent_hue", { hue: hue });
        })
        .then(render)
        .catch(function (err) {
          console.error("flip: set_theme failed", err);
        });
    }

    appearancePane.appendChild(Board.el("h3", "", "Mode"));

    var modeRow = Board.el("div", "seg theme-modes");
    modeRow.setAttribute("role", "group");
    modeRow.setAttribute("aria-label", "Theme mode");
    var modeButtons = [];
    (window.FlipThemes ? window.FlipThemes.modes : []).forEach(function (mode) {
      var button = Board.el("button", "seg-btn", mode[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", function () {
        pickTheme(mode[0], palette);
      });
      modeRow.appendChild(button);
      modeButtons.push({ name: mode[0], button: button });
      if (!mode[2]) return;
      button.title = mode[2];
    });
    appearancePane.appendChild(modeRow);
    appearancePane.appendChild(
      Board.el("p", "mode-note", "Every theme below follows this mode.")
    );

    appearancePane.appendChild(Board.el("h3", "", "Custom themes"));

    var grid = Board.el("div", "theme-grid theme-grid-custom");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Custom themes");
    var cards = [];
    var extraCards = [];
    var expanded = false;

    (window.FlipThemes ? window.FlipThemes.custom : []).forEach(function (choice, index) {
      var card = Board.el("button", "theme-card");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("data-theme-preview", choice.id);
      card.setAttribute("aria-checked", String(choice.id === palette));
      card.appendChild(themePreview());
      var name = Board.el("span", "theme-name");
      name.appendChild(Board.el("span", "theme-dot"));
      name.appendChild(Board.el("span", "", choice.name));
      card.appendChild(name);
      card.appendChild(Board.el("span", "theme-note", choice.note));
      card.addEventListener("click", function () {
        pickTheme(theme, choice.id);
      });
      /* Two palettes are on show; the rest wait behind View more themes. */
      if (index > 1) {
        card.hidden = true;
        extraCards.push(card);
      }
      grid.appendChild(card);
      cards.push({ name: choice.id, card: card });
    });
    appearancePane.appendChild(grid);

    var moreButton = Board.el("button", "btn small theme-more", "View more themes");
    moreButton.type = "button";
    moreButton.setAttribute("aria-expanded", "false");
    moreButton.addEventListener("click", function () {
      expanded = !expanded;
      extraCards.forEach(function (card) {
        card.hidden = !expanded;
      });
      moreButton.setAttribute("aria-expanded", String(expanded));
      moreButton.textContent = expanded ? "Show fewer themes" : "View more themes";
      /* The new row can land under the footer; keep the button in view. */
      moreButton.scrollIntoView({ block: "nearest" });
    });
    if (extraCards.length) appearancePane.appendChild(moreButton);

    function paintThemes() {
      modeButtons.forEach(function (entry) {
        var on = entry.name === theme;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-pressed", String(on));
      });
      cards.forEach(function (entry) {
        entry.card.setAttribute("aria-checked", String(entry.name === palette));
      });
    }
    paintThemes();

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

  /* ---------------------------------------------------------------- wi-fi sync */

  /* Pairing is a three-step handshake, in the shape of a phone-linking app:
     the Wi-Fi rule first, then the six digits, then a short animation while the
     two devices actually talk. A device address is never shown, only its code. */
  function openSync() {
    var t = window.I18n ? window.I18n.t : function (s) { return s; };
    var closed = false;
    var timers = [];
    var running = false;
    var autoTimer = 0;
    var lastCode = "";
    var stage = "verify";

    function wait(ms) {
      return new Promise(function (resolve) {
        timers.push(setTimeout(resolve, ms));
      });
    }

    function errText(err) {
      return String(err && err.message ? err.message : err);
    }

    var body = Board.el("div", "sync-sheet");
    body.dataset.dir = "fwd";

    var rail = Board.el("div", "sync-rail");
    var railSegs = [];
    for (var r = 0; r < 3; r++) {
      var seg = Board.el("span", "sync-rail-seg");
      seg.setAttribute("aria-hidden", "true");
      rail.appendChild(seg);
      railSegs.push(seg);
    }
    body.appendChild(rail);

    var steps = [];
    function addStep() {
      var section = Board.el("section", "sync-step");
      body.appendChild(section);
      steps.push(section);
      return section;
    }

    /* ---- step 1: the network, and the code to read out ---- */

    var stepOne = addStep();

    var art = Board.el("div", "sync-art");
    art.setAttribute("aria-hidden", "true");
    art.innerHTML =
      '<span class="sync-art-ring"></span><span class="sync-art-ring"></span>' +
      '<span class="sync-art-ring"></span><span class="sync-art-core">' +
      '<svg viewBox="0 0 24 24"><path d="M3.5 8.6a13 13 0 0 1 17 0"/>' +
      '<path d="M6.6 12.1a9 9 0 0 1 10.8 0"/><path d="M9.7 15.6a5 5 0 0 1 4.6 0"/>' +
      '<circle cx="12" cy="19" r="1.3"/></svg></span>';
    stepOne.appendChild(art);
    stepOne.appendChild(Board.el("h3", "sync-title", "Connect to the same Wi-Fi"));
    stepOne.appendChild(
      Board.el("p", "sub sync-lede", "Both devices need the same Wi-Fi. No internet, no account.")
    );

    var codeBlock = Board.el("div", "sync-code-block");
    codeBlock.appendChild(Board.el("span", "sync-code-label", "Your code"));
    var codeValue = Board.el("strong", "sync-code-value", "———");
    codeBlock.appendChild(codeValue);
    codeBlock.appendChild(
      Board.el("p", "sub", "Type it on your other device, with both apps open.")
    );
    stepOne.appendChild(codeBlock);

    var nextButton = Board.el("button", "btn primary sync-next", "I have the other code");
    nextButton.type = "button";
    stepOne.appendChild(nextButton);

    /* ---- step 2: the six digits ---- */

    var stepTwo = addStep();
    stepTwo.appendChild(Board.el("h3", "sync-title", "Enter their code"));
    stepTwo.appendChild(
      Board.el("p", "sub sync-lede", "Type the six digits shown on your other device.")
    );

    var otp = Board.el("div", "sync-otp");
    otp.setAttribute("role", "group");
    otp.setAttribute("aria-label", t("Pairing code"));
    var cells = [];
    for (var c = 0; c < 6; c++) {
      var cell = document.createElement("input");
      cell.type = "text";
      cell.className = "sync-otp-cell";
      cell.inputMode = "numeric";
      cell.maxLength = 1;
      cell.autocomplete = "one-time-code";
      cell.spellcheck = false;
      cells.push(cell);
      otp.appendChild(cell);
    }
    stepTwo.appendChild(otp);

    var line = Board.el("div", "sync-line");
    line.hidden = true;
    line.appendChild(Board.el("span", "sync-dot"));
    var lineText = Board.el("span", "sync-line-text", "");
    line.appendChild(lineText);
    stepTwo.appendChild(line);

    var actions = Board.el("div", "sync-actions");
    var backButton = Board.el("button", "btn small", "Back");
    backButton.type = "button";
    var goButton = Board.el("button", "btn primary", "Connect");
    goButton.type = "button";
    actions.appendChild(backButton);
    actions.appendChild(goButton);
    stepTwo.appendChild(actions);

    /* ---- step 3: verify, then copy ---- */

    var stepThree = addStep();
    var stageBox = Board.el("div", "sync-stage");
    stageBox.setAttribute("aria-hidden", "true");
    var spinner = Board.el("span", "sync-ring");
    var check = Board.el("div", "sync-check");
    check.innerHTML =
      '<svg viewBox="0 0 48 48"><circle class="sync-check-ring" cx="24" cy="24" r="21"/>' +
      '<path class="sync-check-mark" d="M15 25.2l6.4 6.4L33.6 18.8"/></svg>';
    var fail = Board.el("div", "sync-fail");
    fail.innerHTML =
      '<svg viewBox="0 0 48 48"><circle class="sync-check-ring" cx="24" cy="24" r="21"/>' +
      '<path class="sync-check-mark" d="M18 18l12 12M30 18L18 30"/></svg>';
    stageBox.appendChild(spinner);
    stageBox.appendChild(check);
    stageBox.appendChild(fail);
    stepThree.appendChild(stageBox);

    var stageTitle = Board.el("h3", "sync-title", "Verifying code");
    var stageText = Board.el("p", "sub sync-lede", "Talking to your other device…");
    stepThree.appendChild(stageTitle);
    stepThree.appendChild(stageText);

    var progress = Board.el("div", "sync-progress");
    var progressFill = Board.el("span", "sync-progress-fill");
    progress.appendChild(progressFill);
    stepThree.appendChild(progress);

    var retryButton = Board.el("button", "btn small sync-retry", "Try again");
    retryButton.type = "button";
    stepThree.appendChild(retryButton);

    var autoRow = Board.el("div", "setting-row sync-auto");
    var autoText = Board.el("div", "setting-text");
    autoText.appendChild(Board.el("div", "setting-title", "Sync automatically"));
    autoText.appendChild(
      Board.el("div", "sub", "Checks every few seconds while both apps are open.")
    );
    autoRow.appendChild(autoText);
    var autoSwitch = switchControl("Sync automatically", true, function (on) {
      if (!lastCode) return;
      invoke("set_pair_code", { code: lastCode, auto: on })
        .then(paint)
        .catch(function (err) {
          console.error("flip: set_pair_code failed", err);
        });
    });
    autoRow.appendChild(autoSwitch);
    stepThree.appendChild(autoRow);

    var current = 1;

    function goStep(n, silent) {
      if (closed) return;
      body.dataset.dir = n < current ? "back" : "fwd";
      current = n;
      steps.forEach(function (section, index) {
        section.classList.toggle("is-active", index + 1 === n);
      });
      railSegs.forEach(function (seg, index) {
        seg.classList.toggle("is-on", index + 1 <= n);
        seg.classList.toggle("is-now", index + 1 === n);
      });
      if (!silent) playSound("syncTick");
      if (n === 2) {
        timers.push(
          setTimeout(function () {
            if (closed) return;
            var target = cells[5];
            for (var i = 0; i < cells.length; i++) {
              if (!cells[i].value) {
                target = cells[i];
                break;
              }
            }
            target.focus({ preventScroll: true });
          }, 90)
        );
      }
    }

    function setStage(name, title, text) {
      stage = name;
      stepThree.classList.remove("is-verify", "is-connected", "is-sync", "is-done", "is-error");
      stepThree.classList.add("is-" + name);
      stageTitle.textContent = title;
      stageText.textContent = text;
    }

    function setLine(kind, message) {
      line.classList.remove("busy", "ok", "error");
      if (kind) line.classList.add(kind);
      lineText.textContent = message || "";
      line.hidden = !message;
    }

    function cellValue() {
      var digits = "";
      for (var i = 0; i < cells.length; i++) digits += cells[i].value.replace(/\D/g, "");
      return digits;
    }

    function fillOtp(code) {
      var digits = String(code || "").replace(/\D/g, "").slice(0, 6);
      for (var i = 0; i < cells.length; i++) {
        cells[i].value = digits.charAt(i) || "";
        cells[i].classList.toggle("is-filled", Boolean(cells[i].value));
      }
    }

    function paint(info) {
      if (!info) return info;
      var digits = String(info.code || "");
      codeValue.textContent = digits.replace(/^(\d{3})(\d{3})$/, "$1 $2") || "———";
      if (info.peerCode) lastCode = String(info.peerCode);
      if (typeof info.auto === "boolean") {
        autoSwitch.setAttribute("aria-checked", String(info.auto));
      }
      return info;
    }

    function finish(result) {
      var changed = Boolean(result && result.changed);
      progressFill.style.width = "100%";
      setStage("done", t("All set"), syncLabel(result));
      playSound(changed ? "syncDone" : "syncLink");
      if (changed) {
        window.Board.load().catch(function () {});
      }
    }

    function start() {
      var code = cellValue();
      if (code.length !== 6) {
        setLine("error", t("Type all six digits."));
        playSound("syncFail");
        return;
      }
      if (running || closed) return;
      running = true;
      clearTimeout(autoTimer);
      lastCode = code;
      setLine("", "");
      goButton.disabled = true;
      goStep(3);
      setStage("verify", t("Verifying code"), t("Talking to your other device…"));
      progressFill.style.width = "0%";
      playSound("syncStart");

      var result = null;
      var work = invoke("set_pair_code", { code: code, auto: null }).then(function (info) {
        paint(info);
        return invoke("sync_now");
      });

      /* The two devices really are quick; the pauses are what makes the steps
         readable instead of a flicker. */
      Promise.all([work, wait(900)])
        .then(function (out) {
          if (closed) return;
          result = out[0] || {};
          setStage("connected", t("Connected"), result.name || t("Your other device"));
          playSound("syncLink");
          return wait(620).then(function () {
            if (closed) return;
            setStage("sync", t("Syncing"), t("Moving your timetable and tasks…"));
            progressFill.style.width = "6%";
            requestAnimationFrame(function () {
              progressFill.style.width = "88%";
            });
            return wait(820);
          });
        })
        .then(function () {
          if (closed) return;
          finish(result || {});
        })
        .catch(function (err) {
          if (closed) return;
          setStage("error", t("Couldn't connect"), t(errText(err)));
          progressFill.style.width = "0%";
          playSound("syncFail");
        })
        .then(function () {
          running = false;
          goButton.disabled = false;
        });
    }

    /* ---- wiring ---- */

    nextButton.addEventListener("click", function () {
      goStep(2);
    });
    backButton.addEventListener("click", function () {
      goStep(1);
    });
    goButton.addEventListener("click", start);
    retryButton.addEventListener("click", function () {
      setLine("", "");
      progressFill.style.width = "0%";
      goStep(2);
    });

    cells.forEach(function (cell, index) {
      cell.addEventListener("input", function () {
        var digits = cell.value.replace(/\D/g, "");
        cell.value = digits.slice(-1);
        cell.classList.toggle("is-filled", Boolean(cell.value));
        if (!cell.value) return;
        if (index < 5) cells[index + 1].focus();
        if (cellValue().length === 6) {
          clearTimeout(autoTimer);
          autoTimer = setTimeout(start, 260);
        }
      });
      cell.addEventListener("keydown", function (event) {
        /* Correcting a digit must cancel the auto-start the last one queued. */
        if (event.key === "Backspace") clearTimeout(autoTimer);
        if (event.key === "Backspace" && !cell.value && index > 0) {
          event.preventDefault();
          cells[index - 1].value = "";
          cells[index - 1].classList.remove("is-filled");
          cells[index - 1].focus();
        } else if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          cells[index - 1].focus();
        } else if (event.key === "ArrowRight" && index < 5) {
          event.preventDefault();
          cells[index + 1].focus();
        } else if (event.key === "Enter") {
          event.preventDefault();
          start();
        }
      });
      cell.addEventListener("focus", function () {
        cell.select();
      });
    });

    otp.addEventListener("paste", function (event) {
      var clip = event.clipboardData || window.clipboardData;
      var digits = String((clip && clip.getData("text")) || "")
        .replace(/\D/g, "")
        .slice(0, 6);
      if (!digits) return;
      event.preventDefault();
      fillOtp(digits);
      if (digits.length === 6) start();
    });

    syncSheet = {
      show: function (result) {
        /* A background sync only speaks up when it actually moved something. */
        if (!result || !result.changed) return;
        window.Board.load().catch(function () {});
        if (stage === "done") {
          stageText.textContent = syncLabel(result);
          playSound("syncDone");
        }
      },
    };

    invoke("sync_info")
      .then(function (info) {
        if (closed) return;
        paint(info);
        if (info && info.peerCode) {
          lastCode = String(info.peerCode);
          fillOtp(lastCode);
        }
      })
      .catch(function (err) {
        console.error("flip: sync_info failed", err);
      });

    goStep(1, true);

    Board.modal({
      title: "Wi-Fi sync",
      body: body,
      saveLabel: "Done",
      hideCancel: true,
      className: "modal-sync",
      onSave: function () {},
      onClose: function () {
        closed = true;
        timers.forEach(clearTimeout);
        timers = [];
        clearTimeout(autoTimer);
        syncSheet = null;
      },
    });
  }

  var syncButton = document.getElementById("sync-btn");
  if (syncButton) syncButton.addEventListener("click", openSync);

  if (settingsButton) {
    settingsButton.addEventListener("click", openSettings);
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
    document.documentElement.setAttribute("data-wash", snap.wash === true ? "on" : "off");

    if (window.FlipTelemetry) window.FlipTelemetry.send(snap);
    lastSnapshot = snap;
    applyTheme(snap.theme, snap.palette);
    /* A preview inside the settings dialog wins until it is committed. */
    if (pendingAccent === null) applyAccent(snap.accentHue);

    var isClock = snap.mode === "clock";
    clockGroup.classList.toggle("active", isClock);
    timerGroup.classList.toggle("active", !isClock);
    modeIsClock = isClock;
    modeButtons.forEach(function (button) {
      var on = (button.dataset.mode === "clock") === isClock;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });

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
    paintFocusChip(snap);

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

  function rememberView(name) {
    try {
      window.localStorage.setItem("flip.view", name);
    } catch (_) {
      /* a refused store only costs the memory */
    }
  }

  function setView(name, fromHistory) {
    if (name === currentView) return;
    currentView = name;
    rememberView(name);
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
    if (name === "timetable" || name === "tasks") warmSections();
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

    if (!booting) playSound("tab");
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
      document.body.classList.remove("is-idle");
      setImmersive(false);
    } else {
      render(lastSnapshot);
      armCursorHide();
      wakeClock();
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
    syncStart: function () {
      tone(560, 0, 0.06, 0.035, "sine");
    },
    syncDone: function () {
      tone(660, 0, 0.08, 0.05, "sine");
      tone(990, 0.07, 0.15, 0.03, "sine");
    },
    syncFail: function () {
      tone(320, 0, 0.11, 0.035, "sine");
      tone(240, 0.09, 0.16, 0.028, "sine");
    },
    syncTick: function () {
      tone(600, 0, 0.045, 0.022, "sine");
    },
    syncLink: function () {
      tone(520, 0, 0.07, 0.04, "sine");
      tone(780, 0.06, 0.13, 0.03, "sine");
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

  /* The clock and the timer are the two screens worth watching from across a
     room, so their controls step aside after ten quiet seconds. Any tap on the
     stage - or any key - brings them straight back. */
  var idleTimeout = 0;
  var IDLE_MS = 10000;

  /* The system bars follow the controls: hidden while the clock is idle, back
     the moment anything is touched. Android only; the desktop call is a no-op. */
  var immersive = false;

  function setImmersive(on) {
    if (immersive === on) return;
    immersive = on;
    if (!ANDROID) return;
    invoke("set_immersive", { on: on }).catch(function (err) {
      console.error("flip: set_immersive failed", err);
    });
  }

  function wakeClock() {
    clearTimeout(idleTimeout);
    if (document.body.classList.contains("is-idle")) {
      document.body.classList.remove("is-idle");
    }
    setImmersive(false);
    idleTimeout = setTimeout(function () {
      if (currentView !== "timer") return;
      if (window.Board && window.Board.isModalOpen()) return;
      /* The portrait warning is a message, not the clock: it stays put. */
      if (document.documentElement.classList.contains("android-portrait")) return;
      document.body.classList.add("is-idle");
      setImmersive(true);
    }, IDLE_MS);
  }

  ["pointerdown", "mousedown", "touchstart", "mousemove", "keydown", "wheel"].forEach(
    function (name) {
      window.addEventListener(name, wakeClock, { passive: true });
    }
  );

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
      /* A phone has no cursor to hide, and this class also hides the timer
         tools - which are the only gear the timer has. The ten second idle
         rule below is what puts the phone's controls away. */
      if (currentView === "timer" && looksFullscreen() && !ANDROID) {
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
    if (window.Board && window.Board.isModalOpen()) return;
    if (isField(e.target)) return;

    /* Ctrl/Cmd + 1-4 jumps between the sections, like browser tabs. */
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      if (!e.repeat) setView(VIEW_ORDER[Number(e.key) - 1]);
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

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

    /* N is the short way to the New task button on the two task screens. */
    if (e.key.toLowerCase() === "n") {
      var newTask =
        currentView === "tasks"
          ? document.getElementById("new-task")
          : currentView === "dashboard"
            ? document.getElementById("dash-new-task")
            : null;
      if (newTask) {
        e.preventDefault();
        if (!e.repeat) newTask.click();
        return;
      }
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
      await listen("sync-status", function (event) {
        if (syncSheet) syncSheet.show(event.payload);
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
    stopFocus: stopFocus,
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

  /* Flip reopens on the section it was closed on. */
  var savedView = null;
  try {
    savedView = window.localStorage.getItem("flip.view");
  } catch (_) {
    savedView = null;
  }
  if (savedView && savedView !== currentView && VIEW_ORDER.indexOf(savedView) >= 0) {
    setView(savedView, true);
  }
  booting = false;

  /* The timetable and the task board are the two largest builds in the app and
     neither is on screen at launch, so they are built after the first frame.
     Board.on hands them whatever data has already arrived. */
  var sectionsReady = false;

  function warmSections() {
    if (sectionsReady) return;
    sectionsReady = true;
    window.Timetable.init();
    window.Tasks.init();
  }

  window.Board.load().catch(function (err) {
    console.error("flip: get_board failed", err);
  });

  start();

  if (window.requestIdleCallback) {
    window.requestIdleCallback(warmSections, { timeout: 600 });
  } else {
    setTimeout(warmSections, 16);
  }
})();
