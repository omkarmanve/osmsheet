/*
 * Logic Validation panel.
 * Alag file hai: script.js / validation.js me koi change nahi.
 *
 * 1. Mapping grid (Validate with Mapping) me paste karo:
 *      A = Element code | B = Valid values | C = Employee logic | D = Dependent logic
 * 2. Yahan XML paste karo, "Logic Check" dabao.
 * 3. Grid ki VISIBLE rows (filter ke baad) check hoti hain. Har element ka logic
 *    XML par chalta hai aur Excel cell se compare hota hai:
 *      - EE rows  -> Employee logic (XML ke employees se)
 *      - DEPENDENT rows -> Dependent logic (XML ke dependents se)
 *    XML me dependents na ho (ya mapping me Dependent logic na ho) to dependent
 *    rows skip hoti hain. Kuch bhi hard-coded nahi: sab mapping ke logic se.
 * Result: cells green / red / yellow + neeche issues ki table (filter + search).
 */
(function () {
    "use strict";

    var PAGE_SIZE = 300;
    var COLUMNS = ["Level", "Record", "Row", "Cell", "Element", "Message", "Found", "Expected"];
    var SELECT_COLUMNS = { Level: true, Record: true, Element: true };

    var CSS = [
        ".logic-panel{background:#fff;border:1px solid var(--excel-border);border-radius:5px;padding:12px 16px;margin-bottom:16px}",
        ".logic-panel summary{cursor:pointer;font-weight:600}",
        "#logicXmlInput{width:100%;height:150px;margin-top:10px;padding:10px;resize:vertical;border:1px solid #c9ceca;border-radius:3px;font-family:Consolas,monospace;line-height:1.4}",
        ".logic-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}",
        ".logic-controls select,.logic-controls input[type=text]{min-height:30px;border:1px solid #c9ceca;border-radius:3px;padding:4px 6px;background:#fff}",
        ".logic-controls input#lgSearch{width:300px;max-width:100%}",
        ".logic-hint{color:var(--muted)}",
        "#logicStatus{color:var(--muted);overflow-wrap:anywhere}",
        "#logicStatus.logic-bad{color:#b42318}",
        "#logicStatus.logic-good{color:#217346}",
        ".lg-wrap{max-height:420px;overflow:auto;border:1px solid var(--excel-border);margin-top:8px;background:#fff}",
        "#lgTable{border-collapse:separate;border-spacing:0;font-size:13px}",
        "#lgTable th,#lgTable td{padding:4px 8px;border-right:1px solid var(--excel-border);border-bottom:1px solid var(--excel-border);text-align:left;vertical-align:top;background:#fff}",
        "#lgTable td.lg-msg{min-width:380px;max-width:620px;white-space:normal;overflow-wrap:anywhere}",
        "#lgTable td.lg-short{white-space:nowrap}",
        "#lgTable thead tr.lg-head th{position:sticky;top:0;z-index:3;box-sizing:border-box;height:27px;line-height:17px;background:var(--excel-header);font-weight:600}",
        "#lgTable thead tr.lg-filter th{position:sticky;top:27px;z-index:3;box-sizing:border-box;height:30px;padding:3px;background:#f8faf8}",
        "#lgTable .lg-filter-ctl{display:block;width:100%;min-width:70px;box-sizing:border-box;padding:3px 4px;border:1px solid #b7beb7;border-radius:3px;background:#fff;color:#202124;font-size:11px}",
        "#lgTable tr.lg-err td{background:#fdecea}",
        "#lgTable tr.lg-warn td{background:#fff7e0}",
        "#lgTable tr.lg-info td{background:#eef3fb}",
        "#lgTable tr.lg-click{cursor:pointer}",
        ".lg-more{display:flex;align-items:center;gap:10px;margin-top:8px;color:var(--muted)}",
        "#resultTable td.logic-pass{background:#e2f0d9 !important}",
        "#resultTable td.logic-fail{background:#f8d7da !important}",
        "#resultTable td.logic-warn{background:#fff3cd !important}"
    ].join("\n");

    var state = { rows: [], filters: {}, shown: PAGE_SIZE };

    function $(id) { return document.getElementById(id); }

    function colLetter(n) {
        var s = "";
        n = n + 1;
        while (n > 0) {
            var m = (n - 1) % 26;
            s = String.fromCharCode(65 + m) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function bodyRows() {
        return Array.prototype.slice.call(
            document.querySelectorAll("#resultTable tbody tr")
        );
    }

    function dataCells(tr) {
        return Array.prototype.slice
            .call(tr.querySelectorAll("td"))
            .filter(function (td) { return !td.classList.contains("row-number"); });
    }

    // EE / DEPENDENT row ka type (validation.js ke rowType jaisa: kisi bhi column me)
    function recordType(tr) {
        var cells = dataCells(tr);
        for (var i = 0; i < cells.length; i++) {
            var text = cells[i].textContent.trim().toUpperCase();
            if (text === "DEPENDENT RECORD") return "DEP";
            if (text === "EE RECORD") return "EE";
        }
        return "OTHER";
    }

    // "Validate with Mapping" ka "Rows:" dropdown (default: EE RECORD only) dependent
    // rows ko chhupa deta hai. Logic Check us dropdown ko ignore karta hai, taaki
    // EE aur DEPENDENT dono rows check hon. (Agar koi column filter ho to wo maana jata hai.)
    function columnFilterOk(index) {
        var fn = window.ediColumnFilterMatchesRow;
        return typeof fn !== "function" || fn(index);
    }

    function isVisible(tr) {
        if (tr.hidden) return false;
        var style = window.getComputedStyle(tr);
        return style.display !== "none" && style.visibility !== "hidden";
    }

    function clearColors() {
        document
            .querySelectorAll("#resultTable td.logic-pass, #resultTable td.logic-fail, #resultTable td.logic-warn")
            .forEach(function (td) {
                td.classList.remove("logic-pass", "logic-fail", "logic-warn");
                if (td.dataset.logicTitle) {
                    td.removeAttribute("title");
                    delete td.dataset.logicTitle;
                }
            });
    }

    function getCell(rowIndex, cellIndex) {
        if (rowIndex < 0) return null;
        var tr = bodyRows()[rowIndex];
        return tr ? (dataCells(tr)[cellIndex] || null) : null;
    }

    // ------------------------------------------------------------
    // Mapping grid (validation.js ka grid) se padhna
    // ------------------------------------------------------------
    function mappingColumnCount() {
        var head = $("mapHeadRow");
        return head ? Math.max(0, head.children.length - 1) : 0;
    }

    var LOGIC_SELECTS = [
        { id: "logicEmpColSelect", fallback: 2 },   // C = Employee logic
        { id: "logicDepColSelect", fallback: 3 }    // D = Dependent logic
    ];

    function refreshLogicColumns() {
        var count = mappingColumnCount();

        LOGIC_SELECTS.forEach(function (cfg) {
            var select = $(cfg.id);
            var previous = select.value;

            select.innerHTML = "";

            var none = document.createElement("option");
            none.value = "-1";
            none.textContent = "(none)";
            select.appendChild(none);

            for (var c = 0; c < count; c++) {
                var option = document.createElement("option");
                option.value = String(c);
                option.textContent = colLetter(c);
                select.appendChild(option);
            }

            if (!select.dataset.user) {
                select.value = count > cfg.fallback ? String(cfg.fallback) : "-1";
            } else if (previous && Number(previous) < count) {
                select.value = previous;
            } else {
                select.value = "-1";
            }
        });
    }

    function readMapping() {
        var body = $("mapBody");
        if (!body) return [];

        var elementCol = $("elementColSelect") ? Number($("elementColSelect").value) : 0;
        var valueCol = $("valueColSelect") ? Number($("valueColSelect").value) : 1;
        var empCol = Number($("logicEmpColSelect").value);
        var depCol = Number($("logicDepColSelect").value);
        var rows = [];

        body.querySelectorAll("tr").forEach(function (tr, index) {
            var inputs = tr.querySelectorAll("input");
            var element = inputs[elementCol] ? inputs[elementCol].value.trim() : "";
            if (!element) return;

            rows.push({
                line: index + 1,
                element: element,
                value: inputs[valueCol] ? inputs[valueCol].value : "",
                logic: empCol >= 0 && inputs[empCol] ? inputs[empCol].value : "",
                dep_logic: depCol >= 0 && inputs[depCol] ? inputs[depCol].value : ""
            });
        });

        return rows;
    }

    // ------------------------------------------------------------
    // Issues table (filter + search)
    // ------------------------------------------------------------
    function toTableRows(issues) {
        return issues.map(function (it) {
            var hasCell = it.row_index >= 0;
            return {
                issue: it,
                cells: [
                    it.level,
                    it.record || "",
                    hasCell ? String(it.row_index + 1) : "-",
                    hasCell ? colLetter(it.cell_index) + (it.row_index + 1) : "-",
                    it.element || "",
                    it.message || "",
                    it.found || "",
                    it.expected || ""
                ]
            };
        });
    }

    function distinct(col) {
        var seen = {};
        state.rows.forEach(function (row) { seen[row.cells[col]] = true; });
        return Object.keys(seen).sort();
    }

    function renderHeader() {
        var thead = $("lgTable").tHead;
        thead.innerHTML = "";

        var head = document.createElement("tr");
        head.className = "lg-head";
        var filter = document.createElement("tr");
        filter.className = "lg-filter";

        COLUMNS.forEach(function (name, col) {
            var th = document.createElement("th");
            th.textContent = name;
            head.appendChild(th);

            var fh = document.createElement("th");
            var control;

            if (SELECT_COLUMNS[name]) {
                control = document.createElement("select");
                var all = document.createElement("option");
                all.value = "";
                all.textContent = "All";
                control.appendChild(all);
                distinct(col).forEach(function (value) {
                    var option = document.createElement("option");
                    option.value = value;
                    option.textContent = value === "" ? "(none)" : value;
                    control.appendChild(option);
                });
                control.value = state.filters[col] || "";
                control.addEventListener("change", onChange);
            } else {
                control = document.createElement("input");
                control.type = "text";
                control.placeholder = "Filter";
                control.value = state.filters[col] || "";
                control.addEventListener("input", onChange);
            }

            control.className = "lg-filter-ctl";
            control.setAttribute("aria-label", "Filter " + name);

            function onChange() {
                state.filters[col] = control.value;
                state.shown = PAGE_SIZE;
                renderBody();
            }

            fh.appendChild(control);
            filter.appendChild(fh);
        });

        thead.appendChild(head);
        thead.appendChild(filter);
    }

    function matching() {
        var search = $("lgSearch").value.trim().toLowerCase();
        var active = [];

        Object.keys(state.filters).forEach(function (key) {
            if (state.filters[key]) {
                var col = Number(key);
                active.push({
                    col: col,
                    value: state.filters[key].toLowerCase(),
                    exact: !!SELECT_COLUMNS[COLUMNS[col]]
                });
            }
        });

        return state.rows.filter(function (row) {
            if (search && row.cells.join("\u0001").toLowerCase().indexOf(search) === -1) {
                return false;
            }
            return active.every(function (f) {
                var cell = row.cells[f.col].toLowerCase();
                return f.exact ? cell === f.value : cell.indexOf(f.value) !== -1;
            });
        });
    }

    function renderBody() {
        var tbody = $("lgTable").tBodies[0];
        tbody.innerHTML = "";

        var rows = matching();
        var limit = Math.min(state.shown, rows.length);
        var frag = document.createDocumentFragment();

        for (var i = 0; i < limit; i++) {
            var row = rows[i];
            var tr = document.createElement("tr");
            var clickable = row.issue.row_index >= 0;

            tr.className = (row.issue.level === "error" ? "lg-err" :
                            row.issue.level === "warning" ? "lg-warn" : "lg-info") +
                (clickable ? " lg-click" : "");

            row.cells.forEach(function (value, col) {
                var td = document.createElement("td");
                td.textContent = value;
                td.className = COLUMNS[col] === "Message" ? "lg-msg" : "lg-short";
                tr.appendChild(td);
            });

            if (clickable) {
                tr.title = "Click to jump to the cell";
                (function (issue) {
                    tr.addEventListener("click", function () {
                        var target = getCell(issue.row_index, issue.cell_index);
                        if (target) {
                            target.scrollIntoView({ block: "center", inline: "center" });
                            target.click();
                        }
                    });
                })(row.issue);
            }

            frag.appendChild(tr);
        }
        tbody.appendChild(frag);

        $("lgShown").textContent = state.rows.length
            ? "Showing " + limit + " of " + rows.length + " matching (" + state.rows.length + " total)"
            : "";
        $("lgMore").style.display = state.rows.length ? "flex" : "none";
        $("lgMoreBtn").style.display = limit < rows.length ? "" : "none";
    }

    function renderIssues(issues) {
        state.rows = toTableRows(issues);
        state.filters = {};
        state.shown = PAGE_SIZE;
        $("lgSearch").value = "";
        renderHeader();
        renderBody();
    }

    // ------------------------------------------------------------
    // Init
    // ------------------------------------------------------------
    function init() {
        if ($("logicPanel")) return;

        var style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        var panel = document.createElement("section");
        panel.className = "logic-panel";
        panel.id = "logicPanel";
        panel.innerHTML =
            "<details open>" +
            "<summary>Logic Validation (XML)</summary>" +
            '<div class="logic-controls">' +
            '<label for="logicEmpColSelect">Employee logic column:</label>' +
            '<select id="logicEmpColSelect"></select>' +
            '<label for="logicDepColSelect">Dependent logic column:</label>' +
            '<select id="logicDepColSelect"></select>' +
            "</div>" +
            '<div class="logic-controls"><span class="logic-hint">Paste the mapping in &quot;Validate with Mapping&quot;: ' +
            "A = Element code, B = Valid values, C = Employee logic, D = Dependent logic. " +
            "Employee-only XML checks only EE rows; if the XML also has dependents, DEPENDENT rows are checked with the Dependent logic.</span>" +
            "</div>" +
            '<div class="logic-controls">' +
            '<button id="logicImportBtn" type="button">Import XML file</button>' +
            '<input type="file" id="logicXmlFile" accept=".xml,.txt,text/xml" hidden>' +
            '<span class="logic-hint">or paste the XML below</span>' +
            "</div>" +
            '<textarea id="logicXmlInput" spellcheck="false" ' +
            'placeholder="Paste your XML here (<Employee> blocks)..."></textarea>' +
            '<div class="logic-controls">' +
            '<button id="logicCheckBtn" type="button" class="primary-btn">Logic Check</button>' +
            '<button id="logicClearBtn" type="button">Clear Logic Result</button>' +
            '<span id="logicStatus">Process the EDI data, apply a filter, paste the XML, then click Logic Check.</span>' +
            "</div>" +
            '<div class="logic-controls">' +
            '<input type="text" id="lgSearch" placeholder="Search results (all columns)..." aria-label="Search results">' +
            '<button id="lgClearFilters" type="button">Clear search &amp; filters</button>' +
            "</div>" +
            '<div class="lg-wrap"><table id="lgTable"><thead></thead><tbody></tbody></table></div>' +
            '<div class="lg-more" id="lgMore" style="display:none">' +
            '<button id="lgMoreBtn" type="button">Show more</button><span id="lgShown"></span></div>' +
            "</details>";

        var sheet = document.querySelector(".spreadsheet-panel");
        if (sheet && sheet.parentNode) {
            sheet.parentNode.insertBefore(panel, sheet);
        } else {
            (document.querySelector("main") || document.body).appendChild(panel);
        }

        refreshLogicColumns();
        renderHeader();

        LOGIC_SELECTS.forEach(function (cfg) {
            var select = $(cfg.id);
            select.addEventListener("mousedown", refreshLogicColumns);
            select.addEventListener("focus", refreshLogicColumns);
            select.addEventListener("change", function () { select.dataset.user = "1"; });
        });

        function setStatus(text, cls) {
            $("logicStatus").textContent = text;
            $("logicStatus").className = cls || "";
        }

        function loadXmlFile(file) {
            if (!file) return;

            if (!window.OSMImport) {
                setStatus("File import is not available (import.js not loaded). Paste the XML instead.", "logic-bad");
                return;
            }

            window.OSMImport.readTextFile(file, function (error, text) {
                if (error) {
                    setStatus("Could not read " + file.name + ": " + error.message, "logic-bad");
                    return;
                }
                $("logicXmlInput").value = text;
                setStatus("Imported " + file.name + " (" + Math.max(1, Math.round(file.size / 1024)) +
                    " KB). Click Logic Check.");
            });
        }

        $("logicImportBtn").addEventListener("click", function () { $("logicXmlFile").click(); });
        $("logicXmlFile").addEventListener("change", function (event) {
            loadXmlFile(event.target.files && event.target.files[0]);
            event.target.value = "";
        });
        $("logicXmlInput").addEventListener("dragover", function (event) { event.preventDefault(); });
        $("logicXmlInput").addEventListener("drop", function (event) {
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) {
                event.preventDefault();
                loadXmlFile(file);
            }
        });

        $("logicClearBtn").addEventListener("click", function () {
            clearColors();
            renderIssues([]);
            setStatus("Logic result cleared.");
        });

        $("lgSearch").addEventListener("input", function () {
            state.shown = PAGE_SIZE;
            renderBody();
        });

        $("lgClearFilters").addEventListener("click", function () {
            state.filters = {};
            $("lgSearch").value = "";
            state.shown = PAGE_SIZE;
            renderHeader();
            renderBody();
        });

        $("lgMoreBtn").addEventListener("click", function () {
            state.shown += PAGE_SIZE;
            renderBody();
        });

        $("logicCheckBtn").addEventListener("click", async function () {
            var xml = $("logicXmlInput").value;

            if (!xml.trim()) {
                setStatus("Paste the XML first.", "logic-bad");
                return;
            }

            var rows = [];
            var sent = { EE: 0, DEP: 0 };

            function pushRow(tr, index) {
                rows.push({
                    row_index: index,
                    cells: dataCells(tr).map(function (td) { return td.textContent.trim(); })
                });
            }

            bodyRows().forEach(function (tr, index) {
                var type = recordType(tr);
                if (type === "OTHER" || !columnFilterOk(index)) return;
                pushRow(tr, index);
                sent[type]++;
            });

            if (!rows.length) {
                // Grid me EE/DEPENDENT RECORD label nahi mile: visible rows bhejo (purana tareeka)
                bodyRows().forEach(function (tr, index) {
                    if (isVisible(tr)) pushRow(tr, index);
                });
            }

            if (!rows.length) {
                setStatus("No rows found in the grid. Process the EDI data first.", "logic-bad");
                return;
            }

            refreshLogicColumns();
            var mapping = readMapping();
            var hasLogic = mapping.some(function (m) {
                return m.logic.trim() !== "" || m.dep_logic.trim() !== "";
            });

            if (!hasLogic) {
                setStatus("No logic found. Paste the mapping (Element | Valid values | Employee logic | Dependent logic) " +
                    "in \"Validate with Mapping\" and select the logic column(s) above.", "logic-bad");
                return;
            }

            var url = "/api/logic-run";
            var payload = { xml: xml, rows: rows, mapping: mapping };

            clearColors();
            renderIssues([]);
            setStatus("Checking " + rows.length + " row(s) (" + sent.EE + " EE, " + sent.DEP +
                " dependent) against the mapping logic...");

            var data;
            try {
                var response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                data = await response.json();

                if (!response.ok) {
                    var detail = data && data.detail;
                    if (typeof detail !== "string") detail = JSON.stringify(detail);
                    setStatus("Error: " + detail, "logic-bad");
                    return;
                }
            } catch (err) {
                setStatus("Could not connect to the server: " + err.message, "logic-bad");
                return;
            }

            (data.validated_cells || []).forEach(function (item) {
                var td = getCell(item.row_index, item.cell_index);
                if (!td) return;
                td.classList.add(
                    item.status === "pass" ? "logic-pass" :
                    item.status === "warn" ? "logic-warn" : "logic-fail"
                );
            });

            (data.issues || []).forEach(function (issue) {
                var td = getCell(issue.row_index, issue.cell_index);
                if (td) {
                    var old = td.dataset.logicTitle ? td.title + "\n" : "";
                    td.title = old + issue.message;
                    td.dataset.logicTitle = "1";
                }
            });

            renderIssues(data.issues || []);

            var s = data.summary || {};
            var text = "Rows checked: " + s.rows_checked +
                " (employee " + s.employee_rows + ", dependent " + s.dependent_rows + ")" +
                " | Elements checked: " + s.elements_checked +
                " | Passed: " + s.passed +
                " | Errors: " + s.errors + " | Warnings: " + s.warnings +
                " | Skipped rows: " + s.skipped +
                " | XML: " + s.users_in_xml + " employee(s), " + s.dependents_in_xml + " dependent(s)" +
                " | Sent from grid: " + sent.EE + " EE, " + sent.DEP + " dependent row(s)" +
                " | Rules: " + s.rules +
                (s.rules_not_understood ? " (" + s.rules_not_understood + " not understood)" : "");

            setStatus(text, s.errors ? "logic-bad" : "logic-good");
        });
    }

    init();
})();
