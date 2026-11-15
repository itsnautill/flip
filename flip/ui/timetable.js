/* Weekly timetable: editable subject cells, period times and break rows. */
(function () {
  "use strict";

  var grid = null;
  var empty = null;
  var weekend = null;
  var importButton = null;
  var fileInput = null;

  var EMPTY_TEXT = "No subjects yet - click a slot to add one.";

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

  function init() {
    grid = document.getElementById("tt-grid");
    weekend = document.getElementById("tt-weekend");
    importButton = document.getElementById("tt-import");
    fileInput = document.getElementById("tt-file");

    empty = document.createElement("p");
    empty.className = "empty";
    empty.id = "tt-empty";
    empty.textContent = EMPTY_TEXT;
    grid.parentNode.insertBefore(empty, grid);

    weekend.addEventListener("change", function () {
      Board.action({ kind: "setWeekend", show: weekend.checked });
    });

    document.getElementById("tt-add-period").addEventListener("click", function () {
      Board.action({ kind: "addPeriod" });
    });

    importButton.addEventListener("click", function () {
      fileInput.value = "";
      fileInput.click();
    });

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
          "This clears every subject, all period times and the weekend setting. Your tasks are kept.",
        confirmLabel: "Reset timetable",
        onConfirm: function () {
          Board.action({ kind: "resetTimetable" });
          Board.toast("Timetable reset");
        },
      });
    });

    window.addEventListener("resize", Board.tooltip.hide);
    Board.initScroll();
    Board.on(render);
  }

  /* ------------------------------------------------------------------ render */

  function render(view) {
    if (!view || !grid) return;
    var days = view.days;
    weekend.checked = view.showWeekend;
    grid.style.setProperty("--day-count", days.length);
    Board.clear(grid);

    var corner = Board.el("div", "tt-corner", "");
    corner.setAttribute("aria-hidden", "true");
    grid.appendChild(corner);

    days.forEach(function (day) {
      var head = Board.el("div", "tt-head" + (day.isToday ? " today" : ""), day.label);
      head.setAttribute("role", "columnheader");
      if (day.isToday) head.setAttribute("aria-label", day.label + " (today)");
      grid.appendChild(head);
    });

    /* The next lesson today, so the time column can say what comes after now. */
    var now = nowMinutes();
    var todayKey = null;
    days.forEach(function (day) {
      if (day.isToday) todayKey = day.key;
    });
    var nextId = null;
    if (todayKey) {
      view.periods.forEach(function (period) {
        if (nextId || period["break"] || view.currentPeriod === period.id) return;
        if (!view.cells[todayKey + "-" + period.id]) return;
        var start = minutesOf(period.start);
        if (start !== null && start > now) nextId = period.id;
      });
    }

    view.periods.forEach(function (period) {
      grid.appendChild(timeCell(period, view.currentPeriod === period.id, period.id === nextId));

      if (period["break"]) {
        var bar = Board.el(
          "div",
          "tt-break" + (view.currentPeriod === period.id ? " now" : ""),
          period.label + " · " + period.start + "–" + period.end
        );
        bar.style.gridColumn = "2 / span " + days.length;
        grid.appendChild(bar);
        return;
      }

      days.forEach(function (day) {
        grid.appendChild(dayCell(view, day, period));
      });
    });

    empty.hidden = Object.keys(view.cells).length > 0;
  }

  function timeCell(period, isNow, isNext) {
    var cell = Board.el("button", "tt-time" + (isNow ? " now" : "") + (isNext ? " next" : ""));
    cell.type = "button";
    cell.appendChild(Board.el("span", "tt-time-label", period.label));
    if (isNow) cell.appendChild(Board.el("span", "tt-flag", "Now"));
    else if (isNext) cell.appendChild(Board.el("span", "tt-flag ghost", "Next"));
    cell.appendChild(
      Board.el("span", "tt-time-range", period.start + " – " + period.end)
    );
    cell.setAttribute(
      "aria-label",
      "Edit " + period.label + ", " + period.start + " to " + period.end
    );
    cell.addEventListener("click", function () {
      editPeriod(period);
    });
    return cell;
  }

  function dayCell(view, day, period) {
    var key = day.key + "-" + period.id;
    var cellView = view.cells[key];
    var cell = Board.el("div", "tt-cell");
    cell.setAttribute("role", "button");
    cell.tabIndex = 0;
    cell.dataset.day = day.key;
    cell.dataset.period = period.id;
    if (day.isToday) cell.classList.add("today");
    if (view.currentPeriod === period.id) cell.classList.add("now");

    if (!cellView) {
      cell.classList.add("empty");
      cell.setAttribute("aria-label", "Add a subject to " + day.label + " " + period.label);
      cell.appendChild(Board.el("span", "tt-plus", "+"));
      cell.addEventListener("click", function () {
        editCell(day.key, period.id, null);
      });
      cell.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editCell(day.key, period.id, null);
        }
      });
      return cell;
    }

    cell.classList.add("filled");
    cell.dataset.subject = cellView.subjectId;
    cell.style.setProperty("--subj", cellView.color);

    var top = Board.el("div", "tt-cell-top");
    top.appendChild(Board.el("span", "tt-name", cellView.name));

    if (cellView.pending > 0) {
      var dot = Board.el("span", "tt-dot");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Has pending tasks");
      dot.title = "Has pending tasks";
      top.appendChild(dot);
    }

    var pencil = Board.icon("Rename " + cellView.name, "✎", "tt-edit");
    pencil.addEventListener("click", function (event) {
      event.stopPropagation();
      editCell(day.key, period.id, cellView);
    });
    top.appendChild(pencil);
    cell.appendChild(top);

    if (cellView.room) cell.appendChild(Board.el("span", "tt-room", cellView.room));

    var label =
      cellView.name +
      (cellView.room ? ", " + cellView.room : "") +
      (cellView.pending > 0 ? ", " + cellView.pending + " pending task(s)" : "") +
      ". Open tasks.";
    cell.setAttribute("aria-label", label);
    cell.title = cellView.name;

    cell.addEventListener("click", function () {
      if (window.Tasks) window.Tasks.openForSubject(cellView.subjectId, cellView.name);
    });
    cell.addEventListener("dblclick", function (event) {
      event.preventDefault();
      editCell(day.key, period.id, cellView);
    });
    cell.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (window.Tasks) window.Tasks.openForSubject(cellView.subjectId, cellView.name);
      } else if (event.key === "e" || event.key === "E" || event.key === "F2") {
        event.preventDefault();
        editCell(day.key, period.id, cellView);
      }
    });

    Board.tooltip.bind(cell, cellView.subjectId);
    return cell;
  }

  /* ------------------------------------------------------------ subject editor */

  function editCell(day, periodId, cell) {
    var view = Board.view();
    if (!view) return;

    var colors = view.colors || [];
    var color = cell ? cell.color : colors[0];
    var body = Board.el("div", "form-grid");

    var nameField = Board.el("label", "field");
    nameField.appendChild(Board.el("span", "", "Subject name"));
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.required = true;
    nameInput.value = cell ? cell.name : "";
    nameInput.placeholder = "Math";
    nameField.appendChild(nameInput);

    var colorField = Board.el("div", "field");
    colorField.appendChild(Board.el("span", "", "Colour"));
    var swatches = Board.el("div", "swatches");
    colors.forEach(function (swatch) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.style.setProperty("--sw", swatch);
      button.setAttribute("aria-label", "Colour " + swatch);
      button.setAttribute("aria-pressed", String(swatch === color));
      button.addEventListener("click", function () {
        color = swatch;
        Array.prototype.forEach.call(swatches.children, function (node) {
          node.setAttribute("aria-pressed", String(node === button));
        });
      });
      swatches.appendChild(button);
    });
    colorField.appendChild(swatches);

    var roomField = Board.el("label", "field");
    roomField.appendChild(Board.el("span", "", "Room or teacher (optional)"));
    var roomInput = document.createElement("input");
    roomInput.type = "text";
    roomInput.maxLength = 40;
    roomInput.value = cell ? cell.room : "";
    roomInput.placeholder = "B12 · Ms Lane";
    roomField.appendChild(roomInput);

    body.appendChild(nameField);
    body.appendChild(colorField);
    body.appendChild(roomField);

    var applyAll = false;
    if (cell) {
      var applyLabel = Board.el("label", "check");
      var applyInput = document.createElement("input");
      applyInput.type = "checkbox";
      applyLabel.appendChild(applyInput);
      applyLabel.appendChild(Board.el("span", "", "Apply to all cells with this subject name"));
      applyInput.addEventListener("change", function () {
        applyAll = applyInput.checked;
      });
      body.appendChild(applyLabel);
    }

    Board.modal({
      title: cell ? "Edit subject" : "Add subject",
      body: body,
      saveLabel: "Save",
      onSave: function () {
        var name = nameInput.value.trim();
        if (!name) return "Subject name is required.";
        return Board.action({
          kind: "saveCell",
          day: day,
          periodId: periodId,
          name: name,
          color: color,
          room: roomInput.value,
          applyAll: applyAll,
        }).then(function (ok) {
          return ok ? null : "Could not save that subject.";
        });
      },
      onDelete: cell
        ? function () {
            Board.action({ kind: "clearCell", day: day, periodId: periodId });
            Board.toast("Cell cleared");
            return true;
          }
        : null,
      deleteLabel: "Clear cell",
    });
  }

  /* ------------------------------------------------------------- period editor */

  function editPeriod(period) {
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
        }).then(function (ok) {
          return ok ? null : "That time was not saved - check the message at the bottom.";
        });
      },
      onDelete: function () {
        Board.action({ kind: "removePeriod", id: period.id });
        return true;
      },
      deleteLabel: "Remove row",
    });
  }

  /* ------------------------------------------------------------------- import */

  var DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
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

  function clockText(minutes) {
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return (hours < 10 ? "0" : "") + hours + ":" + (rest < 10 ? "0" : "") + rest;
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
        start: clockText(start),
        end: clockText(end),
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
        return Board.action({ kind: "importTimetable", rows: parsed.lessons });
      })
      .then(function (ok) {
        if (ok) Board.toast("Timetable imported");
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
      .invoke("save_template", { bytes: Array.prototype.slice.call(bytes) })
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

  window.Timetable = {
    init: init,
    lessonsFromRows: lessonsFromRows,
  };
})();
