/* Optional anonymous usage ping.
   Off unless the user turns it on in Settings, and even then it sends one small
   request per day: a random install id, the app version, and the interface
   language. Nothing about tasks, subjects, notes, times or the machine itself.
   Failures are silent - a missing network must never interrupt the app. */
(function () {
  "use strict";

  /* Filled in when the stats worker is deployed. */
  var ENDPOINT = "https://site-8afa0bdbe0764332b38e33193a775c95.freebuff.page/ping";
  var KEY = "flip.pinged";

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  /* The local calendar day, so a ping is not repeated on the same date. */
  function today() {
    var now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  }

  function readSent() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function markSent(day) {
    try {
      localStorage.setItem(KEY, day);
    } catch (error) {
      /* private mode or a locked store: the next launch simply tries again */
    }
  }

  function send(snap) {
    if (!snap || snap.telemetry !== true || !snap.installId || !ENDPOINT) {
      return Promise.resolve(false);
    }
    var day = today();
    if (readSent() === day) return Promise.resolve(false);

    return window.__TAURI__.app
      .getVersion()
      .then(function (version) {
        return fetch(ENDPOINT, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: snap.installId,
            v: version,
            lang: snap.language === "vi" ? "vi" : "en",
          }),
        });
      })
      .then(function (response) {
        if (!response.ok) return false;
        markSent(day);
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  window.FlipTelemetry = {
    /* Runs the check with the freshest snapshot, e.g. right after switching on. */
    pingNow: function () {
      return window.__TAURI__.core
        .invoke("get_snapshot")
        .then(send)
        .catch(function () {
          return false;
        });
    },
    send: send,
  };
})();
