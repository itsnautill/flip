/* Material 3 Expressive behaviour.

   Draws the wavy progress indicators, drives the timer ring and the morphing
   play/pause button, and hangs the decorative pieces (day waves, import bar)
   off the DOM the rest of Flip already renders.

   One shared animation frame drives every live wave, and the loop stops the
   moment the window is hidden or unfocused: Flip's timer can run all day, so an
   idle tab must not burn a core. Everything degrades to static geometry when
   prefers-reduced-motion is set. */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = function () {
    return Boolean(reduceMotion && reduceMotion.matches);
  };

  document.documentElement.setAttribute("data-m3", "on");

  var live = [];
  var frame = 0;
  var lastTime = 0;

  /* Only a hidden window (minimised, or parked behind another app) stops the
     loop. Focus alone is too aggressive for a panel that is merely not
     focused while still on screen. */
  function running() {
    return !document.hidden;
  }

  function tick(now) {
    frame = 0;
    var dt = lastTime ? Math.min(64, now - lastTime) : 16;
    lastTime = now;
    var any = false;
    for (var i = 0; i < live.length; i++) {
      var item = live[i];
      if (!item) continue;
      if (item.animating()) any = true;
      item.frame(dt);
    }
    if (any && running()) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  }

  function kick() {
    if (frame || reduced() || !running()) return;
    lastTime = 0;
    frame = requestAnimationFrame(tick);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) kick();
  });
  window.addEventListener("focus", kick);
  window.addEventListener("blur", function () {
    lastTime = 0;
  });

  /* ------------------------------------------------------- wavy progress */

  function el(tag, attrs, className) {
    var node = document.createElementNS(NS, tag);
    if (className) node.setAttribute("class", className);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  /* A wavy line: flat track, small gap, wavy active stroke, end dot. */
  function WavyLinear(host, options) {
    var opts = options || {};
    this.host = host;
    this.value = 0;
    this.indeterminate = false;
    this.phase = 0;
    this.amp = opts.amplitude == null ? 3.5 : opts.amplitude;
    this.wavelength = opts.wavelength == null ? 34 : opts.wavelength;
    this.height = opts.height == null ? 12 : opts.height;
    this.stroke = opts.stroke == null ? 4 : opts.stroke;
    this.color = opts.color || "";

    var svg = el("svg", { "aria-hidden": "true", focusable: "false" });
    this.track = el("path", { class: "wave-track" });
    this.active = el("path", { class: "wave-active" });
    this.dot = el("circle", { class: "wave-dot", r: this.stroke / 2 });
    svg.appendChild(this.track);
    svg.appendChild(this.active);
    svg.appendChild(this.dot);
    host.appendChild(svg);

    this.svg = svg;
    this.svg.style.height = this.height + "px";
    if (this.color) {
      this.active.style.stroke = this.color;
      this.dot.style.fill = this.color;
    }

    var self = this;
    this.resize = function () {
      self.width = host.clientWidth || 0;
      self.draw();
    };
    if (window.ResizeObserver) {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(host);
    }
    this.resize();
    live.push(this);
  }

  WavyLinear.prototype.animating = function () {
    return !reduced() && (this.indeterminate || this.phase > 0);
  };

  WavyLinear.prototype.frame = function (dt) {
    if (reduced()) return;
    /* one wavelength per second */
    this.phase = (this.phase + (dt / 1000) * Math.PI * 2) % (Math.PI * 200);
    if (this.indeterminate && !this.value) this.value = (this.value + dt / 2600) % 1;
    this.draw();
  };

  WavyLinear.prototype.set = function (value) {
    this.value = Math.max(0, Math.min(1, Number(value) || 0));
    this.draw();
    kick();
  };

  WavyLinear.prototype.setIndeterminate = function (on) {
    this.indeterminate = Boolean(on);
    if (this.indeterminate) this.value = 0;
    this.draw();
    kick();
  };

  WavyLinear.prototype.draw = function () {
    var w = this.width || this.host.clientWidth || 0;
    var h = this.height;
    if (!w) return;
    var cy = h / 2;
    var inset = this.stroke / 2 + 1;
    var end = Math.max(inset, w - inset);
    var gap = 6;
    var stop = this.stroke + 2;

    /* Track: a flat line to the right, with the stop dot. */
    this.track.setAttribute("d", "M" + (inset + 2) + " " + cy + "H" + (end - stop - gap));
    this.track.style.strokeWidth = this.stroke;

    this.svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);

    this.dot.setAttribute("cx", end - stop / 2);
    this.dot.setAttribute("cy", cy);
    this.dot.setAttribute("r", this.stroke / 2);
    this.dot.style.opacity = this.value > 0.999 ? 0 : 1;

    var start = inset + 2;
    var usable = end - start - (this.value > 0 ? gap + stop : 0);
    if (usable <= 0 || this.value <= 0) {
      this.active.setAttribute("d", "");
      return;
    }

    var length = usable * this.value;
    /* Amplitude fades to flat at both ends of the track. */
    var ease = Math.sin(Math.PI * Math.max(0, Math.min(1, this.value)));
    var amp = reduced() ? 0 : this.amp * Math.pow(ease, 0.7);
    var steps = Math.max(12, Math.round(length / 3));
    var d = "";
    for (var i = 0; i <= steps; i++) {
      var x = start + (length * i) / steps;
      var y = cy + amp * Math.sin(((x - start) / this.wavelength) * Math.PI * 2 + this.phase);
      d += (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    this.active.setAttribute("d", d);
    this.active.style.strokeWidth = this.stroke;
  };

  WavyLinear.prototype.destroy = function () {
    if (this.observer) this.observer.disconnect();
    if (this.svg.parentNode) this.svg.parentNode.removeChild(this.svg);
    live = live.filter(function (item) {
      return item !== this;
    }, this);
  };

  /* A wavy ring: same wave maths, wrapped around a circle. */
  function WavyRing(svg, options) {
    var opts = options || {};
    this.svg = svg;
    this.value = 0;
    this.phase = 0;
    this.amp = opts.amplitude == null ? 5 : opts.amplitude;
    this.wavelength = opts.wavelength == null ? 60 : opts.wavelength;
    this.track = el("path", { class: "ring-track" });
    this.active = el("path", { class: "ring-active" });
    svg.appendChild(this.track);
    svg.appendChild(this.active);
    svg.setAttribute("viewBox", "0 0 400 400");
    this.r = 168;
    live.push(this);
    this.draw();
  }

  WavyRing.prototype.animating = function () {
    return !reduced();
  };

  WavyRing.prototype.frame = function (dt) {
    if (reduced() || this.value <= 0.001) return;
    this.phase = (this.phase + (dt / 1000) * Math.PI * 2) % (Math.PI * 200);
    this.draw();
  };

  WavyRing.prototype.set = function (value) {
    this.value = Math.max(0, Math.min(1, Number(value) || 0));
    this.draw();
    kick();
  };

  WavyRing.prototype.draw = function () {
    var cx = 200;
    var cy = 200;
    var r = this.r;
    var startAngle = -Math.PI / 2;

    this.track.setAttribute("d", "M" + cx + " " + (cy - r) + "A" + r + " " + r + " 0 1 1 " + (cx - 0.01) + " " + (cy - r));

    var sweep = this.value * Math.PI * 2;
    if (sweep <= 0.0001) {
      this.active.setAttribute("d", "");
      return;
    }

    var ease = Math.sin(Math.PI * Math.max(0.02, Math.min(0.98, this.value)));
    var amp = reduced() ? 0 : this.amp * Math.pow(ease, 0.7);
    var steps = Math.max(24, Math.round((sweep / (Math.PI * 2)) * 180));
    var d = "";
    for (var i = 0; i <= steps; i++) {
      var a = startAngle + (sweep * i) / steps;
      var wave = amp * Math.sin(((a * r) / this.wavelength) * Math.PI * 2 + this.phase);
      var rr = r + wave;
      var x = cx + Math.cos(a) * rr;
      var y = cy + Math.sin(a) * rr;
      d += (i ? "L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    }
    this.active.setAttribute("d", d);
  };

  window.M3 = {
    WavyLinear: WavyLinearWrapped,
    WavyRing: WavyRing,
    reduced: reduced,
  };

  function WavyLinearWrapped(host, options) {
    return new WavyLinear(host, options);
  }

  /* -------------------------------------------------------- stage mode */

  /* The play button and the ring only belong to the timer display. app.js
     toggles .active on the two stage groups, so mirror that on <html>. */
  function wireStageMode() {
    var clockGroup = document.getElementById("clock-group");
    var timerGroup = document.getElementById("timer-group");
    if (!clockGroup || !timerGroup) return;

    function paint() {
      document.documentElement.dataset.stage = timerGroup.classList.contains("active")
        ? "timer"
        : "clock";
    }

    new MutationObserver(paint).observe(clockGroup, {
      attributes: true,
      attributeFilter: ["class"],
    });
    new MutationObserver(paint).observe(timerGroup, {
      attributes: true,
      attributeFilter: ["class"],
    });
    paint();
  }

  /* ------------------------------------------------------ timer transport */

  function wireTimerTransport() {
    var button = document.getElementById("timer-toggle");
    if (!button) return;

    function paint(snap) {
      var timer = (snap && snap.timer) || {};
      var runningState = timer.state === "running";
      button.classList.toggle("is-running", runningState);
      button.setAttribute("aria-pressed", String(runningState));
      button.setAttribute("aria-label", runningState ? "Pause timer" : "Start timer");
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
          /* The demo shell has no backend; fall back to the keyboard path. */
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true })
          );
          if (window.Board && Board.toast) Board.toast(String((err && err.message) || err));
        });
    });
  }

  /* The ring reports how much of the chosen duration is left. */
  function wireTimerRing() {
    var svg = document.getElementById("timer-ring");
    if (!svg || !window.Flip) return;
    var ring = new WavyRing(svg, { amplitude: 6, wavelength: 62 });
    window.Flip.subscribe(function (snap) {
      var timer = (snap && snap.timer) || {};
      var total = Number(timer.secs || 0);
      var remaining =
        Number(timer.h || 0) * 3600 + Number(timer.m || 0) * 60 + Number(timer.s || 0);
      var progress = total > 0 ? 1 - remaining / total : 0;
      if (timer.state === "idle") progress = total > 0 ? 0 : 0;
      ring.set(progress);
    });
  }

  /* --------------------------------------------------------- week board */

  /* Each day gets a wavy completion bar under its header. Cards are rebuilt by
     tasks.js, so a mutation watcher keeps the bars in step with the board. */
  function wireDayWaves() {
    var board = document.getElementById("task-board");
    if (!board) return;
    var pending = 0;

    function paint() {
      pending = 0;
      Array.prototype.forEach.call(board.querySelectorAll(".day-col"), function (column) {
        var total = column.querySelectorAll(".task").length;
        var done = column.querySelectorAll(".task.done").length;
        var host = column.querySelector(".day-wave");
        if (!host) {
          host = document.createElement("div");
          host.className = "wave-host day-wave";
          var head = column.querySelector(".day-head");
          head ? head.parentNode.insertBefore(host, head.nextSibling) : column.insertBefore(host, column.firstChild);
          host.__wave = new WavyLinear(host, { amplitude: 2.5, wavelength: 26, height: 8, stroke: 3 });
        }
        host.__wave.set(total ? done / total : 0);
      });
    }

    function schedule() {
      if (pending) return;
      pending = requestAnimationFrame(paint);
    }

    new MutationObserver(schedule).observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    paint();
  }

  /* ----------------------------------------------------------- importer */

  function wireImportWave() {
    var button = document.getElementById("tt-import");
    var host = document.getElementById("tt-wave");
    if (!button || !host) return;
    var wave = new WavyLinear(host, { amplitude: 4, wavelength: 40, height: 14, stroke: 4 });
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

  /* A drop zone in front of the toolbars: the same import, bigger target. */
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

  /* ------------------------------------------------------------ task FAB */

  function wireTaskFab() {
    var fab = document.getElementById("tasks-fab");
    var target = document.getElementById("new-task");
    if (!fab || !target) return;
    fab.addEventListener("click", function () {
      target.click();
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
    wireStageMode();
    wireTimerTransport();
    wireTimerRing();
    wireDayWaves();
    wireImportWave();
    wireDropzone();
    wireTaskFab();
    wireScrollFill();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
