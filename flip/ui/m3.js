/* Flip — soft M3 behaviour.

   Waves are drawn ONCE as SVG paths. Motion is a CSS transform on a path group
   (translate for linear bars, rotate for the ring), so progress changes only
   move a clip or an arc mask and nothing recomputes geometry per frame. The CSS
   animation runs only while the host is on screen and the window is visible. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = function () {
    return Boolean(reduceMotion && reduceMotion.matches);
  };

  document.documentElement.setAttribute("data-m3", "on");

  function svgEl(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  var uid = 0;

  /* ------------------------------------------------------- wavy progress */

  /* One structure for every linear bar:

       .wave-host
         .wave-rail            (inset so the round caps are never cut)
           .wave-track-line    (the flat light track, full width)
           .wave-clip          (STATIC clip: only its inset changes)
             svg > .wave-flow > .wave-active   (fixed geometry, translate only)
           .wave-dot           (rides the end of the fill)

     Progress moves the clip and the dot, never the wave. The path is a whole
     number of periods long and translates by exactly one wavelength, so the
     loop is invisible and the bar's start and end do not move while it flows. */

  /** One period-symmetric wavy line, 1 unit = 1 CSS pixel. */
  function wavePath(width, height, wavelength, amp) {
    var cy = height / 2;
    var step = wavelength / 12;
    var periods = Math.ceil((width + wavelength * 2) / wavelength);
    var total = periods * wavelength;
    var d = "";
    for (var x = 0; x <= total + 0.001; x += step) {
      var y = cy + amp * Math.sin((x / wavelength) * Math.PI * 2);
      d += (d ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return d;
  }

  function WavyLinear(host, options) {
    var opts = options || {};
    this.host = host;
    this.value = 0;
    this.height = opts.height == null ? 14 : opts.height;
    this.stroke = opts.stroke == null ? 4 : opts.stroke;
    this.amp = opts.amplitude == null ? 3 : opts.amplitude;
    this.wavelength = opts.wavelength == null ? 32 : opts.wavelength;
    this.width = 0;
    this.indeterminate = false;
    this.shown = -1;
    this.pathAmp = -1;

    /* Every bar keeps a fixed slot at its right end for the end marker, and
       the wave stops `endGap` before it, so 100% cannot draw over the check. */
    this.endSlot = opts.endSlot == null ? 16 : opts.endSlot;
    this.endGap = opts.endGap == null ? 6 : opts.endGap;

    host.classList.add("wave-host");
    host.style.setProperty("--wave-h", this.height + "px");
    host.style.setProperty("--wave-stroke", this.stroke + "px");
    host.style.setProperty("--wave-end", this.endSlot + "px");
    host.style.setProperty("--wave-gap", this.endGap + "px");

    var rail = document.createElement("div");
    rail.className = "wave-rail";
    var track = document.createElement("div");
    track.className = "wave-track-line";
    var clip = document.createElement("div");
    clip.className = "wave-clip";

    var svg = svgEl("svg", { "aria-hidden": "true", focusable: "false" });
    var flow = svgEl("g", { class: "wave-flow" });
    var active = svgEl("path", { class: "wave-active" });
    flow.appendChild(active);
    svg.appendChild(flow);
    clip.appendChild(svg);

    var dot = document.createElement("span");
    dot.className = "wave-dot";

    /* The end marker at 100%: a 2px check inside a small tonal circle, in the
       reserved slot, centred on the wave's baseline. */
    var check = document.createElement("span");
    check.className = "wave-check";
    var checkSvg = svgEl("svg", { viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" });
    checkSvg.appendChild(
      svgEl("path", {
        d: "M2.4 6.3 4.9 8.7 9.6 3.4",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );
    check.appendChild(checkSvg);

    rail.appendChild(track);
    rail.appendChild(clip);
    rail.appendChild(dot);
    rail.appendChild(check);
    host.appendChild(rail);

    this.rail = rail;
    this.svg = svg;
    this.flow = flow;
    this.active = active;
    this.clip = clip;
    this.dot = dot;

    var self = this;
    this.resize = function () {
      var railWidth = rail.clientWidth || 0;
      /* The geometry stops where the wave stops: before the end slot. */
      self.width = Math.max(0, railWidth - self.endSlot - self.endGap);
      self.build();
    };
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(rail);
    }
    this.resize();
  }

  WavyLinear.prototype.build = function () {
    var w = this.width;
    if (!w) return;
    var geo = Math.ceil(w + this.wavelength * 2);
    this.svg.setAttribute("width", String(geo));
    this.svg.setAttribute("height", String(this.height));
    this.svg.setAttribute("viewBox", "0 0 " + geo + " " + this.height);
    this.svg.style.width = geo + "px";
    this.svg.style.height = this.height + "px";
    /* The same px length drives the path and the keyframes. */
    this.svg.style.setProperty("--wave-len", this.wavelength + "px");
    this.shown = -1;
    this.pathAmp = -1;
    this.draw();
  };

  WavyLinear.prototype.set = function (value) {
    this.value = Math.max(0, Math.min(1, Number(value) || 0));
    this.draw();
  };

  WavyLinear.prototype.setIndeterminate = function (on) {
    this.indeterminate = Boolean(on);
    this.draw();
  };

  WavyLinear.prototype.draw = function () {
    if (!this.width) return;
    var shown = this.indeterminate ? 1 : this.value;
    var w = this.width;
    var stroke = this.stroke;

    /* Flat only at 0%: a finished bar keeps its wave and swaps the end dot for
       a check, so 100% does not read as an empty track. */
    var ease = this.indeterminate ? 1 : Math.min(1, Math.max(0, shown) / 0.08);
    var amp = reduced() ? 0 : this.amp * Math.pow(ease, 0.55);
    var fill = w * shown;
    var complete = !this.indeterminate && shown >= 0.995;
    var dotGap = shown > 0.01 && !complete ? stroke + 4 : 0;

    this.host.style.setProperty("--wave-fill", Math.max(0, fill - dotGap) + "px");
    this.host.style.setProperty("--wave-dot-x", fill + "px");
    this.host.classList.toggle("is-complete", complete);
    this.clip.style.visibility = shown <= 0 ? "hidden" : "";
    this.dot.style.opacity = shown > 0.01 && !complete ? "1" : "0";

    /* Rebuild the path only when its shape actually changed; the CSS transform
       animation keeps running through it, so the wave never restarts. */
    if (this.shown !== shown || this.pathAmp !== amp) {
      this.shown = shown;
      this.pathAmp = amp;
      this.active.setAttribute("d", wavePath(w, this.height, this.wavelength, amp));
    }
  };

  WavyLinear.prototype.destroy = function () {
    if (this.observer) this.observer.disconnect();
    if (this.rail.parentNode) this.rail.parentNode.removeChild(this.rail);
  };

  /* Circular ring: the filled arc is a static mask whose length follows the
     progress; the wavy line flows by rotating exactly one wave (360/N). */
  function WavyRing(svg, options) {
    var opts = options || {};
    var R = 168;
    var cx = 200;
    var cy = 200;
    var amp = opts.amplitude == null ? 4 : opts.amplitude;
    var waves = opts.waves || 12;
    var stroke = opts.stroke || 4;
    var id = "ringmask" + ++uid;
    svg.setAttribute("viewBox", "0 0 400 400");

    var defs = svgEl("defs", {});
    var mask = svgEl("mask", {
      id: id,
      maskUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    var arc = svgEl("circle", {
      class: "ring-arc",
      cx: cx,
      cy: cy,
      r: R,
      fill: "none",
      stroke: "#fff",
      "stroke-width": stroke + 6,
      pathLength: "100",
      "stroke-dasharray": "0 100",
      transform: "rotate(-90 " + cx + " " + cy + ")",
    });
    mask.appendChild(arc);
    defs.appendChild(mask);
    svg.appendChild(defs);

    this.track = svgEl("path", { class: "ring-track" });
    this.track.setAttribute(
      "d",
      "M" + cx + " " + (cy - R) + "A" + R + " " + R + " 0 1 1 " + (cx - 0.01) + " " + (cy - R)
    );

    var clipped = svgEl("g", { mask: "url(#" + id + ")" });
    var flow = svgEl("g", { class: "ring-flow" });
    var active = svgEl("path", { class: "ring-active" });

    /* Integer waves around the circle: rotating by 360/N lands the path on an
       identical shape, so the loop has no seam. */
    var steps = 900;
    var d = "";
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var a = -Math.PI / 2 + t * Math.PI * 2;
      var rr = R + amp * Math.sin(t * waves * Math.PI * 2);
      d += (i ? "L" : "M") + (cx + Math.cos(a) * rr).toFixed(2) + " " + (cy + Math.sin(a) * rr).toFixed(2);
    }
    active.setAttribute("d", d);
    flow.appendChild(active);
    clipped.appendChild(flow);
    svg.appendChild(this.track);
    svg.appendChild(clipped);

    svg.style.setProperty("--ring-step", 360 / waves + "deg");
    this.svg = svg;
    this.arc = arc;
    this.active = active;
    this.flow = flow;
    this.value = 0;
  }

  WavyRing.prototype.set = function (value) {
    var next = Math.max(0, Math.min(1, Number(value) || 0));
    this.value = next;
    this.arc.setAttribute("stroke-dasharray", (next * 100).toFixed(2) + " 100");
    this.flow.style.visibility = next <= 0.002 ? "hidden" : "";
  };

  window.M3 = {
    WavyLinear: function (host, options) {
      return new WavyLinear(host, options);
    },
    WavyRing: WavyRing,
    reduced: reduced,
  };

  /* -------------------------------------------------- pause off-screen */

  var seen = new WeakSet();
  var io =
    window.IntersectionObserver &&
    new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          entry.target.classList.toggle("wave-paused", !entry.isIntersecting);
        });
      },
      { rootMargin: "80px" }
    );

  function watchWave(host) {
    if (!io || seen.has(host)) return;
    seen.add(host);
    io.observe(host);
  }

  /* A hidden window paints nothing, so stop the transform work too. */
  function watchVisibility() {
    function paint() {
      document.documentElement.classList.toggle("waves-hidden", document.hidden);
    }
    document.addEventListener("visibilitychange", paint);
    paint();
  }

  /* -------------------------------------------------------- stage mode */

  function wireStageMode() {
    var clockGroup = document.getElementById("clock-group");
    var timerGroup = document.getElementById("timer-group");
    if (!clockGroup || !timerGroup) return;

    function paint() {
      document.documentElement.dataset.stage = timerGroup.classList.contains("active")
        ? "timer"
        : "clock";
    }

    new MutationObserver(paint).observe(clockGroup, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(paint).observe(timerGroup, { attributes: true, attributeFilter: ["class"] });
    paint();
  }

  /* ------------------------------------------------------ timer transport */

  function wireTimerTransport() {
    var button = document.getElementById("timer-toggle");
    if (!button) return;

    function paint(snap) {
      var timer = (snap && snap.timer) || {};
      var running = timer.state === "running";
      button.classList.toggle("is-running", running);
      button.setAttribute("aria-pressed", String(running));
      button.setAttribute("aria-label", running ? "Pause timer" : "Start timer");
      button.innerHTML = running
        ? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><rect x="6.5" y="5.5" width="4" height="13" rx="1.6"></rect><rect x="13.5" y="5.5" width="4" height="13" rx="1.6"></rect></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5.2v13.6L19 12z"></path></svg>';
    }

    if (window.Flip) window.Flip.subscribe(paint);

    button.addEventListener("click", function () {
      var core = window.__TAURI__ && window.__TAURI__.core;
      if (!core || !core.invoke) return;
      core
        .invoke("timer_toggle")
        .then(function (snap) {
          if (window.Flip && snap) window.Flip.apply(snap);
        })
        .catch(function (err) {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
          if (window.Board && Board.toast) Board.toast(String((err && err.message) || err));
        });
    });
  }

  function wireTimerProgress() {
    var stage = document.getElementById("stage");
    var group = document.getElementById("timer-group");
    if (!stage || !group || !window.Flip) return;

    /* The ring was clipped by the tiles and read as a stray stroke, and the
       wavy bar that replaced it read as a rule under the timer. */
    var ring = document.getElementById("timer-ring");
    if (ring) ring.style.display = "none";

    /* Everything on the timer screen has to fit without scrolling: the pair
       is sized from what is left after the control row and the mode switch. */
    function fit() {
      /* A hidden view reports no box, and measuring it would shrink the pair
         to its floor; the width transition then played that back as a zoom
         when the tab came back. Leave the last real size alone instead. */
      if (!stage.clientWidth || !stage.clientHeight) return;
      /* Clock and Timer are the same column and the same two tiles. The clock
         keeps the control row's height even while it hides the controls, so
         both modes fit to the same box and the pair does not jump or change
         size when the mode changes. */
      var controls = document.getElementById("timer-controls");
      var dots = document.getElementById("dots");
      var pad = 48;
      var controlsHeight = controls ? controls.offsetHeight : 0;
      var dotsHeight = dots ? dots.offsetHeight : 0;
      var gaps = 24 * 2;
      var fixed = pad + gaps + controlsHeight + dotsHeight;
      var availW = stage.clientWidth - pad;
      var availH = stage.clientHeight - fixed;
      var pairGap = 32;

      /* An hours tile reading 00 is not part of the pair: the old sheet kept
         it as a zero-width slot with a negative margin, which tilted the
         whole column. Take it out of the flow instead. */
      Array.prototype.forEach.call(group.querySelectorAll(".card.hours"), function (card) {
        var digit = card.querySelector(".d");
        var text = digit ? digit.textContent.trim() : "";
        card.style.display = !text || /^0+$/.test(text) ? "none" : "";
      });

      [document.getElementById("clock-group"), group].forEach(function (box) {
        if (!box) return;
        /* Only the tiles that are actually on screen count. */
        var shown = Array.prototype.filter.call(box.querySelectorAll(".card"), function (card) {
          return card.getClientRects().length > 0;
        });
        var count = Math.max(2, shown.length);
        var width = Math.min((availW - pairGap * (count - 1)) / count, availH / 1.2);
        width = Math.max(110, Math.min(width, 520));
        width = Math.floor(width);
        box.style.setProperty("--w", width + "px");
        /* max-content rounds the pair against the gap; set it outright so the
           group is exactly as wide as its tiles. */
        box.style.width = count * width + pairGap * (count - 1) + "px";
      });
    }

    /* The first pass runs before the tab has a box, so ask again once it does. */
    fit();
    requestAnimationFrame(fit);
    setTimeout(fit, 120);

    window.addEventListener("resize", fit);
    if (window.ResizeObserver) {
      new ResizeObserver(fit).observe(group);
      new ResizeObserver(fit).observe(stage);
    }
    window.__fitTimer = fit;

    /* The mode switch changes what has to fit, and the first pass runs before
       the tiles have their final width: fit again once layout has settled. */
    new MutationObserver(function () {
      requestAnimationFrame(fit);
      setTimeout(fit, 80);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-stage"] });

    /* The hour tile comes and goes with the value, so the pair is measured
       again on every snapshot. */
    window.Flip.subscribe(function () {
      fit();
    });
  }

  /* Play/pause and the two small tools become one centred row under the pair;
     the mode switch stays at the bottom, 24px further down. */
  function wireTimerControls() {
    var stage = document.getElementById("stage");
    var dots = document.getElementById("dots");
    if (!stage || !dots) return;

    var row = document.getElementById("timer-controls");
    if (!row) {
      row = document.createElement("div");
      row.id = "timer-controls";
      row.className = "timer-controls";
      stage.insertBefore(row, dots);
    }
    ["timer-transport", "timer-tools"].forEach(function (id) {
      var node = document.getElementById(id);
      if (node && node.parentNode !== row) row.appendChild(node);
    });

    /* Order: tiles, controls, mode switch. */
    if (window.__fitTimer) requestAnimationFrame(window.__fitTimer);
  }

  /* ------------------------------------------------------ subject filter */

  /* A native <select> brings the system arrow, the outline and a popup in the
     platform's own style. The select stays in the DOM as the state holder (the
     tasks screen reads its value), and this paints a tonal pill with a menu in
     the app's own style on top of it. */
  function wireSubjectFilter() {
    var select = document.getElementById("filter-subject");
    var btn = document.getElementById("filter-subject-btn");
    var menu = document.getElementById("filter-subject-menu");
    if (!select || !btn || !menu) return;

    var label = btn.querySelector(".filter-btn-label");
    var open = false;
    var active = 0;
    var typeahead = "";
    var typeTimer = 0;

    function options() {
      return Array.prototype.slice.call(select.options);
    }

    function paintLabel() {
      var option = select.options[select.selectedIndex];
      if (label) label.textContent = option ? option.text : "";
    }

    function build() {
      menu.innerHTML = "";
      options().forEach(function (option) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "filter-opt";
        item.setAttribute("role", "option");
        item.dataset.value = option.value;
        item.setAttribute("aria-selected", String(option.value === select.value));
        var text = document.createElement("span");
        text.textContent = option.text;
        item.appendChild(text);
        var tick = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        tick.setAttribute("class", "opt-tick");
        tick.setAttribute("viewBox", "0 0 24 24");
        tick.setAttribute("aria-hidden", "true");
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "m5 12.5 4.5 4.5L19 7.5");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        tick.appendChild(path);
        item.appendChild(tick);
        item.addEventListener("click", function () {
          choose(option.value);
        });
        menu.appendChild(item);
      });
    }

    function items() {
      return Array.prototype.slice.call(menu.querySelectorAll(".filter-opt"));
    }

    function highlight(index) {
      var list = items();
      if (!list.length) return;
      active = (index + list.length) % list.length;
      list.forEach(function (item, i) {
        item.classList.toggle("is-active", i === active);
      });
      var item = list[active];
      if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
    }

    function choose(value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      paintLabel();
      close(true);
    }

    function openMenu() {
      build();
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      open = true;
      var list = items();
      var selected = list.findIndex(function (item) {
        return item.getAttribute("aria-selected") === "true";
      });
      highlight(selected < 0 ? 0 : selected);
      if (list[active]) list[active].focus();
    }

    function close(returnFocus) {
      if (!open) return;
      open = false;
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (returnFocus) btn.focus();
    }

    btn.addEventListener("click", function () {
      if (open) close(true);
      else openMenu();
    });

    btn.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu();
        if (event.key === "ArrowUp") highlight(active - 2);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (open) choose(select.value);
        else openMenu();
      }
    });

    menu.addEventListener("keydown", function (event) {
      var list = items();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlight(active + 1);
        if (list[active]) list[active].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlight(active - 1);
        if (list[active]) list[active].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        highlight(0);
        if (list[0]) list[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        highlight(list.length - 1);
        if (list[list.length - 1]) list[list.length - 1].focus();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (list[active]) choose(list[active].dataset.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "Tab") {
        close(false);
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        /* Typeahead: keep typing within a second to narrow by first letters. */
        typeahead += event.key.toLowerCase();
        window.clearTimeout(typeTimer);
        typeTimer = window.setTimeout(function () {
          typeahead = "";
        }, 900);
        var hit = list.findIndex(function (item) {
          return item.textContent.trim().toLowerCase().indexOf(typeahead) === 0;
        });
        if (hit >= 0) {
          highlight(hit);
          list[hit].focus();
        }
      }
    });

    document.addEventListener("mousedown", function (event) {
      if (open && !menu.contains(event.target) && !btn.contains(event.target)) close(false);
    });

    /* The tasks screen rebuilds the options on every render. */
    if (window.MutationObserver) {
      new MutationObserver(function () {
        paintLabel();
        if (open) build();
      }).observe(select, { childList: true });
    }

    select.addEventListener("change", paintLabel);
    paintLabel();
  }

  /* --------------------------------------------------------- week board */

  function wireDayWaves() {
    var board = document.getElementById("task-board");
    if (!board) return;

    function paint() {
      Array.prototype.forEach.call(board.querySelectorAll(".day-col"), function (column) {
        var total = column.querySelectorAll(".task").length;
        var done = column.querySelectorAll(".task.done").length;
        var head = column.querySelector(".day-head");

        var host = column.querySelector(".day-wave");
        if (!host) {
          host = document.createElement("div");
          host.className = "wave-host day-wave";
          head ? head.parentNode.insertBefore(host, head.nextSibling) : column.insertBefore(host, column.firstChild);
          host.__wave = new WavyLinear(host, { amplitude: 1.6, wavelength: 30, height: 11, stroke: 4 });
          watchWave(host);
        }
        host.__wave.set(total ? done / total : 0);

        /* "2 left" on the day header, from the cards already rendered. */
        var count = column.querySelector(".day-count");
        if (!count && head) {
          count = document.createElement("span");
          count.className = "day-count";
          head.appendChild(count);
        }
        if (count) count.textContent = total ? done + " done" : "";

        /* Past days fade; today stays full. */
        var date = column.getAttribute("data-date");
        if (date && window.Board && Board.todayKey) {
          column.classList.toggle("is-past", date < Board.todayKey());
        }
      });
    }

    var pending = 0;
    function schedule() {
      if (pending) return;
      pending = requestAnimationFrame(function () {
        pending = 0;
        paint();
      });
    }

    new MutationObserver(schedule).observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    paint();
  }

  /* The lanes should reach the bottom of the window instead of leaving 60% of
     the screen blank. Measured from the board's own top, so the summary card
     and toolbar above it are respected. */
  function wireLaneHeight() {
    var board = document.getElementById("task-board");
    var view = document.getElementById("tasks");
    if (!board || !view) return;

    function paint() {
      if (board.hidden) return;
      var top = board.getBoundingClientRect().top - view.getBoundingClientRect().top;
      var height = view.clientHeight - top - 24;
      board.style.minHeight = Math.max(360, Math.round(height)) + "px";
    }

    window.addEventListener("resize", paint);
    if (window.ResizeObserver) new ResizeObserver(paint).observe(view);
    new MutationObserver(function () {
      requestAnimationFrame(paint);
    }).observe(board, { attributes: true, attributeFilter: ["hidden"] });
    paint();
  }

  /* ------------------------------------------------- progress bars -> waves */

  function convertBars() {
    Array.prototype.forEach.call(
      document.querySelectorAll(".progress .track, .dash-progress .track"),
      function (track) {
        if (track.__wave) {
          updateBar(track);
          return;
        }
        var fill = track.querySelector("span");
        var host = document.createElement("div");
        host.className = "wave-host";
        track.appendChild(host);
        track.__fill = fill;
        if (fill) fill.style.display = "none";
        track.__wave = new WavyLinear(host, { amplitude: 1.8, wavelength: 44, height: 12, stroke: 4 });
        watchWave(host);
        updateBar(track);
      }
    );
  }

  function updateBar(track) {
    var fill = track.__fill;
    if (!fill || !track.__wave) return;
    var width = fill.style.width || "";
    var pct = parseFloat(width);
    if (!isFinite(pct)) {
      var trackWidth = track.clientWidth || 1;
      pct = (fill.offsetWidth / trackWidth) * 100;
    }
    track.__wave.set(pct / 100);
  }

  function wireBars() {
    convertBars();
    var tasks = document.getElementById("tasks");
    if (tasks) {
      new MutationObserver(function () {
        requestAnimationFrame(convertBars);
      }).observe(tasks, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    }
    var dash = document.getElementById("dash-grid");
    if (dash) {
      new MutationObserver(function () {
        requestAnimationFrame(convertBars);
      }).observe(dash, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    }
  }

  /* ----------------------------------------------------------- importer */

  function wireImportWave() {
    var button = document.getElementById("tt-import");
    var host = document.getElementById("tt-wave");
    if (!button || !host) return;
    var wave = new WavyLinear(host, { amplitude: 3.4, wavelength: 40, height: 16, stroke: 4 });
    var state = false;

    function apply(busy) {
      if (busy === state) return;
      state = busy;
      host.hidden = !busy;
      wave.resize();
      wave.setIndeterminate(busy);
    }

    new MutationObserver(function () {
      apply(button.classList.contains("is-busy"));
    }).observe(button, { attributes: true, attributeFilter: ["class"] });
    apply(button.classList.contains("is-busy"));
  }

  /* ------------------------------------------------------------ file drop */

  /* No permanent drop card: a file dragged over the window raises one prompt
     over everything. It is there only while a drag is in flight, and any drop,
     drag leave or Escape takes it away again. */
  function wireFileDrop() {
    var overlay = document.getElementById("tt-drop");
    var input = document.getElementById("tt-file");
    if (!overlay || !input) return;

    var depth = 0;

    function files(event) {
      return event.dataTransfer && Array.prototype.indexOf.call(event.dataTransfer.types || [], "Files") >= 0;
    }

    function show(on) {
      overlay.hidden = !on;
      document.body.classList.toggle("is-file-drag", on);
    }

    window.addEventListener("dragenter", function (event) {
      if (!files(event)) return;
      event.preventDefault();
      depth += 1;
      show(true);
    });
    window.addEventListener("dragover", function (event) {
      if (!files(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", function (event) {
      if (!files(event)) return;
      depth = Math.max(0, depth - 1);
      /* Leaving the window (or a tangle of nested leaves) closes it. */
      if (!depth || !event.relatedTarget) {
        depth = 0;
        show(false);
      }
    });
    window.addEventListener("dragend", function () {
      depth = 0;
      show(false);
    });
    window.addEventListener("drop", function (event) {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      show(false);
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    window.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || overlay.hidden) return;
      depth = 0;
      show(false);
    });
  }

  /* ------------------------------------------------------- empty timetable */

  /* With no grid at all, the grid area offers one way in: import, or the two
     hand-built routes. It leaves as soon as a cell exists. */
  function wireEmptyTimetable() {
    var grid = document.getElementById("tt-grid");
    var empty = document.getElementById("tt-empty");
    if (!grid || !empty) return;

    function paint() {
      empty.hidden = grid.querySelectorAll(".tt-cell").length > 0;
    }

    new MutationObserver(function () {
      requestAnimationFrame(paint);
    }).observe(grid, { childList: true, subtree: true });

    function press(id) {
      var target = document.getElementById(id);
      if (target) target.click();
    }

    var importButton = document.getElementById("tt-empty-import");
    if (importButton) importButton.addEventListener("click", function () { press("tt-import"); });
    var addButton = document.getElementById("tt-empty-add");
    if (addButton) addButton.addEventListener("click", function () { press("tt-add-period"); });
    var templateButton = document.getElementById("tt-empty-template");
    if (templateButton)
      templateButton.addEventListener("click", function () { press("tt-template"); });

    paint();
  }

  /* ------------------------------------------------------ tasks helpers */

  function wireTasksExtras() {
    var tasks = document.getElementById("tasks");
    var board = document.getElementById("task-board");
    if (!tasks || !board) return;

    function paint() {
      var boardVisible = !board.hidden;
      var total = board.querySelectorAll(".task").length;
      var done = board.querySelectorAll(".task.done").length;
      var todayCol = board.querySelector(".day-col.today");
      var todayLeft = todayCol ? todayCol.querySelectorAll(".task:not(.done)").length : 0;

      var weekBar = tasks.querySelector(".week-bar");
      var strip = tasks.querySelector(".summary-strip");
      if (!strip) {
        strip = document.createElement("div");
        strip.className = "summary-strip";
        if (weekBar) weekBar.appendChild(strip);
        else board.parentNode.insertBefore(strip, board);
      }
      strip.hidden = !boardVisible;
      strip.textContent =
        todayLeft +
        (todayLeft === 1 ? " task left today" : " tasks left today") +
        " · " +
        done +
        " of " +
        total +
        " done this week";

      /* Long titles get their full text on hover instead of a third line. */
      Array.prototype.forEach.call(board.querySelectorAll(".task-title"), function (title) {
        if (!title.dataset.tip && title.textContent.length > 34) {
          title.dataset.tip = "1";
          title.title = title.textContent;
        }
      });
    }

    new MutationObserver(function () {
      requestAnimationFrame(paint);
    }).observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

    var tab = document.getElementById("tab-tasks");
    if (tab) {
      tab.addEventListener("click", function () {
        setTimeout(paint, 60);
      });
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paint();
    });
    paint();
  }

  /* ------------------------------------------- today in view on the board */

  /* The columns stay in calendar order, so on a narrow window today can sit in
     a later row; bring it into view instead of moving it to the front. */
  function wireTodayScroll() {
    var board = document.getElementById("task-board");
    var view = document.getElementById("tasks");
    if (!board || !view) return;

    function focus() {
      var column = board.querySelector(".day-col.today");
      if (!column || board.hidden) return;
      var head = column.querySelector(".day-head") || column;
      var viewBox = view.getBoundingClientRect();
      var headBox = head.getBoundingClientRect();
      var inset = 76;
      if (headBox.top < viewBox.top + 8 || headBox.top > viewBox.bottom - 120) {
        view.scrollTop += headBox.top - viewBox.top - inset;
      }
    }

    var tab = document.getElementById("tab-tasks");
    if (tab) tab.addEventListener("click", function () { setTimeout(focus, 90); });
    window.addEventListener("resize", function () { if (!view.hidden) setTimeout(focus, 120); });
    focus();
  }

  /* ------------------------------------------------ idle clock glide */

  /* After ten quiet seconds in Timer view the chrome fades and the tiles glide
     to the centre of the window. The layout is untouched: the offset is
     measured once on entering idle and applied as a transform. A resize while
     idle recomputes it from wherever the tiles currently are, so there is no
     jump and no drift. */
  function wireIdleGlide() {
    var stage = document.getElementById("stage");
    var timerGroup = document.getElementById("timer-group");
    var clockGroup = document.getElementById("clock-group");
    if (!stage || !timerGroup || !clockGroup) return;

    /* Only the group on screen is in the column; the other one is absolutely
       positioned over the stage. Measuring the timer while the clock shows
       centred the wrong pair, which read as the clock jumping up on idle. */
    function shown() {
      return document.documentElement.dataset.stage === "timer" ? timerGroup : clockGroup;
    }

    function tiles() {
      return Array.prototype.filter.call(shown().querySelectorAll(".card"), function (card) {
        return card.getClientRects().length > 0;
      });
    }

    function centre() {
      var box = null;
      tiles().forEach(function (card) {
        var rect = card.getBoundingClientRect();
        if (!box) box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        box.left = Math.min(box.left, rect.left);
        box.right = Math.max(box.right, rect.right);
        box.top = Math.min(box.top, rect.top);
        box.bottom = Math.max(box.bottom, rect.bottom);
      });
      return box;
    }

    function measure() {
      var box = centre();
      if (!box) return;
      /* The current offset is already applied, so add the remaining distance
         rather than starting from zero. */
      var x = parseFloat(stage.style.getPropertyValue("--idle-dx")) || 0;
      var y = parseFloat(stage.style.getPropertyValue("--idle-dy")) || 0;
      x += window.innerWidth / 2 - (box.left + box.right) / 2;
      y += window.innerHeight / 2 - (box.top + box.bottom) / 2;
      stage.style.setProperty("--idle-dx", x.toFixed(2) + "px");
      stage.style.setProperty("--idle-dy", y.toFixed(2) + "px");
    }

    function sync() {
      if (!document.body.classList.contains("is-idle")) {
        stage.style.removeProperty("--idle-dx");
        stage.style.removeProperty("--idle-dy");
        return;
      }
      /* Measure after the class lands, while the tiles are still where they
         were before the glide starts. */
      requestAnimationFrame(measure);
    }

    new MutationObserver(sync).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    /* Switching modes while idle glides the pair that is now on screen. */
    new MutationObserver(function () {
      if (document.body.classList.contains("is-idle")) measure();
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-stage"],
    });
    window.addEventListener("resize", function () {
      if (document.body.classList.contains("is-idle")) measure();
    });
  }

  /* ------------------------------------------------ app bar scroll state */

  function wireScrollFill() {
    var chrome = document.getElementById("chrome");
    if (!chrome) return;
    function paint() {
      var view = document.querySelector(".view.active");
      var scrolled = view ? view.scrollTop > 6 : false;
      document.documentElement.dataset.scrolled = scrolled ? "on" : "off";
    }
    document.addEventListener(
      "scroll",
      function (event) {
        if (event.target && event.target.classList && event.target.classList.contains("view")) paint();
      },
      true
    );
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        setTimeout(paint, 40);
      });
    });
    paint();
  }

  function boot() {
    watchVisibility();
    wireStageMode();
    wireTimerTransport();
    wireSubjectFilter();
    wireTimerProgress();
    wireTimerControls();
    wireDayWaves();
    wireBars();
    wireImportWave();
    wireFileDrop();
    wireEmptyTimetable();
    wireIdleGlide();
    wireTasksExtras();
    wireLaneHeight();
    wireTodayScroll();
    wireScrollFill();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
