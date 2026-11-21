/* Weekly timetable: blank until the user builds it, with a one-card setup, a
   quick add-subject sheet, brush painting, drag and drop, undo and a plain
   paste-from-spreadsheet import. */
(function () {
  "use strict";

  var grid = null;
  var setup = null;
  var brush = null;
  var weekend = null;
  var importButton = null;
  var fileInput = null;
  var undoButton = null;
  var redoButton = null;
  var lockButton = null;
  /* A locked timetable is read-only: every editing control is hidden and the
     click handlers below refuse to open an editor. */
  var locked = false;
  var lastView = null;
  var nowTimer = 0;

  /* What a click on an empty cell should do right now: paint, or paste a copy. */
  var brushSubject = null;
  var copySource = null;
  var drag = null;

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function nowMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function minutesOf(text) {
    var parts = String(text || "").split(":");
    var hours = Number(parts[0]);
    var mins = Number(parts[1]);
    if (!isFinite(hours) || !isFinite(mins)) return null;
    return hours * 60 + mins;
  }

  function clockOf(minutes) {
    var value = ((Math.round(minutes) % 1440) + 1440) % 1440;
    var h = Math.floor(value / 60);
    var m = value % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function colourOf(hue) {
    if (window.FlipColor) return window.FlipColor.subjectColorFromHue(hue);
    return { fill: "var(--panel-2)", text: "var(--ink)", border: "var(--accent)", badge: "var(--accent-soft)" };
  }

  function init() {
    grid = document.getElementById("tt-grid");
    brush = document.getElementById("tt-brush");
    weekend = document.getElementById("tt-weekend");
    importButton = document.getElementById("tt-import");
    fileInput = document.getElementById("tt-file");
    undoButton = document.getElementById("tt-undo");
    redoButton = document.getElementById("tt-redo");
    lockButton = document.getElementById("tt-lock");
    if (lockButton) {
      lockButton.addEventListener("click", function () {
        setLocked(!locked);
      });
    }

    setup = document.createElement("section");
    setup.className = "tt-setup";
    setup.id = "tt-setup";
    setup.hidden = true;
    grid.parentNode.insertBefore(setup, grid);

    weekend.addEventListener("change", function () {
      if (locked) {
        /* Nothing may move a locked timetable, not even this filter: the day
           list is data. Put the box back and offer the way out. */
        weekend.checked = !weekend.checked;
        lockedNotice();
        return;
      }
      Board.action({ kind: "setWeekend", show: weekend.checked });
    });

    document.getElementById("tt-add-period").addEventListener("click", function () {
      addRow();
    });

    buildImportMenu();

    var templateButton = document.getElementById("tt-template");
    if (templateButton) {
      templateButton.addEventListener("click", saveTemplate);
    }

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) importFile(file);
    });

    document.getElementById("tt-reset").addEventListener("click", function () {
      Board.confirm({
        title: "Reset timetable?",
        message:
          "This clears every day, every row and every subject. Your tasks are kept.",
        confirmLabel: "Reset timetable",
        onConfirm: function () {
          Board.action({ kind: "resetTimetable" }).then(function (ok) {
            if (ok) Board.toast("Timetable reset");
          });
        },
      });
    });

    if (undoButton) undoButton.addEventListener("click", stepBack);
    if (redoButton) redoButton.addEventListener("click", stepForward);

    document.addEventListener("keydown", onShortcut);
    window.addEventListener("resize", function () {
      Board.tooltip.hide();
      if (lastView) updateNow(lastView);
    });
    window.addEventListener("flip-theme", function () {
      if (lastView) render(lastView);
    });

    /* Midnight, or the next period, must not wait for a re-render. */
    nowTimer = window.setInterval(function () {
      if (lastView && !document.getElementById("timetable").hidden) updateNow(lastView);
    }, 30000);

    Board.initScroll();
    Board.on(render);
  }

  /* ------------------------------------------------------------- undo / redo */

  function stepBack() {
    if (draggingNow()) return;
    Board.undo();
  }

  function stepForward() {
    Board.redo();
  }

  function onShortcut(event) {
    if (Board.isModalOpen()) return;
    var view = document.getElementById("timetable");
    if (!view || view.hidden) return;
    var typing = /^(INPUT|TEXTAREA|SELECT)$/i.test(String(event.target.tagName || ""));
    if (typing) return;
    if (locked) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    var key = String(event.key).toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      stepBack();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      stepForward();
    }
  }

  /* --------------------------------------------------------------- structure */

  function addRow() {
    if (locked) {
      lockedNotice();
      return;
    }
    Board.action({ kind: "addPeriod" }).then(function (ok) {
      if (!ok) return;
      var view = Board.view();
      var period = view && view.periods[view.periods.length - 1];
      if (period) editPeriod(period);
    });
  }

  /* ---------------------------------------------------------- day headings */

  /** Rename, move or remove a column from one small menu on its heading. */
  function openDayMenu(anchor, day, days) {
    if (locked) return;
    var at = days.findIndex(function (item) {
      return item.key === day.key;
    });
    var items = [{ label: "Rename day", run: function () { renameDay(day); } }];
    if (at > 0) {
      items.push({ label: "Move left", run: function () { moveDay(day, -1); } });
    }
    if (at >= 0 && at < days.length - 1) {
      items.push({ label: "Move right", run: function () { moveDay(day, 1); } });
    }
    if (days.length > 1) {
      items.push({ label: "Remove day", danger: true, run: function () { removeDay(day, days); } });
    }
    Board.menu(anchor, items);
  }

  function renameDay(day) {
    var body = Board.el("div", "form-grid");
    body.appendChild(
      Board.el("p", "sub", "The weekday stays the same; only the heading changes.")
    );
    var field = Board.el("label", "field");
    field.appendChild(Board.el("span", "", "Day name"));
    var input = document.createElement("input");
    input.type = "text";
    input.maxLength = 24;
    input.value = day.label;
    input.placeholder = day.key;
    input.autocomplete = "off";
    field.appendChild(input);
    body.appendChild(field);
    Board.modal({
      title: "Rename day",
      body: body,
      saveLabel: "Save name",
      onSave: function () {
        return Board.action({ kind: "renameDay", day: day.key, label: input.value }).then(
          function (ok) {
            return ok ? null : "That name was not saved - check the message at the bottom.";
          }
        );
      },
    });
  }

  function moveDay(day, offset) {
    Board.action({ kind: "moveDay", day: day.key, offset: offset }).then(function (ok) {
      if (!ok || !grid) return;
      /* The header moves, so follow it with the focus instead of dropping it. */
      var moved = grid.querySelector('.tt-head-menu[data-day="' + day.key + '"]');
      if (moved) moved.focus({ preventScroll: true });
    });
  }

  function openAddDay() {
    var view = Board.view() || { days: [] };
    var chosen = {};
    var body = Board.el("div", "form-grid");
    body.appendChild(Board.el("p", "sub", "Pick the days this timetable runs on. You can change them later."));
    var chips = Board.el("div", "day-picker");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Days of the week");

    var buttons = DAY_NAMES.map(function (day) {
      var on = view.days.some(function (existing) {
        return existing.key === day;
      });
      var button = Board.el("button", "chip-btn" + (on ? " active" : ""), day);
      button.type = "button";
      button.setAttribute("aria-pressed", String(on));
      if (on) {
        button.disabled = true;
        button.title = "Already on the timetable";
      }
      button.addEventListener("click", function () {
        chosen[day] = !chosen[day];
        button.classList.toggle("active", chosen[day]);
        button.setAttribute("aria-pressed", String(Boolean(chosen[day])));
      });
      chips.appendChild(button);
      return button;
    });
    body.appendChild(chips);
    if (buttons.every(function (button) {
      return button.disabled;
    })) {
      body.appendChild(Board.el("p", "sub", "Every day is already on the timetable."));
    }

    Board.modal({
      title: "Add days",
      body: body,
      saveLabel: "Add days",
      onSave: function () {
        var wanted = DAY_NAMES.filter(function (day) {
          return chosen[day];
        });
        if (!wanted.length) return "Pick at least one day.";
        return wanted
          .reduce(function (chain, day) {
            return chain.then(function () {
              return Board.action({ kind: "addDay", day: day });
            });
          }, Promise.resolve(true))
          .then(function () {
            return null;
          });
      },
    });
  }

  /* ------------------------------------------------------------------ render */

  function render(view) {
    if (!view || !grid) return;
    lastView = view;
    /* Read once: the setup card, the brush strip and every handler below use
       this same value, so nothing has to be re-rendered afterwards. */
    locked = Boolean(view.locked);
    paintLock();
    var days = view.days || [];
    var periods = view.periods || [];
    var cells = view.cells || {};
    weekend.checked = Boolean(view.showWeekend);
    paintUndo(view);

    /* No days means no week to draw. A corner cell plus a placeholder column
       only pushed the first period into the header row, which looked broken;
       the setup card below is the honest answer until days exist. */
    if (!days.length) {
      grid.hidden = true;
      Board.clear(grid);
      renderSetup(view);
      renderBrush(view);
      return;
    }

    grid.hidden = false;
    grid.style.setProperty("--day-count", String(Math.max(1, days.length)));
    Board.clear(grid);

    var corner = Board.el("div", "tt-corner", "");
    corner.setAttribute("aria-hidden", "true");
    grid.appendChild(corner);

    days.forEach(function (day) {
      var head = Board.el("div", "tt-head" + (day.isToday ? " today" : ""), "");
      head.setAttribute("role", "columnheader");
      head.dataset.day = day.key;
      head.appendChild(Board.el("span", "tt-head-name", day.label));
      if (day.isToday) head.setAttribute("aria-label", day.label + " (today)");
      var more = Board.icon("Day options for " + day.label, "⋯", "tt-head-menu");
      more.dataset.day = day.key;
      more.addEventListener("click", function (event) {
        event.stopPropagation();
        openDayMenu(more, day, days);
      });
      head.appendChild(more);
      grid.appendChild(head);
    });

    var now = nowMinutes();
    var todayKey = null;
    days.forEach(function (day) {
      if (day.isToday) todayKey = day.key;
    });
    var nextId = null;
    if (todayKey) {
      periods.forEach(function (period) {
        if (nextId || period["break"] || view.currentPeriod === period.id) return;
        if (!cells[todayKey + "-" + period.id]) return;
        var start = minutesOf(period.start);
        if (start !== null && start > now) nextId = period.id;
      });
    }

    /* Stored labels are the backend's "Period N", which counts break rows too
       and so repeats a number in a day. Number the class rows only, at render
       time: a hand-written label is shown exactly, and the saved data is never
       touched. */
    var classNumber = 0;
    var labels = {};
    periods.forEach(function (period) {
      if (period["break"]) {
        labels[period.id] = period.label;
      } else {
        classNumber += 1;
        labels[period.id] = /^period\s+\d+$/i.test(String(period.label || ""))
          ? "Period " + classNumber
          : period.label;
      }
    });

    periods.forEach(function (period) {
      grid.appendChild(
        timeCell(period, labels[period.id], view.currentPeriod === period.id, period.id === nextId)
      );

      if (period["break"]) {
        var bar = Board.el(
          "div",
          "tt-break" + (view.currentPeriod === period.id ? " now" : ""),
          labels[period.id]
        );
        bar.style.gridColumn = "2 / span " + Math.max(1, days.length);
        grid.appendChild(bar);
        return;
      }

      days.forEach(function (day) {
        grid.appendChild(dayCell(view, day, period, labels[period.id]));
      });
    });

    grid.appendChild(addColumnCell());
    grid.appendChild(addRowCell(days.length));

    renderSetup(view);
    renderBrush(view);
  }

  /* ---------------------------------------------------------- lock / unlock */

  var LOCK_CLOSED =
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="7" width="10" height="6.5" rx="1.8"/>' +
    '<path d="M5.5 7V5.4a2.5 2.5 0 015 0V7"/></svg>';

  var LOCK_OPEN =
    '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="7" width="10" height="6.5" rx="1.8"/>' +
    '<path d="M5.5 7V5.4a2.5 2.5 0 015 0"/></svg>';

  function setLocked(next) {
    Board.action({ kind: "setLocked", locked: Boolean(next) });
  }

  /** Paints the read-only chrome. It never rebuilds a control: render() has
      already read `locked` before the grid, the brush and the setup card. */
  function paintLock() {
    var section = document.getElementById("timetable");
    if (section) section.classList.toggle("locked", locked);
    if (grid) grid.classList.toggle("locked", locked);

    ["tt-undo", "tt-redo", "tt-import", "tt-add-period", "tt-reset"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.hidden = locked;
    });

    /* The weekend toggle rewrites the day list, so it is an edit too. */
    if (weekend) {
      weekend.disabled = locked;
      weekend.title = locked ? "Unlock the timetable to change the days" : "";
      weekend.parentElement.classList.toggle("is-disabled", locked);
    }

    if (lockButton) {
      lockButton.setAttribute("aria-pressed", String(locked));
      lockButton.classList.toggle("active", locked);
      lockButton.innerHTML = locked ? LOCK_CLOSED : LOCK_OPEN;
      var label = locked ? "Unlock timetable" : "Lock timetable";
      lockButton.setAttribute("aria-label", label);
      lockButton.title = label;
    }
  }

  /** Nothing happens on a locked grid, but a way out is offered. */
  function lockedNotice() {
    Board.toast("Timetable is locked", "Unlock", function () {
      setLocked(false);
    });
  }

  function paintUndo(view) {
    var canUndo = Boolean(view && view.canUndo);
    var canRedo = Boolean(view && view.canRedo);
    if (undoButton) {
      undoButton.disabled = !canUndo;
      undoButton.setAttribute("aria-disabled", String(!canUndo));
    }
    if (redoButton) {
      redoButton.disabled = !canRedo;
      redoButton.setAttribute("aria-disabled", String(!canRedo));
    }
  }

  /** The quiet "+" after the last day, and the full-width row at the bottom. */
  function addColumnCell() {
    if (locked) return Board.el("div", "tt-add-col-wrap", "");
    var cell = Board.el("div", "tt-add-col-wrap");
    var button = Board.el("button", "tt-add-col", "+");
    button.type = "button";
    button.title = "Add a day";
    button.setAttribute("aria-label", "Add a day");
    button.addEventListener("click", openAddDay);
    cell.appendChild(button);
    return cell;
  }

  function addRowCell(dayCount) {
    if (locked) {
      var blank = Board.el("div", "tt-add-row-wrap", "");
      blank.style.gridColumn = "1 / span " + (Math.max(1, dayCount) + 1);
      return blank;
    }
    var wrap = Board.el("div", "tt-add-row-wrap");
    wrap.style.gridColumn = "1 / span " + (Math.max(1, dayCount) + 1);
    var button = Board.el("button", "tt-add-row", "+ Add row");
    button.type = "button";
    button.setAttribute("aria-label", "Add a time slot");
    button.addEventListener("click", addRow);
    wrap.appendChild(button);
    return wrap;
  }

  function needsSetup(view) {
    return !view.days.length || !view.periods.length;
  }

  /* --------------------------------------------------------- one-card setup */

  var setupDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  var setupPreset = "Mon-Fri";

  function renderSetup(view) {
    /* A dismissed setup card may stay hidden only once the week actually has
       days; an empty week always offers the way in. */
    if (locked || !needsSetup(view) || (view.setupDismissed && view.days.length)) {
      setup.hidden = true;
      return;
    }
    setup.hidden = false;
    Board.clear(setup);

    setup.appendChild(Board.el("h2", "setup-title", "Build your timetable"));
    setup.appendChild(
      Board.el("p", "sub", "One small form, then the whole week is ready. No subjects are added for you.")
    );

    var form = Board.el("div", "setup-form");

    /* ---- days ---- */
    var daysField = Board.el("div", "setup-block");
    daysField.appendChild(Board.el("span", "setup-label", "Days"));
    var presets = Board.el("div", "day-picker");
    presets.setAttribute("role", "group");
    presets.setAttribute("aria-label", "Days");
    [
      ["Mon-Fri", "Mon–Fri", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
      ["Mon-Sat", "Mon–Sat", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]],
      ["Mon-Sun", "Mon–Sun", DAY_NAMES.slice()],
      ["custom", "Custom", null],
    ].forEach(function (preset) {
      var button = Board.el("button", "chip-btn", preset[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", String(setupPreset === preset[0]));
      if (setupPreset === preset[0]) button.classList.add("active");
      button.addEventListener("click", function () {
        setupPreset = preset[0];
        if (preset[2]) setupDays = preset[2].slice();
        presets.querySelectorAll(".chip-btn").forEach(function (node) {
          var on = node === button;
          node.classList.toggle("active", on);
          node.setAttribute("aria-pressed", String(on));
        });
        custom.hidden = preset[0] !== "custom";
        updatePreview();
      });
      presets.appendChild(button);
    });
    daysField.appendChild(presets);

    var custom = Board.el("div", "day-picker day-picker-custom");
    custom.hidden = setupPreset !== "custom";
    DAY_NAMES.forEach(function (day) {
      var button = Board.el("button", "chip-btn" + (setupDays.indexOf(day) >= 0 ? " active" : ""), day);
      button.type = "button";
      button.setAttribute("aria-pressed", String(setupDays.indexOf(day) >= 0));
      button.addEventListener("click", function () {
        var at = setupDays.indexOf(day);
        if (at >= 0) setupDays.splice(at, 1);
        else setupDays.push(day);
        setupDays.sort(function (a, b) {
          return DAY_NAMES.indexOf(a) - DAY_NAMES.indexOf(b);
        });
        var on = setupDays.indexOf(day) >= 0;
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", String(on));
        updatePreview();
      });
      custom.appendChild(button);
    });
    daysField.appendChild(custom);
    form.appendChild(daysField);

    /* ---- times ---- */
    var times = Board.el("div", "setup-grid");
    var startInput = timeField(times, "First period starts at", "07:30");
    var periodInput = numberField(times, "Period length (minutes)", 45, 15, 180, 5);
    var breakInput = numberField(times, "Break between periods (minutes)", 5, 0, 120, 5);
    var countInput = numberField(times, "Number of periods", 8, 1, 16, 1);
    form.appendChild(times);

    var lunch = Board.el("div", "setup-lunch");
    var lunchToggle = Board.el("label", "check");
    var lunchInput = document.createElement("input");
    lunchInput.type = "checkbox";
    lunchToggle.appendChild(lunchInput);
    lunchToggle.appendChild(Board.el("span", "", "A longer break in the day"));
    lunch.appendChild(lunchToggle);
    var lunchRow = Board.el("div", "setup-grid setup-grid-lunch");
    lunchRow.hidden = true;
    var lunchAfter = numberField(lunchRow, "After period", 4, 1, 16, 1);
    var lunchMins = numberField(lunchRow, "Long break (minutes)", 30, 0, 180, 5);
    lunch.appendChild(lunchRow);
    lunchInput.addEventListener("change", function () {
      lunchRow.hidden = !lunchInput.checked;
      updatePreview();
    });
    form.appendChild(lunch);

    var preview = Board.el("p", "setup-preview");
    var actions = Board.el("div", "setup-actions");
    var create = Board.el("button", "btn primary", "Create grid");
    create.type = "button";
    var skip = Board.el("button", "btn", "I'll do it myself");
    skip.type = "button";
    actions.appendChild(create);
    actions.appendChild(skip);
    form.appendChild(actions);
    form.insertBefore(preview, actions);

    setup.appendChild(form);

    [startInput, periodInput, breakInput, countInput, lunchAfter, lunchMins].forEach(function (input) {
      input.addEventListener("input", updatePreview);
      input.addEventListener("change", updatePreview);
    });

    function read() {
      var minutes = Number(periodInput.value) || 45;
      var gap = Number(breakInput.value) || 0;
      var count = Math.max(1, Math.min(16, Number(countInput.value) || 1));
      var start = minutesOf(startInput.value);
      if (start === null) start = 7 * 60 + 30;
      var days = setupDays.slice();
      return {
        days: days,
        start: start,
        minutes: minutes,
        gap: gap,
        count: count,
        lunchAfter: lunchInput.checked ? Math.max(1, Math.min(count, Number(lunchAfter.value) || 1)) : null,
        lunchMins: Math.max(0, Math.min(180, Number(lunchMins.value) || 0)),
      };
    }

    function previewText(config) {
      var cursor = config.start;
      for (var i = 0; i < config.count; i++) {
        cursor += config.minutes;
        if (i + 1 < config.count) {
          cursor += config.gap;
          if (config.lunchAfter === i + 1) cursor += config.lunchMins;
        }
      }
      var dayCount = Math.max(1, config.days.length);
      return (
        dayCount +
        " days × " +
        config.count +
        " periods, " +
        clockOf(config.start) +
        "–" +
        clockOf(cursor)
      );
    }

    function updatePreview() {
      var config = read();
      preview.textContent = previewText(config);
      preview.classList.toggle("warn", config.days.length === 0);
    }

    create.addEventListener("click", function () {
      var config = read();
      if (!config.days.length) {
        Board.toast("Pick at least one day.");
        return;
      }
      create.disabled = true;
      Board.action({
        kind: "createGrid",
        days: config.days,
        start: clockOf(config.start),
        periodMins: config.minutes,
        breakMins: config.gap,
        count: config.count,
        longAfter: config.lunchAfter,
        longMins: config.lunchMins,
      }).then(function (ok) {
        create.disabled = false;
        if (!ok) return;
        Board.toast("Grid ready - tap a cell to add a subject");
      });
    });

    skip.addEventListener("click", function () {
      Board.action({ kind: "setSetup", dismissed: true });
    });

    updatePreview();
  }

  function timeField(parent, label, value) {
    var field = Board.el("label", "field");
    field.appendChild(Board.el("span", "", label));
    var input = document.createElement("input");
    input.type = "time";
    input.value = value;
    field.appendChild(input);
    parent.appendChild(field);
    return input;
  }

  function numberField(parent, label, value, min, max, step) {
    var field = Board.el("label", "field");
    field.appendChild(Board.el("span", "", label));
    var input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.inputMode = "numeric";
    field.appendChild(input);
    parent.appendChild(field);
    return input;
  }

  /* ------------------------------------------------------------ brush strip */

  function renderBrush(view) {
    if (!brush) return;
    if (locked) {
      brush.hidden = true;
      return;
    }
    var subjects = (view.subjects || []).filter(function (subject) {
      return subject.inTimetable;
    });
    if (!subjects.length) {
      brush.hidden = true;
      brushSubject = null;
      return;
    }
    brush.hidden = false;
    Board.clear(brush);
    brush.appendChild(Board.el("span", "brush-label", "Paint"));

    subjects.forEach(function (subject) {
      var colour = colourOf(subject.hue);
      var chip = Board.el("button", "brush-chip" + (brushSubject === subject.id ? " active" : ""));
      chip.type = "button";
      chip.style.setProperty("--subj", colour.mark);
      chip.style.setProperty("--subj-fill", colour.fill);
      chip.style.setProperty("--subj-edge", colour.edge);
      chip.style.setProperty("--subj-ink", colour.text);
      chip.textContent = subject.name;
      chip.setAttribute("aria-pressed", String(brushSubject === subject.id));
      chip.addEventListener("click", function () {
        brushSubject = brushSubject === subject.id ? null : subject.id;
        copySource = null;
        renderBrush(Board.view() || view);
      });
      brush.appendChild(chip);
    });

    if (brushSubject || copySource) {
      var stop = Board.el("button", "brush-stop", "Done");
      stop.type = "button";
      stop.addEventListener("click", function () {
        brushSubject = null;
        copySource = null;
        renderBrush(Board.view() || view);
      });
      brush.appendChild(stop);
    }
    grid.classList.toggle("painting", Boolean(brushSubject));
  }

  /* ------------------------------------------------------------------- cells */

  function timeCell(period, label, isNow, isNext) {
    var cell = Board.el("button", "tt-time" + (isNow ? " now" : "") + (isNext ? " next" : ""));
    cell.type = "button";
    cell.appendChild(Board.el("span", "tt-time-label", label));
    if (isNow) cell.appendChild(Board.el("span", "tt-flag", "Now"));
    else if (isNext) cell.appendChild(Board.el("span", "tt-flag ghost", "Next"));
    cell.appendChild(Board.el("span", "tt-time-range", period.start + " – " + period.end));
    cell.setAttribute(
      "aria-label",
      "Edit " + label + ", " + period.start + " to " + period.end
    );
    cell.addEventListener("click", function () {
      editPeriod(period);
    });
    return cell;
  }

  function dayCell(view, day, period, label) {
    var key = day.key + "-" + period.id;
    var cellView = view.cells[key];
    var cell = Board.el("div", "tt-cell");
    cell.setAttribute("role", "button");
    cell.tabIndex = -1;
    cell.dataset.day = day.key;
    cell.dataset.period = period.id;
    if (day.isToday) cell.classList.add("today");
    if (view.currentPeriod === period.id) cell.classList.add("now");

    if (!cellView) {
      cell.classList.add("empty");
      cell.setAttribute("aria-label", "Add a subject to " + day.label + " " + label);
      cell.appendChild(Board.el("span", "tt-plus", "+"));
      cell.addEventListener("click", function () {
        pickEmptyCell(day.key, period.id);
      });
      cell.addEventListener("keydown", function (event) {
        onCellKey(event, day.key, period.id, null);
      });
      wireDropTarget(cell, day.key, period.id);
      return cell;
    }

    var colour = colourOf(cellView.hue);
    cell.classList.add("filled");
    cell.dataset.subject = cellView.subjectId;
    cell.style.setProperty("--subj", colour.mark);
    cell.style.setProperty("--subj-fill", colour.fill);
    cell.style.setProperty("--subj-edge", colour.edge);
    cell.style.setProperty("--subj-badge", colour.badge);
    cell.style.setProperty("--subj-ink", colour.text);

    var top = Board.el("div", "tt-cell-top");
    top.appendChild(Board.el("span", "tt-name", cellView.name));

    if (cellView.pending > 0) {
      var dot = Board.el("span", "tt-dot");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Has pending tasks");
      dot.title = "Has pending tasks";
      top.appendChild(dot);
    }

    var menuButton = Board.icon("More for " + cellView.name, "⋯", "tt-menu-btn");
    menuButton.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
      '<circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" ' +
      'fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/></svg>';
    menuButton.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    menuButton.addEventListener("click", function (event) {
      event.stopPropagation();
      openCardMenu(menuButton, day.key, period.id, cellView);
    });
    top.appendChild(menuButton);
    cell.appendChild(top);

    if (cellView.room) cell.appendChild(Board.el("span", "tt-room", cellView.room));

    var description =
      cellView.name +
      (cellView.room ? ", " + cellView.room : "") +
      (cellView.pending > 0 ? ", " + cellView.pending + " pending task(s)" : "") +
      ". Open tasks.";
    cell.setAttribute("aria-label", label);
    cell.title = cellView.name + (cellView.room ? " · " + cellView.room : "");

    cell.addEventListener("click", function () {
      if (brushSubject || copySource) {
        pickEmptyCell(day.key, period.id);
        return;
      }
      if (window.Tasks) window.Tasks.openForSubject(cellView.subjectId, cellView.name);
    });
    cell.addEventListener("dblclick", function (event) {
      event.preventDefault();
      openCellEditor(day.key, period.id, cellView);
    });
    cell.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      openCardMenu(cell, day.key, period.id, cellView);
    });
    cell.addEventListener("keydown", function (event) {
      onCellKey(event, day.key, period.id, cellView);
    });

    wireDrag(cell, day.key, period.id, cellView);
    wireDropTarget(cell, day.key, period.id);
    Board.tooltip.bind(cell, cellView.subjectId);
    return cell;
  }

  /* A click on an empty cell: paint, paste, or open the add sheet. */
  function pickEmptyCell(day, periodId) {
    if (locked) {
      lockedNotice();
      return;
    }
    if (brushSubject) {
      Board.action({
        kind: "paintCells",
        subjectId: brushSubject,
        cells: [{ day: day, periodId: periodId }],
      });
      return;
    }
    if (copySource) {
      var source = copySource;
      copySource = null;
      renderBrush(Board.view() || lastView || { subjects: [] });
      Board.action({
        kind: "saveCellMany",
        day: day,
        periodId: periodId,
        name: source.name,
        hue: source.hue,
        room: source.room,
        also: [],
      }).then(function (ok) {
        if (ok) Board.toast("Copy placed");
      });
      return;
    }
    openCellEditor(day, periodId, null);
  }

  function onCellKey(event, day, periodId, cellView) {
    /* Arrows still move around a locked grid, but nothing can be changed. */
    if (locked && (event.key === "Enter" || event.key === " " || event.key === "Delete" || event.key === "Backspace")) {
      return;
    }
    var arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      moveFocus(day, periodId, arrows[event.key][0], arrows[event.key][1]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (cellView) openCellEditor(day, periodId, cellView);
      else pickEmptyCell(day, periodId);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (event.target.closest && event.target.closest("#tt-grid") && cellView) {
        event.preventDefault();
        clearCell(day, periodId);
      }
      return;
    }
    if ((event.key === "e" || event.key === "E" || event.key === "F2") && cellView) {
      event.preventDefault();
      openCellEditor(day, periodId, cellView);
    }
  }

  function moveFocus(day, periodId, rowStep, colStep) {
    var view = Board.view();
    if (!view) return;
    var days = view.days || [];
    var rows = (view.periods || []).filter(function (period) {
      return !period["break"];
    });
    var dayIndex = days.findIndex(function (entry) {
      return entry.key === day;
    });
    var rowIndex = rows.findIndex(function (entry) {
      return entry.id === periodId;
    });
    if (dayIndex < 0 || rowIndex < 0) return;
    var nextDay = Math.max(0, Math.min(days.length - 1, dayIndex + colStep));
    var nextRow = Math.max(0, Math.min(rows.length - 1, rowIndex + rowStep));
    var target = grid.querySelector(
      '.tt-cell[data-day="' + days[nextDay].key + '"][data-period="' + rows[nextRow].id + '"]'
    );
    if (target) {
      target.tabIndex = 0;
      target.focus({ preventScroll: false });
    }
  }

  /* ------------------------------------------------------- add / edit a cell */

  function dayChips(current, chosen) {
    var view = Board.view() || { days: [] };
    var row = Board.el("div", "day-picker day-picker-add");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Also add to");
    view.days.forEach(function (day) {
      if (day.key === current) return;
      var on = chosen.indexOf(day.key) >= 0;
      var chip = Board.el("button", "chip-btn" + (on ? " active" : ""), day.label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(on));
      chip.addEventListener("click", function () {
        var at = chosen.indexOf(day.key);
        if (at >= 0) chosen.splice(at, 1);
        else chosen.push(day.key);
        var now = chosen.indexOf(day.key) >= 0;
        chip.classList.toggle("active", now);
        chip.setAttribute("aria-pressed", String(now));
      });
      row.appendChild(chip);
    });
    return row;
  }

  function openCellEditor(day, periodId, cell) {
    if (locked) return;
    var view = Board.view();
    if (!view) return;

    var hues = view.subjects.map(function (subject) {
      return subject.hue;
    });
    var chosenDays = [];
    var selectedHue = cell ? cell.hue : window.FlipColor ? window.FlipColor.nextHue(hues) : 51;
    var body = Board.el("div", "form-grid cell-editor");

    var nameField = Board.el("label", "field");
    nameField.appendChild(Board.el("span", "", "Subject name"));
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.required = true;
    nameInput.value = cell ? cell.name : "";
    nameInput.placeholder = "Math";
    nameInput.autocomplete = "off";
    nameInput.setAttribute("autocapitalize", "words");
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    /* Suggestions from subjects already used, so "ma" offers Math instead of
       making a second one. */
    var suggestions = Board.el("div", "suggest-row");
    function paintSuggestions() {
      var typed = nameInput.value.trim().toLowerCase();
      Board.clear(suggestions);
      var names = view.subjects.filter(function (subject) {
        if (!typed) return false;
        return subject.name.toLowerCase().indexOf(typed) === 0 && subject.name.toLowerCase() !== typed;
      });
      if (!names.length) {
        suggestions.hidden = true;
        return;
      }
      suggestions.hidden = false;
      names.slice(0, 4).forEach(function (subject) {
        var chip = Board.el("button", "suggest-chip", subject.name);
        chip.type = "button";
        chip.addEventListener("click", function () {
          nameInput.value = subject.name;
          selectedHue = subject.hue;
          slider.set(selectedHue);
          suggestions.hidden = true;
        });
        suggestions.appendChild(chip);
      });
    }
    nameInput.addEventListener("input", paintSuggestions);
    body.appendChild(suggestions);

    var addDays = Board.el("div", "cell-days");
    addDays.appendChild(Board.el("span", "setting-title", "Also add to"));
    var dayPicker = dayChips(day, chosenDays);
    addDays.appendChild(dayPicker);
    if ((view.days || []).length > 2) {
      var everyDay = Board.el("button", "btn small ghost", "Same period, every day");
      everyDay.type = "button";
      everyDay.addEventListener("click", function () {
        chosenDays.length = 0;
        view.days.forEach(function (entry) {
          if (entry.key !== day) chosenDays.push(entry.key);
        });
        Board.clear(dayPicker);
        var refreshed = dayChips(day, chosenDays);
        addDays.replaceChild(refreshed, dayPicker);
        dayPicker = refreshed;
        /* Chips rebuilt with their state already on. */
        dayPicker.querySelectorAll(".chip-btn").forEach(function (chip, index) {
          var label = (view.days.filter(function (entry) {
            return entry.key !== day;
          })[index] || {}).key;
          chip.addEventListener("click", function () {
            var at = chosenDays.indexOf(label);
            if (at >= 0) chosenDays.splice(at, 1);
            else chosenDays.push(label);
            chip.classList.toggle("active", chosenDays.indexOf(label) >= 0);
            chip.setAttribute("aria-pressed", String(chosenDays.indexOf(label) >= 0));
          });
        });
      });
      addDays.appendChild(everyDay);
    }
    body.appendChild(addDays);

    var more = Board.el("details", "more-fields");
    var moreSummary = Board.el("summary", "", "More (room, colour)");
    more.appendChild(moreSummary);
    var roomField = Board.el("label", "field");
    roomField.appendChild(Board.el("span", "", "Room or teacher (optional)"));
    var roomInput = document.createElement("input");
    roomInput.type = "text";
    roomInput.maxLength = 40;
    roomInput.value = cell ? cell.room : "";
    roomInput.placeholder = "B12 · Ms Lane";
    roomField.appendChild(roomInput);
    more.appendChild(roomField);

    var hueField = Board.el("div", "field");
    var slider = window.FlipColor
      ? window.FlipColor.hueSlider({
          value: selectedHue,
          label: "Colour",
          onChange: function (hue) {
            selectedHue = hue;
          },
          onCommit: function (hue) {
            selectedHue = hue;
          },
        })
      : null;
    if (slider) hueField.appendChild(slider.element);
    more.appendChild(hueField);
    body.appendChild(more);

    Board.modal({
      title: cell ? "Edit subject" : "Add subject",
      body: body,
      saveLabel: "Save",
      className: "modal-sheet",
      onSave: function () {
        var name = nameInput.value.trim();
        if (!name) return "Subject name is required.";
        return Board.action({
          kind: "saveCellMany",
          day: day,
          periodId: periodId,
          name: name,
          hue: Number(selectedHue),
          room: roomInput.value,
          also: cell ? [] : chosenDays.slice(),
        }).then(function (ok) {
          if (!ok) return "Could not save that subject.";
          return null;
        });
      },
      onDelete: cell
        ? function () {
            clearCell(day, periodId);
            return true;
          }
        : null,
      deleteLabel: "Clear cell",
    });
    if (!cell) {
      nameInput.focus({ preventScroll: true });
    }
  }

  function clearCell(day, periodId) {
    Board.action({ kind: "clearCell", day: day, periodId: periodId }).then(function (ok) {
      if (!ok) return;
      Board.toast("Cell cleared", "Undo", stepBack);
    });
  }

  /* ------------------------------------------------------------- card menu */

  function openCardMenu(anchor, day, periodId, cell) {
    if (locked) return;
    var items = [
      { label: "Edit", run: function () { openCellEditor(day, periodId, cell); } },
      {
        label: "Duplicate",
        run: function () {
          copySource = { name: cell.name, room: cell.room, hue: cell.hue };
          brushSubject = null;
          Board.toast("Tap a cell to place a copy", "Cancel", function () {
            copySource = null;
            renderBrush(Board.view() || lastView || { subjects: [] });
          });
          renderBrush(Board.view() || lastView || { subjects: [] });
        },
      },
      { label: "Clear", run: function () { clearCell(day, periodId); } },
      {
        label: "Delete subject everywhere",
        danger: true,
        confirm: "Remove " + cell.name + " from the whole timetable?",
        run: function () {
          Board.action({ kind: "removeSubject", id: cell.subjectId }).then(function (ok) {
            if (ok) Board.toast(cell.name + " removed", "Undo", stepBack);
          });
        },
      },
    ];
    Board.menu(anchor, items);
  }

  /* -------------------------------------------------------------- drag/drop */

  function wireDrag(cell, day, periodId, cellView) {
    if (locked) return;
    cell.draggable = true;
    cell.addEventListener("dragstart", function (event) {
      drag = {
        day: day,
        period: periodId,
        copy: Boolean(event.ctrlKey || event.altKey || event.metaKey),
        name: cellView.name,
        room: cellView.room,
        hue: cellView.hue,
      };
      cell.classList.add("dragging");
      try {
        event.dataTransfer.setData("text/plain", cellView.name);
        event.dataTransfer.effectAllowed = "copyMove";
      } catch (_) {
        /* a webview without a data transfer still moves on drop */
      }
    });
    cell.addEventListener("dragend", function () {
      cell.classList.remove("dragging");
      clearDropMarks();
      drag = null;
    });

    /* Touch has no drag events: a long press lifts the card, then the finger
       paints a drop target under itself. */
    var pressTimer = 0;
    var lifted = false;
    cell.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "mouse") return;
      pressTimer = window.setTimeout(function () {
        lifted = true;
        drag = {
          day: day,
          period: periodId,
          copy: false,
          name: cellView.name,
          room: cellView.room,
          hue: cellView.hue,
        };
        cell.classList.add("lifted");
      }, 380);
    });
    cell.addEventListener("pointermove", function (event) {
      if (!lifted) {
        clearTimeout(pressTimer);
        return;
      }
      event.preventDefault();
      var under = document.elementFromPoint(event.clientX, event.clientY);
      clearDropMarks();
      var target = under && under.closest ? under.closest(".tt-cell") : null;
      if (target) target.classList.add("drop-target");
    });
    function endPress() {
      clearTimeout(pressTimer);
      if (!lifted) return;
      lifted = false;
      cell.classList.remove("lifted");
    }
    cell.addEventListener("pointerup", function (event) {
      if (!lifted) {
        clearTimeout(pressTimer);
        return;
      }
      var under = document.elementFromPoint(event.clientX, event.clientY);
      var target = under && under.closest ? under.closest(".tt-cell") : null;
      endPress();
      clearDropMarks();
      var moving = drag;
      drag = null;
      if (target && moving) dropInto(target, moving);
    });
    cell.addEventListener("pointercancel", function () {
      endPress();
      clearDropMarks();
      drag = null;
    });
  }

  function wireDropTarget(cell, day, periodId) {
    if (locked) return;
    cell.addEventListener("dragover", function (event) {
      if (!drag) return;
      event.preventDefault();
      cell.classList.add("drop-target");
    });
    cell.addEventListener("dragleave", function () {
      cell.classList.remove("drop-target");
    });
    cell.addEventListener("drop", function (event) {
      event.preventDefault();
      cell.classList.remove("drop-target");
      var moving = drag;
      drag = null;
      if (!moving) return;
      if (moving.copy || event.ctrlKey || event.altKey || event.metaKey) {
        Board.action({
          kind: "saveCellMany",
          day: day,
          periodId: periodId,
          name: moving.name,
          room: moving.room,
          hue: moving.hue,
          also: [],
        });
        return;
      }
      Board.action({
        kind: "moveCell",
        fromDay: moving.day,
        fromPeriod: moving.period,
        toDay: day,
        toPeriod: periodId,
      });
    });
  }

  function dropInto(target, moving) {
    Board.action({
      kind: "moveCell",
      fromDay: moving.day,
      fromPeriod: moving.period,
      toDay: target.dataset.day,
      toPeriod: target.dataset.period,
    });
  }

  function clearDropMarks() {
    grid.querySelectorAll(".drop-target").forEach(function (node) {
      node.classList.remove("drop-target");
    });
  }

  function draggingNow() {
    return Boolean(drag);
  }

  /* --------------------------------------------------------- row and columns */

  function removeDay(day, days) {
    var view = Board.view() || { cells: {} };
    var used = Object.keys(view.cells).filter(function (key) {
      return key.indexOf(day.key + "-") === 0;
    }).length;
    var doIt = function () {
      Board.action({ kind: "removeDay", day: day.key }).then(function (ok) {
        if (!ok) return;
        Board.toast(day.label + " removed", "Undo", stepBack);
      });
    };
    if (!used) {
      doIt();
      return;
    }
    Board.confirm({
      title: "Remove " + day.label + "?",
      message:
        used === 1
          ? "1 lesson on " + day.label + " will be removed."
          : used + " lessons on " + day.label + " will be removed.",
      confirmLabel: "Remove " + day.label,
      onConfirm: doIt,
    });
  }

  /* ------------------------------------------------------------ row editor */

  function editPeriod(period) {
    var view = Board.view() || { periods: [] };
    var rows = view.periods || [];
    var index = rows.findIndex(function (row) {
      return row.id === period.id;
    });
    var body = Board.el("div", "form-grid");

    var labelField = Board.el("label", "field");
    labelField.appendChild(Board.el("span", "", "Label"));
    var labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.maxLength = 24;
    labelInput.value = period.label;
    labelField.appendChild(labelInput);

    var times = Board.el("div", "form-row");
    var startField = Board.el("label", "field");
    startField.appendChild(Board.el("span", "", "Starts"));
    var startInput = document.createElement("input");
    startInput.type = "time";
    startInput.value = period.start;
    startField.appendChild(startInput);

    var endField = Board.el("label", "field");
    endField.appendChild(Board.el("span", "", "Ends"));
    var endInput = document.createElement("input");
    endInput.type = "time";
    endInput.value = period.end;
    endField.appendChild(endInput);
    times.appendChild(startField);
    times.appendChild(endField);

    var breakLabel = Board.el("label", "check");
    var breakInput = document.createElement("input");
    breakInput.type = "checkbox";
    breakInput.checked = Boolean(period["break"]);
    breakLabel.appendChild(breakInput);
    breakLabel.appendChild(Board.el("span", "", "Break row (no subjects)"));

    body.appendChild(labelField);
    body.appendChild(times);
    body.appendChild(breakLabel);

    var shiftLabel = Board.el("label", "check");
    var shiftInput = document.createElement("input");
    shiftInput.type = "checkbox";
    shiftLabel.appendChild(shiftInput);
    shiftLabel.appendChild(Board.el("span", "", "Move the rows after this one too"));
    if (rows.length > 1 && index < rows.length - 1) body.appendChild(shiftLabel);

    if (rows.length > 1) {
      var order = Board.el("div", "form-row");
      var up = Board.el("button", "btn small", "Move up");
      up.type = "button";
      up.disabled = index === 0;
      up.addEventListener("click", function () {
        Board.action({ kind: "movePeriod", id: period.id, offset: -1 });
        Board.closeModal();
      });
      var down = Board.el("button", "btn small", "Move down");
      down.type = "button";
      down.disabled = index === rows.length - 1;
      down.addEventListener("click", function () {
        Board.action({ kind: "movePeriod", id: period.id, offset: 1 });
        Board.closeModal();
      });
      order.appendChild(up);
      order.appendChild(down);
      body.appendChild(order);
    }

    Board.modal({
      title: "Edit row",
      body: body,
      saveLabel: "Save",
      onSave: function () {
        return Board.action({
          kind: "updatePeriod",
          id: period.id,
          label: labelInput.value,
          start: startInput.value,
          end: endInput.value,
          isBreak: breakInput.checked,
          shiftLater: shiftInput.checked,
        }).then(function (ok) {
          return ok ? null : "That time was not saved - check the message at the bottom.";
        });
      },
      onDelete: function () {
        var view = Board.view() || { cells: {} };
        var used = Object.keys(view.cells).filter(function (key) {
          return key.split("-").slice(1).join("-") === period.id;
        }).length;
        var doIt = function () {
          Board.action({ kind: "removePeriod", id: period.id }).then(function (ok) {
            if (ok) Board.toast("Row removed", "Undo", stepBack);
          });
        };
        /* Only worth interrupting when lessons would actually disappear. */
        if (used) {
          Board.confirm({
            title: "Remove " + period.label + "?",
            message:
              used === 1
                ? "1 lesson in this row will be removed."
                : used + " lessons in this row will be removed.",
            confirmLabel: "Remove row",
            onConfirm: doIt,
          });
        } else {
          doIt();
        }
        return true;
      },
      deleteLabel: "Remove row",
    });
  }

  /* -------------------------------------------------------------- import menu */

  var menu = null;
  var menuWrap = null;
  var menuOpen = false;

  function buildImportMenu() {
    menuWrap = Board.el("div", "menu-wrap");
    importButton.parentNode.insertBefore(menuWrap, importButton);
    menuWrap.appendChild(importButton);

    importButton.setAttribute("aria-haspopup", "menu");
    importButton.setAttribute("aria-expanded", "false");
    importButton.title = "Import a timetable";

    menu = Board.el("div", "menu");
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Import a timetable");

    var excel = Board.el("button", "menu-row", "Excel file (.xlsx)");
    excel.type = "button";
    excel.setAttribute("role", "menuitem");
    excel.addEventListener("click", function () {
      closeMenu();
      fileInput.value = "";
      fileInput.click();
    });
    menu.appendChild(excel);

    var paste = Board.el("button", "menu-row", "Paste from a spreadsheet");
    paste.type = "button";
    paste.setAttribute("role", "menuitem");
    paste.addEventListener("click", function () {
      closeMenu();
      openPasteImport();
    });
    menu.appendChild(paste);

    menuWrap.appendChild(menu);
    importButton.addEventListener("click", function (event) {
      event.stopPropagation();
      if (menuOpen) closeMenu();
      else openMenu();
    });
    menu.addEventListener("keydown", function (event) {
      var items = Array.prototype.slice.call(menu.querySelectorAll(".menu-row"));
      var index = items.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        var next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        importButton.focus();
      }
    });
    document.addEventListener("pointerdown", function (event) {
      if (menuOpen && !menuWrap.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", function (event) {
      if (menuOpen && event.key === "Escape") closeMenu();
    });
  }

  function openMenu() {
    menuOpen = true;
    menu.hidden = false;
    importButton.setAttribute("aria-expanded", "true");
    var first = menu.querySelector(".menu-row");
    if (first) first.focus();
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    menu.hidden = true;
    importButton.setAttribute("aria-expanded", "false");
  }

  /* ------------------------------------------------------ paste from a sheet */

  function openPasteImport() {
    var body = Board.el("div", "form-grid");
    body.appendChild(
      Board.el(
        "p",
        "sub",
        "Copy cells from Excel, Google Sheets or a web table and paste them here. The first row should be days and the first column times, or use Day, Start, End, Subject columns."
      )
    );
    var box = document.createElement("textarea");
    box.rows = 7;
    box.className = "paste-box";
    box.setAttribute("aria-label", "Pasted timetable");
    box.placeholder = "Mon\tTue\tWed\n07:30-08:15\tMath\tPhysics\tChemistry";
    body.appendChild(box);
    var error = Board.el("p", "form-error");
    error.hidden = true;
    body.appendChild(error);

    Board.modal({
      title: "Paste a timetable",
      body: body,
      saveLabel: "Read table",
      onSave: function () {
        var text = box.value;
        if (!text.trim()) return "Paste a table first.";
        error.hidden = true;
        return window.__TAURI__.core
          .invoke("read_timetable_table", { text: text })
          .then(function (parsed) {
            var view = Board.view() || {};
            var hasData = (view.days || []).length > 0 || Object.keys(view.cells || {}).length > 0;
            Board.closeModal();
            showPreview(parsed, hasData);
            return null;
          })
          .catch(function (err) {
            error.textContent = Board.errorText(err);
            error.hidden = false;
            return null;
          });
      },
    });
    box.focus({ preventScroll: true });
  }

  function showPreview(parsed, hasData) {
    var body = Board.el("div", "form-grid");
    body.appendChild(Board.el("p", "sub", "Nothing has changed yet."));
    body.appendChild(
      Board.el(
        "p",
        "import-count",
        parsed.days + " days, " + parsed.periods + " periods, " + parsed.subjects + " subjects"
      )
    );
    var rows = parsed.rows || [];
    var names = rows
      .map(function (row) {
        return row.subject;
      })
      .filter(function (name, index, all) {
        return all.indexOf(name) === index;
      });
    body.appendChild(Board.el("div", "import-names", names.slice(0, 12).join(", ") + (names.length > 12 ? "…" : "")));

    var merge = null;
    if (hasData) {
      merge = Board.el("button", "btn small", "Merge into the current timetable");
      merge.type = "button";
      merge.addEventListener("click", function () {
        applyParsed(rows, true);
      });
      body.appendChild(merge);
    }

    Board.modal({
      title: "Use this timetable?",
      body: body,
      saveLabel: hasData ? "Replace timetable" : "Add to timetable",
      onSave: function () {
        /* Returning the promise keeps the dialog open while it runs and lets a
           failure show its message instead of vanishing. */
        return applyParsed(rows, false);
      },
    });
  }

  function applyParsed(rows, merge) {
    return Board.action({ kind: "importTimetable", rows: rows, merge: Boolean(merge) }).then(
      function (ok) {
        if (ok) {
          Board.closeModal();
          Board.toast(merge ? "Timetable merged" : "Timetable imported");
        }
        return null;
      }
    );
  }

  /* ----------------------------------------------------------- xlsx import */

  var DAY_ALIASES = {};
  DAY_NAMES.forEach(function (name) {
    DAY_ALIASES[name.toLowerCase()] = name;
  });

  function normaliseDay(value) {
    if (typeof value === "number" && isFinite(value)) {
      var index = Math.round(value) - 1;
      return DAY_NAMES[((index % 7) + 7) % 7] || "";
    }
    var text = String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    return text ? DAY_ALIASES[text.slice(0, 3)] || "" : "";
  }

  /** Minutes since midnight, from an Excel time fraction or a typed time. */
  function parseClock(value) {
    if (typeof value === "number" && isFinite(value) && value >= 0) {
      if (value < 1) return Math.round(value * 1440) % 1440;
      var whole = Math.floor(value);
      if (whole <= 24) return Math.round((whole % 24) * 60 + (value - whole) * 60);
      return null;
    }
    var text = String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!text) return null;
    var match = text.match(/^(\d{1,2})\s*[:.h]\s*(\d{1,2})\s*([ap])\.?m\.?$/);
    if (!match) match = text.match(/^(\d{1,2})\s*[:.h]\s*(\d{1,2})$/);
    if (match) {
      var hours = Number(match[1]);
      var minutes = Number(match[2]);
      var suffix = match[3];
      if (suffix === "p" && hours < 12) hours += 12;
      if (suffix === "a" && hours === 12) hours = 0;
      if (hours > 23 || minutes > 59) return null;
      return hours * 60 + minutes;
    }
    var onlyHour = text.match(/^(\d{1,2})$/);
    if (onlyHour) {
      var hour = Number(onlyHour[1]);
      return hour <= 23 ? hour * 60 : null;
    }
    return null;
  }

  function cellText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return String(value);
    return String(value).trim().replace(/\s+/g, " ");
  }

  function headerKey(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }

  function lessonsFromRows(rows) {
    var columns = null;
    var headerRow = -1;
    for (var r = 0; r < Math.min(rows.length, 6) && !columns; r++) {
      var found = {};
      (rows[r] || []).forEach(function (value, index) {
        var key = headerKey(value);
        if (key === "day" || key === "weekday") found.day = index;
        else if (key === "start" || key === "starts" || key === "from") found.start = index;
        else if (key === "end" || key === "ends" || key === "to") found.end = index;
        else if (key === "subject" || key === "class" || key === "lesson") found.subject = index;
        else if (key === "room" || key === "teacher" || key === "location") found.room = index;
      });
      if (
        found.day !== undefined &&
        found.start !== undefined &&
        found.end !== undefined &&
        found.subject !== undefined
      ) {
        columns = found;
        headerRow = r;
      }
    }
    if (!columns) {
      // No header row: assume Day, Start, End, Subject, Room in columns A to E.
      columns = { day: 0, start: 1, end: 2, subject: 3, room: 4 };
    }

    var lessons = [];
    for (var row = headerRow + 1; row < rows.length; row++) {
      var values = rows[row] || [];
      var blank = values.every(function (value) {
        return cellText(value) === "";
      });
      if (blank) continue;

      var line = row + 1;
      var day = normaliseDay(values[columns.day]);
      if (!day) return { error: "Row " + line + ": the day must be Mon to Sun." };
      var subject = cellText(values[columns.subject]);
      if (!subject) return { error: "Row " + line + ": add a subject." };
      var start = parseClock(values[columns.start]);
      if (start === null) return { error: "Row " + line + ": the start time looks wrong." };
      var end = parseClock(values[columns.end]);
      if (end === null) return { error: "Row " + line + ": the end time looks wrong." };
      if (end <= start) return { error: "Row " + line + ": the end time is not after the start." };

      lessons.push({
        day: day,
        start: clockOf(start),
        end: clockOf(end),
        subject: subject,
        room: columns.room === undefined ? "" : cellText(values[columns.room]),
      });
    }

    if (!lessons.length) return { error: "That sheet has no lessons in it." };
    return { lessons: lessons };
  }

  function messageOf(err) {
    if (typeof err === "string" && err) return err;
    if (err && err.message) return err.message;
    return "That file could not be imported.";
  }

  function setBusy(busy) {
    if (!importButton) return;
    importButton.classList.toggle("is-busy", busy);
    importButton.disabled = busy;
    importButton.setAttribute("aria-busy", String(busy));
    fileInput.disabled = busy;
  }

  function importFile(file) {
    if (locked) {
      fileInput.value = "";
      lockedNotice();
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      Board.toast("Pick an .xlsx file.");
      return;
    }
    setBusy(true);
    file
      .arrayBuffer()
      .then(function (buffer) {
        return window.Xlsx.readSheetRows(buffer);
      })
      .then(function (rows) {
        var parsed = lessonsFromRows(rows);
        if (parsed.error) throw new Error(parsed.error);
        var view = Board.view() || {};
        var hasData = (view.days || []).length > 0 || Object.keys(view.cells || {}).length > 0;
        showPreview(
          {
            rows: parsed.lessons,
            days: parsed.lessons
              .map(function (row) {
                return row.day;
              })
              .filter(function (day, index, all) {
                return all.indexOf(day) === index;
              }).length,
            periods: parsed.lessons
              .map(function (row) {
                return row.start + row.end;
              })
              .filter(function (slot, index, all) {
                return all.indexOf(slot) === index;
              }).length,
            subjects: parsed.lessons
              .map(function (row) {
                return row.subject.toLowerCase();
              })
              .filter(function (name, index, all) {
                return all.indexOf(name) === index;
              }).length,
          },
          hasData
        );
      })
      .catch(function (err) {
        Board.toast(messageOf(err));
      })
      .then(function () {
        setBusy(false);
      });
  }

  function saveTemplate() {
    var bytes;
    try {
      bytes = window.Xlsx.buildTemplate();
    } catch (err) {
      Board.toast("The template could not be built.");
      return;
    }
    setBusy(true);
    window.__TAURI__.core
      .invoke("save_export", { name: "Flip timetable template.xlsx", bytes: Array.prototype.slice.call(bytes) })
      .then(function () {
        Board.toast("Template saved to Downloads");
      })
      .catch(function (err) {
        Board.toast(messageOf(err));
      })
      .then(function () {
        setBusy(false);
      });
  }

  /* --------------------------------------------------------------- today/now */

  /** Moves the "today" and "Now" marks without rebuilding the grid. */
  function updateNow(view) {
    if (!grid) return;
    var days = view.days || [];
    var minutes = nowMinutes();
    var todayKey = null;
    days.forEach(function (day) {
      if (day.isToday) todayKey = day.key;
    });
    var nowId = null;
    (view.periods || []).forEach(function (period) {
      var start = minutesOf(period.start);
      var end = minutesOf(period.end);
      if (start !== null && end !== null && minutes >= start && minutes < end) nowId = period.id;
    });
    grid.querySelectorAll(".tt-cell").forEach(function (cell) {
      cell.classList.toggle("today", Boolean(todayKey) && cell.dataset.day === todayKey);
      cell.classList.toggle("now", Boolean(nowId) && cell.dataset.period === nowId);
    });
    grid.querySelectorAll(".tt-head").forEach(function (head, index) {
      head.classList.toggle("today", Boolean(days[index]) && days[index].key === todayKey);
    });
    grid.querySelectorAll(".tt-time").forEach(function (cell) {
      var isNow = cell.dataset.period === nowId;
      cell.classList.toggle("now", isNow);
      var flag = cell.querySelector(".tt-flag");
      if (isNow && !flag) {
        cell.appendChild(Board.el("span", "tt-flag", "Now"));
      } else if (!isNow && flag && !flag.classList.contains("ghost")) {
        flag.remove();
      }
    });
  }

  window.Timetable = {
    init: init,
    lessonsFromRows: lessonsFromRows,
  };
})();
