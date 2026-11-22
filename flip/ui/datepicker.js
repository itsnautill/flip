/* Flip — themed date field.

   Chromium draws the calendar for <input type="date"> itself: a plain system
   popup that ignores the app's surfaces. This keeps the input (hidden) as the
   value in YYYY-MM-DD, so form code still reads `input.value`, and draws the
   calendar with the app's own tokens instead. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var CAL_PATH =
    "M7.5 3v3M16.5 3v3M4.5 9h15M6.5 5.5h11a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z";
  var CHEV_PATH = "m7 10 5 5 5-5";

  function t(key) {
    return window.I18n ? window.I18n.t(key) : key;
  }

  function lang() {
    return document.documentElement.getAttribute("lang") || "en";
  }

  /* Formatters are rebuilt only when the interface language changes. */
  var formatsCache = { lang: "" };
  function formats() {
    var code = lang();
    if (formatsCache.lang !== code) {
      formatsCache = {
        lang: code,
        month: new Intl.DateTimeFormat(code, { month: "long", year: "numeric" }),
        day: new Intl.DateTimeFormat(code, { weekday: "short", month: "short", day: "numeric" }),
        week: new Intl.DateTimeFormat(code, { weekday: "narrow" }),
        /* Vietnamese weeks start on Monday, English ones on Sunday. */
        start: code.toLowerCase().indexOf("vi") === 0 ? 1 : 0,
      };
    }
    return formatsCache;
  }

  function dateOf(key) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) ? Board.parseKey(key) : null;
  }

  function svgIcon(path, className) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    if (className) svg.setAttribute("class", className);
    var line = document.createElementNS(NS, "path");
    line.setAttribute("d", path);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "1.8");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);
    return svg;
  }

  var open = null;

  function closePop(refocus) {
    if (open) open.close(refocus);
  }

  /* ------------------------------------------------------------ picker */

  function show(input, display) {
    closePop();
    var f = formats();
    var today = Board.todayKey();
    var selected = dateOf(input.value);
    var focusKey = selected ? Board.keyOf(selected) : today;
    var view = selected
      ? new Date(selected.getFullYear(), selected.getMonth(), 1)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    var pop = document.createElement("div");
    pop.className = "date-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", t("Select date"));

    var head = document.createElement("div");
    head.className = "date-pop-head";
    var prev = document.createElement("button");
    prev.type = "button";
    prev.className = "date-nav";
    prev.setAttribute("aria-label", t("Previous month"));
    prev.appendChild(svgIcon("m14 6-6 6 6 6"));
    var title = document.createElement("div");
    title.className = "date-pop-title";
    var next = document.createElement("button");
    next.type = "button";
    next.className = "date-nav";
    next.setAttribute("aria-label", t("Next month"));
    next.appendChild(svgIcon("m10 6 6 6-6 6"));
    head.appendChild(prev);
    head.appendChild(title);
    head.appendChild(next);

    var week = document.createElement("div");
    week.className = "date-week";
    for (var w = 0; w < 7; w++) {
      var weekday = document.createElement("span");
      var sample = new Date(2024, 0, 7 + ((f.start + w) % 7)); /* a known Sunday */
      weekday.textContent = f.week.format(sample);
      week.appendChild(weekday);
    }

    var grid = document.createElement("div");
    grid.className = "date-grid";

    var foot = document.createElement("div");
    foot.className = "date-pop-foot";
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "date-link";
    clear.textContent = t("Clear");
    var todayButton = document.createElement("button");
    todayButton.type = "button";
    todayButton.className = "date-link";
    todayButton.textContent = t("Today");
    foot.appendChild(clear);
    foot.appendChild(todayButton);

    pop.appendChild(head);
    pop.appendChild(week);
    pop.appendChild(grid);
    pop.appendChild(foot);

    function paint() {
      title.textContent = f.month.format(view);
      grid.textContent = "";
      var first = new Date(view.getFullYear(), view.getMonth(), 1);
      var offset = (first.getDay() - f.start + 7) % 7;
      var start = new Date(first);
      start.setDate(1 - offset);
      var chosen = dateOf(input.value);
      var chosenKey = chosen ? Board.keyOf(chosen) : "";

      for (var i = 0; i < 42; i++) {
        var date = new Date(start);
        date.setDate(start.getDate() + i);
        var key = Board.keyOf(date);
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "date-day";
        cell.dataset.key = key;
        cell.textContent = String(date.getDate());
        if (date.getMonth() !== view.getMonth()) cell.classList.add("is-out");
        if (key === today) cell.classList.add("is-today");
        if (key === chosenKey) {
          cell.classList.add("is-selected");
          cell.setAttribute("aria-pressed", "true");
        }
        cell.addEventListener("click", function () {
          pick(this.dataset.key);
        });
        grid.appendChild(cell);
      }
    }

    function focusCell(key) {
      var cell = key ? grid.querySelector('[data-key="' + key + '"]') : null;
      if (!cell) cell = grid.querySelector(".date-day.is-selected") || grid.querySelector(".date-day.is-today");
      if (!cell) cell = grid.querySelector(".date-day");
      if (cell) {
        try {
          cell.focus({ preventScroll: true });
        } catch (_) {
          cell.focus();
        }
      }
    }

    function pick(key) {
      if (!key) return;
      input.value = key;
      close(true);
    }

    function step(delta) {
      var keep = dateOf(input.value) || new Date();
      view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
      var day = Math.min(keep.getDate(), 28);
      focusKey = Board.keyOf(new Date(view.getFullYear(), view.getMonth(), day));
      paint();
      title.textContent = f.month.format(view);
      focusCell(focusKey);
    }

    prev.addEventListener("click", function () {
      step(-1);
    });
    next.addEventListener("click", function () {
      step(1);
    });
    clear.addEventListener("click", function () {
      input.value = "";
      close(true);
    });
    todayButton.addEventListener("click", function () {
      pick(today);
    });

    /* Arrow keys walk the grid, across month boundaries too. */
    pop.addEventListener("keydown", function (event) {
      var stepDays = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (stepDays == null) return;
      var active = document.activeElement;
      var key = active && active.dataset ? active.dataset.key : "";
      if (!key) return;
      event.preventDefault();
      var target = Board.parseKey(key);
      target.setDate(target.getDate() + stepDays);
      var nextKey = Board.keyOf(target);
      if (target.getMonth() !== view.getMonth()) {
        view = new Date(target.getFullYear(), target.getMonth(), 1);
        paint();
        title.textContent = f.month.format(view);
      }
      focusCell(nextKey);
    });

    /* Escape and Tab are caught above the dialog's own handlers: window
       capture runs before the document capture the modal uses. */
    function onWindowKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (event.key !== "Tab") return;
      var items = Array.prototype.filter.call(pop.querySelectorAll("button"), function (node) {
        return node.offsetParent !== null;
      });
      if (!items.length) return;
      event.preventDefault();
      event.stopPropagation();
      var index = items.indexOf(document.activeElement);
      var stepBy = event.shiftKey ? -1 : 1;
      items[index < 0 ? 0 : (index + stepBy + items.length) % items.length].focus();
    }

    function onOutside(event) {
      if (pop.contains(event.target)) return;
      if (display.contains(event.target)) return;
      if (input.parentNode && input.parentNode.contains(event.target)) return;
      close(false);
    }

    function onClose() {
      close(false);
    }

    var api = { input: input, close: close };
    var observer = null;
    if (window.MutationObserver) {
      var root = document.getElementById("modal-root");
      if (root) {
        observer = new MutationObserver(function () {
          if (!root.children.length) close(false);
        });
        observer.observe(root, { childList: true });
      }
    }

    function close(refocus) {
      if (open !== api) return;
      open = null;
      window.removeEventListener("keydown", onWindowKey, true);
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
      if (observer) observer.disconnect();
      pop.remove();
      display.setAttribute("aria-expanded", "false");
      if (refocus) {
        try {
          display.focus({ preventScroll: true });
        } catch (_) {
          display.focus();
        }
      }
    }

    paint();
    display.setAttribute("aria-expanded", "true");
    document.body.appendChild(pop);

    /* Fixed coordinates: the modal body scrolls and clips its own children. */
    var rect = display.getBoundingClientRect();
    var width = pop.offsetWidth;
    var height = pop.offsetHeight;
    var left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    var top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";

    open = api;
    window.addEventListener("keydown", onWindowKey, true);
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    focusCell(focusKey);
  }

  /* ------------------------------------------------------------- fields */

  /**
   * Replaces a date input with a themed field. The input itself stays in the
   * form (hidden) and keeps being the value, so callers need no changes.
   */
  function dateField(input) {
    if (!input || input.dataset.flipDate) return input;
    input.dataset.flipDate = "1";
    input.type = "hidden";

    var wrap = document.createElement("div");
    wrap.className = "date-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "date-btn";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", t("Select date"));
    var label = document.createElement("span");
    label.className = "date-label";
    button.appendChild(svgIcon(CAL_PATH, "date-icon"));
    button.appendChild(label);
    button.appendChild(svgIcon(CHEV_PATH, "date-caret"));

    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "date-clear";
    clear.setAttribute("aria-label", t("Clear"));
    clear.appendChild(svgIcon("m6.5 6.5 11 11M17.5 6.5l-11 11", "date-clear-icon"));

    wrap.appendChild(button);
    wrap.appendChild(clear);

    /* The stored value is YYYY-MM-DD; the label is only its readable face, so
       a programmatic `input.value = ""` also updates what the user sees. */
    var stored = input.value || "";
    Object.defineProperty(input, "value", {
      configurable: true,
      get: function () {
        return stored;
      },
      set: function (next) {
        stored = next == null ? "" : String(next);
        paint();
      },
    });

    function paint() {
      var date = dateOf(stored);
      wrap.classList.toggle("is-empty", !date);
      label.textContent = date ? formats().day.format(date) : t("Select date");
      clear.hidden = !date;
    }

    button.addEventListener("click", function (event) {
      event.preventDefault();
      if (open && open.input === input) closePop(true);
      else show(input, button);
    });

    clear.addEventListener("click", function (event) {
      event.preventDefault();
      input.value = "";
      closePop();
      button.focus();
    });

    paint();
    return input;
  }

  window.Board = window.Board || {};
  Board.dateField = dateField;
})();
