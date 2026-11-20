/* Material 3 interaction: the touch ripple.

   M3 answers a press with a state layer that grows from where the finger landed
   and fades as it covers the control. Everything here is additive: a span is
   appended, the control is marked position:relative / overflow:hidden for the
   length of the animation, and nothing else about the element changes.

   The markup is untouched, so the plain-CSS skin still works without this file,
   and the ripple is skipped for reduced-motion users. */
(function () {
  "use strict";

  var HOSTS = [
    ".btn",
    ".icon-btn",
    ".tab",
    ".chip-btn",
    ".mode-btn",
    ".seg-btn",
    ".menu-row",
    ".settings-nav button",
    ".theme-card",
    ".accent-swatch",
    ".menu-row",
  ].join(",");

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  document.documentElement.setAttribute("data-material", "on");

  /* -------------------------------------------------------------- squircles */

  /* border-radius draws a circular arc. A squircle flattens that arc into a
     superellipse: the corner leaves the edge earlier and spends longer near the
     diagonal, which is the soft, continuous corner of the reference. Where the
     engine has `corner-shape: squircle` the stylesheet does it natively. Here it
     is drawn as a clip path for everyone else (Chromium 88 and newer), so the
     same surface is a squircle on desktop and on the phone. */
  var canClipPath =
    window.CSS && CSS.supports && CSS.supports("clip-path", 'path("M0 0h1v1H0z")');

  var SQUIRCLE_TARGETS = [
    ".widget",
    ".widget-badge",
    ".modal",
    ".tt-grid",
    ".theme-card",
    ".toast",
    ".menu",
  ].join(",");

  var SEGMENTS = 12;
  /* 2 / exponent. 0.5 is a classic superellipse (n = 4): a little flatter than
     a circle, a little rounder than a raw rectangle. */
  var CURVE = 0.5;

  function squirclePath(w, h, radius) {
    var r = Math.min(radius, w / 2, h / 2);
    if (!(r >= 4) || w < 8 || h < 8) return "";

    function push(points, x, y) {
      points.push(Math.round(x * 100) / 100 + " " + Math.round(y * 100) / 100);
    }

    var points = [];
    var i;
    var t;
    var x;
    var y;

    /* Two superellipse quarter-arcs, in corner-local coordinates:
         arcA runs (r, 0) -> (0, r), arcB runs (0, r) -> (r, 0).
       Mapping them onto the four corners keeps the outline continuous. */
    function arc(t) {
      var c = Math.pow(Math.cos(t), CURVE);
      var s = Math.pow(Math.sin(t), CURVE);
      return {
        ax: r * (1 - s),
        ay: r * (1 - c),
        bx: r * (1 - c),
        by: r * (1 - s),
      };
    }

    var q;
    /* Top-left: (r, 0) to (0, r). */
    for (i = 0; i <= SEGMENTS; i++) {
      t = (Math.PI / 2) * (i / SEGMENTS);
      q = arc(t);
      push(points, q.ax, q.ay);
    }
    /* Bottom-left: (0, h - r) to (r, h). */
    for (i = 0; i <= SEGMENTS; i++) {
      t = (Math.PI / 2) * (i / SEGMENTS);
      q = arc(t);
      push(points, q.bx, h - q.by);
    }
    /* Bottom-right: (w - r, h) to (w, h - r). */
    for (i = 0; i <= SEGMENTS; i++) {
      t = (Math.PI / 2) * (i / SEGMENTS);
      q = arc(t);
      push(points, w - q.ax, h - q.ay);
    }
    /* Top-right: (w, r) to (w - r, 0). */
    for (i = 0; i <= SEGMENTS; i++) {
      t = (Math.PI / 2) * (i / SEGMENTS);
      q = arc(t);
      push(points, w - q.bx, q.by);
    }

    return 'path("M' + points.join("L") + 'Z")';
  }

  function paintSquircle(node) {
    if (!node || node.nodeType !== 1) return;
    var width = node.offsetWidth;
    var height = node.offsetHeight;
    if (!width || !height) return;
    var style = window.getComputedStyle(node);
    var radius = parseFloat(style.borderTopLeftRadius) || 0;
    var path = squirclePath(width, height, radius);
    if (!path) {
      node.style.removeProperty("clip-path");
      return;
    }
    if (node.__flipSquircle !== path) {
      node.__flipSquircle = path;
      node.style.clipPath = path;
    }
  }

  function startSquircles() {
    if (!canClipPath) return;
    document.documentElement.setAttribute("data-squircle", "on");

    var watched = new WeakSet();
    var observer =
      window.ResizeObserver &&
      new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          paintSquircle(entry.target);
        });
      });

    function watch(root) {
      if (!root || root.nodeType !== 1) return;
      var nodes = [];
      if (root.matches && root.matches(SQUIRCLE_TARGETS)) nodes.push(root);
      if (root.querySelectorAll) {
        Array.prototype.forEach.call(root.querySelectorAll(SQUIRCLE_TARGETS), function (node) {
          nodes.push(node);
        });
      }
      nodes.forEach(function (node) {
        paintSquircle(node);
        if (observer && !watched.has(node)) {
          watched.add(node);
          observer.observe(node);
        }
      });
    }

    watch(document.body);

    /* Dialogs, menus and re-rendered widgets arrive later; shape them on the way
       in rather than polling. */
    if (window.MutationObserver) {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, watch);
        });
      }).observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("resize", function () {
      Array.prototype.forEach.call(document.querySelectorAll(SQUIRCLE_TARGETS), paintSquircle);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startSquircles);
  } else {
    startSquircles();
  }

  function ripple(node, event) {
    var rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    var size = Math.max(rect.width, rect.height) * 2.2;
    var x = (event && event.clientX ? event.clientX : rect.left + rect.width / 2) - rect.left;
    var y = (event && event.clientY ? event.clientY : rect.top + rect.height / 2) - rect.top;

    var ink = document.createElement("span");
    ink.className = "m3-ripple";
    ink.style.width = size + "px";
    ink.style.height = size + "px";
    ink.style.left = x - size / 2 + "px";
    ink.style.top = y - size / 2 + "px";

    var hadHostClass = node.classList.contains("m3-host");
    var previousOverflow = node.style.overflow;
    var previousPosition = node.style.position;
    node.classList.add("m3-host");
    node.appendChild(ink);

    function done() {
      if (ink.parentNode) ink.parentNode.removeChild(ink);
      if (!hadHostClass) {
        node.classList.remove("m3-host");
        node.style.overflow = previousOverflow;
        node.style.position = previousPosition;
      }
    }

    ink.addEventListener("animationend", done);
    /* A control that is removed mid-press (a dialog closing) never animates
       out; the node goes with it, so nothing leaks. */
    setTimeout(done, 700);
  }

  document.addEventListener(
    "pointerdown",
    function (event) {
      if (reduced && reduced.matches) return;
      if (event.button !== undefined && event.button !== 0) return;
      var target = event.target;
      if (!target || !target.closest) return;
      var node = target.closest(HOSTS);
      if (!node || node.disabled || node.getAttribute("aria-disabled") === "true") return;
      ripple(node, event);
    },
    true
  );
})();
