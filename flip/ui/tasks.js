/* Tasks: week board, list view, filters, progress and smart suggestions. */
(function () {
  "use strict";

  var invoke = window.__TAURI__.core.invoke;

  var boardEl = null;
  var listEl = null;
  var suggEl = null;
  var rangeEl = null;
  var countEl = null;
  var fillEl = null;
  var filterEl = null;
  var hideDoneEl = null;
  var emptyEl = null;

  var mode = "board";
  var weekStart = null;
  var weekPinned = false;
  var filterSubject = "";
  var hideDone = false;
  var dragId = null;

  function init() {
    boardEl = document.getElementById("task-board");
    listEl = document.getElementById("task-list");
    suggEl = document.getElementById("suggestions");
    rangeEl = document.getElementById("week-range");
    countEl = document.getElementById("week-count");
    fillEl = document.getElementById("week-bar-fill");
    filterEl = document.getElementById("filter-subject");
    hideDoneEl = document.getElementById("hide-done");

    emptyEl = document.createElement("p");
    emptyEl.className = "empty";
    emptyEl.textContent = "No tasks yet - add one with New task, or click a subject on the timetable.";
    boardEl.parentNode.insertBefore(emptyEl, boardEl);

    document.getElementById("view-board").addEventListener("click", function () {
      setMode("board");
    });
    document.getElementById("view-list").addEventListener("click", function () {
      setMode("list");
    });
    document.getElementById("new-task").addEventListener("click", function () {
      openTaskForm(null, { date: Board.todayKey() });
    });
    document.getElementById("week-prev").addEventListener("click", function () {
      weekPinned = true;
      weekStart = Board.addDays(currentStart(), -7);
      render(Board.view());
    });
    document.getElementById("week-next").addEventListener("click", function () {
      weekPinned = true;
      weekStart = Board.addDays(currentStart(), 7);
      render(Board.view());
    });
    document.getElementById("week-today").addEventListener("click", function () {
      weekPinned = false;
      weekStart = Board.view() ? Board.view().week.start : Board.todayKey();
      render(Board.view());
    });

    filterEl.addEventListener("change", function () {
      filterSubject = filterEl.value;
      render(Board.view());
    });
    hideDoneEl.addEventListener("change", function () {
      hideDone = hideDoneEl.checked;
      render(Board.view());
    });
    document.getElementById("week-sun").addEventListener("change", function () {
      var start = document.getElementById("week-sun").checked ? "Sun" : "Mon";
      Board.action({ kind: "setWeekStart", start: start });
    });

    Board.on(render);
  }

  function currentStart() {
    return weekStart || (Board.view() ? Board.view().week.start : Board.todayKey());
  }

  function setMode(next) {
    mode = next;
    var boardButton = document.getElementById("view-board");
    var listButton = document.getElementById("view-list");
    boardButton.classList.toggle("active", mode === "board");
    listButton.classList.toggle("active", mode === "list");
    boardButton.setAttribute("aria-pressed", String(mode === "board"));
    listButton.setAttribute("aria-pressed", String(mode === "list"));
    if (mode === "list") {
      Board.tooltip.hide();
    }
    render(Board.view());
  }

  /* ------------------------------------------------------------------ render */

  function render(view) {
    if (!view) return;
    if (!weekPinned || !weekStart) weekStart = view.week.start;

    var days = weekDays();
    var activeWeek = weekStart === view.week.start;
    rangeEl.textContent = activeWeek ? view.week.label : Board.weekLabel(weekStart);
    document.getElementById("week-sun").checked = view.weekStart === "Sun";

    refreshFilters(view);
    renderProgress(view);



    renderSuggestions(view);
    emptyEl.hidden = view.tasks.length > 0;

    boardEl.hidden = mode !== "board";
    listEl.hidden = mode !== "list";
    if (mode === "board") renderBoard(view, days);
    else renderList(view, days);
  }

  function weekDays() {
    var days = [];
    for (var i = 0; i < 7; i++) {
      var date = Board.addDays(weekStart, i);
      days.push({
        date: date,
        dayKey: Board.dayKeyOf(date),
        label: Board.shortDate(date),
        isToday: date === Board.todayKey(),
      });
    }
    return days;
  }

  function refreshFilters(view) {
    var wanted = filterSubject;
    while (filterEl.options.length > 1) filterEl.remove(1);
    view.subjects.forEach(function (subject) {
      var option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name + (subject.inTimetable ? "" : " (no class)");
      filterEl.appendChild(option);
    });
    var exists = view.subjects.some(function (subject) {
      return subject.id === wanted;
    });
    filterEl.value = exists ? wanted : "";
    filterSubject = filterEl.value;
  }

  function visibleTasks(view) {
    return view.tasks.filter(function (task) {
      if (filterSubject && task.subjectId !== filterSubject) return false;
      if (hideDone && task.done) return false;
      return true;
    });
  }

  function renderProgress(view) {
    var start = weekStart;
    var end = Board.addDays(weekStart, 6);
    var week = view.tasks.filter(function (task) {
      return task.date && task.date >= start && task.date <= end;
    });
    var done = week.filter(function (task) {
      return task.done;
    }).length;
    countEl.textContent = done + " of " + week.length + " done this week";
    fillEl.style.width = week.length ? Math.round((done / week.length) * 100) + "%" : "0%";
  }

  /* ------------------------------------------------------------- week board */

  function renderBoard(view, days) {
    Board.clear(boardEl);
    var tasks = visibleTasks(view);
    var quickSubject = filterSubject || null;

    days.forEach(function (day) {
      var column = Board.el("div", "day-col" + (day.isToday ? " today" : ""));
      column.dataset.date = day.date;

      var head = Board.el("div", "day-head");
      head.appendChild(Board.el("strong", "", day.dayKey));
      head.appendChild(Board.el("span", "", day.label));
      column.appendChild(head);

      var quick = Board.el("form", "quick-add");
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add task…";
      input.setAttribute("aria-label", "Add a task on " + Board.longDay(day.date));
      quick.appendChild(input);
      quick.addEventListener("submit", function (event) {
        event.preventDefault();
        var title = input.value.trim();
        if (!title) return;
        Board.action({
          kind: "addTask",
          title: title,
          subjectId: quickSubject,
          date: day.date,
        }).then(function (ok) {
          if (ok) input.value = "";
        });
      });
      column.appendChild(quick);

      var dayTasks = tasks
        .filter(function (task) {
          return task.date === day.date;
        })
        .sort(sortTasks);

      if (!dayTasks.length) {
        column.appendChild(Board.el("p", "day-empty", "Nothing planned"));
      } else {
        dayTasks.forEach(function (task) {
          column.appendChild(taskCard(task, true));
        });
      }

      column.addEventListener("dragover", function (event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        column.classList.add("drop");
      });
      column.addEventListener("dragleave", function () {
        column.classList.remove("drop");
      });
      column.addEventListener("drop", function (event) {
        event.preventDefault();
        column.classList.remove("drop");
        var id = event.dataTransfer.getData("text/plain") || dragId;
        if (!id) return;
        var task = (Board.view() ? Board.view().tasks : []).find(function (item) {
          return item.id === id;
        });
        if (!task || task.date === day.date) return;
        Board.action({ kind: "scheduleTask", id: id, date: day.date }).then(function (ok) {
          if (ok) Board.toast("Moved to " + Board.shortDate(day.date));
        });
      });

      boardEl.appendChild(column);
    });
  }

  function sortTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    var at = a.time || "99:99";
    var bt = b.time || "99:99";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.title.localeCompare(b.title);
  }

  /* -------------------------------------------------------------- list view */

  function renderList(view, days) {
    Board.clear(listEl);
    var tasks = visibleTasks(view);
    var unscheduled = tasks
      .filter(function (task) {
        return !task.date;
      })
      .sort(sortTasks);

    listEl.appendChild(listGroup("Unscheduled", unscheduled, "No unscheduled tasks"));

    days.forEach(function (day) {
      var dayTasks = tasks
        .filter(function (task) {
          return task.date === day.date;
        })
        .sort(sortTasks);
      var heading = Board.longDay(day.date) + ", " + Board.shortDate(day.date) + (day.isToday ? " · today" : "");
      listEl.appendChild(listGroup(heading, dayTasks, "Nothing planned"));
    });
  }

  function listGroup(title, tasks, emptyText) {
    var group = Board.el("section", "list-group");
    var heading = Board.el("h3", "", title);
    heading.appendChild(Board.el("span", "", tasks.length ? tasks.length + " task(s)" : ""));
    group.appendChild(heading);
    var rows = Board.el("div", "rows");
    if (!tasks.length) rows.appendChild(Board.el("p", "hint", emptyText));
    tasks.forEach(function (task) {
      rows.appendChild(taskCard(task, false));
    });
    group.appendChild(rows);
    return group;
  }

  /* -------------------------------------------------------------- task card */

  function taskCard(task, draggable) {
    var card = Board.el("article", "task" + (task.done ? " done" : ""));

    if (draggable) {
      card.draggable = true;
      card.addEventListener("dragstart", function (event) {
        dragId = task.id;
        card.classList.add("dragging");
        event.dataTransfer.setData("text/plain", task.id);
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", function () {
        dragId = null;
        card.classList.remove("dragging");
      });
    }

    var check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.done;
    check.setAttribute(
      "aria-label",
      (task.done ? "Mark incomplete: " : "Mark complete: ") + task.title
    );
    check.addEventListener("change", function () {
      if (window.FlipSound) window.FlipSound.play(task.done ? "uncheck" : "complete");
      Board.action({ kind: "toggleTask", id: task.id });
    });
    card.appendChild(check);

    var body = Board.el("div", "task-body");
    var title = Board.el("div", "task-title", task.title);
    if (task.notes) title.title = task.notes;
    body.appendChild(title);

    var meta = Board.el("div", "task-meta");
    if (task.subjectId) {
      var subject = Board.subject(task.subjectId);
      if (subject) {
        var chip = Board.el("span", "chip");
        chip.style.setProperty("--chip-c", window.FlipColor ? window.FlipColor.subjectColorFromHue(subject.hue).mark : "var(--muted)");
        chip.appendChild(Board.el("i", ""));
        chip.appendChild(
          Board.el("span", "", subject.name + (subject.inTimetable ? "" : " (no class)"))
        );
        meta.appendChild(chip);
      } else {
        meta.appendChild(Board.el("span", "chip", "(no class)"));
      }
    }
    if (task.time) meta.appendChild(Board.el("span", "pill", task.time));
    /* Only due dates that need attention (today, tomorrow, overdue) earn a
       badge; anything further out stays in the editor. */
    if (task.due && !task.done) {
      var today = Board.todayKey();
      var late = task.due < today;
      var soon = task.due <= Board.addDays(today, 1);
      if (late || soon) {
        meta.appendChild(
          Board.el("span", "pill" + (late ? " late" : " soon"), (late ? "overdue " : "due ") + Board.shortDate(task.due))
        );
      }
    }
    /* Default/low priority is noise; only high is worth a badge. */
    if (task.priority === "high") {
      meta.appendChild(Board.el("span", "pill high", "high"));
    }

    /* The buttons live in the meta row so a narrow day column still leaves
       the whole card width for the title. */
    var actions = Board.el("div", "task-actions");
    var more = Board.icon("More actions for " + task.title, "⋯", "");
    more.setAttribute("aria-haspopup", "dialog");
    more.addEventListener("click", function () {
      openTaskMenu(task);
    });
    var edit = Board.icon("Edit " + task.title, "✎", "");
    edit.addEventListener("click", function () {
      openTaskForm(task);
    });
    var remove = Board.icon("Delete " + task.title, "✕", "");
    remove.addEventListener("click", function () {
      deleteTask(task);
    });
    actions.appendChild(more);
    actions.appendChild(edit);
    actions.appendChild(remove);
    meta.appendChild(actions);
    body.appendChild(meta);
    card.appendChild(body);

    return card;
  }

  /* Mouse-only path for everything the drag handle can do. */
  function openTaskMenu(task) {
    var body = Board.el("div", "form-grid menu-list");
    var today = Board.todayKey();

    body.appendChild(Board.el("p", "menu-label", "Schedule for"));
    for (var i = 0; i < 4; i++) {
      var date = Board.addDays(today, i);
      body.appendChild(
        menuRow(task, { kind: "scheduleTask", id: task.id, date: date }, scheduleLabel(date, today))
      );
    }

    var pick = Board.el("button", "menu-row", "Choose another date…");
    pick.type = "button";
    pick.addEventListener("click", function () {
      Board.closeModal();
      pickDate(task);
    });
    body.appendChild(pick);

    if (task.date) {
      var clear = menuRow(task, { kind: "unschedule", id: task.id }, "Remove from the week");
      clear.classList.add("ghost");
      body.appendChild(clear);
    }

    body.appendChild(Board.el("p", "menu-label", "Actions"));

    var focus = Board.el("button", "menu-row", "Start a focus session");
    focus.type = "button";
    focus.addEventListener("click", function () {
      Board.closeModal();
      var chosen = Number(
        (window.Flip && window.Flip.snapshot() && window.Flip.snapshot().focusSecs) || 25 * 60
      );
      invoke("start_focus", { secs: chosen, taskId: task.id })
        .then(function (snap) {
          if (window.Flip) {
            window.Flip.apply(snap);
            window.Flip.go("timer");
          }
          Board.toast(
            "Focus session started · " +
              window.I18n.count(Math.max(1, Math.round(chosen / 60)), "minute", "minutes")
          );
        })
        .catch(function (err) {
          Board.toast(String((err && err.message) || err));
        });
    });
    body.appendChild(focus);

    var edit = Board.el("button", "menu-row", "Edit task details");
    edit.type = "button";
    edit.addEventListener("click", function () {
      Board.closeModal();
      openTaskForm(task);
    });
    body.appendChild(edit);

    Board.modal({
      title: task.title,
      body: body,
      saveLabel: "Close",
      hideCancel: true,
      onSave: function () {},
    });
  }

  function scheduleLabel(date, today) {
    if (date === today) return "Today";
    if (date === Board.addDays(today, 1)) return "Tomorrow";
    return Board.longDay(date) + " · " + Board.shortDate(date);
  }

  function menuRow(task, action, label) {
    var row = Board.el("button", "menu-row", label);
    row.type = "button";
    row.addEventListener("click", function () {
      Board.closeModal();
      Board.action(action).then(function (ok) {
        if (!ok) return;
        if (action.kind === "unschedule") Board.toast("Removed from the week");
        else Board.toast("Scheduled for " + Board.shortDate(action.date));
      });
    });
    return row;
  }

  function pickDate(task) {
    var body = Board.el("div", "form-grid");
    var field = Board.el("label", "field");
    field.appendChild(Board.el("span", "", "Day"));
    var input = document.createElement("input");
    input.type = "date";
    input.value = task.date || Board.todayKey();
    field.appendChild(input);
    Board.dateField(input);
    body.appendChild(field);

    Board.modal({
      title: "Schedule task",
      body: body,
      saveLabel: "Schedule",
      onSave: function () {
        return Board.action({ kind: "scheduleTask", id: task.id, date: input.value }).then(
          function (ok) {
            return ok ? null : "That day was not saved.";
          }
        );
      },
    });
  }

  function deleteTask(task) {
    var copy = {
      title: task.title,
      subjectId: task.subjectId,
      date: task.date,
      due: task.due,
      time: task.time,
      notes: task.notes,
      priority: task.priority,
    };
    Board.action({ kind: "deleteTask", id: task.id }).then(function (ok) {
      if (!ok) return;
      Board.toast("Task deleted", {
        actionLabel: "Undo",
        onAction: function () {
          Board.action({
            kind: "addTask",
            title: copy.title,
            subjectId: copy.subjectId,
            date: copy.date,
            due: copy.due,
            time: copy.time,
            notes: copy.notes,
            priority: copy.priority,
          });
        },
      });
    });
  }

  /* ------------------------------------------------------------ task editor */

  function openTaskForm(task, preset) {
    var view = Board.view();
    if (!view) return;
    var editing = Boolean(task);
    var data = task || {
      title: "",
      subjectId: preset && preset.subjectId ? preset.subjectId : null,
      date: preset && preset.date ? preset.date : null,
      due: null,
      time: "",
      notes: "",
      priority: null,
    };

    var body = Board.el("div", "form-grid");

    var titleField = Board.el("label", "field");
    titleField.appendChild(Board.el("span", "", "Task"));
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.maxLength = 200;
    titleInput.required = true;
    titleInput.placeholder = "Chapter 5: quadratic equations";
    titleInput.value = data.title || "";
    titleField.appendChild(titleInput);

    var subjectField = Board.el("label", "field");
    subjectField.appendChild(Board.el("span", "", "Subject"));
    var subjectSelect = document.createElement("select");
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "None";
    subjectSelect.appendChild(none);
    view.subjects.forEach(function (subject) {
      var option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name + (subject.inTimetable ? "" : " (no class)");
      subjectSelect.appendChild(option);
    });
    subjectSelect.value = data.subjectId || "";
    subjectField.appendChild(subjectSelect);

    var days = Board.el("div", "form-row");
    var dayField = Board.el("label", "field");
    dayField.appendChild(Board.el("span", "", "Day"));
    var dayInput = document.createElement("input");
    dayInput.type = "date";
    dayInput.value = data.date || "";
    dayField.appendChild(dayInput);
    Board.dateField(dayInput);

    var dueField = Board.el("label", "field");
    dueField.appendChild(Board.el("span", "", "Due date"));
    var dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.value = data.due || "";
    dueField.appendChild(dueInput);
    Board.dateField(dueInput);
    days.appendChild(dayField);
    days.appendChild(dueField);

    var extras = Board.el("div", "form-row");
    var timeField = Board.el("label", "field");
    timeField.appendChild(Board.el("span", "", "Time"));
    var timeInput = document.createElement("input");
    timeInput.type = "time";
    timeInput.value = data.time || "";
    timeField.appendChild(timeInput);

    var priorityField = Board.el("label", "field");
    priorityField.appendChild(Board.el("span", "", "Priority"));
    var prioritySelect = document.createElement("select");
    [["", "None"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].forEach(
      function (pair) {
        var option = document.createElement("option");
        option.value = pair[0];
        option.textContent = pair[1];
        prioritySelect.appendChild(option);
      }
    );
    prioritySelect.value = data.priority || "";
    priorityField.appendChild(prioritySelect);
    extras.appendChild(timeField);
    extras.appendChild(priorityField);

    var notesField = Board.el("label", "field");
    notesField.appendChild(Board.el("span", "", "Notes (optional)"));
    var notesInput = document.createElement("textarea");
    notesInput.maxLength = 500;
    notesInput.value = data.notes || "";
    notesField.appendChild(notesInput);

    body.appendChild(titleField);
    body.appendChild(subjectField);
    body.appendChild(days);
    body.appendChild(extras);
    body.appendChild(notesField);

    Board.modal({
      title: editing ? "Edit task" : "New task",
      body: body,
      saveLabel: editing ? "Save task" : "Add task",
      onSave: function () {
        var title = titleInput.value.trim();
        if (!title) return "Give the task a title first.";
        var payload = {
          kind: editing ? "updateTask" : "addTask",
          title: title,
          subjectId: subjectSelect.value || null,
          date: dayInput.value || null,
          due: dueInput.value || null,
          time: timeInput.value || "",
          notes: notesInput.value,
          priority: prioritySelect.value || null,
        };
        if (editing) payload.id = task.id;
        return Board.action(payload).then(function (ok) {
          return ok ? null : "That task was not saved.";
        });
      },
      onDelete: editing
        ? function () {
            deleteTask(task);
            return true;
          }
        : null,
    });
  }

  /* ------------------------------------------------------ subject task panel */

  function openForSubject(subjectId, fallbackName) {
    var subject = Board.subject(subjectId);
    var body = Board.el("div", "form-grid");

    if (subject && !subject.inTimetable) {
      body.appendChild(
        Board.el("p", "hint", "This subject is no longer on the timetable. Its tasks are kept.")
      );
    }

    var addCard = Board.el("div", "form-grid");
    var titleField = Board.el("label", "field");
    titleField.appendChild(Board.el("span", "", "What needs doing?"));
    var titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.maxLength = 200;
    titleInput.placeholder = "Chapter 5: quadratic equations";
    titleField.appendChild(titleInput);

    var whenRow = Board.el("div", "form-row");
    var dayField = Board.el("label", "field");
    dayField.appendChild(Board.el("span", "", "Day (optional)"));
    var dayInput = document.createElement("input");
    dayInput.type = "date";
    dayField.appendChild(dayInput);
    Board.dateField(dayInput);

    var dueField = Board.el("label", "field");
    dueField.appendChild(Board.el("span", "", "Due date (optional)"));
    var dueInput = document.createElement("input");
    dueInput.type = "date";
    dueField.appendChild(dueInput);
    Board.dateField(dueInput);
    whenRow.appendChild(dayField);
    whenRow.appendChild(dueField);

    var addButton = Board.el("button", "btn primary", "Add task");
    addButton.type = "button";

    addCard.appendChild(titleField);
    addCard.appendChild(whenRow);
    addCard.appendChild(addButton);
    body.appendChild(addCard);

    var rows = Board.el("div", "task-rows");
    body.appendChild(rows);

    function add() {
      var title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        return;
      }
      Board.action({
        kind: "addTask",
        title: title,
        subjectId: subjectId,
        date: dayInput.value || null,
        due: dueInput.value || null,
      }).then(function (ok) {
        if (!ok) return;
        titleInput.value = "";
        dayInput.value = "";
        dueInput.value = "";
        titleInput.focus();
      });
    }

    addButton.addEventListener("click", add);
    titleInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        add();
      }
    });

    function refresh(view) {
      Board.clear(rows);
      var tasks = Board.tasksForSubject(subjectId).slice().sort(function (a, b) {
        return Number(a.done) - Number(b.done) || a.title.localeCompare(b.title);
      });
      if (!tasks.length) {
        rows.appendChild(
          Board.el("p", "hint", "No tasks yet. Add the first thing to learn above.")
        );
        return;
      }
      tasks.forEach(function (task) {
        rows.appendChild(subjectTaskRow(task));
      });
    }

    var unsubscribe = Board.on(refresh);

    Board.modal({
      title: subject ? subject.name : fallbackName || "Subject",
      body: body,
      saveLabel: "Done",
      onClose: unsubscribe,
    });
  }

  function subjectTaskRow(task) {
    var row = Board.el("div", "subject-task");
    var check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.done;
    check.setAttribute(
      "aria-label",
      (task.done ? "Mark incomplete: " : "Mark complete: ") + task.title
    );
    check.addEventListener("change", function () {
      if (window.FlipSound) window.FlipSound.play(task.done ? "uncheck" : "complete");
      Board.action({ kind: "toggleTask", id: task.id });
    });
    row.appendChild(check);
    row.appendChild(Board.el("span", "task-title", task.title));

    if (task.due) row.appendChild(Board.el("span", "pill", "due " + Board.shortDate(task.due)));
    if (task.date) row.appendChild(Board.el("span", "pill", Board.shortDate(task.date)));

    var edit = Board.icon("Edit " + task.title, "✎", "");
    edit.addEventListener("click", function () {
      openTaskForm(task);
    });
    var remove = Board.icon("Delete " + task.title, "✕", "");
    remove.addEventListener("click", function () {
      deleteTask(task);
    });
    row.appendChild(edit);
    row.appendChild(remove);
    return row;
  }

  /* ------------------------------------------------------------- suggestions */

  function renderSuggestions(view) {
    Board.clear(suggEl);
    (view.suggestions || []).forEach(function (suggestion) {
      var card = Board.el("div", "suggestion");

      var head = Board.el("div", "suggestion-head");
      var swatch = Board.el("span", "suggestion-swatch");
      swatch.style.background = window.FlipColor ? window.FlipColor.subjectColorFromHue(suggestion.subjectHue).mark : "var(--muted)";
      head.appendChild(swatch);
      var text = Board.el("div", "");
      text.appendChild(Board.el("div", "suggestion-title", suggestion.title));
      text.appendChild(Board.el("div", "suggestion-question", suggestion.question));
      head.appendChild(text);
      card.appendChild(head);

      var chosen = {};
      suggestion.tasks.forEach(function (task) {
        chosen[task.id] = true;
      });

      var taskList = Board.el("div", "suggestion-tasks");
      suggestion.tasks.slice(0, 5).forEach(function (task) {
        var label = Board.el("label", "");
        var check = document.createElement("input");
        check.type = "checkbox";
        check.checked = true;
        check.addEventListener("change", function () {
          chosen[task.id] = check.checked;
        });
        label.appendChild(check);
        label.appendChild(
          Board.el("span", "", task.title + (task.due ? " · due " + Board.shortDate(task.due) : ""))
        );
        taskList.appendChild(label);
      });
      if (suggestion.tasks.length > 5) {
        taskList.appendChild(
          Board.el("p", "hint", "+" + (suggestion.tasks.length - 5) + " more, also scheduled")
        );
      }
      card.appendChild(taskList);

      var actions = Board.el("div", "suggestion-actions");

      var schedule = Board.el("button", "btn small primary", "Schedule selected");
      schedule.type = "button";
      schedule.addEventListener("click", function () {
        var ids = suggestion.tasks
          .filter(function (task) {
            return chosen[task.id];
          })
          .map(function (task) {
            return task.id;
          });
        if (!ids.length) {
          Board.toast("Pick at least one task first.");
          return;
        }
        scheduleMany(ids, suggestion.date);
      });

      var later = Board.el("button", "btn small", "Not now");
      later.type = "button";
      later.addEventListener("click", function () {
        Board.action({
          kind: "snooze",
          ids: suggestion.tasks.map(function (task) {
            return task.id;
          }),
        }).then(function (ok) {
          if (ok) Board.toast("Hidden until tomorrow");
        });
      });

      var never = Board.el("button", "btn small ghost", "Never for this task");
      never.type = "button";
      never.addEventListener("click", function () {
        var ids = suggestion.tasks
          .filter(function (task) {
            return chosen[task.id];
          })
          .map(function (task) {
            return task.id;
          });
        if (!ids.length) {
          Board.toast("Pick at least one task first.");
          return;
        }
        Board.action({ kind: "neverSuggest", ids: ids }).then(function (ok) {
          if (ok) Board.toast("No more suggestions for that task");
        });
      });

      actions.appendChild(schedule);
      actions.appendChild(later);
      actions.appendChild(never);
      card.appendChild(actions);
      suggEl.appendChild(card);
    });
  }

  async function scheduleMany(ids, date) {
    var allOk = true;
    for (var i = 0; i < ids.length; i++) {
      var ok = await Board.action({ kind: "scheduleTask", id: ids[i], date: date });
      allOk = allOk && ok;
    }
    if (!allOk) return;
    Board.toast("Scheduled for " + Board.shortDate(date), {
      actionLabel: "Undo",
      onAction: function () {
        ids.forEach(function (id) {
          Board.action({ kind: "unschedule", id: id });
        });
      },
    });
  }

  window.Tasks = {
    init: init,
    openForSubject: openForSubject,
    openTaskForm: openTaskForm,
  };
})();
