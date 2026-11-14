/* FlipCard: four-layer flip animation. Never times anything with setTimeout -
   the end state is driven by the flap-bottom animationend event. */
(function () {
  "use strict";

  function reducedMotion() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function layer(className) {
    var el = document.createElement("div");
    el.className = className;
    var d = document.createElement("span");
    d.className = "d";
    el.appendChild(d);
    return { el: el, d: d };
  }

  class FlipCard {
    constructor(parent, opts) {
      var options = opts || {};
      this.value = null;
      this.busy = false;

      var card = document.createElement("div");
      card.className = "card";
      if (options.className) card.className += " " + options.className;

      var top = layer("half top");
      var bottom = layer("half bottom");
      var flapTop = layer("flap flap-top");
      var flapBottom = layer("flap flap-bottom");

      card.appendChild(top.el);
      card.appendChild(bottom.el);
      card.appendChild(flapTop.el);
      card.appendChild(flapBottom.el);

      if (options.ampm) {
        this.ampm = document.createElement("span");
        this.ampm.className = "ampm";
        this.ampm.textContent = "";
        card.appendChild(this.ampm);
      } else {
        this.ampm = null;
      }

      parent.appendChild(card);

      this.el = card;
      this.topD = top.d;
      this.bottomD = bottom.d;
      this.flapTopD = flapTop.d;
      this.flapBottomD = flapBottom.d;
      this.flapBottom = flapBottom.el;

      this.onAnimationEnd = this.onAnimationEnd.bind(this);
      this.flapBottom.addEventListener("animationend", this.onAnimationEnd);
    }

    onAnimationEnd(event) {
      if (event.animationName !== "flip-bottom") return;
      if (!this.busy) return;
      this.finish();
    }

    paint(next, old) {
      this.topD.textContent = next;
      this.bottomD.textContent = old;
      this.flapTopD.textContent = old;
      this.flapBottomD.textContent = next;
    }

    set(value) {
      var next = String(value);
      if (next === this.value) return;

      if (this.value === null) {
        this.value = next;
        this.paint(next, next);
        return;
      }

      if (this.busy) this.finish();

      var old = this.value;
      this.value = next;

      if (reducedMotion()) {
        this.el.classList.remove("flipping");
        this.busy = false;
        this.paint(next, next);
        return;
      }

      /* static halves already hold the end state once the flaps land */
      this.paint(next, old);

      this.el.classList.remove("flipping");
      void this.el.offsetWidth;
      this.el.classList.add("flipping");
      this.busy = true;
    }

    finish() {
      this.bottomD.textContent = this.value;
      this.el.classList.remove("flipping");
      this.busy = false;
    }
  }

  window.FlipCard = FlipCard;
})();
