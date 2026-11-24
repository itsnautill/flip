/* First-run setup.

   Four short steps, each one changing the app as you go rather than saving at
   the end. Rust remembers whether it has been seen, so it opens once and can be
   reopened from Settings.

   The wizard also remembers where it was: switching language reloads the page,
   and without that the setup used to close halfway through. */
(function () {
  "use strict";

  var invoke =
    window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;

  /* The wizard offers the three modes; the custom palettes live in Settings. */
  var THEMES = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];

  var STEP_KEY = "flip-setup-step";
  var OPEN_KEY = "flip-setup-open";

  var overlay = null;
  var stepIndex = 0;
  var steps = [];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function snapshot() {
    return invoke ? invoke("get_snapshot") : Promise.resolve({});
  }

  function apply(next) {
    if (window.Flip && next) window.Flip.apply(next);
  }

  function remember() {
    try {
      window.sessionStorage.setItem(STEP_KEY, String(stepIndex));
      window.sessionStorage.setItem(OPEN_KEY, "1");
    } catch (_) {
      /* private mode: the wizard still works, it just cannot resume */
    }
  }

  function forget() {
    try {
      window.sessionStorage.removeItem(STEP_KEY);
      window.sessionStorage.removeItem(OPEN_KEY);
    } catch (_) {
      /* nothing to clean up */
    }
  }

  function savedStep() {
    try {
      var raw = window.sessionStorage.getItem(OPEN_KEY);
      if (!raw) return 0;
      var value = parseInt(window.sessionStorage.getItem(STEP_KEY) || "0", 10);
      return value >= 0 && value < steps.length ? value : 0;
    } catch (_) {
      return 0;
    }
  }

  function finish(goToTimetable) {
    close();
    if (invoke) {
      invoke("set_onboarded", { done: true })
        .then(apply)
        .catch(function (err) {
          console.error("flip: set_onboarded failed", err);
        });
    }
    if (goToTimetable) {
      var tab = document.querySelector('.tab[data-view="timetable"]');
      if (tab) tab.click();
      if (window.Board) {
        window.Board.toast("Timetable is ready. Click any slot to add a subject.", {
          duration: 3000,
        });
      }
    }
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    forget();
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }

  /* ------------------------------------------------------------------ steps */

  /* The translator reads the table both ways, so the wizard switches language
     in place and never loses the step it is on. */
  function chooseLanguage(lang) {
    if (!invoke) return;
    remember();
    snapshot().then(function (snap) {
      if (((snap && snap.language) || "en") === lang) return;
      invoke("set_language", { language: lang })
        .then(function () {
          if (window.I18n) {
            window.I18n.setLanguage(lang);
            window.I18n.apply(document.body);
          }
        })
        .catch(function (err) {
          console.error("flip: set_language failed", err);
        });
    });
  }

  function languageStep() {
    var wrap = el("div", "setup-step");
    wrap.appendChild(el("p", "setup-kicker", "Welcome to Flip"));
    wrap.appendChild(el("h2", "setup-title", "Choose your language"));
    wrap.appendChild(el("p", "sub", "You can switch any time in Settings."));

    var row = el("div", "setup-control");
    row.appendChild(el("span", "setup-label", "Language"));
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Language");
    var buttons = [];

    function paint(current) {
      buttons.forEach(function (entry) {
        var on = entry.lang === current;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-pressed", String(on));
      });
    }

    [
      ["en", "English"],
      ["vi", "Tiếng Việt"],
    ].forEach(function (option) {
      var button = el("button", "seg-btn", option[1]);
      button.type = "button";
      button.addEventListener("click", function () {
        paint(option[0]);
        chooseLanguage(option[0]);
      });
      seg.appendChild(button);
      buttons.push({ lang: option[0], button: button });
    });

    row.appendChild(seg);
    wrap.appendChild(row);

    snapshot().then(function (snap) {
      paint((snap && snap.language) || "en");
    });

    return wrap;
  }

  function themePreview() {
    var box = el("div", "theme-preview");
    var bar = el("div", "tp-bar");
    for (var i = 0; i < 3; i++) bar.appendChild(el("i"));
    box.appendChild(bar);
    box.appendChild(el("div", "tp-head"));
    var row = el("div", "tp-body");
    var card = el("div", "tp-card");
    card.appendChild(el("i"));
    row.appendChild(card);
    row.appendChild(el("div", "tp-side"));
    box.appendChild(row);
    return box;
  }

  function themeGrid() {
    var grid = el("div", "theme-grid");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Theme");
    var cards = [];

    function paint(current) {
      cards.forEach(function (entry) {
        entry.card.setAttribute("aria-checked", String(entry.name === current));
      });
    }

    THEMES.forEach(function (option) {
      var card = el("button", "theme-card");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("data-theme-preview", option[0]);
      card.setAttribute("aria-checked", "false");
      card.appendChild(themePreview());
      var name = el("span", "theme-name");
      name.appendChild(el("span", "theme-dot"));
      name.appendChild(el("span", "", option[1]));
      card.appendChild(name);
      card.addEventListener("click", function () {
        paint(option[0]);
        /* Repaint before the round trip: the wizard is the first thing anyone
           sees, and waiting on the backend made a card look dead. */
        if (window.FlipThemes) {
          window.FlipThemes.paint(option[0], window.FlipThemes.saved()[1]);
        }
        invoke("set_theme", { theme: option[0] })
          .then(apply)
          .catch(function (err) {
            console.error("flip: set_theme failed", err);
          });
      });
      grid.appendChild(card);
      cards.push({ name: option[0], card: card });
    });

    snapshot().then(function (snap) {
      paint((snap && snap.theme) || "light");
    });

    return grid;
  }

  function lookStep() {
    var wrap = el("div", "setup-step");
    wrap.appendChild(el("p", "setup-kicker", "Step 2"));
    wrap.appendChild(el("h2", "setup-title", "Pick a look"));
    wrap.appendChild(el("p", "sub", "Change it later in Settings."));

    wrap.appendChild(themeGrid());

    /* The same one control Settings uses: a hue slider, no colour buttons. */
    var accentRow = el("div", "setup-control");
    accentRow.appendChild(el("span", "setup-label", "Accent"));
    var slider = null;
    if (window.FlipColor && window.FlipColor.hueSlider) {
      slider = window.FlipColor.hueSlider({
        value: 258,
        label: "Accent",
        accent: true,
        onChange: function (hue) {
          /* Painted now, saved when the drag settles. */
          window.FlipColor.applyAccent(hue);
        },
        onCommit: function (hue) {
          /* A palette owns the accent, so it lets go before the hue lands. */
          invoke("set_palette", { palette: "" })
            .then(function () {
              return invoke("set_accent_hue", { hue: hue });
            })
            .then(apply)
            .catch(function (err) {
              console.error("flip: set_accent_hue failed", err);
            });
        },
      });
      accentRow.appendChild(slider.element);
    }
    wrap.appendChild(accentRow);

    snapshot().then(function (snap) {
      if (slider && snap && typeof snap.accentHue === "number") slider.set(snap.accentHue);
    });

    return wrap;
  }

  function timetableStep() {
    var wrap = el("div", "setup-step");
    wrap.appendChild(el("p", "setup-kicker", "Step 3"));
    wrap.appendChild(el("h2", "setup-title", "Your timetable"));
    wrap.appendChild(
      el(
        "p",
        "sub",
        "Click any empty slot to add a subject, or import an .xlsx file if your school already gives you one."
      )
    );
    return wrap;
  }

  function doneStep() {
    var wrap = el("div", "setup-step");
    wrap.appendChild(el("p", "setup-kicker", "Done"));
    wrap.appendChild(el("h2", "setup-title", "You're all set"));
    wrap.appendChild(el("p", "sub", "Everything stays on this computer."));
    return wrap;
  }

  /* ------------------------------------------------------------------ paint */

  function render() {
    if (!overlay) return;
    var body = overlay.querySelector(".setup-body");
    var foot = overlay.querySelector(".setup-foot");
    body.textContent = "";
    foot.textContent = "";

    var step = steps[stepIndex];
    remember();
    body.appendChild(step.build());
    body.classList.remove("enter");
    void body.offsetWidth;
    body.classList.add("enter");

    renderFoot(foot, step);
  }

  function renderFoot(foot, step) {
    if (stepIndex > 0) {
      var back = el("button", "btn small", "Back");
      back.type = "button";
      back.addEventListener("click", function () {
        stepIndex -= 1;
        render();
      });
      foot.appendChild(back);
    }

    if (step.kind === "timetable") {
      var skip = el("button", "btn small", "Skip for now");
      skip.type = "button";
      skip.addEventListener("click", function () {
        stepIndex += 1;
        render();
      });
      foot.appendChild(skip);

      var open = el("button", "btn primary", "Open the timetable");
      open.type = "button";
      open.addEventListener("click", function () {
        finish(true);
      });
      foot.appendChild(open);
      return;
    }

    if (step.kind === "done") {
      var done = el("button", "btn primary", "Done");
      done.type = "button";
      done.addEventListener("click", function () {
        finish(false);
      });
      foot.appendChild(done);
      return;
    }

    var next = el("button", "btn primary", stepIndex === 0 ? "Get started" : "Continue");
    next.type = "button";
    next.addEventListener("click", function () {
      stepIndex += 1;
      render();
    });
    foot.appendChild(next);
  }

  function open(startAt) {
    if (overlay) return;
    steps = [
      { build: languageStep },
      { build: lookStep },
      { build: timetableStep, kind: "timetable" },
      { build: doneStep, kind: "done" },
    ];
    var wanted = startAt == null ? savedStep() : startAt;
    stepIndex = Math.min(Math.max(0, wanted), steps.length - 1);

    overlay = el("div", "overlay setup-overlay");
    var panel = el("div", "modal setup");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Setup");
    panel.appendChild(el("div", "modal-body setup-body"));
    panel.appendChild(el("div", "modal-foot setup-foot"));
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    render();
  }

  window.FlipSetup = {
    /* From Settings: always start from the beginning. */
    open: function () {
      open(0);
    },
    /* At startup: pick up where the last run stopped, if it stopped mid-way. */
    resume: function () {
      open(null);
    },
    close: close,
  };

  /* The app opens it on first run; this also picks the wizard back up after the
     reload that a language change causes. */
  document.addEventListener("DOMContentLoaded", function () {
    if (overlay) return;
    var flagged = false;
    try {
      flagged = window.sessionStorage.getItem(OPEN_KEY) === "1";
    } catch (_) {
      flagged = false;
    }
    snapshot().then(function (snap) {
      if (!snap || overlay) return;
      /* Reopened either because setup has never been finished (first run) or
         because a reload interrupted it, which is what changing language does. */
      if (!flagged && snap.onboarded !== false) return;
      open(savedStep());
    });
  });
})();
