/* The theme catalog: one mode (system, light or dark) plus an optional palette.

   The mode is the base the whole app is painted from. A palette only recolours
   that base, so Blossom can be bright in the morning and dusky at night without
   being two different themes in the settings list. */

(function () {
  "use strict";

  var SYSTEM = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  var MODES = [
    ["system", "System", "Follows your computer's light or dark setting."],
    ["light", "Light", "Soft off-white with warm accents."],
    ["dark", "Dark", "Grey panels rather than pure black."],
  ];

  /* The hue a palette suggests: picking it also sets the accent, which is what
     makes each one feel like a theme rather than a grey box. `base` is only
     used to read a look saved by a build where a palette carried its own base. */
  var CUSTOM = [
    {
      id: "blossom",
      name: "Blossom",
      note: "Rose petals on warm paper.",
      base: "light",
      hue: 352,
    },
    {
      id: "paper",
      name: "Paper",
      note: "Parchment, ink and quiet margins.",
      base: "light",
      hue: 51,
    },
    {
      id: "mint",
      name: "Mint",
      note: "Cool green, clear and calm.",
      base: "light",
      hue: 148,
    },
    {
      id: "slate",
      name: "Slate",
      note: "Cool grey with a blue edge.",
      base: "light",
      hue: 258,
    },
    {
      id: "midnight",
      name: "Midnight",
      note: "Navy depths and moonlight.",
      base: "dark",
      hue: 258,
    },
  ];

  var MODE_IDS = MODES.map(function (entry) {
    return entry[0];
  });

  function custom(palette) {
    for (var i = 0; i < CUSTOM.length; i++) {
      if (CUSTOM[i].id === palette) return CUSTOM[i];
    }
    return null;
  }

  /** The light or dark base a mode resolves to. */
  function base(mode) {
    if (mode === "dark") return "dark";
    if (mode === "system" && SYSTEM) return SYSTEM.matches ? "dark" : "light";
    return "light";
  }

  /* The snapshot repaints the theme on every tick, so the last choice is kept
     here and an unchanged one costs nothing. */
  var painted = null;

  /** Paints a mode on <html>, with an optional palette over it. */
  function paint(mode, palette) {
    var m = MODE_IDS.indexOf(mode) >= 0 ? mode : "light";
    var p = custom(palette) ? palette : "";
    var theme = base(m);
    /* The resolved base is part of the key: "system" changes under us when the
       computer flips between light and dark. */
    var key = m + "|" + p + "|" + theme;
    if (key === painted) return key;
    painted = key;
    var root = document.documentElement;
    root.setAttribute("data-theme", theme);
    if (p) root.setAttribute("data-palette", p);
    else root.removeAttribute("data-palette");
    try {
      window.localStorage.setItem("flip.mode", m);
      window.localStorage.setItem("flip.palette", p);
    } catch (_) {
      /* a refused store only costs the memory */
    }
    return key;
  }

  /** The stored choice, including one saved by a build that had one string. */
  function saved() {
    var mode = null;
    var palette = "";
    try {
      mode = window.localStorage.getItem("flip.mode");
      palette = window.localStorage.getItem("flip.palette") || "";
      if (!mode) {
        var old = window.localStorage.getItem("flip.theme") || "";
        var entry = custom(old);
        if (entry) {
          palette = old;
          mode = entry.base;
        } else {
          mode = old;
        }
      }
    } catch (_) {
      mode = null;
    }
    if (MODE_IDS.indexOf(mode) < 0) mode = "light";
    if (!custom(palette)) palette = "";
    return [mode, palette];
  }

  /** Paints the stored choice before the first frame. */
  function paintSaved() {
    var choice = saved();
    return paint(choice[0], choice[1]);
  }

  window.FlipThemes = {
    modes: MODES,
    custom: CUSTOM,
    modeKnown: function (mode) {
      return MODE_IDS.indexOf(String(mode)) >= 0;
    },
    paletteOf: custom,
    base: base,
    paint: paint,
    paintSaved: paintSaved,
    saved: saved,
    hueFor: function (palette) {
      var entry = custom(palette);
      return entry ? entry.hue : null;
    },
    /** Runs whenever the computer switches between light and dark. */
    watchSystem: function (fn) {
      if (!SYSTEM) return;
      var handler = function () {
        fn();
      };
      if (SYSTEM.addEventListener) SYSTEM.addEventListener("change", handler);
      else if (SYSTEM.addListener) SYSTEM.addListener(handler);
    },
  };
})();
