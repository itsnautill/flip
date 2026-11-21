/* Dashboard: a hub of small widgets built from the board view and the timer
   snapshot. Widget order and visibility live in Rust settings. */
(function () {
  "use strict";

  var invoke = window.__TAURI__.core.invoke;

  var grid = null;
  var greetEl = null;
  var subEl = null;
  var arrangeBtn = null;
  var resetBtn = null;
  var newTaskBtn = null;

  var boardView = null;
  var snap = null;
  var layout = null;
  var arranging = false;
  var visible = false;
  var ticker = 0;
  var dragId = null;
  var signature = "";

  var DEFAULT_ORDER = ["next", "today", "due", "tasks", "focus", "stats"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ------------------------------------------------------------------ helpers */

  function el(tag, className, text) {
    return Board.el(tag, className, text);
  }

  function iconBtn(label, glyph, className) {
    var button = Board.icon(label, glyph, className || "widget-tool");
    button.type = "button";
    return button;
  }

  function parseClock(text) {
    var parts = String(text || "").split(":");
    if (parts.length < 2) return null;
    var hours = Number(parts[0]);
    var minutes = Number(parts[1]);
    if (!isFinite(hours) || !isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }

  function nowMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  function clockText(minutes) {
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return (hours < 10 ? "0" : "") + hours + ":" + (rest < 10 ? "0" : "") + rest;
  }

  function durationText(minutes) {
    if (minutes <= 0) return "now";
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    if (!hours) return rest + "m";
    return hours + "h" + (rest ? " " + rest : "");
  }

  function minutesText(secs) {
    var total = Math.round(secs / 60);
    if (total < 60) return total + "m";
    var hours = Math.floor(total / 60);
    var rest = total % 60;
    return hours + "h" + (rest ? " " + rest + "m" : "");
  }

  /** A number plus a translated noun, so English can never leak through. */
  function countText(value, one, many) {
    var count = Number(value) || 0;
    if (window.I18n && window.I18n.count) return window.I18n.count(count, one, many);
    return count + " " + (count === 1 ? one : many);
  }

  function sessionText(value) {
    return countText(value, "session", "sessions");
  }

  function dayKeyOf(view) {
    return Board.dayKeyOf(view.today);
  }

  function subjectName(id) {
    var subject = Board.subject(id);
    return subject ? subject.name : "";
  }

  function subjectHue(id) {
    var subject = Board.subject(id);
    return subject ? Number(subject.hue) : 24;
  }

  function paintColour(hue) {
    return window.FlipColor ? window.FlipColor.subjectColorFromHue(hue).border : "var(--muted)";
  }

  function subjectColor(id) {
    var subject = Board.subject(id);
    return subject ? paintColour(subject.hue) : "var(--muted)";
  }

  function hasClassOn(view, dayKey) {
    return view.periods.some(function (period) {
      return !period.break && view.cells[dayKey + "-" + period.id];
    });
  }

  /* Today's lessons in order, with their live status. */
  function todayLessons() {
    if (!boardView) return [];
    var key = dayKeyOf(boardView);
    var now = nowMinutes();
    var out = [];
    boardView.periods.forEach(function (period) {
      var cell = boardView.cells[key + "-" + period.id];
      if (!cell) return;
      var start = parseClock(period.start);
      var end = parseClock(period.end);
      out.push({
        period: period,
        cell: cell,
        start: start,
        end: end,
        state: period.break
          ? "break"
          : start !== null && end !== null
            ? now >= end ? "past" : now >= start ? "now" : "later"
            : "later",
      });
    });
    return out;
  }

  /** The first lesson on a day key, in period order, or null. */
  function firstLesson(key) {
    var first = null;
    boardView.periods.forEach(function (period) {
      if (period.break || first) return;
      var cell = boardView.cells[key + "-" + period.id];
      if (cell) first = { period: period, cell: cell };
    });
    return first;
  }

  function hasDay(key) {
    return boardView.days.some(function (day) { return day.key === key; });
  }

  function nextUp() {
    if (!boardView) return null;
    var key = dayKeyOf(boardView);
    var anyToday = hasDay(key) && hasClassOn(boardView, key);
    if (anyToday) {
      var lessons = todayLessons().filter(function (lesson) { return lesson.state !== "break"; });
      var current = lessons.find(function (lesson) { return lesson.state === "now"; });
      if (current) return { kind: "now", lesson: current };
      var next = lessons.find(function (lesson) { return lesson.state === "later"; });
      if (next) return { kind: "next", lesson: next };
    }
    /* Nothing left today: the next day that has a class wins. */
    for (var step = 1; step <= 7; step++) {
      var date = Board.addDays(boardView.today, step);
      var dayKey = Board.dayKeyOf(date);
      if (!hasDay(dayKey)) continue;
      var found = firstLesson(dayKey);
      if (found) {
        return { kind: step === 1 ? "tomorrow" : "later-day", step: step, date: date, lesson: found };
      }
    }
    /* A week with nothing in it at all says so; a finished day says it is done. */
    return { kind: anyToday ? "done" : "free" };
  }

  /* ------------------------------------------------------------------ widgets */

  var WIDGETS = {};

  /* The glyph each card header carries, in the tonal badge the Material skin
     paints. Paths only: the wrapper SVG is built in card(). */
  var GLYPHS = {
    next: '<path d="M5 12h12"></path><path d="M12 5l7 7-7 7"></path>',
    today:
      '<rect x="4" y="5.5" width="16" height="14.5" rx="3"></rect><path d="M4 10.2h16M8.5 3.5v4M15.5 3.5v4"></path>',
    due: '<circle cx="12" cy="12.5" r="7.5"></circle><path d="M12 8.5v4.2l2.8 1.7"></path>',
    tasks:
      '<path d="M4.5 7.5l2 2 3.5-3.5M4.5 16.5l2 2 3.5-3.5"></path><path d="M12.5 7.5H20M12.5 17.5H20"></path>',
    focus:
      '<circle cx="12" cy="13.5" r="7"></circle><path d="M12 10v4l2.6 1.6M9.5 2.5h5M12 2.5V6"></path>',
    stats: '<path d="M5.5 19v-7M12 19V5M18.5 19v-9"></path>',
  };

  WIDGETS.next = {
    title: "Next up",
    render: function (body) {
      var info = nextUp();
      if (!info) {
        body.appendChild(el("p", "dash-hint", "Your timetable appears here once you add a class."));
        return;
      }
      if (info.kind === "free") {
        body.appendChild(el("p", "hero-eyebrow", "Nothing scheduled"));
        body.appendChild(el("p", "hero-title", "No classes today"));
        body.appendChild(el("p", "dash-hint", "Enjoy the quiet - or get ahead on a task."));
        body.appendChild(actionLink("Open timetable", "timetable"));
        return;
      }
      if (info.kind === "done") {
        body.appendChild(el("p", "hero-eyebrow", "All done"));
        body.appendChild(el("p", "hero-title", "No classes left this week"));
        body.appendChild(actionLink("See the timetable", "timetable"));
        return;
      }

      var lesson = info.lesson;
      var now = nowMinutes();
      var eyebrow =
        info.kind === "now"
          ? "In progress"
          : info.kind === "tomorrow"
            ? "Tomorrow"
            : info.kind === "later-day"
              ? WEEKDAYS[Board.parseKey(info.date).getDay()]
              : "Next class";
      body.appendChild(el("p", "hero-eyebrow", eyebrow));

      var title = el("div", "hero-title");
      title.appendChild(el("span", "hero-swatch")).style.background = paintColour(lesson.cell.hue);
      title.appendChild(el("span", "", lesson.cell.name));
      body.appendChild(title);

      var meta = el("div", "hero-meta");
      var time = lesson.period.start + " – " + lesson.period.end;
      meta.appendChild(el("span", "", time));
      if (lesson.cell.room) meta.appendChild(el("span", "hero-room", lesson.cell.room));
      if (info.kind === "now") {
        meta.appendChild(el("span", "hero-chip live", durationText(lesson.end - now) + " left"));
      } else if (info.kind === "next") {
        meta.appendChild(el("span", "hero-chip", "in " + durationText(lesson.start - now)));
      }
      body.appendChild(meta);

      if (info.kind === "now") {
        var span = Math.max(1, lesson.end - lesson.start);
        var done = Math.min(1, Math.max(0, (now - lesson.start) / span));
        var bar = el("div", "hero-bar");
        var fill = el("span", "");
        fill.style.width = Math.round(done * 100) + "%";
        bar.appendChild(fill);
        body.appendChild(bar);
      }

      if (lesson.cell.pending) {
        body.appendChild(
          el("p", "dash-hint", lesson.cell.pending + " task" + (lesson.cell.pending === 1 ? "" : "s") + " waiting for this subject")
        );
      }
      body.appendChild(actionLink("Open timetable", "timetable"));
    },
  };

  /* Finished lessons fold into one quiet row; the state survives re-renders. */
  var doneOpen = false;

  function scheduleRow(lesson) {
    var row = el("li", "sched-row state-" + lesson.state);
    row.appendChild(el("span", "sched-time", lesson.period.start));
    var name = el("span", "sched-name");
    name.appendChild(el("i", "sched-dot"));
    name.firstChild.style.background = paintColour(lesson.cell.hue);
    name.appendChild(el("span", "sched-label", lesson.cell.name));
    row.appendChild(name);
    if (lesson.cell.room) row.appendChild(el("span", "sched-room", lesson.cell.room));
    if (lesson.state === "now") row.appendChild(el("span", "sched-flag", "now"));
    else if (lesson.state === "break") row.appendChild(el("span", "sched-flag ghost", "break"));
    if (lesson.cell.pending) {
      var badge = el("span", "sched-count", String(lesson.cell.pending));
      badge.title = lesson.cell.pending + " open task(s)";
      row.appendChild(badge);
    }
    row.title = lesson.cell.name + " · " + lesson.period.start + "–" + lesson.period.end;
    return row;
  }

  WIDGETS.today = {
    title: "Today's schedule",
    render: function (body) {
      if (!boardView) return;
      var lessons = todayLessons();
      if (!lessons.length) {
        body.appendChild(el("p", "dash-hint", "No classes on the timetable today."));
        body.appendChild(actionLink("Add a subject", "timetable"));
        return;
      }

      var past = lessons.filter(function (lesson) { return lesson.state === "past"; });
      var live = lessons.filter(function (lesson) { return lesson.state !== "past"; });

      if (live.length) {
        var list = el("ul", "sched-list");
        live.forEach(function (lesson) { list.appendChild(scheduleRow(lesson)); });
        body.appendChild(list);
      } else if (!past.length) {
        body.appendChild(el("p", "dash-hint", "Nothing else on the timetable today."));
      }

      if (past.length) {
        var toggle = el(
          "button",
          "sched-done-toggle",
          past.length + (past.length === 1 ? " class done" : " classes done")
        );
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", String(doneOpen));
        var doneList = el("ul", "sched-list sched-done-list");
        doneList.hidden = !doneOpen;
        past.forEach(function (lesson) { doneList.appendChild(scheduleRow(lesson)); });
        toggle.addEventListener("click", function () {
          doneOpen = !doneOpen;
          doneList.hidden = !doneOpen;
          toggle.setAttribute("aria-expanded", String(doneOpen));
        });
        body.appendChild(toggle);
        body.appendChild(doneList);
      }
    },
  };

  WIDGETS.due = {
    title: "Upcoming deadlines",
    render: function (body) {
      if (!boardView) return;
      var today = boardView.today;
      var soon = Board.addDays(today, 14);
      var tasks = boardView.tasks
        .filter(function (task) { return !task.done && task.due && task.due <= soon; })
        .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });

      if (!tasks.length) {
        body.appendChild(el("p", "dash-hint", "Nothing due in the next two weeks."));
        body.appendChild(actionLink("Open tasks", "tasks"));
        return;
      }

      var list = el("ul", "deadline-list");
      tasks.slice(0, 6).forEach(function (task) {
        var row = el("li", "deadline-row" + (task.due < today ? " overdue" : ""));
        var dot = el("i", "deadline-dot");
        dot.style.background = subjectColor(task.subjectId);
        row.appendChild(dot);

        var text = el("div", "deadline-text");
        var button = el("button", "link-btn", task.title);
        button.type = "button";
        button.addEventListener("click", function () {
          if (window.Tasks) window.Tasks.openTaskForm(task);
        });
        text.appendChild(button);
        var subject = subjectName(task.subjectId);
        if (subject) text.appendChild(el("span", "deadline-subject", subject));
        row.appendChild(text);

        var when = task.due === today ? "today" : Board.shortDate(task.due);
        if (task.due < today) when = "overdue";
        row.appendChild(el("span", "deadline-when", when));
        if (task.priority === "high") row.appendChild(el("span", "pill high", "high"));
        list.appendChild(row);
      });
      body.appendChild(list);
      if (tasks.length > 6) {
        var more = el("button", "link-btn dash-more", "+" + (tasks.length - 6) + " more");
        more.type = "button";
        more.addEventListener("click", function () { go("tasks"); });
        body.appendChild(more);
      }
    },
  };

  WIDGETS.tasks = {
    title: "Today's tasks",
    render: function (body) {
      if (!boardView) return;
      var today = boardView.today;
      var mine = boardView.tasks.filter(function (task) { return task.date === today; });
      var done = mine.filter(function (task) { return task.done; }).length;

      var head = el("div", "widget-note");
      head.appendChild(el("span", "", mine.length ? done + " of " + mine.length + " done" : "Nothing planned yet"));
      body.appendChild(head);

      var list = el("ul", "dash-task-list");
      mine.slice(0, 5).forEach(function (task) {
        list.appendChild(taskRow(task));
      });
      if (mine.length > 5) list.appendChild(el("li", "dash-hint", "+" + (mine.length - 5) + " more in Tasks"));
      body.appendChild(list);

      var form = el("form", "quick-add dash-quick");
      var input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Add a task for today…";
      input.setAttribute("aria-label", "Add a task for today");
      form.appendChild(input);
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var title = input.value.trim();
        if (!title) return;
        Board.action({ kind: "addTask", title: title, date: today }).then(function (ok) {
          if (ok) input.value = "";
        });
      });
      body.appendChild(form);

      var week = el("div", "dash-progress");
      var track = el("div", "track");
      var fill = el("span", "");
      track.appendChild(fill);
      week.appendChild(track);
      body.appendChild(week);
    },
  };

  WIDGETS.focus = {
    title: "Focus session",
    render: function (body) {
      var timer = (snap && snap.timer) || {};
      var running = snap && snap.focusActive &&
        (timer.state === "running" || timer.state === "paused");
      var focus = (boardView && boardView.focus) || { todaySecs: 0, sessionsToday: 0 };
      var total = Math.round((snap && snap.focusSecs ? snap.focusSecs : 1500) / 60);

      if (running) {
        body.appendChild(el("p", "hero-eyebrow", "Focus running"));
        var clock = el("p", "focus-clock", timer.h + ":" + timer.m + ":" + timer.s);
        body.appendChild(clock);
        var live = el("div", "widget-note");
        live.appendChild(el("span", "", (snap.focusActive ? "Session in progress" : "Timer")));
        body.appendChild(live);
        var actions = el("div", "widget-actions");
        var stop = el("button", "btn small", "Stop");
        stop.type = "button";
        stop.addEventListener("click", function () {
          /* Stopping early still credits the minutes spent, so the toast says
             how much was saved. */
          if (window.Flip && window.Flip.stopFocus) window.Flip.stopFocus();
        });
        var open = el("button", "btn small primary", "Open timer");
        open.type = "button";
        open.addEventListener("click", function () { go("timer"); });
        actions.appendChild(stop);
        actions.appendChild(open);
        body.appendChild(actions);
      } else {
        var chips = el("div", "focus-chips");
        var chosen = total;
        var labels = [15, 25, 45, 50];
        var buttons = labels.map(function (minutes) {
          var chip = el("button", "chip-btn" + (minutes === total ? " active" : ""), minutes + "m");
          chip.type = "button";
          chip.setAttribute("aria-pressed", String(minutes === total));
          chip.addEventListener("click", function () {
            chosen = minutes;
            buttons.forEach(function (node) {
              node.classList.toggle("active", node === chip);
              node.setAttribute("aria-pressed", String(node === chip));
            });
          });
          chips.appendChild(chip);
          return chip;
        });
        body.appendChild(chips);
        var start = el("button", "btn primary wide", "Start focus");
        start.type = "button";
        start.addEventListener("click", function () {
          invoke("start_focus", { secs: chosen * 60, taskId: null })
            .then(function (next) {
              if (window.Flip && next) window.Flip.apply(next);
              go("timer");
              Board.toast("Focus session started · " + countText(chosen, "minute", "minutes"));
            })
            .catch(function (err) {
              Board.toast(String((err && err.message) || err));
            });
        });
        body.appendChild(start);
      }

      var stats = el("div", "widget-note focus-total");
      stats.appendChild(el("span", "", "Today"));
      stats.appendChild(el("strong", "", minutesText(focus.todaySecs || 0)));
      stats.appendChild(
        el("span", "", sessionText(focus.sessionsToday || 0))
      );
      body.appendChild(stats);
    },
  };

  WIDGETS.stats = {
    title: "This week",
    render: function (body) {
      if (!boardView) return;
      var focus = boardView.focus || { weekSecs: 0, streak: 0 };
      var start = boardView.week.start;
      var end = Board.addDays(start, 6);
      var weekTasks = boardView.tasks.filter(function (task) {
        return task.date && task.date >= start && task.date <= end;
      });
      var done = weekTasks.filter(function (task) { return task.done; }).length;
      var open = boardView.tasks.filter(function (task) { return !task.done; }).length;

      var figures = el("div", "figure-grid");
      [
        [minutesText(focus.weekSecs || 0), "focused"],
        [String(focus.streak || 0), (focus.streak === 1 ? "day streak" : "day streak")],
        [done + "/" + weekTasks.length, "tasks done"],
        [String(open), "open tasks"],
      ].forEach(function (pair) {
        var figure = el("div", "figure");
        figure.appendChild(el("span", "figure-value", pair[0]));
        figure.appendChild(el("span", "figure-label", pair[1]));
        figures.appendChild(figure);
      });
      body.appendChild(figures);
    },
  };

  function taskRow(task) {
    var row = el("li", "dash-task" + (task.done ? " done" : ""));
    var check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.done;
    check.setAttribute("aria-label", (task.done ? "Mark incomplete: " : "Mark complete: ") + task.title);
    check.addEventListener("change", function () {
      Board.action({ kind: "toggleTask", id: task.id });
    });
    row.appendChild(check);
    var title = el("span", "dash-task-title", task.title);
    row.appendChild(title);
    if (task.subjectId) {
      var dot = el("i", "sched-dot");
      dot.style.background = subjectColor(task.subjectId);
      row.appendChild(dot);
    }
    if (task.time) row.appendChild(el("span", "sched-room", task.time));
    return row;
  }

  function actionLink(label, view) {
    var button = el("button", "link-btn widget-link", label);
    button.type = "button";
    button.addEventListener("click", function () { go(view); });
    return button;
  }

  function go(view) {
    if (window.Flip && window.Flip.go) window.Flip.go(view);
  }

  /* ------------------------------------------------------------------- layout */

  function currentOrder() {
    var order = (layout && layout.order && layout.order.length ? layout.order : DEFAULT_ORDER).slice();
    DEFAULT_ORDER.forEach(function (id) {
      if (order.indexOf(id) < 0) order.push(id);
    });
    return order;
  }

  function hiddenList() {
    return (layout && layout.hidden) || [];
  }

  function saveLayout(order, hidden) {
    layout = { order: order.slice(), hidden: hidden.slice() };
    render();
    invoke("set_dashboard", { order: order, hidden: hidden })
      .then(function (next) {
        if (next && next.dashboard) layout = next.dashboard;
      })
      .catch(function (err) {
        console.error("flip: set_dashboard failed", err);
      });
  }

  function move(id, delta) {
    var order = currentOrder();
    var from = order.indexOf(id);
    var to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    saveLayout(order, hiddenList());
  }

  function hideWidget(id) {
    var hidden = hiddenList().slice();
    if (hidden.indexOf(id) < 0) hidden.push(id);
    saveLayout(currentOrder(), hidden);
    Board.toast("Widget hidden - Reset layout brings it back");
  }

  function resetLayout() {
    saveLayout(DEFAULT_ORDER.slice(), []);
    Board.toast("Dashboard reset to its default layout");
  }

  function toggleArrange() {
    arranging = !arranging;
    arrangeBtn.setAttribute("aria-pressed", String(arranging));
    arrangeBtn.textContent = arranging ? "Done" : "Arrange";
    arrangeBtn.classList.toggle("primary", arranging);
    resetBtn.hidden = !arranging;
    render();
    if (arranging) Board.toast("Drag widgets to reorder, or use the arrows");
  }

  /* -------------------------------------------------------------------- render */

  function card(id) {
    var def = WIDGETS[id];
    var node = el("section", "widget widget-" + id);
    node.dataset.widget = id;

    var head = el("div", "widget-head");
    var badge = el("span", "widget-badge");
    badge.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (GLYPHS[id] || "") +
      "</svg>";
    head.appendChild(badge);
    var title = el("h2", "", def.title);
    head.appendChild(title);
    var tools = el("div", "widget-tools");

    if (arranging) {
      var up = iconBtn("Move " + def.title + " up", "↑");
      up.addEventListener("click", function () { move(id, -1); });
      var down = iconBtn("Move " + def.title + " down", "↓");
      down.addEventListener("click", function () { move(id, 1); });
      var remove = iconBtn("Hide " + def.title, "✕");
      remove.addEventListener("click", function () {
        hideWidget(id);
      });
      tools.appendChild(up);
      tools.appendChild(down);
      tools.appendChild(remove);
      node.draggable = true;
      node.addEventListener("dragstart", function (event) {
        dragId = id;
        node.classList.add("dragging");
        event.dataTransfer.setData("text/plain", id);
        event.dataTransfer.effectAllowed = "move";
      });
      node.addEventListener("dragend", function () {
        dragId = null;
        node.classList.remove("dragging");
        var order = Array.prototype.map.call(grid.children, function (child) {
          return child.dataset.widget;
        }).filter(Boolean);
        saveLayout(order, hiddenList());
      });
    }
    head.appendChild(tools);
    node.appendChild(head);

    var body = el("div", "widget-body");
    def.render(body);
    node.appendChild(body);
    return node;
  }

  function fillHeader() {
    if (!boardView) return;
    var date = Board.parseKey(boardView.today);
    var hour = new Date().getHours();
    var greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    greetEl.textContent = greeting;

    var lessons = todayLessons().filter(function (lesson) { return lesson.state !== "break"; });
    var openToday = boardView.tasks.filter(function (task) {
      return !task.done && (task.date === boardView.today || task.due === boardView.today);
    }).length;
    var bits = [WEEKDAYS[date.getDay()] + ", " + date.getDate() + " " + MONTHS[date.getMonth()]];
    bits.push(
      lessons.length
        ? countText(lessons.length, "class", "classes") + " " + (window.I18n ? window.I18n.t("today") : "today")
        : "no classes today"
    );
    if (openToday) bits.push(openToday + " task" + (openToday === 1 ? "" : "s") + " for today");
    subEl.textContent = bits.join(" · ");
  }

  /* The grid is as wide as the content column, so the number of columns comes
     from the measured width, not from the window. Every card is one column;
     the last card of an incomplete row takes what is left, which is what keeps
     the default five-card order from leaving a lonely card under four others. */
  function columnsFor(width) {
    if (width >= 1200) return 4;
    if (width >= 860) return 3;
    if (width >= 560) return 2;
    return 1;
  }

  function applySpans() {
    if (!grid) return;
    var cols = columnsFor(grid.clientWidth || 0);
    grid.style.setProperty("--dash-cols", String(cols));
    var cards = Array.prototype.filter.call(grid.children, function (child) {
      return child.classList && child.classList.contains("widget");
    });
    var cursor = 0;
    cards.forEach(function (node, index) {
      var left = cols - (cursor % cols);
      var span = index === cards.length - 1 && left > 0 ? left : 1;
      node.style.setProperty("--col-span", "span " + span);
      cursor += span;
    });
  }

  function render() {
    if (!grid) return;
    var order = currentOrder();
    var hidden = hiddenList();
    var shown = order.filter(function (id) {
      return WIDGETS[id] && hidden.indexOf(id) < 0;
    });

    Board.clear(grid);
    grid.classList.toggle("arranging", arranging);
    if (!shown.length) {
      var empty = el("div", "empty dash-empty", "Every widget is hidden. Use Reset layout to bring them back.");
      grid.appendChild(empty);
    } else {
      shown.forEach(function (id) { grid.appendChild(card(id)); });
    }
    applySpans();
    fillHeader();
  }

  /* --------------------------------------------------------------------- init */

  function init() {
    grid = document.getElementById("dash-grid");
    greetEl = document.getElementById("dash-greeting");
    subEl = document.getElementById("dash-sub");
    arrangeBtn = document.getElementById("dash-arrange");
    resetBtn = document.getElementById("dash-reset");
    newTaskBtn = document.getElementById("dash-new-task");

    arrangeBtn.addEventListener("click", toggleArrange);
    resetBtn.addEventListener("click", resetLayout);
    newTaskBtn.addEventListener("click", function () {
      if (window.Tasks) window.Tasks.openTaskForm(null, { date: Board.todayKey() });
    });

    grid.addEventListener("dragover", function (event) {
      if (!arranging || !dragId) return;
      event.preventDefault();
      var target = event.target.closest ? event.target.closest(".widget") : null;
      if (!target || target.dataset.widget === dragId) return;
      var dragged = grid.querySelector('.widget[data-widget="' + dragId + '"]');
      if (!dragged) return;
      var box = target.getBoundingClientRect();
      var after = event.clientY > box.top + box.height / 2;
      grid.insertBefore(dragged, after ? target.nextSibling : target);
    });

    Board.on(function (view) {
      boardView = view;
      render();
    });

    if (window.ResizeObserver) {
      var lastWidth = 0;
      new ResizeObserver(function () {
        if (grid.clientWidth === lastWidth) return;
        lastWidth = grid.clientWidth;
        applySpans();
      }).observe(grid);
    }
    window.addEventListener("resize", applySpans);

    if (window.Flip) window.Flip.subscribe(onSnapshot);
  }

  /* The snapshot changes every minute with the clock; redrawing then would
     wipe whatever the user is typing, so only real changes redraw. */
  function stampOf(next) {
    var timer = next.timer || {};
    var dash = next.dashboard || { order: [], hidden: [] };
    return [
      next.focusActive,
      next.focusSecs,
      timer.state,
      timer.h,
      timer.m,
      timer.s,
      dash.order.join(","),
      dash.hidden.join(","),
    ].join("|");
  }

  function onSnapshot(next) {
    if (!next) return;
    snap = next;
    if (next.dashboard) layout = next.dashboard;
    var stamp = stampOf(next);
    var changed = stamp !== signature;
    signature = stamp;
    if (visible && changed) render();
  }

  function show() {
    visible = true;
    render();
    clearInterval(ticker);
    ticker = setInterval(render, 30000);
  }

  function hide() {
    visible = false;
    clearInterval(ticker);
    ticker = 0;
  }

  window.Dashboard = {
    init: init,
    show: show,
    hide: hide,
    refresh: render,
  };
})();
