/* Colour maths, shared by the timetable, the accent picker and the sliders.

   Flip stores a hue (0-360) and nothing else. Saturation and lightness are
   derived here in OKLCH, a space where equal lightness looks equally light
   across hues, so yellow and green stop glowing next to blue and purple.
   Everything returns plain CSS colours the styles can consume. */
(function () {
  "use strict";

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  function isDark(theme) {
    return String(theme || document.documentElement.getAttribute("data-theme") || "light").indexOf("dark") === 0;
  }

  function normaliseHue(value) {
    var hue = Number(value);
    if (!isFinite(hue)) return 24;
    return ((hue % 360) + 360) % 360;
  }

  /* ----------------------------------------------------------- OKLCH -> sRGB */

  function linearToSrgb(value) {
    return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  }

  /** One OKLCH colour, gamut mapped by walking chroma down until it fits. */
  function oklch(lightness, chroma, hue) {
    var L = clamp(lightness, 0, 1);
    var C = Math.max(0, chroma);
    var h = (normaliseHue(hue) * Math.PI) / 180;
    var rgb = [0, 0, 0];

    for (var step = 0; step < 14; step++) {
      var a = C * Math.cos(h);
      var b = C * Math.sin(h);
      var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
      var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
      var s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
      rgb = [
        linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
      ];
      var fits = rgb.every(function (channel) {
        return channel >= -0.0005 && channel <= 1.0005;
      });
      if (fits) break;
      C *= 0.92;
    }

    var hex = rgb
      .map(function (channel) {
        var byte = Math.round(clamp(channel, 0, 1) * 255);
        return (byte < 16 ? "0" : "") + byte.toString(16);
      })
      .join("");
    return "#" + hex.toUpperCase();
  }

  /* -------------------------------------------------------------- contrast */

  function parseHex(hex) {
    var text = String(hex || "").trim().replace(/^#/, "");
    if (text.length === 3) {
      text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
    }
    if (!/^[0-9a-f]{6}$/i.test(text)) return null;
    return [
      parseInt(text.slice(0, 2), 16) / 255,
      parseInt(text.slice(2, 4), 16) / 255,
      parseInt(text.slice(4, 6), 16) / 255,
    ];
  }

  function luminance(hex) {
    var rgb = parseHex(hex);
    if (!rgb) return 0.5;
    var channels = rgb.map(function (value) {
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  /** WCAG contrast ratio, 1 to 21. */
  function contrast(a, b) {
    var one = luminance(a);
    var two = luminance(b);
    return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
  }

  var INK_DARK = "#1B140E";
  var INK_LIGHT = "#FFF9F1";

  /** The ink that reads best on a given background. */
  function inkOn(background) {
    return contrast(background, INK_DARK) >= contrast(background, INK_LIGHT) ? INK_DARK : INK_LIGHT;
  }

  /** Nudges a fill's lightness until its ink clears 4.5:1. */
  function readableFill(lightness, chroma, hue, dark) {
    var fill = oklch(lightness, chroma, hue);
    var ink = inkOn(fill);
    for (var step = 0; step < 20 && contrast(fill, ink) < 4.5; step++) {
      lightness = clamp(lightness + (ink === INK_LIGHT ? -0.02 : 0.02), 0.1, 0.97);
      fill = oklch(lightness, chroma, hue);
      ink = inkOn(fill);
    }
    if (dark && contrast(fill, ink) < 4.5) {
      fill = oklch(0.22, chroma, hue);
      ink = inkOn(fill);
    }
    return { fill: fill, ink: ink };
  }

  /* ------------------------------------------------------- subject colours */

  /**
   * Everything a timetable cell needs, from one hue:
   *   fill  - the card background
   *   border- the left edge and the dot
   *   badge - the small tinted badge
   *   text  - ink that clears AA on the fill
   *   soft  - a quieter tint for chips and hovers
   */
  function subjectColorFromHue(hue, theme) {
    var dark = isDark(theme);
    var h = normaliseHue(hue);

    /* One recipe per theme, both keep the subject's own hue.
       Dark: a translucent tint of the hue over the card surface with a 1px edge
       of the same hue - the card reads lighter than a solid block, and the ink
       is a light tint of the hue at 7:1 or better.
       Light: a pastel fill with dark ink. */
    var fill;
    var text;
    var edge;
    var warm = h >= 45 && h <= 105;
    if (dark) {
      /* Gold and amber go muddy when they are a near-grey brown; the warm band
         gets a lighter, more chromatic tint so it reads as gold, not mud. The
         hue itself is never moved. */
      var tintL = warm ? 0.84 : 0.76;
      var tintC = warm ? 0.22 : 0.2;
      var share = 0.16;
      var cardL = 0.245;
      var tint = oklch(tintL, tintC, h);
      var solid = oklch(cardL + share * (tintL - cardL), share * tintC, h);
      fill = "color-mix(in srgb, " + tint + " 16%, var(--surface-container))";
      edge = "color-mix(in srgb, " + tint + " 32%, transparent)";
      text = oklch(0.93, 0.03, h);
      for (var step = 0; step < 20 && contrast(solid, text) < 7; step++) {
        text = oklch(Math.min(0.99, 0.93 + step * 0.004), 0.03, h);
      }
    } else {
      fill = oklch(0.93, 0.045, h);
      text = inkOn(fill);
      edge = oklch(0.78, 0.09, h);
      for (var pass = 0; pass < 20 && contrast(fill, text) < 7; pass++) {
        fill = oklch(0.93 - pass * 0.01, 0.045, h);
        text = inkOn(fill);
      }
    }

    return {
      hue: h,
      fill: fill,
      text: text,
      mark: oklch(dark ? 0.78 : 0.6, dark ? 0.09 : 0.09, h),
      edge: edge,
      border: oklch(dark ? 0.72 : 0.58, 0.15, h),
      badge: oklch(dark ? 0.4 : 0.84, 0.09, h),
      soft: oklch(dark ? 0.22 : 0.965, dark ? 0.035 : 0.03, h),
    };
  }

  /** A hue for a new subject, as far as possible from the ones already used. */
  function nextHue(taken) {
    var used = (taken || []).map(normaliseHue);
    if (!used.length) return 51;
    var start = used[used.length - 1];
    var best = normaliseHue(start + 137.5);
    var bestGap = -1;
    for (var step = 1; step <= 24; step++) {
      var candidate = normaliseHue(start + 137.5 * step);
      var gap = used.reduce(function (smallest, hue) {
        var diff = Math.abs(candidate - hue);
        return Math.min(smallest, Math.min(diff, 360 - diff));
      }, 360);
      if (gap > bestGap) {
        best = candidate;
        bestGap = gap;
      }
      if (gap >= 48) break;
    }
    return Math.round(best);
  }

  /* ------------------------------------------------------------ app accent */

  /* OKLCH angles, so each preset lands on the colour its name promises. */
  var ACCENT_PRESETS = [
    { name: "Red", hue: 29 },
    { name: "Orange", hue: 51 },
    { name: "Yellow", hue: 85 },
    { name: "Green", hue: 148 },
    { name: "Blue", hue: 258 },
    { name: "Purple", hue: 313 },
    { name: "Pink", hue: 352 },
  ];

  /** Derives every accent weight from one hue, for the current theme. */
  function accentPalette(hue, theme) {
    var dark = isDark(theme);
    var h = normaliseHue(hue);
    var light = dark ? 0.76 : 0.55;
    var chroma = dark ? 0.13 : 0.14;

    /* The accent has to carry ink on top of it, so walk its weight until the
       chosen ink clears AA rather than trusting one lightness for all hues. */
    var accent = oklch(light, chroma, h);
    var ink = inkOn(accent);
    for (var step = 0; step < 16 && contrast(accent, ink) < 4.6; step++) {
      light = clamp(light + (ink === INK_LIGHT ? -0.02 : 0.02), 0.24, 0.9);
      accent = oklch(light, chroma, h);
      ink = inkOn(accent);
    }

    var panel = dark ? "#221F1A" : "#FFFDF7";
    var soft = oklch(dark ? 0.2 : 0.94, dark ? 0.04 : 0.04, h);
    var textWeight = light;
    var text = oklch(textWeight, chroma, h);
    /* Accent-coloured labels also sit on the accent tint (the today column,
       active chips), which is darker than the panel, so both have to pass. */
    for (
      var tries = 0;
      tries < 16 && (contrast(text, panel) < 4.6 || contrast(text, soft) < 4.5);
      tries++
    ) {
      textWeight = clamp(textWeight + (dark ? 0.03 : -0.03), 0.16, 0.94);
      text = oklch(textWeight, chroma, h);
    }

    return {
      hue: h,
      accent: accent,
      ink: ink,
      hover: oklch(clamp(light + (dark ? 0.05 : -0.04), 0.2, 0.92), chroma, h),
      active: oklch(clamp(light + (dark ? -0.05 : 0.04), 0.18, 0.9), chroma, h),
      soft: soft,
      line: oklch(dark ? 0.55 : 0.72, 0.1, h),
      focus: oklch(dark ? 0.78 : 0.48, 0.14, h),
      text: text,
      washA: oklch(dark ? 0.2 : 0.9, dark ? 0.05 : 0.05, h),
      washB: oklch(dark ? 0.16 : 0.93, dark ? 0.045 : 0.045, h + 20),
      washC: oklch(dark ? 0.21 : 0.92, dark ? 0.04 : 0.04, h - 22),
      base: oklch(dark ? 0.1 : 0.97, dark ? 0.02 : 0.03, h),
    };
  }

  /* ------------------------------------------------------------ whole theme */

  /**
   * Every role the app needs, from one hue. Light and dark derive from the
   * same angles: neutrals are very low-chroma tints of the accent, containers
   * are softer steps of the same hue, and the only non-accent colours are the
   * error/status tints.
   */
  function themeFor(hue, theme) {
    var dark = isDark(theme);
    var h = normaliseHue(hue);
    var base = accentPalette(h, theme);

    function at(l, c, shift) {
      return oklch(l, c, h + (shift || 0));
    }

    var surface = at(dark ? 0.2 : 0.985, dark ? 0.012 : 0.012);
    /* Dark surfaces need a wider ladder than light ones: on a near-black page a
       3% step is invisible, so each container sits clearly above the last. */
    var levels = dark
      ? [0.245, 0.27, 0.3, 0.335, 0.375]
      : [0.998, 0.972, 0.955, 0.936, 0.916];
    var levelChroma = dark ? [0.014, 0.016, 0.018, 0.02, 0.022] : [0.006, 0.012, 0.015, 0.018, 0.021];

    /* Accent-coloured text has to clear AA against the surface it sits on and
       the soft container behind chips, whatever hue was chosen. */
    var textWeight = dark ? 0.84 : 0.46;
    var textChroma = dark ? 0.1 : 0.12;
    var text = oklch(textWeight, textChroma, h);
    for (var step = 0; step < 24 && contrast(text, surface) < 4.6; step++) {
      textWeight = clamp(textWeight + (dark ? 0.015 : -0.015), 0.16, 0.96);
      text = oklch(textWeight, textChroma, h);
    }

    var roles = {
      "--accent": base.accent,
      "--accent-ink": base.ink,
      "--accent-hover": base.hover,
      "--accent-active": base.active,
      "--accent-soft": base.soft,
      "--accent-line": base.line,
      "--accent-text": text,
      "--focus": text,

      "--primary": base.accent,
      "--on-primary": base.ink,
      "--primary-container": at(dark ? 0.32 : 0.945, dark ? 0.05 : 0.05),
      "--on-primary-container": at(dark ? 0.9 : 0.28, dark ? 0.045 : 0.055),
      "--secondary-container": at(dark ? 0.245 : 0.968, dark ? 0.032 : 0.032),
      "--on-secondary-container": dark ? at(0.9, 0.03) : at(0.33, 0.035),
      "--tertiary-container": at(dark ? 0.215 : 0.98, dark ? 0.02 : 0.02),
      "--on-tertiary-container": dark ? at(0.88, 0.02) : at(0.38, 0.025),

      "--surface": surface,
      "--surface-dim": at(dark ? 0.145 : 0.925, dark ? 0.012 : 0.015),
      "--surface-bright": at(dark ? 0.33 : 0.997, dark ? 0.02 : 0.006),
      "--surface-container-lowest": at(levels[0], levelChroma[0]),
      "--surface-container-low": at(levels[1], levelChroma[1]),
      "--surface-container": at(levels[2], levelChroma[2]),
      "--surface-container-high": at(levels[3], levelChroma[3]),
      "--surface-container-highest": at(levels[4], levelChroma[4]),

      "--on-surface": at(dark ? 0.93 : 0.235, dark ? 0.015 : 0.018),
      "--on-surface-variant": at(dark ? 0.76 : 0.44, dark ? 0.02 : 0.02),
      "--outline": at(dark ? 0.56 : 0.66, 0.018),
      "--outline-variant": at(dark ? 0.33 : 0.885, 0.014),
      "--inverse-surface": at(dark ? 0.93 : 0.24, 0.018),
      "--inverse-on-surface": at(dark ? 0.22 : 0.96, 0.012),

      "--wash-base": at(dark ? 0.19 : 0.982, dark ? 0.018 : 0.02),
      "--wash-a": at(dark ? 0.27 : 0.955, dark ? 0.05 : 0.036, -8),
      "--wash-b": at(dark ? 0.205 : 0.972, dark ? 0.036 : 0.028, 12),
      "--wash-c": at(dark ? 0.225 : 0.962, dark ? 0.032 : 0.03, 22),

      "--glass-fill": "color-mix(in srgb, " + at(levels[0], levelChroma[0]) + (dark ? " 74%" : " 62%") + ", transparent)",
      "--glass-fill-strong": "color-mix(in srgb, " + at(levels[0], levelChroma[0]) + (dark ? " 92%" : " 86%") + ", transparent)",
      "--glass-edge": dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.66)",
      "--glass-inner": dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.34)",
      "--glass-shadow": dark
        ? "0 18px 36px -22px rgba(0,0,0,0.75)"
        : "0 14px 32px -20px " + oklch(0.32, 0.06, h),
    };

    return { hue: h, roles: roles, base: base };
  }

  /** Paints the palette on <html>; the stylesheet does the rest. */
  function applyAccent(hue) {
    var theme = themeFor(hue);
    var style = document.documentElement.style;
    Object.keys(theme.roles).forEach(function (name) {
      style.setProperty(name, theme.roles[name]);
    });
    window.__flipHue = theme.hue;
    document.documentElement.setAttribute("data-accent-hue", String(Math.round(theme.hue)));
    return theme.base;
  }

  /* A theme flip (system or the Settings switch) has to regenerate the roles
     too, otherwise dark keeps the light neutrals. */
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(function () {
      if (window.__flipHue != null) applyAccent(window.__flipHue);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* ----------------------------------------------------------- hue slider */

  /**
   * One hue slider, used for subjects and for the app accent.
   * opts: { value, label, onChange(hue), onCommit(hue), id, accent }
   * accent: paint the accent colour instead of a subject colour.
   * onChange paints live; onCommit runs when the drag or key press settles.
   */
  function hueSlider(opts) {
    var value = normaliseHue(opts.value);
    var wrap = document.createElement("div");
    wrap.className = "hue-field";
    if (opts.id) wrap.id = opts.id;

    var head = document.createElement("div");
    head.className = "hue-head";
    var label = document.createElement("span");
    label.className = "hue-label";
    label.textContent = opts.label || "Hue";
    head.appendChild(label);

    var preview = document.createElement("span");
    preview.className = "hue-preview";
    preview.setAttribute("aria-hidden", "true");
    head.appendChild(preview);
    wrap.appendChild(head);

    var input = document.createElement("input");
    input.type = "range";
    input.className = "hue-range";
    input.min = "0";
    input.max = "360";
    input.step = "1";
    input.value = String(Math.round(value));
    input.setAttribute("aria-label", opts.label || "Hue");
    wrap.appendChild(input);

    var commitTimer = 0;

    function paint(hue) {
      /* The accent preview must be the accent itself: a subject swatch is a
         muted tone and reads as brown next to the bright slider. */
      var swatch = opts.accent
        ? { border: accentPalette(hue).accent, fill: accentPalette(hue).soft }
        : subjectColorFromHue(hue);
      preview.style.setProperty("--sw", swatch.border);
      preview.style.setProperty("--sw-fill", swatch.fill);
      input.style.setProperty("--sw", swatch.border);
      input.setAttribute("aria-valuetext", Math.round(hue) + " degrees");
    }

    function commitLater(hue) {
      clearTimeout(commitTimer);
      commitTimer = setTimeout(function () {
        if (opts.onCommit) opts.onCommit(hue);
      }, 320);
    }

    input.addEventListener("input", function () {
      value = normaliseHue(input.value);
      paint(value);
      if (opts.onChange) opts.onChange(value);
      commitLater(value);
    });
    input.addEventListener("change", function () {
      value = normaliseHue(input.value);
      paint(value);
      clearTimeout(commitTimer);
      if (opts.onCommit) opts.onCommit(value);
    });

    paint(value);

    return {
      element: wrap,
      input: input,
      get value() {
        return value;
      },
      set: function (hue) {
        value = normaliseHue(hue);
        input.value = String(Math.round(value));
        paint(value);
      },
    };
  }

  window.FlipColor = {
    clamp: clamp,
    isDark: isDark,
    normaliseHue: normaliseHue,
    oklch: oklch,
    contrast: contrast,
    inkOn: inkOn,
    subjectColorFromHue: subjectColorFromHue,
    nextHue: nextHue,
    accentPalette: accentPalette,
    themeFor: themeFor,
    applyAccent: applyAccent,
    hueSlider: hueSlider,
    presets: ACCENT_PRESETS,
  };
})();
