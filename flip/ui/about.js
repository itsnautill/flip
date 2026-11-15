/* The Flip wordmark opens a small About card: version and credits. */
(function () {
  "use strict";

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function row(list, term, detail) {
    list.appendChild(el("dt", "", term));
    list.appendChild(el("dd", "", detail));
  }

  function show(version) {
    var body = el("div", "about");

    body.appendChild(el("p", "about-version", version ? "Flip " + version : "Flip"));
    body.appendChild(
      el("p", "sub", "A small study dashboard for your desktop.")
    );

    var list = el("dl", "about-credits");
    row(list, "Made with", "Rust, Tauri and vanilla JavaScript");
    row(list, "Icons", "Generated locally with Pillow");
    row(list, "Data", "Kept on this computer, always");
    body.appendChild(list);

    var download = el("button", "btn primary wide", "Download Flip for another PC");
    download.type = "button";
    download.addEventListener("click", function () {
      var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      if (!invoke) return;
      invoke("open_url", { url: "https://projectflip.site.je" }).catch(function () {
        /* nothing to recover: the browser simply did not open */
      });
    });
    body.appendChild(download);

    if (window.FlipUpdate) window.FlipUpdate.mount(body);

    window.Board.modal({
      title: "About Flip",
      body: body,
      saveLabel: "Close",
      hideCancel: true
    });
  }

  function open() {
    var app = window.__TAURI__ && window.__TAURI__.app;
    if (app && typeof app.getVersion === "function") {
      app
        .getVersion()
        .then(function (version) {
          show(version || "");
        })
        .catch(function () {
          show("");
        });
      return;
    }
    show("");
  }

  function boot() {
    var brand = document.querySelector(".brand");
    if (!brand) return;
    brand.removeAttribute("aria-hidden");
    brand.setAttribute("role", "button");
    brand.setAttribute("tabindex", "0");
    brand.setAttribute("aria-label", "About Flip");
    brand.setAttribute("title", "About Flip");
    brand.addEventListener("click", open);
    brand.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
