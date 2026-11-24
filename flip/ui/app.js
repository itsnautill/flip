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

    /* A finished countdown goes into the study log too; this is the switch for
       it, remembered in settings so the next timer is set the same way. */
    var focusRow = Board.el("label", "check foot-check");
    var focusBox = document.createElement("input");
    focusBox.type = "checkbox";
    focusBox.checked = !lastSnapshot || lastSnapshot.timerFocus !== false;
    focusBox.addEventListener("change", function () {
      invoke("set_timer_focus", { enabled: focusBox.checked })
        .then(render)
        .catch(function (err) {
          focusBox.checked = !focusBox.checked;
          return String(err && err.message ? err.message : err);
        });
    });
    focusRow.appendChild(focusBox);
    focusRow.appendChild(Board.el("span", "", "Count as focus session"));

    Board.modal({
      title: "Set timer",
      body: body,
      saveLabel: "Set timer",
      footExtra: focusRow,
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

  /* Every cue the app can make, with the label the Sounds page shows. */
  var CUES = [
    ["chime", "Timer finished"],
    ["complete", "Task completed"],
    ["uncheck", "Task reopened"],
    ["start", "Timer starts"],
    ["pause", "Timer pauses"],
    ["reset", "Timer reset"],
    ["tab", "Switch sections"],
    ["dialog", "Dialog opens"],
    ["dismiss", "Dialog dismissed"],
    ["confirm", "Saved"],
    ["remove", "Deleted"],
    ["open", "App opens"],
    ["syncStart", "Sync starts"],
    ["syncTick", "Sync step"],
    ["syncLink", "Device connected"],
    ["syncDone", "Sync finishes"],
    ["syncFail", "Sync fails"],
  ];

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

  /* A miniature of the app for a theme card: a rail, a title and two rows of
     subject cards. It carries the palette's own data attributes, so the theme
     rules paint it from the palette's tokens instead of a hand-written swatch,
     and `data-theme` makes it show that palette in the base the app is in. */
  function themePreview(choice) {
    var mock = Board.el("span", "theme-mock");
    mock.setAttribute("aria-hidden", "true");
    mock.setAttribute("data-palette", choice.id);
    var rail = Board.el("span", "tm-rail");
    for (var i = 0; i < 3; i++) rail.appendChild(Board.el("i"));
    mock.appendChild(rail);
    var page = Board.el("span", "tm-page");
    page.appendChild(Board.el("i", "tm-title"));
    for (var row = 0; row < 2; row++) {
      var line = Board.el("span", "tm-row");
      for (var cell = 0; cell < 3; cell++) {
        line.appendChild(
          Board.el("i", "tm-cell" + (cell === (row ? 1 : 2) ? " tm-accent" : ""))
        );
      }
      page.appendChild(line);
    }
    mock.appendChild(page);
    return mock;
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

  /* Changing the interface language rebuilds every label in the app. Doing that
     in place left half of the screen in the old language until something else
     re-rendered it, so the page reloads instead: an overlay covers the swap and
     Settings reopens on the pane it was left on. */
  var LANG_REOPEN_KEY = "flip.reopenSettings";
  /* The reload that follows a language change is the app rebuilding itself, not
     a launch: it arrives without the opening cue and without a dialog sound. */
  var QUIET_BOOT_KEY = "flip.quietBoot";

  var quietBoot = false;
  try {
    quietBoot = window.sessionStorage.getItem(QUIET_BOOT_KEY) === "1";
    if (quietBoot) window.sessionStorage.removeItem(QUIET_BOOT_KEY);
  } catch (_) {
    /* private mode: every boot is a normal one */
  }

  function languageOverlay() {
    var root = document.getElementById("modal-root");
    if (!root) return null;
    Board.clear(root);
    var overlay = Board.el("div", "overlay lang-overlay");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-busy", "true");
    overlay.setAttribute("aria-label", "Applying language…");
    var card = Board.el("div", "lang-card");
    var ring = Board.el("span", "lang-ring");
    ring.setAttribute("aria-hidden", "true");
    card.appendChild(ring);
    card.appendChild(Board.el("div", "lang-title", "Applying language…"));
    card.appendChild(
      Board.el("div", "sub", "Flip will reopen Settings in a moment.")
    );
    overlay.appendChild(card);
    root.appendChild(overlay);
    return overlay;
  }

  /* Runs once after boot: the reload that follows a language change brings the
     settings dialog back where it was. */
  function reopenSettings() {
    var pane = null;
    try {
      pane = window.sessionStorage.getItem(LANG_REOPEN_KEY);
      if (pane) window.sessionStorage.removeItem(LANG_REOPEN_KEY);
    } catch (_) {
      /* private mode: nothing was stored, nothing to reopen */
      return;
    }
    if (pane) openSettings(pane, quietBoot);
  }

  function openSettings(startPane, silent) {
    var snap = lastSnapshot || {};
    var isTwelve = Boolean(snap.clock && snap.clock.is12h);
    var currentLang = String(snap.language || "en");
    var theme =
      window.FlipThemes && window.FlipThemes.modeKnown(snap.theme) ? String(snap.theme) : "light";
    var palette = String(snap.palette || "");
    var motion = String(snap.motion || "normal");
    var streakChoice = String(snap.streakEffects || "full");

    var body = Board.el("div", "settings");
    var nav = Board.el("nav", "settings-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-label", "Settings sections");

    /* One pill glides between the tabs; the buttons only carry their colour. */
    var navPill = Board.el("span", "settings-nav-pill");
    navPill.setAttribute("aria-hidden", "true");
    nav.appendChild(navPill);

    /* One pane per section, in the order people look for them: the everyday
       switches first, then looks, privacy, files and finally this copy. */
    var panes = {
      general: Board.el("div", "settings-pane"),
      appearance: Board.el("div", "settings-pane"),
      sounds: Board.el("div", "settings-pane"),
      privacy: Board.el("div", "settings-pane"),
      data: Board.el("div", "settings-pane"),
      about: Board.el("div", "settings-pane"),
    };
    var appearancePane = panes.appearance;
    var soundsPane = panes.sounds;
    var generalPane = panes.general;
    var privacyPane = panes.privacy;
    var dataPane = panes.data;
    var aboutPane = panes.about;
    var firstPane = panes[startPane] ? startPane : "general";
    Object.keys(panes).forEach(function (name) {
      panes[name].hidden = name !== firstPane;
    });

    var navButtons = [];
    [
      ["general", "General"],
      ["appearance", "Appearance"],
      ["sounds", "Sounds"],
      ["privacy", "Privacy"],
      ["data", "Data"],
      ["about", "About"],
    ].forEach(function (entry) {
      var on = entry[0] === firstPane;
      var button = Board.el("button", on ? "active" : "", entry[1]);
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(on));
      button.addEventListener("click", function () {
        showPane(entry[0]);
      });
      nav.appendChild(button);
      navButtons.push({ name: entry[0], button: button });
    });

    /* The highlight slides between tabs (Extra animates it; the other modes
       simply place it), so it is measured from the tab that is active now. */
    function movePill() {
      var active = null;
      navButtons.forEach(function (entry) {
        if (entry.button.classList.contains("active")) active = entry.button;
      });
      if (!active) return;
      navPill.style.width = active.offsetWidth + "px";
      navPill.style.height = active.offsetHeight + "px";
      navPill.style.transform =
        "translate(" + active.offsetLeft + "px, " + active.offsetTop + "px)";
      navPill.style.opacity = "1";
    }

    function showPane(which) {
      Object.keys(panes).forEach(function (name) {
        panes[name].hidden = name !== which;
      });
      navButtons.forEach(function (entry) {
        var on = entry.name === which;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-selected", String(on));
      });
      movePill();
      /* Only the pane scrolls, so this is the one and only scroll reset. */
      var pane = panes[which];
      if (pane) {
        pane.scrollTop = 0;
        /* Extra replays a short entrance; every other mode swaps instantly. */
        pane.classList.remove("pane-enter");
        void pane.offsetWidth;
        pane.classList.add("pane-enter");
      }
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

    /* A palette is a whole look that arrives with its own accent hue, so a
       custom accent colour has to let go of the palette first; otherwise the
       two keep repainting the same token and the app ends up half one, half
       the other. */
    function releasePalette() {
      if (!palette) return;
      palette = "";
      applyTheme(theme, "");
      paintThemes();
      invoke("set_palette", { palette: "" })
        .then(render)
        .catch(function (err) {
          console.error("flip: set_palette failed", err);
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
    appearancePane.appendChild(Board.el("h3", "", "Themes"));

    var grid = Board.el("div", "theme-grid theme-grid-custom");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Custom themes");
    var cards = [];

    /* All five palettes are on show. The old section hid three behind a button
       that sat below the fold, so "more" had to be scrolled to before it could
       be believed, and expanding it pushed a card under the dialog footer. */
    (window.FlipThemes ? window.FlipThemes.custom : []).forEach(function (choice) {
      var card = Board.el("button", "theme-card");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("data-theme-preview", choice.id);
      card.setAttribute("aria-checked", String(choice.id === palette));
      var preview = themePreview(choice);
      card.appendChild(preview);
      var name = Board.el("span", "theme-name");
      name.appendChild(Board.el("span", "theme-dot"));
      name.appendChild(Board.el("span", "theme-label", choice.name));
      name.appendChild(Board.el("span", "theme-check"));
      card.appendChild(name);
      card.addEventListener("click", function () {
        pickTheme(theme, choice.id);
      });
      grid.appendChild(card);
      cards.push({ name: choice.id, card: card, preview: preview });
    });
    appearancePane.appendChild(grid);

    /* The base can change while the dialog is open (the computer flips between
       light and dark), and every preview has to follow it. */
    function themeBase() {
      var painted = document.documentElement.getAttribute("data-theme") || "light";
      return painted.indexOf("dark") === 0 ? "dark" : "light";
    }

    function paintThemes() {
      var baseTheme = themeBase();
      modeButtons.forEach(function (entry) {
        var on = entry.name === theme;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-pressed", String(on));
      });
      cards.forEach(function (entry) {
        entry.card.setAttribute("aria-checked", String(entry.name === palette));
        entry.preview.setAttribute("data-theme", baseTheme);
      });
    }
    paintThemes();
    window.addEventListener("flip-theme", paintThemes);

    appearancePane.appendChild(Board.el("h3", "", "Accent"));

    /* One slider, no colour buttons: it reaches every accent there is and
       keeps the Appearance page a single short column. */
    var accentRow = Board.el("div", "setting-row column");
    var accentHue = window.FlipColor ? Number(snap.accentHue) || 258 : 258;

    var slider = window.FlipColor
      ? window.FlipColor.hueSlider({
          value: accentHue,
          label: "Custom accent hue",
          accent: true,
          onChange: function (hue) {
            releasePalette();
            accentHue = hue;
            /* Live paint without touching the disk until the drag settles. */
            pendingAccent = hue;
            applyAccent(hue);
          },
          onCommit: function (hue) {
            releasePalette();
            accentHue = hue;
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

    /* ---- sounds ---- */

    soundsPane.appendChild(Board.el("h3", "", "Volume"));

    var volumeRow = Board.el("div", "setting-row column");
    var volumeHead = Board.el("div", "setting-row");
    var volumeText = Board.el("div", "setting-text");
    volumeText.appendChild(Board.el("div", "setting-title", "Master volume"));
    volumeText.appendChild(
      Board.el("p", "sub", "Every interface sound plays at this level.")
    );
    volumeHead.appendChild(volumeText);
    var volumeValue = Board.el("span", "volume-value", Math.round(soundVolume) + "%");
    volumeHead.appendChild(volumeValue);
    volumeRow.appendChild(volumeHead);

    var volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.className = "volume-range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.step = "5";
    volumeInput.value = String(Math.round(soundVolume));
    volumeInput.setAttribute("aria-label", "Master volume");

    function paintVolume() {
      var pct = Math.round(Number(volumeInput.value));
      volumeValue.textContent = pct + "%";
      volumeInput.style.setProperty("--vol", pct + "%");
      volumeInput.setAttribute("aria-valuetext", pct + "%");
    }
    paintVolume();

    /* The drag is heard at once; only the released value reaches the disk. */
    volumeInput.addEventListener("input", function () {
      soundVolume = Number(volumeInput.value) || 0;
      paintVolume();
      applyVolume();
    });
    volumeInput.addEventListener("change", function () {
      invoke("set_sound_volume", { volume: Math.round(Number(volumeInput.value)) })
        .then(render)
        .catch(function (err) {
          console.error("flip: set_sound_volume failed", err);
        });
    });
    volumeRow.appendChild(volumeInput);
    soundsPane.appendChild(volumeRow);

    soundsPane.appendChild(
      settingRow(
        "Sound effects",
        switchControl("Sound effects", snap.sound !== false, function (on) {
          paintSoundsEnabled(on);
          soundOn = on;
          invoke("set_sound", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_sound failed", err);
            });
        }),
        "The master switch for every sound below."
      )
    );

    var belowMaster = Board.el("div", "sounds-below");

    var cueHead = Board.el("div", "cue-head");
    cueHead.appendChild(Board.el("h3", "", "Effects"));
    var cueActions = Board.el("div", "cue-actions");
    var selectAll = Board.el("button", "btn small", "Select all");
    var deselectAll = Board.el("button", "btn small", "Deselect all");
    selectAll.type = "button";
    deselectAll.type = "button";
    cueActions.appendChild(selectAll);
    cueActions.appendChild(deselectAll);
    cueHead.appendChild(cueActions);
    belowMaster.appendChild(cueHead);

    var cueGrid = Board.el("div", "cue-grid");
    var cueSwitches = [];
    CUES.forEach(function (entry) {
      var cueName = entry[0];
      var row = Board.el("div", "cue-row");
      row.appendChild(Board.el("span", "cue-name", entry[1]));
      var controls = Board.el("div", "cue-controls");
      /* The switch only says whether a cue fires on its own; hearing one should
         not depend on that, so the triangle plays it either way. */
      var preview = Board.el("button", "cue-preview");
      preview.type = "button";
      preview.setAttribute("aria-label", "Preview sound");
      preview.title = "Preview sound";
      preview.innerHTML =
        '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 1.8 10 6l-6.6 4.2z"/></svg>';
      preview.addEventListener("click", function () {
        ensureAudio();
        playSound(cueName, true);
      });
      controls.appendChild(preview);
      var button = switchControl(entry[1], !soundMuted[cueName], function (on) {
        if (on) delete soundMuted[cueName];
        else soundMuted[cueName] = true;
        /* Turning one back on plays it, so the choice can be heard. */
        if (on) {
          ensureAudio();
          playSound(cueName);
        }
        invoke("set_sound_cue", { name: cueName, enabled: on })
          .then(render)
          .catch(function (err) {
            console.error("flip: set_sound_cue failed", err);
          });
      });
      controls.appendChild(button);
      row.appendChild(controls);
      cueGrid.appendChild(row);
      cueSwitches.push({ name: cueName, button: button, preview: preview });
    });
    belowMaster.appendChild(cueGrid);
    soundsPane.appendChild(belowMaster);

    function setEveryCue(enabled) {
      cueSwitches.forEach(function (entry) {
        entry.button.setAttribute("aria-checked", String(enabled));
        if (enabled) delete soundMuted[entry.name];
        else soundMuted[entry.name] = true;
      });
      invoke("set_all_sound_cues", { enabled: enabled })
        .then(render)
        .catch(function (err) {
          console.error("flip: set_all_sound_cues failed", err);
        });
    }
    selectAll.addEventListener("click", function () {
      setEveryCue(true);
    });
    deselectAll.addEventListener("click", function () {
      setEveryCue(false);
    });

    /* With the master switch off the cue list is inert and visibly greyed. */
    function paintSoundsEnabled(on) {
      belowMaster.classList.toggle("is-off", !on);
      belowMaster.setAttribute("aria-disabled", String(!on));
      selectAll.disabled = !on;
      deselectAll.disabled = !on;
      cueSwitches.forEach(function (entry) {
        entry.button.disabled = !on;
        entry.preview.disabled = !on;
      });
    }
    paintSoundsEnabled(snap.sound !== false);

    /* ---- general ---- */

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
        "Streak effects",
        segControl(
          "Streak effects",
          [["full", "Full"], ["notification", "Notification"], ["none", "None"]],
          streakChoice,
          function (value) {
            streakChoice = value;
            invoke("set_streak_effects", { mode: value })
              .then(render)
              .catch(function (err) {
                console.error("flip: set_streak_effects failed", err);
              });
          }
        ),
        "What plays when your study streak grows."
      )
    );

    generalPane.appendChild(
      settingRow(
        "Language",
        segControl(
          "Language",
          [["en", "English"], ["vi", "Tiếng Việt"]],
          currentLang,
          function (value) {
            if (value === currentLang) return;
            /* The dialog will not be closed in the usual way, so an accent that
               is still only a preview is saved before the page reloads. */
            commitAccent();
            var overlay = languageOverlay();
            try {
              /* The page is about to rebuild itself, so the dialog is asked for
                 again on the other side of the reload. */
              window.sessionStorage.setItem(LANG_REOPEN_KEY, "general");
              window.sessionStorage.setItem(QUIET_BOOT_KEY, "1");
            } catch (_) {
              /* private mode: the language still changes, the dialog just closes */
            }
            invoke("set_language", { language: value })
              .then(function () {
                window.location.reload();
              })
              .catch(function (err) {
                console.error("flip: set_language failed", err);
                try {
                  window.sessionStorage.removeItem(LANG_REOPEN_KEY);
                  window.sessionStorage.removeItem(QUIET_BOOT_KEY);
                } catch (_) {
                  /* nothing to clean up */
                }
                if (overlay && overlay.parentNode) {
                  overlay.parentNode.removeChild(overlay);
                }
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

    generalPane.appendChild(
      settingRow(
        "Startup animation",
        switchControl("Startup animation", snap.startupAnim !== false, function (on) {
          try {
            window.localStorage.setItem("flip.startupAnim", on ? "on" : "off");
          } catch (_) {
            /* the backend keeps the choice even if storage refuses it */
          }
          invoke("set_startup_anim", { enabled: on })
            .then(render)
            .catch(function (err) {
              console.error("flip: set_startup_anim failed", err);
            });
        }),
        "Plays the opening animation when Flip starts."
      )
    );

    /* ---- what this build sends, and what it never sends ---- */

    privacyPane.appendChild(
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
    privacyPane.appendChild(telemetryRow);

    /* ---- this copy ---- */

    var updateBox = Board.el("div", "setting-row column");
    var updateText = Board.el("div", "setting-text");
    updateText.appendChild(Board.el("div", "setting-title", "Updates"));
    updateBox.appendChild(updateText);
    if (window.FlipUpdate) window.FlipUpdate.mount(updateBox);
    aboutPane.appendChild(updateBox);

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
    aboutPane.appendChild(setupRow);

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
    Object.keys(panes).forEach(function (name) {
      body.appendChild(panes[name]);
    });

    Board.modal({
      title: "Settings",
      body: body,
      saveLabel: "Done",
      hideCancel: true,
      /* Settings has one way out, the Done button, so that button speaks the
         dismissal the corner × used to. */
      hideClose: true,
      saveCue: "dismiss",
      className: "modal-settings",
      silent: silent === true,
      onSave: function () {
        commitAccent();
      },
      onClose: function () {
        window.removeEventListener("flip-theme", paintThemes);
        if (pendingAccent !== null) commitAccent(pendingAccent);
      },
    });

    /* Place the highlight once, before transitions exist, so the dialog opens
       with the pill already sitting on Appearance. */
    movePill();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        nav.classList.add("pill-ready");
      });
    });

    /* The dialog is built at the top; nothing here may scroll it. The tabs are
       deliberately not focused: the dialog already hands focus to its first
       field, and a second, programmatic focus drew a second ring around the
       active tab. */
    Object.keys(panes).forEach(function (name) {
      panes[name].scrollTop = 0;
    });
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

    /* ---- step 1: who is sending ---- */

    /* The first screen is the choice itself. It used to open on this device's
       code with a "I have the other code" button underneath, which never said
       which device was sending and which was receiving. */
    var stepOne = addStep();
    stepOne.appendChild(
      Board.el(
        "p",
        "sync-notice",
        "Make sure both devices are connected to the same network."
      )
    );

    function choiceButton(label, sub, onPick, primary) {
      var button = Board.el("button", "btn sync-choice-btn" + (primary ? " primary" : ""));
      button.type = "button";
      button.appendChild(Board.el("span", "sync-choice-label", label));
      button.appendChild(Board.el("span", "sync-choice-sub", sub));
      button.addEventListener("click", onPick);
      return button;
    }

    var choiceRow = Board.el("div", "sync-choice");
    var sendButton = choiceButton("Send", "Show this device's code", function () {
      goStep(2);
    }, true);
    var receiveButton = choiceButton("Receive", "Enter the other device's code", function () {
      goStep(3, false, true);
    }, false);
    choiceRow.appendChild(sendButton);
    choiceRow.appendChild(receiveButton);
    stepOne.appendChild(choiceRow);

    /* ---- step 2: this device sends its code ---- */

    var stepTwo = addStep();
    stepTwo.appendChild(Board.el("h3", "sync-title", "Your code"));
    stepTwo.appendChild(
      Board.el("p", "sub sync-lede", "Type this code on the other device.")
    );

    var codeBlock = Board.el("div", "sync-code-block");
    var codeValue = Board.el("strong", "sync-code-value", "———");
    codeBlock.appendChild(codeValue);
    stepTwo.appendChild(codeBlock);

    /* The other device pulls the data, so this side waits, then says what
       happened as soon as a sync lands. */
    var sendLine = Board.el("div", "sync-line busy");
    sendLine.appendChild(Board.el("span", "sync-dot"));
    var sendLineText = Board.el("span", "sync-line-text", "Waiting for your other device…");
    sendLine.appendChild(sendLineText);
    stepTwo.appendChild(sendLine);

    var sendActions = Board.el("div", "sync-actions");
    var sendBack = Board.el("button", "btn small", "Back");
    sendBack.type = "button";
    sendActions.appendChild(sendBack);
    stepTwo.appendChild(sendActions);

    /* ---- step 3: this device receives, with the six digits ---- */

    var stepReceive = addStep();
    stepReceive.appendChild(Board.el("h3", "sync-title", "Enter their code"));
    stepReceive.appendChild(
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
    stepReceive.appendChild(otp);

    var line = Board.el("div", "sync-line");
    line.hidden = true;
    line.appendChild(Board.el("span", "sync-dot"));
    var lineText = Board.el("span", "sync-line-text", "");
    line.appendChild(lineText);
    stepReceive.appendChild(line);

    var actions = Board.el("div", "sync-actions");
    var backButton = Board.el("button", "btn small", "Back");
    backButton.type = "button";
    var goButton = Board.el("button", "btn primary", "Connect");
    goButton.type = "button";
    actions.appendChild(backButton);
    actions.appendChild(goButton);
    stepReceive.appendChild(actions);

    /* ---- step 4: verify, then copy ---- */

    var stepResult = addStep();
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
    stepResult.appendChild(stageBox);

    var stageTitle = Board.el("h3", "sync-title", "Verifying code");
    var stageText = Board.el("p", "sub sync-lede", "Talking to your other device…");
    stepResult.appendChild(stageTitle);
    stepResult.appendChild(stageText);

    var progress = Board.el("div", "sync-progress");
    var progressFill = Board.el("span", "sync-progress-fill");
    progress.appendChild(progressFill);
    stepResult.appendChild(progress);

    var retryButton = Board.el("button", "btn small sync-retry", "Try again");
    retryButton.type = "button";
    stepResult.appendChild(retryButton);

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
    stepResult.appendChild(autoRow);

    var current = 1;

    function goStep(n, silent, fresh) {
      if (closed) return;
      /* Choosing Receive always starts from empty boxes: the code from the last
         pairing is last time's code, and a pre-filled row made it look as if
         something had already been typed. */
      if (n === 3 && fresh) fillOtp("");
      body.dataset.dir = n < current ? "back" : "fwd";
      current = n;
      steps.forEach(function (section, index) {
        section.classList.toggle("is-active", index + 1 === n);
      });
      /* Three marks for four screens: choosing a side, the code screen, then
         the copy itself. Send and Receive are the same middle beat. */
      var railAt = n <= 1 ? 1 : n === 4 ? 3 : 2;
      railSegs.forEach(function (seg, index) {
        seg.classList.toggle("is-on", index + 1 <= railAt);
        seg.classList.toggle("is-now", index + 1 === railAt);
      });
      if (!silent) playSound("syncTick");
      if (n === 3) {
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
      stepResult.classList.remove("is-verify", "is-connected", "is-sync", "is-done", "is-error");
      stepResult.classList.add("is-" + name);
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

    /* The sync status event can land right after the sheet has already said it
       is done, and the sheet speaks once for that moment. */
    var lastDoneAt = 0;

    function speakDone() {
      var now = window.performance.now();
      if (now - lastDoneAt < 1200) return;
      lastDoneAt = now;
      playSound("syncDone");
    }

    function finish(result) {
      var changed = Boolean(result && result.changed);
      progressFill.style.width = "100%";
      setStage("done", t("All set"), syncLabel(result));
      if (changed) speakDone();
      else playSound("syncLink");
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
      goStep(4);
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

    sendBack.addEventListener("click", function () {
      goStep(1);
    });
    backButton.addEventListener("click", function () {
      goStep(1);
    });
    goButton.addEventListener("click", start);
    retryButton.addEventListener("click", function () {
      setLine("", "");
      progressFill.style.width = "0%";
      goStep(3);
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
        var spoke = false;
        if (stage === "done") {
          stageText.textContent = syncLabel(result);
          spoke = true;
        }
        /* This device was showing its code and the other one just pulled. */
        if (current === 2) {
          sendLine.classList.remove("busy");
          sendLine.classList.add("ok");
          sendLineText.textContent = syncLabel(result);
          spoke = true;
        }
        /* One card, one sound: both branches above describe the same sync. */
        if (spoke) speakDone();
      },
    };

    invoke("sync_info")
      .then(function (info) {
        if (closed) return;
        paint(info);
        /* The remembered code only feeds the automatic check; the boxes stay
           empty for the next pairing. */
        if (info && info.peerCode) lastCode = String(info.peerCode);
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

  /* The toolbar icon read as refresh, so sync lives in Settings > Data now. */
  window.FlipSync = { open: openSync };

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
    var wasTimer = lastSnapshot && lastSnapshot.timer ? lastSnapshot.timer.state : null;
    soundOn = snap.sound !== false;
    soundVolume = typeof snap.soundVolume === "number" ? snap.soundVolume : 100;
    soundMuted = {};
    (snap.soundMuted || []).forEach(function (id) {
      soundMuted[id] = true;
    });
    applyVolume();
    streakMode = String(snap.streakEffects || "full");
    applyMotion(snap.motion);
    document.documentElement.setAttribute("data-wash", snap.wash === true ? "on" : "off");
    /* The opening animation starts before any snapshot arrives, so the choice
       is mirrored where the boot script can read it synchronously. */
    try {
      window.localStorage.setItem("flip.startupAnim", snap.startupAnim === false ? "off" : "on");
    } catch (_) {
      /* a refused store only means the next launch keeps the default */
    }

    if (window.FlipTelemetry) window.FlipTelemetry.send(snap);
    lastSnapshot = snap;
    /* Whatever started the countdown (button, Space, Enter), its state change
       is the one place that knows it began or paused. A reset has its own cue
       at the command, so it is left out here. */
    var nowTimer = snap.timer && snap.timer.state;
    if (wasTimer && nowTimer && nowTimer !== wasTimer) {
      if (nowTimer === "running") playSound("start");
      else if (nowTimer === "paused") playSound("pause");
    }
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
    if (command === "timer_reset") playSound("reset");
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
    layoutChrome();

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
    /* The label below the glyph is the styled tooltip, so the native one - which
       opens a second later and would cover it - is dropped the moment the
       pointer or the keyboard arrives. The attribute stays in the markup for
       anything that reads it before that; the name itself is the aria-label. */
    tab.addEventListener("pointerenter", function () {
      tab.removeAttribute("title");
    });
    tab.addEventListener("focus", function () {
      tab.removeAttribute("title");
    });
  });

  /* The selected section is one chip that travels between the four glyphs, like
     the settings list: the tabs stay transparent and only the glyph colour
     changes, so the row never moves and nothing reflows. */
  var tabsNav = document.getElementById("tabs");
  var tabsPill = document.getElementById("tabs-pill");

  function moveTabsPill() {
    if (!tabsNav || !tabsPill) return;
    var active = tabsNav.querySelector(".tab.active");
    if (!active) return;
    tabsPill.style.width = active.offsetWidth + "px";
    tabsPill.style.height = active.offsetHeight + "px";
    tabsPill.style.transform =
      "translate(" + active.offsetLeft + "px, " + active.offsetTop + "px)";
    tabsPill.style.opacity = "1";
    /* It only starts animating once it sits on the right tab, so the first paint
       never slides it in from the corner. */
    if (!tabsNav.classList.contains("pill-ready")) {
      requestAnimationFrame(function () {
        tabsNav.classList.add("pill-ready");
      });
    }
  }

  /* The page column is measured, not guessed, and it belongs to the app rather
     than to whichever section is showing: the clock has no title block and its
     own scrollbar, and reading the column there moved both pills. So the number
     is taken on a page that has a column (padding plus the reserved scrollbar
     gutter) and reused for every section until the window is resized. */
  var desktopNav = window.matchMedia("(min-width: 840px)");
  var chromeColumn = { left: 0, right: 0, padLeft: 22, padRight: 22, gutter: 0 };

  function columnOf(view) {
    var styles = getComputedStyle(view);
    var padLeft = parseFloat(styles.paddingLeft);
    var padRight = parseFloat(styles.paddingRight);
    if (isFinite(padLeft)) chromeColumn.padLeft = padLeft;
    if (isFinite(padRight)) chromeColumn.padRight = padRight;
    /* A scrolling page reserves this gutter even when it does not need it, so
       the clock's column lines up with the pages that do. */
    var gutter = view.offsetWidth - view.clientWidth;
    if (gutter > 0) chromeColumn.gutter = gutter;
    var width = (document.documentElement.clientWidth || window.innerWidth) - chromeColumn.gutter;
    var inner = width - chromeColumn.padLeft - chromeColumn.padRight;
    var column = Math.min(inner, 1400);
    var slack = Math.max(0, (inner - column) / 2);
    chromeColumn.left = Math.round(chromeColumn.padLeft + slack);
    chromeColumn.right = Math.round(chromeColumn.padRight + slack + chromeColumn.gutter);
  }

  function alignChrome() {
    var head = document.getElementById("chrome");
    var view = document.querySelector(".view.active");
    if (!head) return;
    if (!desktopNav.matches || !view) {
      head.style.paddingLeft = "";
      head.style.paddingRight = "";
      return;
    }
    if (view.querySelector(".view-head")) columnOf(view);
    if (!chromeColumn.left && !chromeColumn.right) return;
    head.style.paddingLeft = chromeColumn.left + "px";
    head.style.paddingRight = chromeColumn.right + "px";
  }

  function layoutChrome() {
    alignChrome();
    moveTabsPill();
  }

  layoutChrome();
  window.addEventListener("resize", layoutChrome);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutChrome);

  window.addEventListener("popstate", function (event) {
    /* A dialog or menu closing itself removes its own history entry with a
       back(); that pop is not a tab change, and used to leave the user on the
       wrong tab after pressing Done. */
    if (window.Board && window.Board.consumeSelfBack && window.Board.consumeSelfBack()) return;
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
  /* One gain stage in front of the speakers carries the master volume, so the
     slider moves every cue at once without touching each sound. */
  var master = null;
  var soundOn = true;
  var soundVolume = 100;
  var soundMuted = {};

  function volumeLevel() {
    var value = Math.max(0, Math.min(100, Number(soundVolume) || 0));
    return (value / 100) * 0.9;
  }

  function applyVolume() {
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(volumeLevel(), ctx.currentTime, 0.02);
  }

  function ensureAudio() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = volumeLevel();
        master.connect(ctx.destination);
      } catch (_) {
        ctx = null;
        master = null;
      }
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    primeSamples();
  }

  /* The cues ship as recordings in `sfx/`. Each is decoded once and kept, so
     the second play of a cue never touches the disk again. */
  var SOUND_FILES = {
    chime: "sfx/chime.wav",
    complete: "sfx/complete.wav",
    uncheck: "sfx/uncheck.wav",
    start: "sfx/start.wav",
    pause: "sfx/pause.wav",
    reset: "sfx/reset.wav",
    tab: "sfx/tab.wav",
    dialog: "sfx/dialog.wav",
    /* Its own recording: the Deleted clip belongs to removing something and
       to the toast, so sharing it made every close sound like a delete. */
    dismiss: "sfx/dismiss.wav",
    confirm: "sfx/confirm.wav",
    remove: "sfx/remove.wav",
    open: "sfx/open.wav",
    syncStart: "sfx/syncStart.wav",
    syncTick: "sfx/syncTick.wav",
    syncLink: "sfx/syncLink.wav",
    syncDone: "sfx/syncDone.wav",
    syncFail: "sfx/syncFail.wav",
    /* The two the opening animation adds: a soft pass as the halves leave and
       a tiny settle when they land. Both are recorded quiet on purpose. */
    launch: "sfx/launch.wav",
    snap: "sfx/snap.wav"
  };

  /* The recordings peak around -14 dBFS, below the old synthesis, so one fixed
     lift restores a normal level without disturbing the balance between cues. */
  var SAMPLE_GAIN = 2;

  var samples = {};

  function decodeSample(data) {
    return new Promise(function (resolve, reject) {
      /* Older Android webviews only understand the callback form. */
      var pending = ctx.decodeAudioData(data, resolve, reject);
      if (pending && typeof pending.then === "function") pending.then(resolve, reject);
    });
  }

  function loadSample(name) {
    if (samples[name]) return samples[name];
    var path = SOUND_FILES[name];
    if (!ctx || !path) return null;
    samples[name] = fetch(path)
      .then(function (res) {
        if (!res.ok) throw new Error("sfx " + name + " responded " + res.status);
        return res.arrayBuffer();
      })
      .then(decodeSample)
      .catch(function (err) {
        /* A cue that cannot load goes quiet; nothing else breaks. */
        console.error("flip: sound " + name + " failed", err);
        return null;
      });
    return samples[name];
  }

  /* Warm every cue as soon as the context exists, so the first press of a
     button is already decoded. */
  var priming = false;

  function primeSamples() {
    if (priming || !ctx) return;
    priming = true;
    Object.keys(SOUND_FILES).forEach(function (name) {
      loadSample(name);
    });
  }

  function playBuffer(buffer) {
    if (!ctx || !buffer) return;
    try {
      var source = ctx.createBufferSource();
      var level = ctx.createGain();
      source.buffer = buffer;
      level.gain.value = SAMPLE_GAIN;
      source.connect(level).connect(master || ctx.destination);
      source.start();
    } catch (_) {
      /* audio is a nicety; never let it break a click */
    }
  }

  function playSound(name, audition) {
    /* `audition` is the Settings preview: it plays even when that one cue is
       switched off, otherwise the preview would be a silent button. */
    if (!soundOn || (!audition && soundMuted[name]) || !SOUND_FILES[name]) return;
    ensureAudio();
    if (!ctx) return;
    var sample = loadSample(name);
    if (sample) sample.then(playBuffer);
    /* Tell the toast stack a cue just spoke for this moment. */
    if (window.Board && window.Board.noteCue) window.Board.noteCue();
  }

  /* The focus timer's own bell, still reachable under its old name. */
  function chime() {
    playSound("chime");
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

  /* ---- streak celebration ---------------------------------------------- */

  var streakMode = "full";
  var lastStreak = null;
  var streakCue = null;
  var streakCueTimer = 0;

  function closeStreakCue() {
    clearTimeout(streakCueTimer);
    if (!streakCue) return;
    var cue = streakCue;
    streakCue = null;
    cue.classList.add("is-closing");
    setTimeout(function () {
      if (cue.parentNode) cue.parentNode.removeChild(cue);
    }, 240);
  }

  /* The full cutscene: the flame lights, sparks fly and the count ticks up to
     the new streak. It leaves on its own, or on the first click. */
  function showStreakCue(count) {
    closeStreakCue();
    var cue = Board.el("div", "streak-cue");
    cue.setAttribute("role", "status");
    cue.setAttribute("aria-live", "polite");
    var card = Board.el("div", "streak-card");
    var flame = Board.el("span", "streak-flame");
    flame.innerHTML =
      '<svg viewBox="0 0 64 72" aria-hidden="true">' +
      '<path class="flame-outer" d="M32 2c2 10 10 14 12 24 2 9-2 17-6 21 1-9-3-14-8-17 1 9-3 13-6 16-4-5-6-10-6-16 0-9 7-14 14-28z"/>' +
      '<path class="flame-inner" d="M32 36c1 6 6 8 6 14a6 6 0 0 1-12 0c0-5 4-7 6-14z"/>' +
      "</svg>";
    var sparks = Board.el("span", "streak-sparks");
    for (var i = 0; i < 10; i++) {
      var spark = Board.el("i");
      var angle = -Math.PI / 2 + (i - 4.5) * 0.32;
      var distance = 52 + (i % 3) * 14;
      spark.style.setProperty("--x", Math.round(Math.cos(angle) * distance) + "px");
      spark.style.setProperty("--y", Math.round(Math.sin(angle) * distance) + "px");
      spark.style.setProperty("--delay", (i % 4) * 40 + "ms");
      sparks.appendChild(spark);
    }
    flame.appendChild(sparks);
    card.appendChild(flame);
    var number = Board.el("span", "streak-count", String(Math.max(1, count)));
    card.appendChild(number);
    card.appendChild(Board.el("span", "streak-label", "day streak"));
    cue.appendChild(card);
    cue.addEventListener("click", closeStreakCue);
    document.body.appendChild(cue);
    streakCue = cue;

    var from = Math.max(0, count - 1);
    var started = window.performance.now();
    function tick(now) {
      if (!streakCue) return;
      var progress = Math.min(1, (now - started) / 420);
      number.textContent = String(Math.round(from + (count - from) * progress));
      if (progress < 1) window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
    streakCueTimer = setTimeout(closeStreakCue, 2800);
  }

  function celebrateStreak(count) {
    if (streakMode === "none" || count < 1) return;
    if (streakMode === "notification") {
      var t = window.I18n ? window.I18n.t : function (s) { return s; };
      window.Board.toast(String(count) + " " + t("day streak"), { duration: 4200 });
      return;
    }
    showStreakCue(count);
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
    /* Reset is a timer action: on the clock face R would silently throw
       away a countdown the user cannot see. */
    if (key === "r") {
      if (!e.repeat && !modeIsClock) send("timer_reset");
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
      else reopenSettings();
    } catch (err) {
      console.error("flip: get_snapshot failed", err);
    }
    try {
      await listen("snapshot", function (event) {
        render(event.payload);
      });
      await listen("timer-finished", function () {
        pulse();
        playSound("chime");
        /* A run that was logged as study time says so through the
           focus-finished event, so only an uncounted run needs its own toast. */
        if (!lastSnapshot || (!lastSnapshot.focusActive && !lastSnapshot.timerFocus)) {
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

  /* Flip always opens on the Dashboard, whatever was on screen last time. */
  if (currentView !== "dashboard") setView("dashboard", true);
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

  /* A finished session reloads the board; when the run of study days grows,
     that is the moment to celebrate it. */
  window.Board.on(function (view) {
    var streak = view && view.focus ? Number(view.focus.streak) || 0 : 0;
    if (lastStreak === null) {
      lastStreak = streak;
      return;
    }
    if (streak > lastStreak) celebrateStreak(streak);
    lastStreak = streak;
  });

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
