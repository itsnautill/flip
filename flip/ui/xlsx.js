/* Spreadsheet support without a library.
   A workbook is a ZIP of XML parts: WebView2 can inflate deflate streams and
   parse XML itself, so reading one sheet and writing the template both fit in
   this file. Only the first worksheet is read. */
(function () {
  "use strict";

  /* ------------------------------------------------------------------- crc32 */

  var CRC_TABLE = null;

  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* --------------------------------------------------------------- zip read */

  function u16(view, at) {
    return view.getUint16(at, true);
  }

  function u32(view, at) {
    return view.getUint32(at, true);
  }

  function centralEntries(view) {
    var lowest = Math.max(0, view.byteLength - 65558);
    var eocd = -1;
    for (var at = view.byteLength - 22; at >= lowest; at--) {
      if (u32(view, at) === 0x06054b50) {
        eocd = at;
        break;
      }
    }
    if (eocd < 0) throw new Error("That file is not a spreadsheet.");

    var count = u16(view, eocd + 10);
    var cursor = u32(view, eocd + 16);
    var entries = {};
    var decoder = new TextDecoder();
    for (var i = 0; i < count; i++) {
      if (u32(view, cursor) !== 0x02014b50) break;
      var nameLength = u16(view, cursor + 28);
      var extraLength = u16(view, cursor + 30);
      var commentLength = u16(view, cursor + 32);
      var name = decoder.decode(
        new Uint8Array(view.buffer, view.byteOffset + cursor + 46, nameLength)
      );
      entries[name] = {
        method: u16(view, cursor + 10),
        compressed: u32(view, cursor + 20),
        localAt: u32(view, cursor + 42),
      };
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function entryBytes(bytes, view, entry) {
    var at = entry.localAt;
    if (u32(view, at) !== 0x04034b50) throw new Error("That spreadsheet is damaged.");
    var start = at + 30 + u16(view, at + 26) + u16(view, at + 28);
    var raw = bytes.subarray(start, start + entry.compressed);
    if (entry.method === 0) return raw;
    if (entry.method !== 8) throw new Error("That spreadsheet uses unsupported compression.");
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This system cannot open compressed spreadsheets.");
    }
    var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------------------------------------------------------------- xml read */

  function parseXml(bytes) {
    var doc = new DOMParser().parseFromString(
      new TextDecoder().decode(bytes),
      "application/xml"
    );
    if (!doc || doc.getElementsByTagName("parsererror").length) {
      throw new Error("That spreadsheet is damaged.");
    }
    return doc;
  }

  function attributeEndingWith(node, suffix) {
    if (!node || !node.attributes) return null;
    for (var i = 0; i < node.attributes.length; i++) {
      var name = node.attributes[i].name;
      if (name === suffix || name.slice(-(suffix.length + 1)) === ":" + suffix) {
        return node.attributes[i].value;
      }
    }
    return null;
  }

  function sharedStrings(doc) {
    if (!doc) return [];
    var out = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("si"), function (si) {
      var text = "";
      Array.prototype.forEach.call(si.getElementsByTagName("t"), function (node) {
        // Phonetic runs are not part of the value.
        if (node.parentNode && node.parentNode.nodeName === "rPh") return;
        text += node.textContent;
      });
      out.push(text);
    });
    return out;
  }

  function columnIndex(reference) {
    var letters = String(reference || "").replace(/[^A-Z]/gi, "").toUpperCase();
    var index = 0;
    for (var i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return letters ? index - 1 : -1;
  }

  function cellValue(cell, shared) {
    var type = cell.getAttribute("t");
    var value = cell.getElementsByTagName("v")[0];
    if (type === "s") return shared[Number(value && value.textContent)] || "";
    if (type === "inlineStr") {
      var text = "";
      Array.prototype.forEach.call(cell.getElementsByTagName("t"), function (node) {
        text += node.textContent;
      });
      return text;
    }
    if (type === "str" || type === "e") return value ? value.textContent : "";
    if (type === "b") return Boolean(value) && value.textContent === "1";
    if (!value) return "";
    var number = Number(value.textContent);
    return Number.isFinite(number) ? number : value.textContent;
  }

  function extractRows(doc, shared) {
    var rows = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("row"), function (row) {
      var values = [];
      Array.prototype.forEach.call(row.getElementsByTagName("c"), function (cell) {
        var index = columnIndex(cell.getAttribute("r"));
        if (index < 0) index = values.length;
        values[index] = cellValue(cell, shared);
      });
      for (var i = 0; i < values.length; i++) {
        if (values[i] === undefined) values[i] = "";
      }
      /* Keep the sheet's own row numbers so error messages point at the
         spreadsheet, not at the array position after skipped blank rows. */
      var number = Number(row.getAttribute("r"));
      if (number > 0) {
        while (rows.length < number - 1) rows.push([]);
        rows[number - 1] = values;
      } else {
        rows.push(values);
      }
    });
    return rows;
  }

  /** Reads the first worksheet as an array of rows (arrays of cell values). */
  async function readSheetRows(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var entries = centralEntries(view);

    async function part(name) {
      var entry = entries[name];
      return entry ? entryBytes(bytes, view, entry) : null;
    }

    var target = "xl/worksheets/sheet1.xml";
    var workbookBytes = await part("xl/workbook.xml");
    var relsBytes = await part("xl/_rels/workbook.xml.rels");
    if (workbookBytes && relsBytes) {
      var workbook = parseXml(workbookBytes);
      var sheet = workbook.getElementsByTagName("sheet")[0];
      var relationshipId = attributeEndingWith(sheet, "id");
      if (relationshipId) {
        var relationships = parseXml(relsBytes).getElementsByTagName("Relationship");
        Array.prototype.some.call(relationships, function (relation) {
          if (relation.getAttribute("Id") !== relationshipId) return false;
          var relative = relation.getAttribute("Target") || "";
          target = relative.charAt(0) === "/" ? relative.slice(1) : "xl/" + relative.replace(/^\.\//, "");
          return true;
        });
      }
    }

    var sheetBytes = await part(target);
    if (!sheetBytes) {
      var fallback = Object.keys(entries)
        .filter(function (name) {
          return /^xl\/worksheets\/.*\.xml$/.test(name);
        })
        .sort()[0];
      if (!fallback) throw new Error("That file has no worksheet.");
      sheetBytes = await part(fallback);
    }

    var sharedBytes = await part("xl/sharedStrings.xml");
    return extractRows(parseXml(sheetBytes), sharedStrings(sharedBytes ? parseXml(sharedBytes) : null));
  }

  /* -------------------------------------------------------------- zip write */

  function columnName(index) {
    var name = "";
    var n = index + 1;
    while (n > 0) {
      var rest = (n - 1) % 26;
      name = String.fromCharCode(65 + rest) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function xmlEscape(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function zip(files) {
    var encoder = new TextEncoder();
    var pieces = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var data = encoder.encode(file.body);
      var sum = crc32(data);
      var local = new Uint8Array(30 + name.length);
      var view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(10, time, true);
      view.setUint16(12, date, true);
      view.setUint32(14, sum, true);
      view.setUint32(18, data.length, true);
      view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true);
      local.set(name, 30);
      pieces.push(local, data);
      central.push({ name: name, sum: sum, size: data.length, offset: offset, time: time, date: date });
      offset += local.length + data.length;
    });

    var centralSize = 0;
    var heads = central.map(function (entry) {
      var head = new Uint8Array(46 + entry.name.length);
      var view = new DataView(head.buffer);
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(12, entry.time, true);
      view.setUint16(14, entry.date, true);
      view.setUint32(16, entry.sum, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      head.set(entry.name, 46);
      centralSize += head.length;
      return head;
    });

    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, central.length, true);
    endView.setUint16(10, central.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    var all = pieces.concat(heads, [end]);
    var total = all.reduce(function (sum, piece) {
      return sum + piece.length;
    }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    all.forEach(function (piece) {
      out.set(piece, at);
      at += piece.length;
    });
    return out;
  }

  /* ---------------------------------------------------------------- template */

  var HEADER = ["Day", "Start", "End", "Subject", "Room"];
  var SAMPLE = [
    ["Mon", "08:00", "08:45", "Math", "B12"],
    ["Mon", "08:50", "09:35", "Physics", "Lab 1"],
    ["Tue", "10:00", "10:45", "Math", "B12"],
    ["Wed", "13:00", "13:45", "Biology", "Room 4"],
  ];

  function sheetXml(table) {
    var rows = table
      .map(function (values, rowIndex) {
        var cells = values
          .map(function (value, column) {
            var reference = columnName(column) + (rowIndex + 1);
            var style = rowIndex === 0 ? ' s="1"' : "";
            return (
              '<c r="' + reference + '" t="inlineStr"' + style + "><is><t>" +
              xmlEscape(value) + "</t></is></c>"
            );
          })
          .join("");
        return '<row r="' + (rowIndex + 1) + '">' + cells + "</row>";
      })
      .join("");
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<cols><col min="1" max="1" width="10" customWidth="1"/>' +
      '<col min="2" max="3" width="9" customWidth="1"/>' +
      '<col min="4" max="4" width="20" customWidth="1"/>' +
      '<col min="5" max="5" width="16" customWidth="1"/></cols>' +
      "<sheetData>" + rows + "</sheetData></worksheet>"
    );
  }

  function buildTemplate() {
    return zip([
      {
        name: "[Content_Types].xml",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/workbook.xml",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Timetable" sheetId="1" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/styles.xml",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
          '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
          '<fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border/></borders>' +
          '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
          '<cellXfs count="2"><xf xfId="0"/><xf fontId="1" applyFont="1" xfId="0"/></cellXfs>' +
          "</styleSheet>",
      },
      { name: "xl/worksheets/sheet1.xml", body: sheetXml([HEADER].concat(SAMPLE)) },
    ]);
  }

  /** A real Excel workbook for any table of strings - the export path, where
      Unicode never depends on a code page or a list separator. */
  function buildSheet(table) {
    return zip([
      {
        name: "[Content_Types].xml",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      {
        name: "xl/workbook.xml",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Timetable" sheetId="1" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        body:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          "</Relationships>",
      },
      { name: "xl/worksheets/sheet1.xml", body: sheetXml(table) },
    ]);
  }

  window.Xlsx = {
    readSheetRows: readSheetRows,
    buildTemplate: buildTemplate,
    buildSheet: buildSheet,
  };
})();
