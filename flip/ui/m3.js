/* Flip — soft M3 behaviour.

   Waves are drawn ONCE as SVG paths. Motion is a CSS transform on the path
   group (translate for linear bars, rotate for the ring), so progress changes
   are a clip/dash change and nothing recomputes geometry per frame. The CSS
   animation only runs while the host is on screen and the window is visible. */
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

  function WavyLinear(host, options) {
    var opts = options || {};
    this.host = host;
    this.value = 0;
    this.height = opts.height == null ? 12 : opts.height;
    this.stroke = opts.stroke == null ? 3 : opts.stroke;
    this.amp = opts.amplitude == null ? 3 : opts.amplitude;
    this.wavelength = opts.wavelength == null ? 34 : opts.wavelength;
    this.width = 0;
    this.indeterminate = false;
    var id = "waveclip" + ++uid;

    var svg = svgEl("svg", { "aria-hidden": "true", focusable: "false" });
    svg.style.height = this.height + "px";
    var defs = svgEl("defs", {});
    var clip = svgEl("clipPath", { id: id, clipPathUnits: "userSpaceOnUse" });
    this.clipRect = svgEl("rect", { x: 0, y: 0, width: 0, height: this.height });
    clip.appendChild(this.clipRect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    this.track = svgEl("path", { class: "wave-track" });
    this.group = svgEl("g", { class: "wave-group", "clip-path": "url(#" + id + ")" });
    this.active = svgEl("path", { class: "wave-active" });
    this.group.appendChild(this.active);
    this.dot = svgEl("circle", { class: "wave-dot", r: this.stroke / 2 + 0.5 });
    svg.appendChild(this.track);
    svg.appendChild(this.group);
    svg.appendChild(this.dot);
    host.appendChild(svg);

    this.svg = svg;
    this.host.classList.add("wave-host");

    var self = this;
    this.resize = function () {
      self.width = host.clientWidth || 0;
      self.build();
    };
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
    }
    this.resize();
  }

  WavyLinear.prototype.build = function () {
    var w = this.width;
    if (!w) return;
    var cy = this.height / 2;
    var inset = this.stroke / 2 + 1;
    var end = Math.max(inset, w - inset);
    this.start = inset + 1;
    this.end = end;
    this.stop = this.stroke + 3;

    this.svg.setAttribute("viewBox", "0 0 " + w + " " + this.height);
    this.track.setAttribute("d", "M" + this.start + " " + cy + "H" + (end - this.stop));
    this.track.style.strokeWidth = this.stroke;
    this.dot.setAttribute("cx", end - this.stop / 2);
    this.dot.setAttribute("cy", cy);
    this.dot.setAttribute("r", this.stroke / 2 + 0.5);
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
    var usable = this.end - this.start - this.stop - 6;
    if (usable <= 0) return;

    var shown = this.indeterminate ? 1 : this.value;
    var width = Math.max(0, usable * shown);
    this.clipRect.setAttribute("width", String(width));
    this.clipRect.setAttribute("height", String(this.height));
    this.group.style.display = shown <= 0 ? "none" : "";
    this.dot.style.display = shown > 0.995 || this.indeterminate ? "none" : "1";

    /* Amplitude eases to flat at both ends of the track. */
    var ease = this.indeterminate ? 1 : Math.sin(Math.PI * Math.min(1, Math.max(0.001, this.value)));
    var amp = reduced() ? 0 : this.amp * Math.pow(ease, 0.6);
    var cy = this.height / 2;
    var len = this.wavelength;

    /* A wave that repeats past the clip so the translate loops seamlessly. */
    var steps = Math.max(24, Math.round((usable + len * 2) / 4));
    var d = "";
    for (var i = 0; i <= steps; i++) {
      var x = (i * 4);
      var y = cy + amp * Math.sin((x / len) * Math.PI * 2);
      d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(2);
    }
    this.active.setAttribute("d", d);
    this.active.style.strokeWidth = this.stroke;
    this.group.style.setProperty("--wave-len", len + "px");

    if (amp > 0.2 && shown > 0) this.group.classList.add("wave-live");
    else this.group.classList.remove("wave-live");
  };

  WavyLinear.prototype.destroy = function () {
    if (this.observer) this.observer.disconnect();
    if (this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
  };

  /* A wavy ring: one static path, progress by dash offset, motion by rotate. */
  function WavyRing(svg, options) {
    var opts = options || {};
    var R = 168;
    var cx = 200;
    var cy = 200;
    var amp = opts.amplitude == null ? 4 : opts.amplitude;
    var wavelength = opts.wavelength == null ? 62 : opts.wavelength;
    svg.setAttribute("viewBox", "0 0 400 400");

    this.track = svgEl("path", { class: "ring-track" });
    var group = svgEl("g", { class: "ring-wave" });
    this.active = svgEl("path", {
      class: "ring-active",
      pathLength: "100",
      "stroke-dasharray": "100",
      "stroke-dashoffset": "100",
    });

    var circumference = 2 * Math.PI * R;
    var steps = Math.round(circumference / 2);
    var d = "";
    for (var i = 0; i <= steps; i++) {
      var a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
      var rr = R + amp * Math.sin((i / steps) * (circumference / wavelength) * Math.PI * 2);
      var x = cx + Math.cos(a) * rr;
      var y = cy + Math.sin(a) * rr;
      d += (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    this.active.setAttribute("d", d);
    group.appendChild(this.active);
    this.track.setAttribute("d", "M" + cx + " " + (cy - R) + "A" + R + " " + R + " 0 1 1 " + (cx - 0.01) + " " + (cy - R));
    svg.appendChild(this.track);
    svg.appendChild(group);
    this.group = group;
    this.svg = svg;
  }

  WavyRing.prototype.set = function (value) {
    this.value = Math.max(0, Math.min(1, Number(value) || 0));
    this.active.setAttribute("stroke-dashoffset", String(100 * (1 - this.value)));
    this.group.classList.toggle("ring-live", !reduced() && this.value > 0.02 && this.value < 0.995);
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
    var ring = new WavyRing(svg, { amplitude: 4, wavelength: 62 });
    window.Flip.subscribe(function (snap) {
      var timer = (snap && snap.timer) || {};
      var total = Number(timer.secs || 0);
      var remaining = Number(timer.h || 0) * 3600 + Number(timer.m || 0) * 60 + Number(timer.s || 0);
      var progress = total > 0 ? 1 - remaining / total : 0;
      if (timer.state === "idle") progress = 0;
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
          host.__wave = new WavyLinear(host, { amplitude: 2.4, wavelength: 24, height: 9, stroke: 3 });
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
        host.style.height = "12px";
        track.appendChild(host);
        track.__fill = fill;
        track.__wave = new WavyLinear(host, { amplitude: 1.6, wavelength: 30, height: 9, stroke: 2.5 });
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
  }

  /* ----------------------------------------------------------- importer */

  function wireImportWave() {
    var button = document.getElementById("tt-import");
    var host = document.getElementById("tt-wave");
    if (!button || !host) return;
    var wave = new WavyLinear(host, { amplitude: 3.4, wavelength: 40, height: 14, stroke: 3 });
    var state = false;

    function apply(busy) {
      if (busy === state) return;
      state = busy;
      host.hidden = !busy;
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

    /* All seven days fit, so today is already on screen when the tab opens. */
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
