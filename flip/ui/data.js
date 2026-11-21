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

  /* The Data pane is built from the same pieces as Appearance and General:
     a small group heading, then a row card per setting. Nothing here invents a
     second visual language for the one modal. */
  function row(title, sub, controls) {
    var node = el("div", "setting-row");
    var text = el("div", "setting-text");
    if (title) text.appendChild(el("div", "setting-title", title));
    if (sub) text.appendChild(el("div", "sub", sub));
    node.appendChild(text);
    if (controls) node.appendChild(controls);
    return node;
  }

  /* A setting whose body is a line of buttons under its explanation. */
  function rowWithActions(sub, controls) {
    var node = el("div", "setting-row column");
    var text = el("div", "setting-text");
    text.appendChild(el("div", "sub", sub));
    node.appendChild(text);
    node.appendChild(actions(controls));
    return node;
  }

  function actions(controls) {
    var box = el("div", "setting-actions");
    controls.forEach(function (control) {
      box.appendChild(control);
    });
    return box;
  }

  function describe(path) {
    var name = String(path).split(/[\\/]/).pop();
    Board.toast("Saved " + name + " to Downloads");
  }

  function section() {
    var pane = el("div", "data-pane");

    /* ------------------------------------------------------------ wi-fi sync */
    pane.appendChild(el("h3", "", "Wi-Fi sync"));
    var syncButton = el("button", "btn primary small", "Sync now");
    syncButton.type = "button";
    syncButton.addEventListener("click", function () {
      if (window.FlipSync) window.FlipSync.open();
    });
    pane.appendChild(
      row("", "Both devices need the same Wi-Fi. No internet, no account.", syncButton)
    );

    /* ---------------------------------------------------------- full backup */
    pane.appendChild(el("h3", "", "Backups"));

    var makeButton = el("button", "btn primary small", "Back up now");
    makeButton.type = "button";
    var folderButton = el("button", "btn small", "Show backups folder");
    folderButton.type = "button";
    folderButton.addEventListener("click", function () {
      invoke("open_folder", { kind: "backups" }).catch(function (err) {
        Board.toast(String((err && err.message) || err));
      });
    });
    pane.appendChild(
      rowWithActions(
        "A backup holds your timetable, tasks, subjects and settings in one file, so Flip can be put back exactly as it was. :D",
        [makeButton, folderButton]
      )
    );

    var list = el("div", "backup-list");
    list.appendChild(emptyRow());
    pane.appendChild(list);

    function emptyRow() {
      return row("", "No backups yet. The first one takes a second.", null);
    }

    async function refresh() {
      try {
        var backups = await invoke("list_backups");
        Board.clear(list);
        if (!backups.length) {
          list.appendChild(emptyRow());
          return;
        }
        backups.forEach(function (info) {
          var node = el("div", "setting-row");
          var text = el("div", "setting-text backup-text");
          var title = el("div", "setting-title", info.createdAt);
          if (info.automatic) title.appendChild(el("span", "tag", "safety copy"));
          text.appendChild(title);
          text.appendChild(el("span", "backup-meta", sizeText(info.sizeBytes) + " · " + info.name));
          node.appendChild(text);

          var restore = el("button", "btn small", "Restore");
          restore.type = "button";
          restore.addEventListener("click", function () {
            restoreBackup(info);
          });
          node.appendChild(restore);

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
          node.appendChild(remove);
          list.appendChild(node);
        });
      } catch (err) {
        Board.clear(list);
        list.appendChild(row("", "Backups could not be listed right now.", null));
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
    pane.appendChild(el("h3", "", "Export"));

    /* Excel first: it stores Unicode itself, so no encoding or list separator
       can ever turn a Vietnamese subject name into rubbish. */
    var separator = ",";
    var excelButton = el("button", "btn small primary", "Timetable to Excel (.xlsx)");
    excelButton.type = "button";
    excelButton.addEventListener("click", function () {
      exportTimetableXlsx(excelButton);
    });
    var csvButton = el("button", "btn small", "Timetable as CSV (for other apps)");
    csvButton.type = "button";
    csvButton.addEventListener("click", function () {
      invoke("export_data", { kind: "timetable", separator: separator })
        .then(describe)
        .catch(function (err) {
          Board.toast(String((err && err.message) || err));
        });
    });
    pane.appendChild(
      rowWithActions(
        "Spreadsheets open in Excel, Numbers or Google Sheets. Exports are written to your Downloads folder. :3",
        [excelButton, csvButton]
      )
    );

    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "CSV separator");
    [
      [",", "Comma"],
      [";", "Semicolon"],
    ].forEach(function (choice) {
      var button = el("button", "seg-btn" + (choice[0] === separator ? " active" : ""), choice[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", String(choice[0] === separator));
      button.addEventListener("click", function () {
        separator = choice[0];
        seg.querySelectorAll(".seg-btn").forEach(function (node) {
          var on = node === button;
          node.classList.toggle("active", on);
          node.setAttribute("aria-pressed", String(on));
        });
      });
      seg.appendChild(button);
    });
    pane.appendChild(
      row(
        "CSV separator",
        "Excel with Vietnamese regional settings usually wants Semicolon; most other apps want Comma. The .xlsx export never has this problem.",
        seg
      )
    );

    var moreButtons = [
      ["tasks", "Tasks as CSV"],
      ["settings", "Settings as JSON"],
    ].map(function (pair) {
      var button = el("button", "btn small", pair[1]);
      button.type = "button";
      button.addEventListener("click", function () {
        invoke("export_data", { kind: pair[0], separator: separator })
          .then(describe)
          .catch(function (err) {
            Board.toast(String((err && err.message) || err));
          });
      });
      return button;
    });
    pane.appendChild(row("Other formats", "", actions(moreButtons)));

    function exportTimetableXlsx(button) {
      var view = window.Board && window.Board.view();
      if (!view) {
        Board.toast("The timetable is not loaded yet.");
        return;
      }
      var table = [["Day", "Start", "End", "Subject", "Room"]];
      (view.days || []).forEach(function (day) {
        (view.periods || []).forEach(function (period) {
          if (period["break"]) return;
          var cell = view.cells[day.key + "-" + period.id];
          if (!cell) return;
          table.push([day.label, period.start, period.end, cell.name, cell.room || ""]);
        });
      });
      if (table.length === 1) {
        Board.toast("Add a lesson first - there is nothing to export yet.");
        return;
      }
      button.disabled = true;
      var bytes;
      try {
        bytes = window.Xlsx.buildSheet(table);
      } catch (_) {
        button.disabled = false;
        Board.toast("The spreadsheet could not be built.");
        return;
      }
      invoke("save_export", {
        name: "Flip timetable.xlsx",
        bytes: Array.prototype.slice.call(bytes),
      })
        .then(describe)
        .catch(function (err) {
          Board.toast(String((err && err.message) || err));
        })
        .then(function () {
          button.disabled = false;
        });
    }

    /* --------------------------------------------------------------- storage */
    pane.appendChild(el("h3", "", "Data folder"));
    var openData = el("button", "btn small", "Show data folder");
    openData.type = "button";
    openData.addEventListener("click", function () {
      invoke("open_folder", { kind: "data" }).catch(function (err) {
        Board.toast(String((err && err.message) || err));
      });
    });
    pane.appendChild(
      row("", "Flip keeps settings.json and board.json here. Nothing leaves your computer. :)", openData)
    );

    refresh();
    return pane;
  }

  window.FlipData = { section: section };
})();
