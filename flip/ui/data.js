/* Settings > Data: backups, restore and exports. Every file operation happens
   in Rust; this pane only lists what came back and asks before overwriting. */
(function () {
  "use strict";

  var invoke = window.__TAURI__.core.invoke;

  function el(tag, className, text) {
    return Board.el(tag, className, text);
  }

  function sizeText(bytes) {
    if (!bytes) return "0 KB";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function block(title, note) {
    var wrap = el("section", "data-block");
    var head = el("div", "data-head");
    head.appendChild(el("h3", "", title));
    wrap.appendChild(head);
    if (note) wrap.appendChild(el("p", "data-note", note));
    return wrap;
  }

  function describe(path) {
    var name = String(path).split(/[\\/]/).pop();
    Board.toast("Saved " + name + " to Downloads");
  }

  function section() {
    var pane = el("div", "data-pane");

    /* ---------------------------------------------------------- full backup */
    var backup = block(
      "Backups",
      "A backup holds your timetable, tasks, subjects and settings in one file, so Flip can be put back exactly as it was. :D"
    );

    var backupActions = el("div", "data-actions");
    var makeButton = el("button", "btn primary small", "Back up now");
    makeButton.type = "button";
    var folderButton = el("button", "btn small", "Show backups folder");
    folderButton.type = "button";
    folderButton.addEventListener("click", function () {
      invoke("open_folder", { kind: "backups" }).catch(function (err) {
        Board.toast(String((err && err.message) || err));
      });
    });
    backupActions.appendChild(makeButton);
    backupActions.appendChild(folderButton);
    backup.appendChild(backupActions);

    var list = el("div", "backup-list");
    var empty = el("p", "dash-hint", "No backups yet. The first one takes a second.");
    list.appendChild(empty);
    backup.appendChild(list);
    pane.appendChild(backup);

    async function refresh() {
      try {
        var backups = await invoke("list_backups");
        Board.clear(list);
        if (!backups.length) {
          list.appendChild(el("p", "dash-hint", "No backups yet. The first one takes a second."));
          return;
        }
        backups.forEach(function (info) {
          var row = el("div", "backup-row");
          var text = el("div", "backup-text");
          var title = el("strong", "", info.createdAt);
          if (info.automatic) title.appendChild(el("span", "tag", "safety copy"));
          text.appendChild(title);
          text.appendChild(el("span", "backup-meta", sizeText(info.sizeBytes) + " · " + info.name));
          row.appendChild(text);

          var restore = el("button", "btn small", "Restore");
          restore.type = "button";
          restore.addEventListener("click", function () {
            restoreBackup(info);
          });
          row.appendChild(restore);

          var remove = Board.icon("Delete backup from " + info.createdAt, "✕");
          remove.addEventListener("click", function () {
            Board.confirm({
              title: "Delete this backup?",
              message: "The file is removed from the backups folder. Your live data is untouched.",
              confirmLabel: "Delete backup",
              onConfirm: function () {
                invoke("delete_backup", { name: info.name })
                  .then(function () {
                    Board.toast("Backup deleted");
                    refresh();
                  })
                  .catch(function (err) {
                    Board.toast(String((err && err.message) || err));
                  });
              },
            });
          });
          row.appendChild(remove);
          list.appendChild(row);
        });
      } catch (err) {
        Board.clear(list);
        list.appendChild(el("p", "dash-hint", "Backups could not be listed right now."));
      }
    }

    function restoreBackup(info) {
      Board.confirm({
        title: "Restore this backup?",
        message:
          "Your timetable, tasks and settings are replaced with the ones in this backup. Flip saves a safety copy of the current data first, so this can be undone.",
        confirmLabel: "Restore backup",
        onConfirm: function () {
          invoke("restore_backup", { name: info.name })
            .then(function (snap) {
              if (window.Flip && snap) window.Flip.apply(snap);
              return window.Board.load();
            })
            .then(function () {
              Board.toast("Backup restored");
              refresh();
            })
            .catch(function (err) {
              Board.toast(String((err && err.message) || err));
            });
        },
      });
    }

    makeButton.addEventListener("click", function () {
      makeButton.disabled = true;
      invoke("make_backup")
        .then(function () {
          Board.toast("Backup saved");
          refresh();
        })
        .catch(function (err) {
          Board.toast(String((err && err.message) || err));
        })
        .then(function () {
          makeButton.disabled = false;
        });
    });

    /* -------------------------------------------------------------- exports */
    var exports = block(
      "Export",
      "Spreadsheets open in Excel, Numbers or Google Sheets. Exports are written to your Downloads folder. :3"
    );
    var exportActions = el("div", "data-actions");
    [
      ["tasks", "Tasks as CSV"],
      ["timetable", "Timetable as CSV"],
      ["settings", "Settings as JSON"],
    ].forEach(function (pair) {
      var button = el("button", "btn small", pair[1]);
      button.type = "button";
      button.addEventListener("click", function () {
        invoke("export_data", { kind: pair[0] })
          .then(describe)
          .catch(function (err) {
            Board.toast(String((err && err.message) || err));
          });
      });
      exportActions.appendChild(button);
    });
    exports.appendChild(exportActions);
    pane.appendChild(exports);

    /* --------------------------------------------------------------- storage */
    var storage = block(
      "Data folder",
      "Flip keeps settings.json and board.json here. Nothing leaves your computer. :)"
    );
    var storageActions = el("div", "data-actions");
    var openData = el("button", "btn small", "Show data folder");
    openData.type = "button";
    openData.addEventListener("click", function () {
      invoke("open_folder", { kind: "data" }).catch(function (err) {
        Board.toast(String((err && err.message) || err));
      });
    });
    storageActions.appendChild(openData);
    storage.appendChild(storageActions);
    pane.appendChild(storage);

    refresh();
    return pane;
  }

  window.FlipData = { section: section };
})();
