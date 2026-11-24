/*
 * XML to Table panel.
 * Alag file: script.js / validation.js / logic.js me koi change nahi.
 * Kisi bhi XML (paste ya file) -> /api/xml-table -> har table ka alag tab.
 *
 * - Errors / repairs "Issues" tab me table ki tarah (Level, Type, Line, ...).
 * - Search bar: active table ki saari rows me, saare cells me dhoondhta hai.
 * - Har column ke neeche filter (Issues me Level/Type ke dropdown).
 */
(function () {
    "use strict";

    var PAGE_SIZE = 200;
    var BIG_FILE = 1500000; // bytes: isse bada file textarea me nahi dikhate

    var ISSUE_COLUMNS = ["Level", "Type", "Line", "Column", "Message", "Original", "Fixed"];

    var CSS = [
        ".xt-panel{background:#fff;border:1px solid var(--excel-border);border-radius:5px;padding:12px 16px;margin-bottom:16px}",
        ".xt-panel summary{cursor:pointer;font-weight:600}",
        "#xtInput{width:100%;height:130px;margin-top:10px;padding:10px;resize:vertical;border:1px solid #c9ceca;border-radius:3px;font-family:Consolas,monospace;line-height:1.4}",
        ".xt-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}",
        ".xt-controls input[type=text]{min-height:30px;border:1px solid #c9ceca;border-radius:3px;padding:5px;width:180px}",
        ".xt-controls input#xtRowSearch{width:300px;max-width:100%}",
        "#xtStatus{color:var(--muted);overflow-wrap:anywhere}",
        "#xtStatus.xt-bad{color:#b42318}",
        "#xtStatus.xt-good{color:#217346}",
        ".xt-tabs{display:flex;gap:4px;margin-top:12px;flex-wrap:wrap}",
        ".xt-tabs button.xt-active{background:var(--excel-green);color:#fff;border-color:var(--excel-green)}",
        ".xt-tabs button.xt-issues-tab{color:#b42318;border-color:#e0b4b0}",
        ".xt-tabs button.xt-issues-tab.xt-active{background:#b42318;color:#fff;border-color:#b42318}",
        ".xt-wrap{max-height:480px;overflow:auto;border:1px solid var(--excel-border);margin-top:8px;background:#fff}",
        "#xtTable{border-collapse:separate;border-spacing:0;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:13px}",
        "#xtTable th,#xtTable td{padding:4px 8px;border-right:1px solid var(--excel-border);border-bottom:1px solid var(--excel-border);white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis;text-align:left;background:#fff}",
        "#xtTable thead tr.xt-head-row th{position:sticky;top:0;z-index:3;box-sizing:border-box;height:27px;line-height:17px;background:var(--excel-header);font-weight:600}",
        "#xtTable thead tr.xt-filter-row th{position:sticky;top:27px;z-index:3;box-sizing:border-box;height:30px;padding:3px;background:#f8faf8}",
        "#xtTable .xt-filter{display:block;width:100%;min-width:70px;box-sizing:border-box;padding:3px 4px;border:1px solid #b7beb7;border-radius:3px;background:#fff;color:#202124;font-size:11px}",
        "#xtTable .xt-num{position:sticky;left:0;z-index:2;background:var(--excel-header);text-align:center;color:#555;min-width:48px}",
        "#xtTable thead .xt-num{z-index:4}",
        "#xtTable tr.xt-err td{background:#fdecea}",
        "#xtTable tr.xt-warn td{background:#fff7e0}",
        "#xtTable tr.xt-click{cursor:pointer}",
        "#xtTable tr.xt-click:hover td{filter:brightness(0.96)}",
        ".xt-more{display:flex;align-items:center;gap:10px;margin-top:8px;color:var(--muted)}"
    ].join("\n");

    var state = {
        data: null,
        views: [],
        tab: 0,
        cols: [],
        shown: PAGE_SIZE,
        fileText: ""
    };

    function $(id) { return document.getElementById(id); }

    function currentView() { return state.views[state.tab]; }

    // ------------------------------------------------------------
    // Views: har table ek view, aur issues ka alag view
    // ------------------------------------------------------------
    function makeView(table) {
        var flags = table.columns.map(function () { return false; });
        table.rows.forEach(function (row) {
            for (var i = 0; i < flags.length; i++) {
                if (!flags[i] && row[i] !== "") flags[i] = true;
            }
        });

        return {
            kind: "data",
            name: table.name,
            columns: table.columns,
            rows: table.rows,
            nonEmpty: flags,
            selectCols: {},
            filters: {},
            hay: null
        };
    }

    function makeIssuesView(issues) {
        return {
            kind: "issues",
            name: "Issues",
            columns: ISSUE_COLUMNS,
            rows: issues.map(function (it) {
                return [
                    it.level, it.type, String(it.line), String(it.column),
                    it.message, it.original, it.fixed
                ];
            }),
            nonEmpty: ISSUE_COLUMNS.map(function () { return true; }),
            selectCols: { 0: true, 1: true },
            filters: {},
            hay: null
        };
    }

    function distinct(view, col) {
        var seen = {};
        view.rows.forEach(function (row) { seen[row[col]] = true; });
        return Object.keys(seen).sort();
    }

    function visibleColumns(view, applyColumnSearch) {
        var hide = view.kind === "data" && $("xtHideEmpty").checked;
        var query = applyColumnSearch ? $("xtColSearch").value.trim().toLowerCase() : "";
        var cols = [];

        view.columns.forEach(function (name, i) {
            if (hide && !view.nonEmpty[i]) return;
            if (query && name.toLowerCase().indexOf(query) === -1) return;
            cols.push(i);
        });

        return cols;
    }

    function setStatus(text, cls) {
        var el = $("xtStatus");
        el.textContent = text;
        el.className = cls || "";
    }

    // ------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------
    function renderTabs() {
        var box = $("xtTabs");
        box.innerHTML = "";

        state.views.forEach(function (view, index) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = view.name + " (" + view.rows.length + ")";

            var cls = [];
            if (view.kind === "issues") cls.push("xt-issues-tab");
            if (index === state.tab) cls.push("xt-active");
            button.className = cls.join(" ");

            button.addEventListener("click", function () {
                state.tab = index;
                state.shown = PAGE_SIZE;
                renderTabs();
                renderTable();
            });

            box.appendChild(button);
        });
    }

    function renderHeader() {
        var thead = $("xtTable").tHead;
        thead.innerHTML = "";

        var view = currentView();
        if (!view) return;

        state.cols = visibleColumns(view, true);

        var headRow = document.createElement("tr");
        headRow.className = "xt-head-row";
        var filterRow = document.createElement("tr");
        filterRow.className = "xt-filter-row";

        var corner = document.createElement("th");
        corner.className = "xt-num";
        corner.textContent = "#";
        headRow.appendChild(corner);

        var cornerFilter = document.createElement("th");
        cornerFilter.className = "xt-num";
        filterRow.appendChild(cornerFilter);

        state.cols.forEach(function (col) {
            var th = document.createElement("th");
            th.textContent = view.columns[col];
            th.title = view.columns[col];
            headRow.appendChild(th);

            var fh = document.createElement("th");
            var control;

            if (view.selectCols[col]) {
                control = document.createElement("select");
                var all = document.createElement("option");
                all.value = "";
                all.textContent = "All";
                control.appendChild(all);

                distinct(view, col).forEach(function (value) {
                    var option = document.createElement("option");
                    option.value = value;
                    option.textContent = value;
                    control.appendChild(option);
                });

                control.value = view.filters[col] || "";
                control.addEventListener("change", onFilter);
            } else {
                control = document.createElement("input");
                control.type = "text";
                control.placeholder = "Filter";
                control.value = view.filters[col] || "";
                control.addEventListener("input", onFilter);
            }

            control.className = "xt-filter";
            control.dataset.col = col;
            control.setAttribute("aria-label", "Filter " + view.columns[col]);

            function onFilter() {
                view.filters[col] = control.value;
                state.shown = PAGE_SIZE;
                renderBody();
            }

            fh.appendChild(control);
            filterRow.appendChild(fh);
        });

        thead.appendChild(headRow);
        thead.appendChild(filterRow);
    }

    function matchingRows(view) {
        var search = $("xtRowSearch").value.trim().toLowerCase();
        var active = [];

        Object.keys(view.filters).forEach(function (key) {
            var value = view.filters[key];
            if (value) {
                active.push({
                    col: Number(key),
                    value: value.toLowerCase(),
                    exact: !!view.selectCols[key]
                });
            }
        });

        if (search && !view.hay) {
            view.hay = view.rows.map(function (row) {
                return row.join("\u0001").toLowerCase();
            });
        }

        var result = [];

        for (var r = 0; r < view.rows.length; r++) {
            if (search && view.hay[r].indexOf(search) === -1) continue;

            var ok = true;
            for (var f = 0; f < active.length; f++) {
                var cell = String(view.rows[r][active[f].col]).toLowerCase();
                if (active[f].exact ? cell !== active[f].value
                                    : cell.indexOf(active[f].value) === -1) {
                    ok = false;
                    break;
                }
            }
            if (ok) result.push(r);
        }

        return result;
    }

    function jumpToLine(line) {
        line = Number(line);
        if (!line) return;

        if (state.fileText) {
            setStatus("Line " + line + " is in the uploaded file. Open the file in a text editor to see it.");
            return;
        }

        var box = $("xtInput");
        var lines = box.value.replace(/\r\n?/g, "\n").split("\n");
        if (line > lines.length) return;

        var start = 0;
        for (var i = 0; i < line - 1; i++) start += lines[i].length + 1;

        box.focus();
        box.setSelectionRange(start, start + lines[line - 1].length);

        var lineHeight = parseFloat(window.getComputedStyle(box).lineHeight) || 18;
        box.scrollTop = Math.max(0, (line - 3) * lineHeight);
    }

    function renderBody() {
        var tbody = $("xtTable").tBodies[0];
        tbody.innerHTML = "";

        var view = currentView();

        if (!view) {
            $("xtShown").textContent = "";
            $("xtMore").style.display = "none";
            return;
        }

        var matches = matchingRows(view);
        var limit = Math.min(state.shown, matches.length);
        var frag = document.createDocumentFragment();

        for (var m = 0; m < limit; m++) {
            var r = matches[m];
            var row = view.rows[r];
            var tr = document.createElement("tr");

            if (view.kind === "issues") {
                tr.className = (row[0] === "error" ? "xt-err" : "xt-warn") +
                    (row[2] ? " xt-click" : "");
                if (row[2]) {
                    tr.title = "Click to select line " + row[2] + " in the XML box";
                    tr.dataset.line = row[2];
                    tr.addEventListener("click", function (event) {
                        jumpToLine(event.currentTarget.dataset.line);
                    });
                }
            }

            var num = document.createElement("td");
            num.className = "xt-num";
            num.textContent = r + 1;
            tr.appendChild(num);

            for (var c = 0; c < state.cols.length; c++) {
                var td = document.createElement("td");
                var value = row[state.cols[c]];
                td.textContent = value;
                if (value.length > 40) td.title = value;
                tr.appendChild(td);
            }
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);

        $("xtShown").textContent =
            "Showing " + limit + " of " + matches.length + " matching rows (" +
            view.rows.length + " total), " +
            state.cols.length + " of " + view.columns.length + " columns";
        $("xtMore").style.display = "flex";
        $("xtMoreBtn").style.display = limit < matches.length ? "" : "none";
    }

    function renderTable() {
        renderHeader();
        renderBody();
    }

    // ------------------------------------------------------------
    // Input
    // ------------------------------------------------------------
    function decodeBuffer(buffer) {
        var bytes = new Uint8Array(buffer.slice(0, 3));

        if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
            return new TextDecoder("utf-16le").decode(buffer);
        }
        if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
            return new TextDecoder("utf-16be").decode(buffer);
        }

        var head = new TextDecoder("latin1").decode(buffer.slice(0, 200));
        var match = /encoding=["']([^"']+)["']/i.exec(head);
        var label = match ? match[1] : "utf-8";

        try {
            return new TextDecoder(label).decode(buffer);
        } catch (e) {
            return new TextDecoder("utf-8").decode(buffer);
        }
    }

    function loadFile(file) {
        file.arrayBuffer().then(function (buffer) {
            var text = decodeBuffer(buffer);

            if (buffer.byteLength > BIG_FILE) {
                state.fileText = text;
                $("xtInput").value = "";
                $("xtInput").placeholder =
                    "File loaded: " + file.name + " (" +
                    Math.round(buffer.byteLength / 1024) + " KB). Click Convert.";
            } else {
                state.fileText = "";
                $("xtInput").value = text;
            }
            setStatus("File loaded: " + file.name);
        }).catch(function (err) {
            setStatus("Could not read the file: " + err.message, "xt-bad");
        });
    }

    function convert() {
        var xml = state.fileText || $("xtInput").value;

        if (!xml.trim()) {
            setStatus("Paste or upload the XML first.", "xt-bad");
            return;
        }

        setStatus("Converting...");

        fetch("/api/xml-table", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ xml: xml })
        }).then(function (response) {
            return response.json().then(function (data) {
                return { ok: response.ok, data: data };
            });
        }).then(function (result) {
            var data = result.data;

            if (!result.ok) {
                var detail = data && data.detail;
                if (typeof detail !== "string") detail = JSON.stringify(detail);
                setStatus("Error: " + detail, "xt-bad");
                return;
            }

            state.data = data;
            state.views = (data.tables || []).map(makeView);

            if (data.issues && data.issues.length) {
                state.views.push(makeIssuesView(data.issues));
            }

            state.shown = PAGE_SIZE;
            $("xtRowSearch").value = "";
            $("xtColSearch").value = "";

            if (data.ok) {
                var parts = data.summary.tables.map(function (t) {
                    return t.name + ": " + t.rows + " rows x " + t.columns + " columns";
                });
                var text = "Tables: " + parts.join(" | ");
                var count = (data.issues || []).length;

                if (count) {
                    text += " | " + count + " XML issue(s) fixed automatically. See the Issues tab, and compare with the original XML.";
                }
                setStatus(text, count ? "" : "xt-good");
                state.tab = 0;
            } else {
                setStatus("XML could not be converted: " + data.message + " (see the Issues tab)", "xt-bad");
                state.tab = Math.max(0, state.views.length - 1);
            }

            renderTabs();
            renderTable();
        }).catch(function (err) {
            setStatus("Could not connect to the server: " + err.message, "xt-bad");
        });
    }

    // ------------------------------------------------------------
    // Export
    // ------------------------------------------------------------
    function sheetName(name, used) {
        var base = String(name).replace(/[\[\]:*?\/\\]/g, "_").slice(0, 31) || "Sheet";
        var candidate = base;
        var n = 2;

        while (used[candidate.toLowerCase()]) {
            var suffix = "_" + n++;
            candidate = base.slice(0, 31 - suffix.length) + suffix;
        }

        used[candidate.toLowerCase()] = true;
        return candidate;
    }

    function exportExcel() {
        if (!state.views.length) {
            setStatus("Convert the XML first.", "xt-bad");
            return;
        }
        if (typeof XLSX === "undefined") {
            setStatus("Excel library (SheetJS) not loaded. Check your internet.", "xt-bad");
            return;
        }

        var wb = XLSX.utils.book_new();
        var used = {};

        state.views.forEach(function (view) {
            var cols = visibleColumns(view, false);
            var aoa = [cols.map(function (i) { return view.columns[i]; })];

            view.rows.forEach(function (row) {
                aoa.push(cols.map(function (i) { return row[i]; }));
            });

            XLSX.utils.book_append_sheet(
                wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(view.name, used)
            );
        });

        XLSX.writeFile(wb, "xml_data.xlsx");
    }

    // ------------------------------------------------------------
    // Init
    // ------------------------------------------------------------
    function init() {
        if ($("xtPanel")) return;

        var style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        var panel = document.createElement("section");
        panel.className = "xt-panel";
        panel.id = "xtPanel";
        panel.innerHTML =
            "<details open>" +
            "<summary>XML to Table</summary>" +
            '<div class="xt-controls">' +
            '<input type="file" id="xtFile" accept=".xml,.txt,text/xml">' +
            "<span>or paste any XML below</span></div>" +
            '<textarea id="xtInput" spellcheck="false" ' +
            'placeholder="Paste your XML here (any structure)..."></textarea>' +
            '<div class="xt-controls">' +
            '<button id="xtConvertBtn" type="button" class="primary-btn">Convert to Table</button>' +
            '<button id="xtExportBtn" type="button">Export Excel</button>' +
            '<button id="xtClearBtn" type="button">Clear</button>' +
            '<span id="xtStatus">Paste or upload an XML file, then click Convert to Table.</span>' +
            "</div>" +
            '<div class="xt-tabs" id="xtTabs"></div>' +
            '<div class="xt-controls">' +
            '<input type="text" id="xtRowSearch" placeholder="Search rows (all columns)..." aria-label="Search rows">' +
            '<button id="xtClearFiltersBtn" type="button">Clear search &amp; filters</button>' +
            '<label><input type="checkbox" id="xtHideEmpty"> Hide empty columns</label>' +
            '<input type="text" id="xtColSearch" placeholder="Find column..." aria-label="Find column">' +
            "</div>" +
            '<div class="xt-wrap"><table id="xtTable"><thead></thead><tbody></tbody></table></div>' +
            '<div class="xt-more" id="xtMore" style="display:none">' +
            '<button id="xtMoreBtn" type="button">Show more rows</button>' +
            '<span id="xtShown"></span></div>' +
            "</details>";

        (document.querySelector("main") || document.body).appendChild(panel);

        $("xtFile").addEventListener("change", function (event) {
            var file = event.target.files && event.target.files[0];
            if (file) loadFile(file);
        });

        $("xtInput").addEventListener("input", function () {
            state.fileText = "";
        });

        $("xtConvertBtn").addEventListener("click", convert);
        $("xtExportBtn").addEventListener("click", exportExcel);

        $("xtClearBtn").addEventListener("click", function () {
            state.data = null;
            state.views = [];
            state.tab = 0;
            state.fileText = "";
            $("xtInput").value = "";
            $("xtInput").placeholder = "Paste your XML here (any structure)...";
            $("xtFile").value = "";
            $("xtRowSearch").value = "";
            $("xtColSearch").value = "";
            setStatus("Cleared.");
            renderTabs();
            renderTable();
        });

        $("xtRowSearch").addEventListener("input", function () {
            state.shown = PAGE_SIZE;
            renderBody();
        });

        $("xtColSearch").addEventListener("input", renderTable);

        $("xtHideEmpty").addEventListener("change", function () {
            state.shown = PAGE_SIZE;
            renderTable();
        });

        $("xtClearFiltersBtn").addEventListener("click", function () {
            var view = currentView();
            if (view) view.filters = {};
            $("xtRowSearch").value = "";
            $("xtColSearch").value = "";
            state.shown = PAGE_SIZE;
            renderTable();
        });

        $("xtMoreBtn").addEventListener("click", function () {
            state.shown += PAGE_SIZE;
            renderBody();
        });
    }

    init();
})();
