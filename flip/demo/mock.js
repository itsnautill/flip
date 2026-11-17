/* Flip demo backend.

   Runs the real interface in a plain browser, with no Tauri and no Rust. It
   answers the same commands the app calls, keeps everything in memory and
   fills the timetable, tasks and study log with example data, so the demo is
   something to look at instead of an empty shell. Nothing here is saved: a
   reload starts from the example data again. */

(function () {
  "use strict";

  var DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var COLORS = ["#B4622D", "#C9974A", "#6F8F5B", "#4F7F8C", "#7A6BA8", "#B25C6B", "#8A7A65", "#55708C"];

  /* ------------------------------------------------------------- date helpers */

  function iso(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function shift(date, days) {
    var next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function mondayOf(date, weekStart) {
    var day = date.getDay(); // 0 = Sunday
    var offset = weekStart === "Sun" ? day : (day + 6) % 7;
    return shift(date, -offset);
  }

  function shortDate(text) {
    var date = new Date(text + "T00:00:00");
    return MONTHS[date.getMonth()] + " " + date.getDate();
  }

  function todayKey() {
    return DAY_KEYS[(new Date().getDay() + 6) % 7];
  }

  /* ------------------------------------------------------------- example data */

  /* ------------------------------------------------------------- language copy */

  /* The demo speaks the same language as the interface. The app writes the
     choice to localStorage and reloads, so the mock reads it back on boot. */
  var COPY = {
    en: {
      periods: ["Period 1", "Period 2", "Period 3", "Break", "Period 4", "Period 5"],
      subjects: {
        "s-toan": ["Math", "B12 · Ms Lan"],
        "s-van": ["Literature", "A04 · Mr Hung"],
        "s-anh": ["English", "C02 · Ms Mai"],
        "s-ly": ["Physics", "Lab 2"],
        "s-hoa": ["Chemistry", "Lab 1"],
        "s-sinh": ["Biology", "B06"],
        "s-su": ["History", "A08"],
        "s-dia": ["Geography", "A09"],
        "s-hdtn": ["Homeroom", "School yard"],
        "s-nhac": ["Music", "Music room"]
      },
      tasks: {
        t1: "Do the exercises on p.42 (Q3, 4, 5)",
        t2: "Prepare “The Last Leaf”",
        t3: "Learn the Unit 4 vocabulary",
        t4: "Study sections 2.3 + 2.4 + 3.1 of chapter 8",
        t5: "Write the group 2 lab report",
        t6: "Revise chapter 2: dynamics",
        t7: "Draw the climate map of Vietnam",
        t8: "Prepare the homeroom presentation",
        t9: "Make the midterm outline for Biology",
        t10: "Copy the lyrics for Music"
      },
      notes: { t2: "Read the author section first", t5: "Hand it in before period 4", t7: "A3 paper" },
      suggestionTitle: "has work with no day planned",
      suggestionQuestion: "Plan it for tonight?"
    },
    vi: {
      periods: ["Tiết 1", "Tiết 2", "Tiết 3", "Giải lao", "Tiết 4", "Tiết 5"],
      subjects: {
        "s-toan": ["Toán", "B12 · Cô Lan"],
        "s-van": ["Ngữ văn", "A04 · Thầy Hùng"],
        "s-anh": ["Tiếng Anh", "C02 · Cô Mai"],
        "s-ly": ["Vật lí", "Lab 2"],
        "s-hoa": ["Hoá học", "Lab 1"],
        "s-sinh": ["Sinh học", "B06"],
        "s-su": ["Lịch sử", "A08"],
        "s-dia": ["Địa lí", "A09"],
        "s-hdtn": ["HĐTN", "Sân trường"],
        "s-nhac": ["Âm nhạc", "Phòng nhạc"]
      },
      tasks: {
        t1: "Giải bài tập SGK tr.42 (câu 3, 4, 5)",
        t2: "Soạn bài “Chiếc lá cuối cùng”",
        t3: "Học từ vựng Unit 4",
        t4: "Học hết phần 2.3 + 2.4 + 3.1 bài 8",
        t5: "Viết báo cáo thí nghiệm nhóm 2",
        t6: "Ôn tập chương 2: động lực học",
        t7: "Vẽ bản đồ khí hậu Việt Nam",
        t8: "Chuẩn bị thuyết trình HĐTN",
        t9: "Làm đề cương giữa kì môn Sinh",
        t10: "Chép lời bài hát cho tiết Âm nhạc"
      },
      notes: { t2: "Đọc trước phần tác giả", t5: "Nộp cho cô trước tiết 4", t7: "Giấy A3" },
      suggestionTitle: "có bài chưa xếp ngày",
      suggestionQuestion: "Xếp vào tối nay nhé?"
    }
  };

  var language = localStorage.getItem("flip-demo-language") === "vi" ? "vi" : "en";
  var copy = COPY[language];

  var periods = [
    { id: "p1", label: copy.periods[0], start: "07:00", end: "07:45", break: false },
    { id: "p2", label: copy.periods[1], start: "07:50", end: "08:35", break: false },
    { id: "p3", label: copy.periods[2], start: "08:40", end: "09:25", break: false },
    { id: "b1", label: copy.periods[3], start: "09:25", end: "09:45", break: true },
    { id: "p4", label: copy.periods[4], start: "09:45", end: "10:30", break: false },
    { id: "p5", label: copy.periods[5], start: "10:35", end: "11:20", break: false }
  ];

  function subject(id, color) {
    var pair = copy.subjects[id];
    return { id: id, name: pair[0], color: color, room: pair[1] };
  }

  var subjects = [
    subject("s-toan", "#55708C"),
    subject("s-van", "#B4622D"),
    subject("s-anh", "#6F8F5B"),
    subject("s-ly", "#7A6BA8"),
    subject("s-hoa", "#C9974A"),
    subject("s-sinh", "#4F7F8C"),
    subject("s-su", "#B25C6B"),
    subject("s-dia", "#8A7A65"),
    subject("s-hdtn", "#6F8F5B"),
    subject("s-nhac", "#C9974A")
  ];

  var HUES = [51, 76, 134, 217, 295, 10, 249, 313, 148, 352];
  subjects.forEach(function (subject, index) {
    subject.hue = HUES[index % HUES.length];
  });

  var timetable = {
    "Mon-p1": "s-toan", "Mon-p2": "s-van", "Mon-p3": "s-anh", "Mon-p4": "s-ly", "Mon-p5": "s-hdtn",
    "Tue-p1": "s-hoa", "Tue-p2": "s-sinh", "Tue-p3": "s-toan", "Tue-p4": "s-su", "Tue-p5": "s-nhac",
    "Wed-p1": "s-van", "Wed-p2": "s-anh", "Wed-p3": "s-ly", "Wed-p4": "s-hoa", "Wed-p5": "s-toan",
    "Thu-p1": "s-su", "Thu-p2": "s-dia", "Thu-p3": "s-van", "Thu-p4": "s-sinh", "Thu-p5": "s-anh",
    "Fri-p1": "s-toan", "Fri-p2": "s-hoa", "Fri-p3": "s-dia", "Fri-p4": "s-van", "Fri-p5": "s-ly",
    "Sat-p1": "s-van", "Sat-p2": "s-toan", "Sat-p3": "s-anh", "Sat-p4": "s-hdtn",
    "Sun-p4": "s-nhac", "Sun-p5": "s-sinh"
  };

  /* The demo keeps the real date and puts lessons on every day of the week,
     including a lighter weekend, so the page always has something to show. */
  var today = new Date();
  var weekStart = "Mon";
  var days = DAY_KEYS.slice();
  var setupDismissed = false;
  var dayLabels = {};
  var breakMinutes = 5;
  var locked = false;

  function at(offset) {
    return iso(shift(today, offset));
  }

  function task(id, subjectId, date, due, time, priority, done) {
    return {
      id: id,
      title: copy.tasks[id],
      subjectId: subjectId,
      date: date,
      due: due,
      time: time,
      notes: copy.notes[id] || "",
      priority: priority,
      done: done
    };
  }

  var tasks = [
    task("t1", "s-toan", at(0), at(1), "19:30", "high", false),
    task("t2", "s-van", at(0), at(2), "", "medium", false),
    task("t3", "s-anh", at(1), "", "20:00", "low", false),
    task("t4", "s-su", "", at(3), "", "high", false),
    task("t5", "s-hoa", at(2), at(4), "", "medium", false),
    task("t6", "s-ly", at(3), "", "", "medium", false),
    task("t7", "s-dia", "", at(5), "", "low", false),
    task("t8", "s-hdtn", at(4), "", "", "medium", false),
    task("t9", "s-sinh", at(-1), at(-1), "", "high", true),
    task("t10", "s-nhac", at(-1), "", "", "low", true)
  ];

  var sessions = [
    { id: "f1", taskId: "t1", subjectId: "s-toan", secs: 25 * 60, date: at(0) },
    { id: "f2", taskId: null, subjectId: "s-van", secs: 25 * 60, date: at(0) },
    { id: "f3", taskId: "t5", subjectId: "s-hoa", secs: 30 * 60, date: at(-1) },
    { id: "f4", taskId: null, subjectId: "s-anh", secs: 20 * 60, date: at(-1) },
    { id: "f5", taskId: "t9", subjectId: "s-sinh", secs: 45 * 60, date: at(-2) },
    { id: "f6", taskId: null, subjectId: "s-su", secs: 25 * 60, date: at(-3) },
    { id: "f7", taskId: null, subjectId: "s-ly", secs: 25 * 60, date: at(-3) }
  ];

  var snapshot = {
    mode: "clock",
    clock: { h: "07", m: "00", s: "00", pm: false, is12h: false },
    timer: { state: "idle", h: "00", m: "00", s: "00", secs: 0, showHours: false, typing: false, remaining: 0 },
    theme: "light",
    language: language,
    sound: false,
    onboarded: true,
    motion: "normal",
    touch: false,
    zoom: 100,
    wash: true,
    discord: true,
    telemetry: false,
    installId: "",
    accentHue: 51,
    focusSecs: 25 * 60,
    dashboard: { order: ["next", "today", "due", "tasks", "focus", "stats"], hidden: [] },
    focusActive: false
  };

  var backups = [];

  /* -------------------------------------------------------------- view shapes */

  function pendingCount(subjectId) {
    var count = 0;
    tasks.forEach(function (task) {
      if (!task.done && task.subjectId === subjectId) count += 1;
    });
    return count;
  }

  function focusView() {
    var start = iso(mondayOf(today, weekStart));
    var todaySecs = 0;
    var weekSecs = 0;
    var todaySessions = 0;
    var demoDay = iso(today);
    sessions.forEach(function (session) {
      if (session.date === demoDay) {
        todaySecs += session.secs;
        todaySessions += 1;
      }
      if (session.date >= start) weekSecs += session.secs;
    });
    return { todaySecs: todaySecs, weekSecs: weekSecs, streak: 4, sessionsToday: todaySessions };
  }

  function weekView() {
    var startDate = mondayOf(today, weekStart);
    var endDate = shift(startDate, 6);
    var days = [];
    for (var i = 0; i < 7; i += 1) {
      var date = shift(startDate, i);
      days.push({
        date: iso(date),
        label: MONTHS[date.getMonth()] + " " + date.getDate(),
        dayKey: DAY_KEYS[(date.getDay() + 6) % 7],
        isToday: iso(date) === iso(today)
      });
    }
    return {
      start: iso(startDate),
      end: iso(endDate),
      label:
        MONTHS[startDate.getMonth()] + " " + startDate.getDate() + " to " +
        MONTHS[endDate.getMonth()] + " " + endDate.getDate() + ", " + endDate.getFullYear(),
      days: days
    };
  }

  function currentPeriodId() {
    var now = new Date();
    var minutes = now.getHours() * 60 + now.getMinutes();
    var match = null;
    periods.forEach(function (period) {
      if (period.break) return;
      var parts = period.start.split(":");
      var from = Number(parts[0]) * 60 + Number(parts[1]);
      parts = period.end.split(":");
      var to = Number(parts[0]) * 60 + Number(parts[1]);
      if (minutes >= from && minutes < to) match = period.id;
    });
    return match;
  }

  function buildView() {
    var cells = {};
    Object.keys(timetable).forEach(function (key) {
      var subject = subjects.find(function (s) { return s.id === timetable[key]; });
      if (!subject) return;
      cells[key] = {
        subjectId: subject.id,
        name: subject.name,
        hue: Number(subject.hue),
        room: subject.room,
        pending: pendingCount(subject.id)
      };
    });

    var subjectViews = subjects.map(function (subject) {
      var onTimetable = Object.keys(timetable).some(function (key) {
        return timetable[key] === subject.id;
      });
      return {
        id: subject.id,
        name: subject.name,
        hue: Number(subject.hue),
        room: subject.room,
        pending: pendingCount(subject.id),
        inTimetable: onTimetable
      };
    });

    var dayKey = DAY_KEYS[(today.getDay() + 6) % 7];
    var open = tasks.filter(function (task) { return !task.done && !task.date && task.subjectId; });
    var suggestions = [];
    if (open.length) {
      var first = open[0];
      var subject = subjects.find(function (s) { return s.id === first.subjectId; });
      var group = open.filter(function (task) { return task.subjectId === first.subjectId; });
      suggestions.push({
        id: "sug-" + first.subjectId,
        kind: "due",
        subjectId: first.subjectId,
        subjectName: subject ? subject.name : "",
        subjectHue: subject ? Number(subject.hue) : 51,
        date: iso(today),
        title: (subject ? subject.name : "") + " " + copy.suggestionTitle,
        question: copy.suggestionQuestion,
        tasks: group.map(function (task) {
          return { id: task.id, title: task.title, due: task.due || null };
        })
      });
    }

    return {
      days: days.map(function (key) {
        return { key: key, label: dayLabels[key] || key, isToday: key === dayKey };
      }),
      periods: periods,
      cells: cells,
      subjects: subjectViews,
      tasks: tasks,
      today: iso(today),
      week: weekView(),
      currentPeriod: currentPeriodId(),
      focus: focusView(),
      suggestions: suggestions,
      suggestionCount: suggestions.length,
      showWeekend: true,
      weekStart: weekStart,
      setupDismissed: setupDismissed,
      locked: locked,
      canUndo: history.length > 0,
      canRedo: future.length > 0
    };
  }

  /* ------------------------------------------------------------ timer + clock */

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function tickClock() {
    var now = new Date();
    var hour = now.getHours();
    var twelve = snapshot.clock.is12h;
    var shown = twelve ? hour % 12 || 12 : hour;
    snapshot.clock = {
      h: pad(shown),
      m: pad(now.getMinutes()),
      s: pad(now.getSeconds()),
      pm: hour >= 12,
      is12h: twelve
    };
  }

  function paintTimer() {
    var remaining = Math.max(0, snapshot.timer.remaining);
    var hours = Math.floor(remaining / 3600);
    var minutes = Math.floor((remaining % 3600) / 60);
    var secs = remaining % 60;
    snapshot.timer.h = pad(hours);
    snapshot.timer.m = pad(minutes);
    snapshot.timer.s = pad(secs);
    snapshot.timer.secs = remaining;
    snapshot.timer.showHours = hours > 0;
  }

  /* --------------------------------------------------------------- commands */

  function clockMinutes(text) {
    var parts = String(text || "07:30").split(":");
    return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
  }

  function clockText(minutes) {
    var value = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function ok(value) {
    return Promise.resolve(clone(value));
  }

  var history = [];
  var future = [];

  function remember() {
    history.push(clone({ days: days, periods: periods, timetable: timetable, subjects: subjects, setupDismissed: setupDismissed }));
    if (history.length > 40) history.shift();
    future = [];
  }

  function step(back) {
    var from = back ? history : future;
    var to = back ? future : history;
    if (!from.length) return Promise.reject("Nothing to " + (back ? "undo" : "redo") + ".");
    var state = from.pop();
    to.push(clone({ days: days, periods: periods, timetable: timetable, subjects: subjects, setupDismissed: setupDismissed }));
    days = state.days;
    periods = state.periods;
    timetable = state.timetable;
    subjects = state.subjects;
    setupDismissed = state.setupDismissed;
    return ok(buildView());
  }

  function parseTable(text) {
    var lines = String(text).replace(/\r/g, "").split("\n").filter(function (line) { return line.trim(); });
    if (!lines.length) return Promise.reject("Paste a table first.");
    var grid = lines.map(function (line) { return line.split(line.indexOf("\t") >= 0 ? "\t" : /,|;/); });
    var rows = [];
    var clock = function (value) {
      var match = String(value).match(/(\d{1,2})[:.h](\d{2})/);
      return match ? match[1].padStart(2, "0") + ":" + match[2] : null;
    };
    for (var r = 1; r < grid.length; r++) {
      var times = String(grid[r][0] || "").match(/(\d{1,2})[:.h](\d{2})\s*[-–]\s*(\d{1,2})[:.h](\d{2})/);
      if (!times) continue;
      for (var c = 1; c < grid[r].length; c++) {
        var name = String(grid[r][c] || "").trim();
        var day = grid[0][c] ? String(grid[0][c]).trim() : "";
        if (!name || !day) continue;
        rows.push({
          day: day,
          start: clock(times[1] + ":" + times[2]),
          end: clock(times[3] + ":" + times[4]),
          subject: name,
          room: "",
        });
      }
    }
    if (!rows.length) return Promise.reject("That table has no lessons in it.");
    var unique = function (values) {
      return values.filter(function (value, index, all) { return all.indexOf(value) === index; }).length;
    };
    return ok({
      rows: rows,
      days: unique(rows.map(function (row) { return row.day; })),
      periods: unique(rows.map(function (row) { return row.start + row.end; })),
      subjects: unique(rows.map(function (row) { return row.subject.toLowerCase(); })),
    });
  }

  function boardAction(action) {
    return applyAction(action).then(function (view) {
      return view;
    });
  }

  function applyAction(action) {
    var kind = action.kind;
    remember();
    if (kind === "toggleTask") {
      tasks.forEach(function (task) {
        if (task.id === action.id) task.done = !task.done;
      });
    } else if (kind === "addTask") {
      tasks.push({
        id: "t" + (tasks.length + 1) + "-" + Date.now(),
        title: action.title || "Untitled",
        subjectId: action.subjectId || null,
        date: action.date || null,
        due: action.due || null,
        time: action.time || "",
        notes: action.notes || "",
        priority: action.priority || null,
        done: false
      });
    } else if (kind === "updateTask") {
      tasks.forEach(function (task) {
        if (task.id !== action.id) return;
        task.title = action.title;
        task.subjectId = action.subjectId || null;
        task.date = action.date || null;
        task.due = action.due || null;
        task.time = action.time || "";
        task.notes = action.notes || "";
        task.priority = action.priority || null;
      });
    } else if (kind === "deleteTask") {
      tasks = tasks.filter(function (task) { return task.id !== action.id; });
    } else if (kind === "scheduleTask" || kind === "snooze") {
      tasks.forEach(function (task) {
        if (task.id === action.id) task.date = action.date;
      });
    } else if (kind === "unschedule") {
      tasks.forEach(function (task) {
        if (task.id === action.id) task.date = null;
      });
    } else if (kind === "saveCellMany") {
      var existingSubject = subjects.find(function (s) { return s.name === action.name; });
      var placed = existingSubject || {
        id: "s-" + Date.now(),
        name: action.name,
        hue: Number(action.hue) || 51,
        room: action.room || ""
      };
      if (!existingSubject) subjects.push(placed);
      if (typeof action.hue === "number") placed.hue = action.hue;
      if (action.room) placed.room = action.room;
      timetable[action.day + "-" + action.periodId] = placed.id;
      (action.also || []).forEach(function (day) {
        timetable[day + "-" + action.periodId] = placed.id;
      });
    } else if (kind === "createGrid") {
      days = (action.days || []).slice();
      periods = [];
      timetable = {};
      var cursor = clockMinutes(action.start);
      for (var i = 0; i < action.count; i++) {
        var end = cursor + action.periodMins;
        periods.push({
          id: "p" + (i + 1),
          label: "Tiết " + (i + 1),
          start: clockText(cursor),
          end: clockText(end),
          break: false
        });
        cursor = end + (action.breakMins || 0);
        if (action.longAfter === i + 1) cursor += action.longMins || 0;
      }
      breakMinutes = Math.min(120, Number(action.breakMins) || 0);
      dayLabels = {};
      setupDismissed = true;
    } else if (kind === "setSetup") {
      setupDismissed = Boolean(action.dismissed);
    } else if (kind === "moveCell") {
      var fromKey = action.fromDay + "-" + action.fromPeriod;
      var toKey = action.toDay + "-" + action.toPeriod;
      var moving = timetable[fromKey];
      if (moving) {
        var displaced = timetable[toKey];
        timetable[toKey] = moving;
        if (displaced) timetable[fromKey] = displaced;
        else delete timetable[fromKey];
      }
    } else if (kind === "paintCells") {
      (action.cells || []).forEach(function (cell) {
        timetable[cell.day + "-" + cell.periodId] = action.subjectId;
      });
    } else if (kind === "removeSubject") {
      Object.keys(timetable).forEach(function (key) {
        if (timetable[key] === action.id) delete timetable[key];
      });
      subjects = subjects.filter(function (subject) { return subject.id !== action.id; });
      tasks.forEach(function (task) {
        if (task.subjectId === action.id) task.subjectId = null;
      });
    } else if (kind === "movePeriod") {
      var at = periods.findIndex(function (period) { return period.id === action.id; });
      var next = at + action.offset;
      if (at >= 0 && next >= 0 && next < periods.length) {
        var row = periods.splice(at, 1)[0];
        periods.splice(next, 0, row);
      }
    } else if (kind === "saveCell") {
      var existing = subjects.find(function (s) { return s.name === action.name; });
      var subject = existing || {
        id: "s-" + Date.now(),
        name: action.name,
        hue: Number(action.hue) || 51,
        room: action.room || ""
      };
      if (!existing) subjects.push(subject);
      subject.name = action.name;
      if (typeof action.hue === "number") subject.hue = action.hue;
      subject.room = action.room || "";
      timetable[action.day + "-" + action.periodId] = subject.id;
      if (action.applyAll) {
        Object.keys(timetable).forEach(function (key) {
          if (timetable[key] === subject.id) return;
        });
      }
    } else if (kind === "clearCell") {
      delete timetable[action.day + "-" + action.periodId];
    } else if (kind === "addPeriod") {
      var index = periods.length + 1;
      var lastRow = periods[periods.length - 1];
      var startMin = lastRow ? clockMinutes(lastRow.end) + breakMinutes : 7 * 60 + 30;
      periods.push({
        id: "p" + Date.now(),
        label: "Tiết " + index,
        start: clockText(startMin),
        end: clockText(startMin + 45),
        break: false
      });
    } else if (kind === "updatePeriod") {
      var before = null;
      periods.forEach(function (period) {
        if (period.id === action.id) before = clockMinutes(period.start);
      });
      periods.forEach(function (period) {
        if (period.id !== action.id) return;
        period.label = action.label;
        period.start = action.start;
        period.end = action.end;
        period.break = Boolean(action.isBreak);
      });
      if (action.shiftLater && before !== null) {
        var delta = clockMinutes(action.start) - before;
        var seen = false;
        periods.forEach(function (period) {
          if (period.id === action.id) {
            seen = true;
            return;
          }
          if (!seen || !delta) return;
          period.start = clockText(clockMinutes(period.start) + delta);
          period.end = clockText(clockMinutes(period.end) + delta);
        });
      }
    } else if (kind === "removePeriod") {
      periods = periods.filter(function (period) { return period.id !== action.id; });
    } else if (kind === "setWeekend") {
      snapshot.showWeekend = Boolean(action.show);
    } else if (kind === "setWeekStart") {
      weekStart = action.start === "Sun" ? "Sun" : "Mon";
    } else if (kind === "addDay") {
      if (days.indexOf(action.day) < 0) days.push(action.day);
      days.sort(function (a, b) {
        return DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b);
      });
      setupDismissed = false;
    } else if (kind === "removeDay") {
      days = days.filter(function (day) { return day !== action.day; });
      delete dayLabels[action.day];
      Object.keys(timetable).forEach(function (key) {
        if (key.indexOf(action.day + "-") === 0) delete timetable[key];
      });
    } else if (kind === "renameDay") {
      var clean = String(action.label || "").trim().slice(0, 24);
      if (clean) dayLabels[action.day] = clean;
      else delete dayLabels[action.day];
    } else if (kind === "moveDay") {
      var dayAt = days.indexOf(action.day);
      var dayTo = dayAt + action.offset;
      if (dayAt >= 0 && dayTo >= 0 && dayTo < days.length) {
        var movedDay = days.splice(dayAt, 1)[0];
        days.splice(dayTo, 0, movedDay);
      }
    } else if (kind === "setLocked") {
      locked = Boolean(action.locked);
    } else if (kind === "setBreak") {
      breakMinutes = Math.min(120, Number(action.minutes) || 0);
    } else if (kind === "setGuide") {
      setupDismissed = Boolean(action.dismissed);
    } else if (kind === "importTimetable") {
      if (!action.merge) {
        timetable = {};
        periods = [];
        days = [];
      }
      (action.rows || []).forEach(function (row) {
        if (!row.day || !row.start) return;
        if (days.indexOf(row.day) < 0) days.push(row.day);
        var period = periods.find(function (item) {
          return item.start === row.start && item.end === row.end;
        });
        if (!period) {
          period = {
            id: "p" + (periods.length + 1) + "-" + row.start.replace(":", ""),
            label: "Tiết " + (periods.length + 1),
            start: row.start,
            end: row.end,
            break: false,
          };
          periods.push(period);
        }
        var subject = subjects.find(function (item) {
          return item.name.toLowerCase() === String(row.subject || "").toLowerCase();
        });
        if (!subject) {
          subject = { id: "s-" + (subjects.length + 1) + row.subject, name: row.subject, hue: 51, room: row.room || "" };
          subjects.push(subject);
        }
        timetable[row.day + "-" + period.id] = subject.id;
      });
      periods.sort(function (a, b) { return a.start.localeCompare(b.start); });
      days.sort(function (a, b) { return DAY_KEYS.indexOf(a) - DAY_KEYS.indexOf(b); });
      setupDismissed = true;
    } else if (kind === "resetTimetable") {
      timetable = {};
      periods = [];
      days = [];
      dayLabels = {};
    } else if (kind === "neverSuggest") {
      /* nothing to remember in the demo */
    }
    return ok(buildView());
  }

  function handle(command, args) {
    tickClock();
    switch (command) {
      case "get_snapshot":
        return ok(snapshot);
      case "get_board":
        return ok(buildView());
      case "board_action":
        return boardAction(args.action || {});
      case "switch_mode":
        snapshot.mode = snapshot.mode === "clock" ? "timer" : "clock";
        return ok(snapshot);
      case "timer_toggle":
        if (snapshot.timer.state === "running") snapshot.timer.state = "paused";
        else if (snapshot.timer.state === "paused") snapshot.timer.state = "running";
        else snapshot.timer.state = "running";
        return ok(snapshot);
      case "timer_reset":
        snapshot.timer.state = "idle";
        snapshot.timer.remaining = 0;
        snapshot.focusActive = false;
        paintTimer();
        return ok(snapshot);
      case "timer_set":
        snapshot.timer.state = "paused";
        snapshot.timer.remaining = Math.max(0, Number(args.secs) || 0);
        snapshot.mode = "timer";
        paintTimer();
        return ok(snapshot);
      case "timer_digit":
      case "timer_backspace":
        return ok(snapshot);
      case "toggle_hour_format":
        snapshot.clock.is12h = !snapshot.clock.is12h;
        return ok(snapshot);
      case "set_hour_format":
        snapshot.clock.is12h = Boolean(args.use12h);
        return ok(snapshot);
      case "set_theme":
        snapshot.theme = args.theme;
        return ok(snapshot);
      case "set_accent_hue":
        snapshot.accentHue = Number(args.hue) || 0;
        return ok(snapshot);
      case "set_language":
        snapshot.language = args.language;
        try {
          localStorage.setItem("flip-demo-language", args.language === "vi" ? "vi" : "en");
        } catch (error) {
          /* a browser with storage blocked just keeps the current language */
        }
        return ok(snapshot);
      case "set_sound":
        snapshot.sound = Boolean(args.enabled);
        return ok(snapshot);
      case "set_motion":
        snapshot.motion = args.motion;
        return ok(snapshot);
      case "set_touch":
        snapshot.touch = Boolean(args.enabled);
        return ok(snapshot);
      case "set_wash":
        snapshot.wash = Boolean(args.enabled);
        return ok(snapshot);
      case "set_discord":
        snapshot.discord = Boolean(args.enabled);
        return ok(snapshot);
      case "set_zoom":
        snapshot.zoom = Math.max(80, Math.min(160, Number(args.percent) || 100));
        return ok(snapshot);
      case "set_telemetry":
        snapshot.telemetry = Boolean(args.enabled);
        return ok(snapshot);
      case "set_onboarded":
        snapshot.onboarded = Boolean(args.onboarded);
        return ok(snapshot);
      case "set_dashboard":
        snapshot.dashboard = { order: args.order || [], hidden: args.hidden || [] };
        return ok(snapshot);
      case "start_focus":
        snapshot.focusActive = true;
        snapshot.timer.remaining = Number(args.secs) || snapshot.focusSecs;
        snapshot.timer.state = "running";
        snapshot.mode = "timer";
        paintTimer();
        return ok(snapshot);
      case "cancel_focus":
        snapshot.focusActive = false;
        snapshot.timer.state = "idle";
        snapshot.timer.remaining = 0;
        paintTimer();
        return ok(snapshot);
      case "app_version":
        return Promise.resolve("1.0.2-demo");
      case "save_template":
        return Promise.resolve("Flip timetable template.csv");
      case "list_backups":
        return ok(backups);
      case "make_backup":
        backups.push({ name: "backup-" + Date.now() + ".json", size: 4096 });
        return ok(backups[backups.length - 1]);
      case "delete_backup":
        backups = backups.filter(function (item) { return item.name !== args.name; });
        return ok(backups);
      case "restore_backup":
        return ok(snapshot);
      case "export_data":
        return Promise.resolve("Flip timetable.csv");
      case "save_export":
        return Promise.resolve("Flip timetable.xlsx");
      case "read_timetable_table":
        return parseTable(args.text || "");
      case "undo_board":
        return step(true);
      case "redo_board":
        return step(false);
      case "open_folder":
      case "open_url":
        return Promise.resolve(null);
      case "download_update":
      case "install_update":
        return Promise.reject(new Error("Updates are turned off in the demo."));
      default:
        return ok(snapshot);
    }
  }

  /* ------------------------------------------------------------------ wiring */

  var listeners = {};

  function emit(name, payload) {
    (listeners[name] || []).forEach(function (handler) {
      handler({ event: name, payload: payload === undefined ? null : payload });
    });
  }

  window.__TAURI__ = {
    core: {
      invoke: function (command, args) {
        return handle(command, args || {});
      }
    },
    event: {
      listen: function (name, handler) {
        listeners[name] = listeners[name] || [];
        listeners[name].push(handler);
        return Promise.resolve(function () {
          listeners[name] = listeners[name].filter(function (item) { return item !== handler; });
        });
      }
    },
    app: {
      getVersion: function () {
        return Promise.resolve("1.0.2-demo");
      }
    }
  };

  paintTimer();

  /* The real app renders from a ticker event every second; the demo does the
     same so the clock hands over and a running timer counts down. */
  setInterval(function () {
    if (snapshot.timer.state === "running" && snapshot.timer.remaining > 0) {
      snapshot.timer.remaining -= 1;
      paintTimer();
      if (snapshot.timer.remaining === 0) {
        snapshot.timer.state = "finished";
        emit("timer-finished", null);
        if (snapshot.focusActive) {
          emit("focus-finished", snapshot.focusSecs);
          snapshot.focusActive = false;
        }
      }
    }
    tickClock();
    emit("snapshot", snapshot);
  }, 1000);

  emit("snapshot", snapshot);
})();
