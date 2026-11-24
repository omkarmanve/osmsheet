"use strict";

/*
 * Validation UI
 * Required globals from script.js:
 * currentColumns, currentRows, tableBody, selectCell
 */
(function () {
    const MIN_COLS = 2;   // grid kam se kam 2 columns; paste par apne aap badhta hai
    let mapCols = MIN_COLS;
    const INITIAL_ROWS = 45;

    // ---------- Styles ----------
    const style = document.createElement("style");

    style.textContent = `
        .validation-box {
            background: #fff;
            border: 1px solid var(--excel-border);
            border-radius: 5px;
            padding: 16px;
            margin-bottom: 16px;
        }

        .validation-box h2 {
            margin: 0 0 4px;
            font-size: 15px;
        }

        .val-hint {
            color: var(--muted);
            margin: 0 0 10px;
        }

        .val-controls {
            display: flex;
            gap: 10px;
            align-items: center;
            flex-wrap: wrap;
            margin-top: 10px;
        }

        .map-wrap {
            height: 230px;
            overflow: auto;
            border: 1px solid var(--excel-border);
            background: #fff;
        }

        #mapTable {
            border-collapse: separate;
            border-spacing: 0;
            table-layout: fixed;
            width: max-content;
            font-family: Calibri, "Segoe UI", Arial, sans-serif;
            font-size: 13px;
        }

        #mapTable th,
        #mapTable td {
            border-right: 1px solid var(--excel-border);
            border-bottom: 1px solid var(--excel-border);
            padding: 0;
            height: 25px;
            background: #fff;
        }

        #mapTable thead th {
            position: sticky;
            top: 0;
            z-index: 3;
            background: var(--excel-header);
            text-align: center;
            font-weight: 600;
            color: #333;
            border-bottom: 1px solid #b7beb7;
            user-select: none;
        }

        #mapTable .map-rownum {
            position: sticky;
            left: 0;
            z-index: 2;
            width: 44px;
            min-width: 44px;
            background: var(--excel-header);
            color: #555;
            text-align: center;
            font-weight: 400;
        }

        #mapTable thead .map-rownum {
            z-index: 4;
        }

        #mapTable th.map-colA,
        #mapTable td.map-colA {
            width: 150px;
            min-width: 150px;
        }

        #mapTable th.map-colB,
        #mapTable td.map-colB {
            width: 420px;
            min-width: 420px;
        }

        #mapTable th.map-colX,
        #mapTable td.map-colX {
            width: 220px;
            min-width: 220px;
        }

        #mapTable thead th select {
            font: inherit;
        }

        #mapTable input {
            width: 100%;
            height: 24px;
            border: none;
            padding: 0 7px;
            background: transparent;
            font: inherit;
            color: inherit;
            outline: none;
        }

        #mapTable input:focus {
            outline: 2px solid var(--excel-green);
            outline-offset: -2px;
            background: #fff;
        }

        #resultTable td.val-ok {
            background: #e2f0d9 !important;
        }

        #resultTable td.val-error {
            background: #f8d7da !important;
        }

        #resultTable td.val-warn {
            background: #fff3cd !important;
        }

        .issues-wrap {
            margin-top: 12px;
            max-height: 300px;
            overflow: auto;
            border: 1px solid var(--excel-border);
        }

        #issuesTable {
            border-collapse: separate;
            border-spacing: 0;
            width: max-content;
            min-width: 100%;
            font-family: Calibri, "Segoe UI", Arial, sans-serif;
            font-size: 13px;
        }

        #issuesTable th,
        #issuesTable td {
            padding: 4px 8px;
            text-align: left;
            white-space: nowrap;
            border-right: 1px solid var(--excel-border);
            border-bottom: 1px solid var(--excel-border);
            background: #fff;
        }

        #issuesTable thead th {
            position: sticky;
            top: 0;
            z-index: 2;
            background: var(--excel-header);
            font-weight: 600;
            border-bottom: 1px solid #b7beb7;
        }

        #issuesTable tbody tr {
            cursor: pointer;
        }

        #issuesTable tbody tr:hover td {
            background: #f2f4f2;
        }

        #issuesTable td.iss-msg {
            white-space: normal;
            min-width: 320px;
            max-width: 520px;
        }

        #issuesTable td.iss-level {
            font-weight: 600;
        }

        #issuesTable tr.iss-error td.iss-level {
            color: #b42318;
        }

        #issuesTable tr.iss-warn td.iss-level {
            color: #b54708;
        }

        #issuesTable thead tr.issue-filter-row th {
            position: sticky;
            top: 27px;
            z-index: 3;
            background: #f8faf8;
            padding: 4px;
        }

        #issuesTable .issue-column-filter {
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            width: 100%;
            min-width: 65px;
            max-width: 220px;
            box-sizing: border-box;
            padding: 4px;
            border: 1px solid #888;
            border-radius: 3px;
            background: #fff;
            color: #202124;
            font-size: 11px;
        }

        #issuesTable .issue-column-filter:focus {
            outline: 2px solid var(--excel-green);
            outline-offset: -1px;
        }

        #valMapWarnings {
            margin: 8px 0 0;
            padding-left: 18px;
            color: #b54708;
        }
    `;

    document.head.appendChild(style);

    // ---------- UI ----------
    const box = document.createElement("section");
    box.className = "validation-box";

    box.innerHTML = `
        <h2>Validate with Mapping</h2>

        <p class="val-hint">
            Excel se jitne bhi columns/rows chahiye select karke copy karo,
            phir grid ke A1 cell me click karke Ctrl+V dabao. Columns apne
            aap ban jayenge aur data usi column me aayega jis me Excel me tha.
            Validation ke liye neeche Element aur Value column chuno
            (default A aur B).
        </p>

        <div class="map-wrap">
            <table id="mapTable">
                <thead>
                    <tr id="mapHeadRow">
                        <th class="map-rownum"></th>
                    </tr>
                </thead>
                <tbody id="mapBody"></tbody>
            </table>
        </div>

        <div class="val-controls">
            <button id="importMapBtn" type="button">Import Excel file</button>

            <input id="importMapFile" type="file"
                   accept=".xlsx,.xls,.csv" hidden>

            <button id="clearMapBtn" type="button">Clear mapping</button>

            <label for="elementColSelect">Element column:</label>
            <select id="elementColSelect"></select>

            <label for="valueColSelect">Value column:</label>
            <select id="valueColSelect"></select>

            <span id="mapCount">0 mapping rows</span>
        </div>

        <div class="val-controls">
            <label for="rowFilter">Rows:</label>

            <select id="rowFilter">
                <option value="ALL">All records</option>
                <option value="EE" selected>EE RECORD only</option>
                <option value="DEP">DEPENDENT RECORD only</option>
            </select>

            <button id="validateBtn" class="primary-btn" type="button">
                Validate Column B (INS)
            </button>

            <span id="valStatus"></span>
        </div>

        <div id="issuesWrap" class="issues-wrap" hidden>
            <table id="issuesTable">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Row</th>
                        <th>Column</th>
                        <th>Cell</th>
                        <th>Segment</th>
                        <th>Element</th>
                        <th>Level</th>
                        <th>Message</th>
                        <th>Found</th>
                        <th>Expected</th>
                    </tr>
                </thead>
                <tbody id="issuesBody"></tbody>
            </table>
        </div>

        <ul id="valMapWarnings"></ul>
    `;

    const sheetPanel = document.querySelector(".spreadsheet-panel");

    if (!sheetPanel || !sheetPanel.parentNode) {
        console.error("Validator: .spreadsheet-panel element not found.");
        return;
    }

    sheetPanel.parentNode.insertBefore(box, sheetPanel);

    const mapBody = document.getElementById("mapBody");
    const mapCount = document.getElementById("mapCount");
    const importMapBtn = document.getElementById("importMapBtn");
    const importMapFile = document.getElementById("importMapFile");
    const clearMapBtn = document.getElementById("clearMapBtn");
    const rowFilter = document.getElementById("rowFilter");
    const validateBtn = document.getElementById("validateBtn");
    const valStatus = document.getElementById("valStatus");
    const issuesWrap = document.getElementById("issuesWrap");
    const issuesBody = document.getElementById("issuesBody");
    const mapWarnings = document.getElementById("valMapWarnings");

    // ---------- Mapping grid ----------
    const mapInputs = [];
    const mapRows = [];
    const mapHeadRow = document.getElementById("mapHeadRow");
    const elementColSelect = document.getElementById("elementColSelect");
    const valueColSelect = document.getElementById("valueColSelect");

    function mapColName(index) {
        let name = "";
        let n = index + 1;

        while (n > 0) {
            const r = (n - 1) % 26;
            name = String.fromCharCode(65 + r) + name;
            n = Math.floor((n - 1) / 26);
        }

        return name;
    }

    function mapColClass(col) {
        if (col === 0) return "map-colA";
        if (col === 1) return "map-colB";
        return "map-colX";
    }

    function refreshColSelects() {
        [
            [elementColSelect, 0],
            [valueColSelect, 1]
        ].forEach(([select, fallback]) => {
            const keep = select.value === ""
                ? fallback
                : Number(select.value);

            select.replaceChildren();

            for (let c = 0; c < mapCols; c++) {
                const option = document.createElement("option");
                option.value = String(c);
                option.textContent = mapColName(c);
                select.appendChild(option);
            }

            select.value = String(Math.min(keep, mapCols - 1));
        });
    }

    function addMapHeader(col) {
        const th = document.createElement("th");
        th.className = mapColClass(col);
        th.textContent = mapColName(col);
        mapHeadRow.appendChild(th);
    }

    function makeMapCell(rowIndex, col) {
        const td = document.createElement("td");
        td.className = mapColClass(col);

        const input = document.createElement("input");
        input.type = "text";
        input.spellcheck = false;
        input.dataset.row = rowIndex;
        input.dataset.col = col;

        input.addEventListener("input", updateMapCount);
        input.addEventListener("paste", onMapPaste);
        input.addEventListener("keydown", onMapKeyDown);

        td.appendChild(input);

        return { td, input };
    }

    function ensureCols(count) {
        while (mapCols < count) {
            const col = mapCols;

            mapCols++;
            addMapHeader(col);

            mapRows.forEach((tr, rowIndex) => {
                const { td, input } = makeMapCell(rowIndex, col);
                tr.appendChild(td);
                mapInputs[rowIndex].push(input);
            });
        }

        refreshColSelects();
    }

    function resetCols() {
        while (mapCols > MIN_COLS) {
            mapCols--;

            mapHeadRow.lastElementChild.remove();

            mapRows.forEach((tr, rowIndex) => {
                tr.lastElementChild.remove();
                mapInputs[rowIndex].pop();
            });
        }

        refreshColSelects();
    }

    for (let c = 0; c < mapCols; c++) {
        addMapHeader(c);
    }

    refreshColSelects();

    function focusCell(row, col) {
        ensureRows(row + 1);

        const input = mapInputs[row] && mapInputs[row][col];

        if (input) {
            input.focus();
            input.select();
        }
    }

    function addMapRow() {
        const rowIndex = mapInputs.length;
        const tr = document.createElement("tr");

        const num = document.createElement("th");
        num.className = "map-rownum";
        num.textContent = rowIndex + 1;

        tr.appendChild(num);

        const inputs = [];

        for (let col = 0; col < mapCols; col++) {
            const { td, input } = makeMapCell(rowIndex, col);
            tr.appendChild(td);
            inputs.push(input);
        }

        mapInputs.push(inputs);
        mapRows.push(tr);
        mapBody.appendChild(tr);
    }

    function ensureRows(count) {
        while (mapInputs.length < count) {
            addMapRow();
        }
    }

    function parseClipboard(text) {
        const src = text.replace(/\r\n?/g, "\n");
        const rows = [];
        let row = [];
        let cell = "";
        let inQuotes = false;

        for (let i = 0; i < src.length; i++) {
            const ch = src[i];

            if (inQuotes) {
                if (ch === '"') {
                    if (src[i + 1] === '"') {
                        cell += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    // input box single-line hai, isliye newline -> space
                    cell += ch === "\n" ? " " : ch;
                }
            } else if (ch === '"' && cell === "") {
                inQuotes = true;
            } else if (ch === "\t") {
                row.push(cell.trim());
                cell = "";
            } else if (ch === "\n") {
                row.push(cell.trim());
                rows.push(row);
                row = [];
                cell = "";
            } else {
                cell += ch;
            }
        }

        if (cell !== "" || row.length) {
            row.push(cell.trim());
            rows.push(row);
        }

        while (
            rows.length > 1 &&
            rows[rows.length - 1].every(value => value === "")
        ) {
            rows.pop();
        }

        return rows.length ? rows : [[""]];
    }

    function fillGrid(table, startRow, startCol) {
        const width = Math.max(1, ...table.map(cells => cells.length));

        ensureCols(startCol + width);
        ensureRows(startRow + table.length + 1);

        table.forEach((cells, i) => {
            cells.forEach((value, j) => {
                mapInputs[startRow + i][startCol + j].value = value;
            });
        });

        updateMapCount();

        return width;
    }

    function onMapPaste(event) {
        const text = (
            event.clipboardData || window.clipboardData
        ).getData("text");

        const table = parseClipboard(text);

        if (table.length === 1 && table[0].length === 1) {
            return;
        }

        event.preventDefault();

        const row = Number(event.target.dataset.row);
        const col = Number(event.target.dataset.col);

        const width = fillGrid(table, row, col);

        valStatus.textContent =
            `${table.length} rows x ${width} columns paste hui.`;
    }

    function onMapKeyDown(event) {
        const row = Number(event.target.dataset.row);
        const col = Number(event.target.dataset.col);

        if (event.key === "Enter" || event.key === "ArrowDown") {
            event.preventDefault();
            focusCell(row + 1, col);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();

            if (row > 0) {
                focusCell(row - 1, col);
            }
        }
    }

    function getMappingText() {
        const elementCol = Number(elementColSelect.value);
        const valueCol = Number(valueColSelect.value);
        const lines = [];

        mapInputs.forEach(inputs => {
            const element = (inputs[elementCol]?.value || "").trim();
            const value = (inputs[valueCol]?.value || "").trim();

            if (element) {
                lines.push(`${element}\t${value}`);
            }
        });

        return lines.join("\n");
    }

    function updateMapCount() {
        const elementCol = Number(elementColSelect.value);

        const filled = mapInputs.filter(inputs =>
            (inputs[elementCol]?.value || "").trim()
        ).length;

        mapCount.textContent = `${filled} mapping rows`;
    }

    elementColSelect.addEventListener("change", updateMapCount);

    ensureRows(INITIAL_ROWS);

    clearMapBtn.addEventListener("click", () => {
        mapInputs.forEach(inputs => {
            inputs.forEach(input => {
                input.value = "";
            });
        });

        updateMapCount();
        resetCols();
        valStatus.textContent = "Mapping clear ho gayi.";
    });

    // ---------- Import Excel / CSV ----------
    importMapBtn.addEventListener("click", () => {
        importMapFile.click();
    });

    importMapFile.addEventListener("change", async () => {
        const file = importMapFile.files[0];

        importMapFile.value = "";

        if (!file) return;

        if (typeof XLSX === "undefined") {
            valStatus.textContent =
                "Excel library load nahi hui. Internet check karo, ya mapping seedha paste karo.";
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];

            const table = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                raw: false,
                defval: ""
            }).map(row =>
                row.map(value => String(value).trim())
            );

            if (!table.length) {
                valStatus.textContent = "File khali hai.";
                return;
            }

            clearMapBtn.click();
            fillGrid(table, 0, 0);

            valStatus.textContent =
                `${table.length} rows import hui (${file.name}).`;
        } catch (error) {
            console.error(error);
            valStatus.textContent = "File padhi nahi ja saki.";
        }
    });

    // ---------- Main table row filters ----------
    function rowType(index) {
        const row = currentRows[index];

        if (!row) return "OTHER";

        const values = currentColumns.map(column =>
            String(row[column] ?? "").trim().toUpperCase()
        );

        if (values.includes("EE RECORD")) return "EE";
        if (values.includes("DEPENDENT RECORD")) return "DEP";

        return "OTHER";
    }

    function isRowSelected(index) {
        const filter = rowFilter.value;

        return filter === "ALL" || rowType(index) === filter;
    }

    function applyFilter() {
        tableBody.querySelectorAll("tr").forEach((tr, index) => {
            const columnFilterMatches =
                typeof window.ediColumnFilterMatchesRow !== "function" ||
                window.ediColumnFilterMatchesRow(index);

            tr.style.display =
                isRowSelected(index) && columnFilterMatches ? "" : "none";
        });
    }

    function clearResults() {
        tableBody
            .querySelectorAll(".val-ok, .val-error, .val-warn")
            .forEach(td => {
                td.classList.remove("val-ok", "val-error", "val-warn");
                td.removeAttribute("title");
            });

        issuesBody.replaceChildren();
        mapWarnings.replaceChildren();
        issuesWrap.hidden = true;

        document.querySelector("#issuesTable thead")
            ?.querySelector(".issue-filter-row")
            ?.remove();

        valStatus.textContent = "";
    }

    function getCell(row, col) {
        return tableBody.querySelector(
            `td[data-row="${row}"][data-column="${col}"]`
        );
    }

    // ---------- Events ----------
    rowFilter.addEventListener("change", () => {
        applyFilter();
        clearResults();
    });

    new MutationObserver(() => {
        applyFilter();
        clearResults();
    }).observe(tableBody, { childList: true });

    document.addEventListener("ediColumnFiltersChanged", applyFilter);

    // ---------- Validate ----------
    validateBtn.addEventListener("click", async () => {
        if (!currentRows.length) {
            valStatus.textContent = "Pehle EDI data process karo.";
            return;
        }

        const mapping = getMappingText();

        if (!mapping.trim()) {
            valStatus.textContent = "Pehle mapping grid me paste karo.";
            return;
        }

        const rows = [];

        currentRows.forEach((row, index) => {
            if (!isRowSelected(index)) return;

            rows.push({
                row_index: index,
                cells: currentColumns.map(column =>
                    String(row[column] ?? "")
                )
            });
        });

        if (!rows.length) {
            valStatus.textContent =
                "Selected filter ke liye koi row nahi.";
            return;
        }

        validateBtn.disabled = true;
        valStatus.textContent = "Validating...";

        try {
            const response = await fetch("/api/validate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ mapping, rows })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    typeof result.detail === "string"
                        ? result.detail
                        : "Validation failed."
                );
            }

            showResult(result);
        } catch (error) {
            console.error(error);
            valStatus.textContent = error.message;
        } finally {
            validateBtn.disabled = false;
        }
    });

    // =====================================================
    // ERROR LIST FILTERS
    // Dropdown options use all spreadsheet rows/columns.
    // =====================================================

    function getExcelColumnLetter(index) {
        let result = "";
        let number = index + 1;

        while (number > 0) {
            const remainder = (number - 1) % 26;

            result =
                String.fromCharCode(65 + remainder) + result;

            number = Math.floor((number - 1) / 26);
        }

        return result;
    }

    function addIssueColumnFilters() {
        const table = document.getElementById("issuesTable");
        if (!table) return;

        const thead = table.querySelector("thead");
        if (!thead) return;

        const headerRow = [...thead.querySelectorAll("tr")]
            .find(row => !row.classList.contains("issue-filter-row"));

        if (!headerRow) return;

        thead.querySelector(".issue-filter-row")?.remove();

        const headers = [...headerRow.querySelectorAll("th")];
        const filterRow = document.createElement("tr");

        filterRow.className = "issue-filter-row";

        headers.forEach((header, index) => {
            const th = document.createElement("th");
            const headerName = header.textContent.trim().toLowerCase();

            if (headerName === "row" || headerName === "column") {
                const select = document.createElement("select");

                select.className = "issue-column-filter";
                select.dataset.column = String(index);
                select.dataset.filterType = headerName;
                select.setAttribute("aria-label", `Filter ${headerName}`);

                const allOption = document.createElement("option");
                allOption.value = "";
                allOption.textContent = "All";
                select.appendChild(allOption);

                let values = [];

                if (headerName === "row") {
                    // All spreadsheet row numbers.
                    values = currentRows.map((_, rowIndex) =>
                        String(rowIndex + 1)
                    );
                } else {
                    // All spreadsheet column letters.
                    values = currentColumns.map((_, columnIndex) =>
                        getExcelColumnLetter(columnIndex)
                    );
                }

                [...new Set(values)].forEach(value => {
                    const option = document.createElement("option");

                    option.value = value;
                    option.textContent = value;

                    select.appendChild(option);
                });

                select.addEventListener(
                    "change",
                    applyIssueColumnFilters
                );

                th.appendChild(select);
            }

            filterRow.appendChild(th);
        });

        headerRow.insertAdjacentElement("afterend", filterRow);
    }

    function applyIssueColumnFilters() {
        const filters = [
            ...document.querySelectorAll(
                "#issuesTable .issue-column-filter"
            )
        ];

        issuesBody.querySelectorAll("tr").forEach(row => {
            const matches = filters.every(select => {
                if (select.value === "") return true;

                const columnIndex = Number(select.dataset.column);
                const filterType = select.dataset.filterType;

                const cellValue =
                    row.cells[columnIndex]?.textContent.trim() || "";

                if (filterType === "row") {
                    return cellValue === select.value;
                }

                if (filterType === "column") {
                    return cellValue.toUpperCase() ===
                        select.value.toUpperCase();
                }

                return true;
            });

            row.style.display = matches ? "" : "none";
        });
    }

    // ---------- Render validator results ----------
    function showResult(result) {
        clearResults();

        (result.validated_cells || []).forEach(item => {
            const td = getCell(item.row, item.col);

            if (td && item.ok) {
                td.classList.add("val-ok");
            }
        });

        const messagesByCell = new Map();

        (result.issues || []).forEach((issue, n) => {
            const td = getCell(issue.row, issue.col);

            if (td) {
                td.classList.remove("val-ok");

                td.classList.add(
                    issue.level === "error"
                        ? "val-error"
                        : "val-warn"
                );
            }

            const key = `${issue.row}:${issue.col}`;
            const list = messagesByCell.get(key) || [];

            list.push(`${issue.element}: ${issue.message}`);
            messagesByCell.set(key, list);

            const tr = document.createElement("tr");

            tr.className =
                issue.level === "error"
                    ? "iss-error"
                    : "iss-warn";

            const columnLetter = String(issue.cell).replace(/\d+/g, "");

            const values = [
                [n + 1, ""],
                [issue.row + 1, ""],
                [columnLetter, ""],
                [issue.cell, ""],
                [issue.segment, ""],
                [issue.element, ""],
                [issue.level, "iss-level"],
                [issue.message, "iss-msg"],
                [issue.found, ""],
                [issue.expected, ""]
            ];

            values.forEach(([value, className]) => {
                const cell = document.createElement("td");

                cell.textContent = String(value ?? "");

                if (className) {
                    cell.className = className;
                }

                tr.appendChild(cell);
            });

            tr.addEventListener("click", () => {
                selectCell(issue.row, issue.col);
            });

            issuesBody.appendChild(tr);
        });

        issuesWrap.hidden = !(result.issues || []).length;

        // Add Row and Column filters after rendering all issues.
        addIssueColumnFilters();

        messagesByCell.forEach((messages, key) => {
            const [row, col] = key.split(":");
            const td = getCell(row, col);

            if (td) {
                td.title = messages.join("\n");
            }
        });

        const s = result.summary || {
            rows_checked: 0,
            errors: 0,
            warnings: 0
        };

        valStatus.textContent =
            `${s.rows_checked} rows checked | ` +
            `${s.errors} errors | ${s.warnings} warnings`;

        (result.mapping_warnings || []).forEach(message => {
            const li = document.createElement("li");

            li.textContent = "Mapping: " + message;
            mapWarnings.appendChild(li);
        });
    }

    applyFilter();
})();