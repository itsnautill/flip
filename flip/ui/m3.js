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

    host.classList.add("wave-host");
    host.style.setProperty("--wave-h", this.height + "px");
    host.style.setProperty("--wave-stroke", this.stroke + "px");

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

    rail.appendChild(track);
    rail.appendChild(clip);
    rail.appendChild(dot);
    host.appendChild(rail);

    this.rail = rail;
    this.svg = svg;
    this.flow = flow;
    this.active = active;
    this.clip = clip;
    this.dot = dot;

    var self = this;
    this.resize = function () {
      self.width = rail.clientWidth || 0;
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

    /* Amplitude eases to flat at 0% and 100%. */
    var ease = this.indeterminate ? 1 : Math.sin(Math.PI * Math.min(1, Math.max(0, shown)));
    var amp = reduced() ? 0 : this.amp * Math.pow(ease, 0.55);
    var fill = w * shown;
    var dotGap = shown > 0.01 && shown < 0.99 ? stroke + 4 : 0;

    this.host.style.setProperty("--wave-fill", Math.max(0, fill - dotGap) + "px");
    this.host.style.setProperty("--wave-dot-x", fill + "px");
    this.clip.style.visibility = shown <= 0 ? "hidden" : "";
    this.dot.style.opacity = shown > 0.01 && shown < 0.99 ? "1" : "0";

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

  function wireTimerRing() {
    var svg = document.getElementById("timer-ring");
    if (!svg || !window.Flip) return;
    var ring = new WavyRing(svg, { amplitude: 4, waves: 12 });
    watchWave(svg);
    /* The snapshot carries the remaining time, not the duration. An idle timer
       shows its preset, so that is where the total comes from; a running
       countdown keeps the last total it saw start. */
    var total = 0;
    window.Flip.subscribe(function (snap) {
      var timer = (snap && snap.timer) || {};
      var remaining =
        Number(timer.h || 0) * 3600 + Number(timer.m || 0) * 60 + Number(timer.s || 0);
      if (timer.state === "idle") {
        total = remaining;
      } else if (remaining > total) {
        total = remaining;
      } else if (total === 0 && snap && snap.focusSecs) {
        total = Number(snap.focusSecs) || 0;
      }
      var progress = total > 0 ? 1 - remaining / total : 0;
      if (timer.state === "idle" || timer.state === "finished") progress = 0;
      ring.set(progress);
    });
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
          host.__wave = new WavyLinear(host, { amplitude: 2.2, wavelength: 26, height: 11, stroke: 4 });
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
        if (count) count.textContent = total - done > 0 ? total - done + " left" : total ? "done" : "";

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
        track.__wave = new WavyLinear(host, { amplitude: 2, wavelength: 30, height: 12, stroke: 4 });
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

  function wireDropzone() {
    var zone = document.getElementById("tt-dropzone");
    var pick = document.getElementById("tt-dropzone-import");
    var input = document.getElementById("tt-file");
    if (!zone || !input) return;

    if (pick) {
      pick.addEventListener("click", function () {
        var fileButton = document.getElementById("tt-import");
        if (fileButton) fileButton.click();
      });
    }

    ["dragenter", "dragover"].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add("is-over");
      });
    });
    ["dragleave", "drop"].forEach(function (type) {
      zone.addEventListener(type, function () {
        zone.classList.remove("is-over");
      });
    });
    zone.addEventListener("drop", function (event) {
      event.preventDefault();
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
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

      var strip = tasks.querySelector(".summary-strip");
      if (!strip) {
        strip = document.createElement("div");
        strip.className = "summary-strip";
        board.parentNode.insertBefore(strip, board);
      }
      strip.hidden = !boardVisible;
      var bits = [];
      bits.push("Today: <b>" + todayLeft + "</b> left");
      bits.push("<b>" + done + "</b> of " + total + " done this week");
      strip.innerHTML = bits.join(" · ");

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
    wireTimerRing();
    wireDayWaves();
    wireBars();
    wireImportWave();
    wireDropzone();
    wireTasksExtras();
    wireScrollFill();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
