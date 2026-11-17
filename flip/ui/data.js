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

    /* Excel first: it stores Unicode itself, so no encoding or list separator
       can ever turn a Vietnamese subject name into rubbish. */
    var excelButton = el("button", "btn small primary", "Timetable to Excel (.xlsx)");
    excelButton.type = "button";
    excelButton.addEventListener("click", function () {
      exportTimetableXlsx(excelButton);
    });
    var excelRow = el("div", "data-actions");
    excelRow.appendChild(excelButton);
    exports.appendChild(excelRow);

    var separator = ",";
    var csvBlock = el("div", "export-csv");
    var csvRow = el("div", "data-actions");
    var csvButton = el("button", "btn small", "Timetable as CSV (for other apps)");
    csvButton.type = "button";
    csvButton.addEventListener("click", function () {
      invoke("export_data", { kind: "timetable", separator: separator })
        .then(describe)
        .catch(function (err) {
          Board.toast(String((err && err.message) || err));
        });
    });
    csvRow.appendChild(csvButton);
    csvBlock.appendChild(csvRow);

    var separatorRow = el("div", "export-separator");
    separatorRow.appendChild(el("span", "export-label", "CSV separator"));
    var seg = el("div", "seg");
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
    separatorRow.appendChild(seg);
    csvBlock.appendChild(separatorRow);
    csvBlock.appendChild(
      el(
        "p",
        "hint",
        "Excel with Vietnamese regional settings usually wants Semicolon; most other apps want Comma. The .xlsx export never has this problem."
      )
    );
    exports.appendChild(csvBlock);

    var moreRow = el("div", "data-actions");
    [
      ["tasks", "Tasks as CSV"],
      ["settings", "Settings as JSON"],
    ].forEach(function (pair) {
      var button = el("button", "btn small", pair[1]);
      button.type = "button";
      button.addEventListener("click", function () {
        invoke("export_data", { kind: pair[0], separator: separator })
          .then(describe)
          .catch(function (err) {
            Board.toast(String((err && err.message) || err));
          });
      });
      moreRow.appendChild(button);
    });
    exports.appendChild(moreRow);
    pane.appendChild(exports);

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
