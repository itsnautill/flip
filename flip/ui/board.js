/* Shared frontend plumbing for the timetable and task sections.
   Rust owns the data; this file only asks for a view and renders it. */
(function () {
  "use strict";

  var invoke = window.__TAURI__.core.invoke;
  var view = null;
  var listeners = [];
  var closeCurrentModal = null;
  /* history.back() lands one task later, so a dialog opened right after another
     one closed would receive that stale popstate and close itself. Count the
     backs we asked for and swallow exactly those. */
  var pendingBacks = 0;
  /* A dialog or menu that closes itself pops the entry it pushed. That pop is
     not a Back press, but it reaches the tab handler all the same; these count
     the pops the app should ignore. */
  var selfBacks = 0;
  var toastTimer = 0;

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /* ------------------------------------------------------------- dom helpers */

  /** Subject colours come from a hue, so every surface agrees on them. */
  function subjectColour(hue) {
    if (window.FlipColor) return window.FlipColor.subjectColorFromHue(hue);
    return { border: "var(--muted)", fill: "var(--panel-2)", badge: "var(--panel-2)", text: "var(--ink)" };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function $(id) {
    return document.getElementById(id);
  }

  function icon(label, glyph, className) {
    var button = el("button", "icon-btn " + (className || ""), glyph);
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;
    return button;
  }

  /* ------------------------------------------------------------------- dates */

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function keyOf(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseKey(key) {
    var parts = String(key).split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(key, days) {
    var date = parseKey(key);
    date.setDate(date.getDate() + days);
    return keyOf(date);
  }

  function todayKey() {
    return keyOf(new Date());
  }

  function shortDate(key) {
    var date = parseKey(key);
    return MONTHS[date.getMonth()] + " " + date.getDate();
  }

  function dayKeyOf(key) {
    return DAYS_SHORT[parseKey(key).getDay()];
  }

  function longDay(key) {
    return DAYS_LONG[parseKey(key).getDay()];
  }

  function weekLabel(startKey) {
    var start = parseKey(startKey);
    var end = parseKey(addDays(startKey, 6));
    if (start.getFullYear() === end.getFullYear()) {
      return (
        MONTHS[start.getMonth()] + " " + start.getDate() + " to " +
        MONTHS[end.getMonth()] + " " + end.getDate() + ", " + end.getFullYear()
      );
    }
    return (
      MONTHS[start.getMonth()] + " " + start.getDate() + ", " + start.getFullYear() +
      " to " + MONTHS[end.getMonth()] + " " + end.getDate() + ", " + end.getFullYear()
    );
  }

  /* ------------------------------------------------------------------- state */

  async function load() {
    setView(await invoke("get_board"));
  }

  function setView(next) {
    view = next;
    listeners.forEach(function (fn) {
      try {
        fn(view);
      } catch (err) {
        console.error("flip: board render failed", err);
      }
    });
  }

  function on(fn) {
    listeners.push(fn);
    if (view) fn(view);
    return function off() {
      listeners = listeners.filter(function (item) {
        return item !== fn;
      });
    };
  }

  async function action(next) {
    try {
      setView(await invoke("board_action", { action: next }));
      return true;
    } catch (err) {
      toast(errorText(err));
      return false;
    }
  }

  function errorText(err) {
    if (typeof err === "string" && err) return err;
    if (err && err.message) return err.message;
    return "That did not work. Please try again.";
  }

  function subject(id) {
    if (!view || !id) return null;
    for (var i = 0; i < view.subjects.length; i++) {
      if (view.subjects[i].id === id) return view.subjects[i];
    }
    return null;
  }

  function tasksForSubject(id) {
    if (!view || !id) return [];
    return view.tasks.filter(function (task) {
      return task.subjectId === id;
    });
  }

  function pendingForSubject(id) {
    return tasksForSubject(id).filter(function (task) {
      return !task.done;
    }).length;
  }

  /* ------------------------------------------------------------------- toast */

  var toastLeft = 0;
  var toastStartedAt = 0;

  function hideToast() {
    var node = $("toast");
    if (!node) return;
    clearTimeout(toastTimer);
    node.hidden = true;
    node.onmouseenter = null;
    node.onmouseleave = null;
    clear(node);
  }

  function armHide(ms) {
    clearTimeout(toastTimer);
    toastStartedAt = window.performance.now();
    toastLeft = ms;
    toastTimer = setTimeout(hideToast, ms);
  }

  function toast(message, options) {
    var node = $("toast");
    if (!node) return;
    /* Both shapes are used in the app: `toast(text, options)` and the shorter
       `toast(text, "Undo", fn)` for an edit that can be taken back. */
    var opts = typeof options === "string"
      ? { actionLabel: options, onAction: arguments[2] }
      : options || {};
    clear(node);
    node.appendChild(el("span", "toast-text", message));
    if (opts.actionLabel) {
      var button = el("button", "btn small", opts.actionLabel);
      button.type = "button";
      button.addEventListener("click", function () {
        hideToast();
        if (opts.onAction) opts.onAction();
      });
      node.appendChild(button);
    }

    var bar = el("div", "toast-progress");
    var fill = el("i");
    bar.appendChild(fill);
    node.appendChild(bar);

    var duration = opts.duration || (opts.actionLabel ? 6500 : 3200);
    fill.style.setProperty("--toast-ms", duration + "ms");

    node.hidden = false;
    armHide(duration);
    /* Hovering pauses both the bar and the timer, so a long message can be
       read without it disappearing. */
    node.onmouseenter = function () {
      clearTimeout(toastTimer);
      toastLeft = Math.max(0, toastLeft - (window.performance.now() - toastStartedAt));
    };
    node.onmouseleave = function () {
      armHide(toastLeft);
    };
  }

  /* ------------------------------------------------------------------ modals */

  function isModalOpen() {
    return Boolean(closeCurrentModal) || Boolean(closeCurrentMenu);
  }

  function closeModal() {
    if (closeCurrentModal) closeCurrentModal();
  }

  /**
   * opts: { title, body, saveLabel, onSave, onDelete, onClose, hideCancel }
   * onSave may return a string (shown as an error) or a promise of one.
   */
  function modal(opts) {
    closeModal();
    var root = $("modal-root");
    clear(root);

    var overlay = el("div", "overlay");
    var panel = el("div", "modal");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", opts.title);
    if (opts.className) {
      panel.classList.add(opts.className);
      /* Lets the overlay itself go edge-to-edge for a phone sheet. */
      overlay.classList.add("overlay-" + opts.className);
    }

    var head = el("div", "modal-head");
    head.appendChild(el("h2", "", opts.title));
    var closeButton = icon("Close", "×");
    head.appendChild(closeButton);

    var form = document.createElement("form");
    form.className = "modal-body";
    form.noValidate = true;
    form.id = "flip-modal-form";
    form.appendChild(opts.body);

    var error = el("p", "form-error");
    error.hidden = true;
    form.appendChild(error);

    var foot = el("div", "modal-foot");
    if (opts.onDelete) {
      var removeButton = el("button", "btn small danger spacer", opts.deleteLabel || "Delete");
      removeButton.type = "button";
      removeButton.addEventListener("click", function () {
        if (opts.onDelete()) close();
      });
      foot.appendChild(removeButton);
    }
    var cancel = el("button", "btn small", "Cancel");
    cancel.type = "button";
    var save = el("button", "btn primary", opts.saveLabel || "Save");
    save.type = "submit";
    /* The footer lives outside the form, so point the button at it by id. */
    save.setAttribute("form", "flip-modal-form");
    if (!opts.hideCancel) foot.appendChild(cancel);
    foot.appendChild(save);

    panel.appendChild(head);
    panel.appendChild(form);
    panel.appendChild(foot);
    overlay.appendChild(panel);
    root.appendChild(overlay);

    var previousFocus = document.activeElement;

    /* Android's back button is the webview's back: one history entry per
       dialog means back closes the dialog instead of leaving the app. */
    var pushed = false;
    try {
      window.history.pushState({ flipModal: true }, "");
      pushed = true;
    } catch (_) {
      /* a browser that refuses history still closes with Esc */
    }

    function onPop(event) {
      /* The dialog's entry is the most recent one: nothing else should react
         to this back press. */
      if (event && event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (pendingBacks > 0) {
        pendingBacks--;
        return;
      }
      if (closeCurrentModal === close) close(true);
    }

    function close(fromHistory) {
      if (closeCurrentModal !== close) return;
      closeCurrentModal = null;
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("popstate", onPop);
      if (pushed && !fromHistory) {
        pushed = false;
        /* Removing the entry we added keeps the history clean. */
        pendingBacks++;
        selfBacks++;
        window.history.back();
      }
      /* Dialogs leave the way they came: Normal and Extra get a short exit,
         Fast and Snappy swap instantly (as does reduced motion). */
      var motion = document.documentElement.getAttribute("data-motion") || "normal";
      var animated =
        (motion === "normal" || motion === "extra") &&
        !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (animated && overlay.parentNode) {
        overlay.classList.add("is-closing");
        setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 220);
      } else {
        clear(root);
      }
      if (previousFocus && previousFocus.focus) {
        try {
          previousFocus.focus();
        } catch (_) {
          /* the old node may be gone */
        }
      }
      if (opts.onClose) opts.onClose();
    }

    function focusables() {
      return Array.prototype.slice
        .call(panel.querySelectorAll("input, select, textarea, button"))
        .filter(function (node) {
          return !node.disabled && node.offsetParent !== null;
        });
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var result = opts.onSave ? opts.onSave() : null;
      if (result && typeof result.then === "function") {
        save.disabled = true;
        result = await result;
        save.disabled = false;
      }
      if (typeof result === "string" && result) {
        error.textContent = result;
        error.hidden = false;
        return;
      }
      close();
    });

    closeButton.addEventListener("click", close);
    cancel.addEventListener("click", close);
    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKeyDown, true);
    if (pushed) window.addEventListener("popstate", onPop);

    closeCurrentModal = close;
    /* Colours, radios, files and hidden inputs are not where a dialog should
       start: focusing one of those scrolls the body down to it. Focus the first
       real field, and never let that focus move the panel. */
    var firstField = panel.querySelector(
      "input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=file]):not([type=hidden]):not([type=range]), select, textarea, .btn.primary"
    );
    if (firstField) {
      setTimeout(function () {
        firstField.focus({ preventScroll: true });
        /* A dialog can scroll at more than one level (the panel, and a pane
           inside it), so put every one of them back to the top. */
        panel.scrollTop = 0;
        Array.prototype.forEach.call(panel.querySelectorAll(".modal-body, .modal-body *"), function (node) {
          if (node.scrollTop) node.scrollTop = 0;
        });
      }, 0);
    }
    return close;
  }

  /* --------------------------------------------------------------- popovers */

  var currentMenu = null;
  var closeCurrentMenu = null;

  /**
   * A small menu next to an element: { label, run, danger, confirm } items.
   * On a phone it becomes a bottom sheet. Back closes it before anything else.
   */
  function menu(anchor, items) {
    closeMenu();
    var layer = el("div", "popover-layer");
    var panel = el("div", "menu popover");
    panel.setAttribute("role", "menu");

    var pushed = false;
    try {
      window.history.pushState({ flipMenu: true }, "");
      pushed = true;
    } catch (_) {
      /* no history still closes on Esc */
    }

    function close(fromHistory) {
      if (closeCurrentMenu !== close) return;
      closeCurrentMenu = null;
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
      if (pushed && !fromHistory) {
        pushed = false;
        pendingBacks++;
        selfBacks++;
        window.history.back();
      }
      layer.remove();
      currentMenu = null;
    }

    function onOutside(event) {
      if (!panel.contains(event.target) && !anchor.contains(event.target)) close();
    }

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    }

    function onPop(event) {
      if (event && event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (pendingBacks > 0) {
        pendingBacks--;
        return;
      }
      close(true);
    }

    items.forEach(function (item) {
      var row = el("button", "menu-row" + (item.danger ? " danger" : ""), item.label);
      row.type = "button";
      row.setAttribute("role", "menuitem");
      row.addEventListener("click", function () {
        close();
        if (item.confirm) {
          confirmBox({
            title: item.label,
            message: item.confirm,
            confirmLabel: item.label,
            onConfirm: item.run,
          });
        } else if (item.run) {
          item.run();
        }
      });
      panel.appendChild(row);
    });

    layer.appendChild(panel);
    document.body.appendChild(layer);

    var rect = anchor.getBoundingClientRect();
    var width = panel.offsetWidth || 200;
    var height = panel.offsetHeight || 0;
    var left = Math.min(rect.left, window.innerWidth - width - 12);
    var top = rect.bottom + 6;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
    panel.style.left = Math.round(Math.max(12, left)) + "px";
    panel.style.top = Math.round(Math.max(12, top)) + "px";

    currentMenu = panel;
    closeCurrentMenu = close;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", onPop);
    var first = panel.querySelector(".menu-row");
    if (first) first.focus({ preventScroll: true });
    return close;
  }

  function closeMenu() {
    if (closeCurrentMenu) closeCurrentMenu();
  }

  function undo() {
    return invoke("undo_board")
      .then(function (next) {
        setView(next);
        return true;
      })
      .catch(function (err) {
        toast(errorText(err));
        return false;
      });
  }

  function redo() {
    return invoke("redo_board")
      .then(function (next) {
        setView(next);
        return true;
      })
      .catch(function (err) {
        toast(errorText(err));
        return false;
      });
  }

  function confirmBox(opts) {
    var body = el("div", "form-grid");
    body.appendChild(el("p", "sub", opts.message));
    modal({
      title: opts.title,
      body: body,
      saveLabel: opts.confirmLabel || "Confirm",
      onSave: function () {
        opts.onConfirm();
      },
    });
  }

  /* --------------------------------------------------------------- tooltip */

  var tooltipTimer = 0;

  function styleTooltip(cell) {
    var tip = $("tooltip");
    var rect = cell.getBoundingClientRect();
    var width = tip.offsetWidth;
    var height = tip.offsetHeight;
    var left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    var top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = rect.top - height - 8;
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(Math.max(8, top)) + "px";
  }

  function buildTooltip(subjectId) {
    var tip = $("tooltip");
    clear(tip);
    var subjectRow = subject(subjectId);
    if (!subjectRow) return;

    var title = el("div", "tip-title");
    var swatch = el("span", "tip-swatch");
    swatch.style.background = subjectColour(subjectRow.hue).mark;
    title.appendChild(swatch);
    title.appendChild(el("span", "", subjectRow.name));
    if (subjectRow.room) title.appendChild(el("span", "tip-room", subjectRow.room));
    tip.appendChild(title);

    var tasks = tasksForSubject(subjectId);
    if (!tasks.length) {
      tip.appendChild(el("p", "tip-empty", "Click to add tasks"));
      return;
    }

    var sorted = tasks.slice().sort(function (a, b) {
      return Number(a.done) - Number(b.done);
    });
    var list = el("ul", "tip-list");
    sorted.slice(0, 5).forEach(function (task) {
      var row = el("li", task.done ? "done" : "");
      row.appendChild(el("span", "tip-state", task.done ? "✓" : "○"));
      row.appendChild(el("span", "tip-text", task.title));
      var when = "";
      if (task.due) when = "due " + shortDate(task.due);
      else if (task.date) when = shortDate(task.date);
      if (when) row.appendChild(el("span", "tip-when", when));
      list.appendChild(row);
    });
    tip.appendChild(list);
    if (sorted.length > 5) {
      tip.appendChild(el("div", "tip-more", "+" + (sorted.length - 5) + " more"));
    }
  }

  /* The translator and the task list both change the tooltip's size after it is
     placed, so it is re-measured whenever that size changes instead of once
     when it opens (a longer Vietnamese title used to hang out of the pill). */
  var tooltipObserver = null;
  var tooltipCell = null;

  function watchTooltipSize(cell) {
    tooltipCell = cell;
    if (!window.ResizeObserver || tooltipObserver) return;
    var tip = $("tooltip");
    if (!tip) return;
    tooltipObserver = new ResizeObserver(function () {
      if (!tip.hidden && tooltipCell) styleTooltip(tooltipCell);
    });
    tooltipObserver.observe(tip);
  }

  function showTooltip(cell, subjectId) {
    var tip = $("tooltip");
    clearTimeout(tooltipTimer);
    buildTooltip(subjectId);
    tip.hidden = false;
    styleTooltip(cell);
    watchTooltipSize(cell);
  }

  function hideTooltip() {
    clearTimeout(tooltipTimer);
    clearTimeout(tooltipShowTimer);
    clearTimeout(tooltipHideTimer);
    var tip = $("tooltip");
    if (tip) tip.hidden = true;
  }

  /* One pending show and one pending hide for the whole grid. With a timer per
     cell, leaving one subject started a hide that the next subject's show
     could not cancel, so moving across the timetable made the tooltip blink. */
  var tooltipShowTimer = 0;
  var tooltipHideTimer = 0;

  function scheduleShow(cell, subjectId) {
    clearTimeout(tooltipHideTimer);
    clearTimeout(tooltipShowTimer);
    tooltipShowTimer = setTimeout(function () {
      showTooltip(cell, subjectId);
    }, 150);
  }

  function scheduleHide() {
    clearTimeout(tooltipShowTimer);
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = setTimeout(hideTooltip, 120);
  }

  /** Hover, focus and long-press all open the same tooltip. */
  function bindTooltip(cell, subjectId) {
    var pressTimer = 0;

    cell.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "touch") return;
      scheduleShow(cell, subjectId);
    });
    cell.addEventListener("pointerleave", function (event) {
      if (event.pointerType === "touch") return;
      scheduleHide();
    });
    cell.addEventListener("focus", function () {
      showTooltip(cell, subjectId);
    });
    cell.addEventListener("blur", hideTooltip);
    cell.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "touch") return;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        showTooltip(cell, subjectId);
      }, 450);
    });
    ["pointerup", "pointercancel", "pointermove"].forEach(function (name) {
      cell.addEventListener(name, function (event) {
        if (event.pointerType === "touch") clearTimeout(pressTimer);
      });
    });
  }

  var scroller = null;
  function bindScrollHiding() {
    scroller = function () {
      hideTooltip();
    };
    document.addEventListener("scroll", scroller, true);
  }

  /* ----------------------------------------------------------------- exports */

  window.Board = {
    load: load,
    on: on,
    view: function () {
      return view;
    },
    action: action,
    undo: undo,
    redo: redo,
    subject: subject,
    tasksForSubject: tasksForSubject,
    pendingForSubject: pendingForSubject,
    el: el,
    clear: clear,
    $: $,
    icon: icon,
    keyOf: keyOf,
    parseKey: parseKey,
    addDays: addDays,
    todayKey: todayKey,
    shortDate: shortDate,
    dayKeyOf: dayKeyOf,
    longDay: longDay,
    weekLabel: weekLabel,
    toast: toast,
    hideToast: hideToast,
    modal: modal,
    menu: menu,
    closeModal: closeModal,
    isModalOpen: isModalOpen,
    /** One popstate caused by a dialog or menu closing itself. */
    consumeSelfBack: function () {
      if (selfBacks <= 0) return false;
      selfBacks--;
      return true;
    },
    errorText: errorText,
    confirm: confirmBox,
    tooltip: { show: showTooltip, hide: hideTooltip, bind: bindTooltip },
    subjectColour: subjectColour,
    initScroll: bindScrollHiding,
  };
})();
