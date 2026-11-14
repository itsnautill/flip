/* First-run setup.

   Four short steps, each one changing the app as you go rather than saving at
   the end. Rust remembers whether it has been seen, so it opens once and can be
   reopened from Settings. */
(function () {
  "use strict";

  var invoke =
    window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;

  var ACCENTS = ["#B4622D", "#B25C6B", "#4F7A5B", "#3F6E8C", "#6B5CA5", "#8A6A3B"];

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
    }
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }

  /* ------------------------------------------------------------------ steps */

  /* Vietnamese can be applied live; going back to English needs a reload so the
     already-translated nodes start from the source text again. */
  function chooseLanguage(lang) {
    if (!invoke) return;
    snapshot().then(function (snap) {
      if (((snap && snap.language) || "en") === lang) return;
      invoke("set_language", { language: lang })
        .then(function () {
          if (lang === "en") {
            location.reload();
            return;
          }
          if (window.I18n) {
            window.I18n.setLanguage("vi");
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

    [["en", "English"], ["vi", "Tiếng Việt"]].forEach(function (option) {
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

  function lookStep() {
    var wrap = el("div", "setup-step");
    wrap.appendChild(el("p", "setup-kicker", "Step 2"));
    wrap.appendChild(el("h2", "setup-title", "Pick a look"));
    wrap.appendChild(el("p", "sub", "Change it later in Settings - nothing here is permanent."));

    var themeRow = el("div", "setup-control");
    themeRow.appendChild(el("span", "setup-label", "Theme"));
    var themeSeg = el("div", "seg");
    themeSeg.setAttribute("role", "group");
    themeSeg.setAttribute("aria-label", "Theme");
    var themeButtons = [];

    function paintTheme(current) {
      themeButtons.forEach(function (entry) {
        var on = entry.name === current;
        entry.button.classList.toggle("active", on);
        entry.button.setAttribute("aria-pressed", String(on));
      });
    }

    [["beige", "Light"], ["dark", "Dark"]].forEach(function (option) {
      var button = el("button", "seg-btn", option[1]);
      button.type = "button";
      button.addEventListener("click", function () {
        snapshot().then(function (snap) {
          var current = (snap && snap.theme) || "beige";
          if (current === option[0]) return;
          invoke("toggle_theme")
            .then(function (next) {
              apply(next);
              paintTheme(next.theme);
            })
            .catch(function (err) {
              console.error("flip: toggle_theme failed", err);
            });
        });
      });
      themeSeg.appendChild(button);
      themeButtons.push({ name: option[0], button: button });
    });
    themeRow.appendChild(themeSeg);
    wrap.appendChild(themeRow);

    var accentRow = el("div", "setup-control");
    accentRow.appendChild(el("span", "setup-label", "Accent"));
    var swatches = el("div", "accent-swatches");
    swatches.setAttribute("role", "group");
    swatches.setAttribute("aria-label", "Accent colour");
    ACCENTS.forEach(function (hex) {
      var button = el("button", "accent-swatch");
      button.type = "button";
      button.style.setProperty("--sw", hex);
      button.setAttribute("aria-label", "Accent " + hex);
      button.addEventListener("click", function () {
        Array.prototype.forEach.call(swatches.children, function (node) {
          node.setAttribute("aria-pressed", String(node === button));
        });
        invoke("set_accent", { accent: hex })
          .then(apply)
          .catch(function (err) {
            console.error("flip: set_accent failed", err);
          });
      });
      swatches.appendChild(button);
    });
    accentRow.appendChild(swatches);
    wrap.appendChild(accentRow);

    snapshot().then(function (snap) {
      paintTheme((snap && snap.theme) || "beige");
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
    wrap.appendChild(el("p", "setup-kicker", "Last one"));
    wrap.appendChild(el("h2", "setup-title", "All set"));
    wrap.appendChild(
      el(
        "p",
        "sub",
        "Press ? for shortcuts. Click Flip in the top corner for the version. Run this again any time from Settings."
      )
    );
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
    body.appendChild(step.build());
    body.classList.remove("enter");
    void body.offsetWidth;
    body.classList.add("enter");

    if (stepIndex > 0) {
      var back = el("button", "btn small", "Back");
      back.type = "button";
      back.addEventListener("click", function () {
        stepIndex -= 1;
        render();
      });
      foot.appendChild(back);
    }

    if (step.finish) {
      var skip = el("button", "btn small", "Skip for now");
      skip.type = "button";
      skip.addEventListener("click", function () {
        finish(false);
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

    var next = el("button", "btn primary", stepIndex === 0 ? "Get started" : "Continue");
    next.type = "button";
    next.addEventListener("click", function () {
      if (stepIndex === steps.length - 1) {
        finish(false);
        return;
      }
      stepIndex += 1;
      render();
    });
    foot.appendChild(next);
  }

  function open() {
    if (overlay) return;
    steps = [
      { build: languageStep },
      { build: lookStep },
      { build: timetableStep, finish: true },
      { build: doneStep }
    ];
    stepIndex = 0;

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

  window.FlipSetup = { open: open, close: close };

  /* The app opens it on first run; this covers a reload mid-wizard. */
  document.addEventListener("DOMContentLoaded", function () {
    snapshot().then(function (snap) {
      if (snap && snap.onboarded === false && !overlay) open();
    });
  });
})();
