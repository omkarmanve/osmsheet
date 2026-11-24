"use strict";

/* ============================================================
   ROUND 2 - EXCEL VIEWER + COMPARISON
   ------------------------------------------------------------
   Performance optimized version
============================================================ */

const ROW_H = 29;
const ROW_NUM_W = 48;
const DEFAULT_COL_W = 110;
const BLANK_ROWS = 30;
const BLANK_COLS = 12;
const WRAP_ROW_LIMIT = 3000;

/*
 * Important performance settings
 */
const EXCEL_READ_OPTIONS = {
    type: "array",
    dense: true,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellFormula: false
};

const KINDS = {
    old: {
        label: "OLD EXCEL",
        name: "Old Excel",
        tab: "oldExcel"
    },

    new: {
        label: "NEW EXCEL",
        name: "New Excel",
        tab: "newExcel"
    },

    scenario: {
        label: "SCENARIO EXCEL",
        name: "Scenario Excel",
        tab: "scenarioExcel"
    }
};

const TAB_TO_KIND = {
    oldExcel: "old",
    newExcel: "new",
    scenarioExcel: "scenario"
};

const state = {
    books: {
        old: null,
        new: null,
        scenario: null
    },

    grids: {},

    tab: "comparison",

    scenarioSsns: [],

    data: null,

    items: [],

    selected: new Set(),

    statusFilter: "ALL"
};

const $ = (id) => document.getElementById(id);


/* ============================================================
   HELPERS
============================================================ */

function esc(value) {
    return String(
        value === null || value === undefined ? "" : value
    )
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}


function pad2(n) {
    return String(n).padStart(2, "0");
}


function fmt(v) {
    if (v === null || v === undefined) {
        return "";
    }

    /*
     * Excel parser is configured with cellDates:false.
     * This still keeps support for Date values if a pasted/edit
     * value becomes a Date later.
     */
    if (v instanceof Date) {
        if (isNaN(v.getTime())) {
            return "";
        }

        const d =
            `${v.getFullYear()}-` +
            `${pad2(v.getMonth() + 1)}-` +
            `${pad2(v.getDate())}`;

        const t =
            `${pad2(v.getHours())}:` +
            `${pad2(v.getMinutes())}:` +
            `${pad2(v.getSeconds())}`;

        return t === "00:00:00" ? d : `${d} ${t}`;
    }

    if (typeof v === "boolean") {
        return v ? "TRUE" : "FALSE";
    }

    return String(v).trim();
}


function colLetter(index) {
    let n = index + 1;
    let s = "";

    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }

    return s;
}


function normaliseSsn(v) {
    return fmt(v).replace(/[-\s.]/g, "");
}


function looksLikeSsn(v) {
    return /^\d{9}$/.test(normaliseSsn(v));
}


function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}


function debounce(fn, ms) {
    let t = null;

    return (...args) => {
        clearTimeout(t);

        t = setTimeout(() => {
            fn(...args);
        }, ms);
    };
}


let toastTimer = null;

function toast(message, isError) {
    const el = $("toast");

    if (!el) {
        return;
    }

    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.hidden = false;

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        el.hidden = true;
    }, isError ? 6000 : 2500);
}


function setFooterStatus(text) {
    const el = $("footerStatus");

    if (el) {
        el.textContent = text;
    }
}


function setFileName(id, text) {
    const el = $(id);

    if (el) {
        el.textContent = text;
    }
}


function showError(message) {
    toast(message, true);
    setFooterStatus(message);
    renderMessages([message], []);
}


function renderMessages(errors, warnings) {
    const section = $("globalMessagesSection");

    if (!section) {
        return;
    }

    $("globalErrorsList").innerHTML =
        errors.map(m => `<li>${esc(m)}</li>`).join("") ||
        `<li class="muted">None</li>`;

    $("globalWarningsList").innerHTML =
        warnings.map(m => `<li>${esc(m)}</li>`).join("") ||
        `<li class="muted">None</li>`;

    section.hidden = !errors.length && !warnings.length;
}


function toTSV(matrix) {
    return matrix
        .map(row =>
            row
                .map(cell => {
                    const text = String(
                        cell === null || cell === undefined
                            ? ""
                            : cell
                    );

                    return /[\t\n\r"]/.test(text)
                        ? `"${text.replace(/"/g, '""')}"`
                        : text;
                })
                .join("\t")
        )
        .join("\n");
}


function parseTSV(input) {
    const text = String(input || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    const rows = [];

    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += ch;
            }
        } else if (ch === '"' && cell === "") {
            inQuotes = true;
        } else if (ch === "\t") {
            row.push(cell);
            cell = "";
        } else if (ch === "\n") {
            row.push(cell);
            rows.push(row);

            row = [];
            cell = "";
        } else {
            cell += ch;
        }
    }

    if (cell !== "" || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}


async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        try {
            const ta = document.createElement("textarea");

            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";

            document.body.appendChild(ta);

            ta.select();

            const ok = document.execCommand("copy");

            ta.remove();

            return ok;
        } catch (e2) {
            return false;
        }
    }
}


/* ============================================================
   WORKBOOK MODEL
============================================================ */

function newUi() {
    return {
        widths: [],
        filters: {},
        sortCol: -1,
        sortDir: 0,
        showFilters: false
    };
}


function maxCols(data) {
    let m = 0;

    for (const row of data) {
        if (row && row.length > m) {
            m = row.length;
        }
    }

    return m;
}


function makeBlankSheet() {
    return {
        name: "Pasted Data",
        data: Array.from(
            { length: BLANK_ROWS },
            () => []
        ),

        maxCols: 0,
        blank: true,
        dirty: false,
        ui: newUi()
    };
}


/*
 * IMPORTANT:
 *
 * Excel workbook is parsed once during upload.
 * Sheet data is still created lazily.
 *
 * dense:true makes SheetJS use a dense worksheet structure,
 * which is generally much faster for large normal Excel sheets.
 */
function ensureSheetData(book, sheet) {
    if (sheet.data) {
        return;
    }

    const ws = book.wb.Sheets[sheet.name];

    let data = [];

    if (ws && ws["!ref"]) {
        const range = XLSX.utils.decode_range(ws["!ref"]);

        /*
         * Always start from A1.
         */
        range.s.r = 0;
        range.s.c = 0;

        data = XLSX.utils.sheet_to_json(
            ws,
            {
                header: 1,
                raw: true,
                defval: "",
                blankrows: true,
                range
            }
        );
    }

    sheet.data = data;
    sheet.maxCols = maxCols(data);
}


function activeSheetOf(kind) {
    const book = state.books[kind];

    if (!book) {
        return null;
    }

    const sheet = book.sheets[book.active];

    if (sheet) {
        ensureSheetData(book, sheet);
    }

    return sheet || null;
}


function sheetHasData(sheet) {
    if (!sheet || !sheet.data) {
        return false;
    }

    for (const row of sheet.data) {
        if (!row) {
            continue;
        }

        for (const value of row) {
            if (value !== null &&
                value !== undefined &&
                String(value).trim() !== "") {
                return true;
            }
        }
    }

    return false;
}


/* ============================================================
   GRID
============================================================ */

class Grid {

    constructor(kind) {
        this.kind = kind;

        this.book = null;

        this.sheet = makeBlankSheet();

        this.view = [];

        this.ncols = BLANK_COLS;

        this.sel = null;

        this.drag = null;

        this.wrap = false;

        this.query = "";

        this.hits = new Map();

        this.matchList = [];

        this.matchIdx = -1;

        this.root = $(`${kind}ExcelViewer`);

        this.buildDom();

        this.bind();

        this.refreshAll();
    }


    /* --------------------------------------------------------
       DOM
    -------------------------------------------------------- */

    buildDom() {
        const k = this.kind;

        this.root.innerHTML = `
            <div class="viewer-label">
                ${KINDS[k].label}
            </div>

            <div id="${k}SheetTabs"
                 class="sheet-tabs"></div>

            <div class="spreadsheet-toolbar">

                <input
                    id="${k}SheetSearch"
                    type="search"
                    placeholder="Search ${KINDS[k].name}... (Enter = next)"
                >

                <button
                    id="${k}FilterBtn"
                    type="button">
                    Filters
                </button>

                <button
                    id="${k}AutoFitBtn"
                    type="button">
                    Auto Fit
                </button>

                <button
                    id="${k}WrapBtn"
                    type="button">
                    Wrap Text
                </button>

                <button
                    id="${k}ResetWidthBtn"
                    type="button">
                    Reset Widths
                </button>

                <button
                    id="${k}ClearBtn"
                    type="button">
                    Clear Sort/Filters
                </button>

                <span
                    id="${k}SearchInfo"
                    class="toolbar-info"></span>

            </div>

            <div
                id="${k}SpreadsheetContainer"
                class="spreadsheet-container"
                tabindex="0">

                <table
                    id="${k}SpreadsheetTable"
                    class="excel-grid">

                    <colgroup></colgroup>

                    <thead></thead>

                    <tbody></tbody>

                </table>

            </div>

            <div class="sheet-statusbar">

                <span id="${k}ActiveSheet">
                    No sheet selected
                </span>

                <span id="${k}SelectionInfo">
                    Ready
                </span>

                <span id="${k}RowCount">
                    0 rows
                </span>

            </div>
        `;

        this.tabsEl = $(`${k}SheetTabs`);

        this.container =
            $(`${k}SpreadsheetContainer`);

        this.table =
            $(`${k}SpreadsheetTable`);

        this.colgroup =
            this.table.querySelector("colgroup");

        this.thead =
            this.table.querySelector("thead");

        this.tbody =
            this.table.querySelector("tbody");

        this.searchInput =
            $(`${k}SheetSearch`);
    }


    /* --------------------------------------------------------
       EVENTS
    -------------------------------------------------------- */

    bind() {
        const k = this.kind;
        const c = this.container;

        c.addEventListener(
            "mousedown",
            e => this.onMouseDown(e)
        );

        c.addEventListener(
            "mouseover",
            e => this.onMouseOver(e)
        );

        c.addEventListener(
            "click",
            e => this.onClick(e)
        );

        c.addEventListener(
            "dblclick",
            e => this.onDblClick(e)
        );

        c.addEventListener(
            "keydown",
            e => this.onKeyDown(e)
        );

        c.addEventListener(
            "copy",
            e => this.onCopy(e)
        );

        c.addEventListener(
            "paste",
            e => this.onPaste(e)
        );

        c.addEventListener(
            "input",
            e => this.onFilterInput(e)
        );

        let raf = null;

        c.addEventListener(
            "scroll",
            () => {

                if (raf) {
                    return;
                }

                raf = requestAnimationFrame(() => {
                    raf = null;
                    this.renderBody();
                });
            }
        );

        document.addEventListener(
            "mouseup",
            () => {
                if (
                    this.drag &&
                    (
                        this.drag.type === "cell" ||
                        this.drag.type === "select"
                    )
                ) {
                    this.drag = null;
                }
            }
        );

        document.addEventListener(
            "mousemove",
            e => this.onResizeMove(e)
        );

        document.addEventListener(
            "mouseup",
            () => this.onResizeEnd()
        );

        this.searchInput.addEventListener(
            "input",
            debounce(
                () => this.runSearch(),
                200
            )
        );

        this.searchInput.addEventListener(
            "keydown",
            e => {

                if (e.key === "Enter") {

                    e.preventDefault();

                    this.gotoMatch(
                        e.shiftKey ? -1 : 1
                    );

                } else if (e.key === "Escape") {

                    this.searchInput.value = "";

                    this.runSearch();

                    this.container.focus();
                }
            }
        );


        $(`${k}FilterBtn`).onclick = () => {

            this.sheet.ui.showFilters =
                !this.sheet.ui.showFilters;

            this.renderHead();
            this.renderBody();
        };


        $(`${k}AutoFitBtn`).onclick = () => {
            this.autoFit();
        };


        $(`${k}ResetWidthBtn`).onclick = () => {

            this.sheet.ui.widths = [];

            this.renderHead();
            this.renderBody();
        };


        $(`${k}WrapBtn`).onclick = () => {
            this.toggleWrap();
        };


        $(`${k}ClearBtn`).onclick = () => {
            this.clearSortFilters();
        };
    }


    /* --------------------------------------------------------
       BOOK / SHEET
    -------------------------------------------------------- */

    setBook(book) {

        this.book = book;

        if (book) {

            this.showSheet(
                book.active || 0
            );

        } else {

            this.sheet =
                makeBlankSheet();

            this.sel = null;

            this.refreshAll();
        }
    }


    showSheet(index) {

        this.book.active = index;

        const sheet =
            this.book.sheets[index];

        ensureSheetData(
            this.book,
            sheet
        );

        this.sheet = sheet;

        this.sel = null;

        this.wrap = false;

        this.refreshAll();

        this.container.scrollTop = 0;
        this.container.scrollLeft = 0;

        this.renderBody();

        app.onSheetChanged(
            this.kind
        );
    }


    refreshAll() {

        this.rebuildView();

        this.renderTabs();

        this.renderHead();

        this.renderBody();

        this.updateStatus();

        this.runSearch(true);
    }


    renderTabs() {

        if (!this.book) {

            this.tabsEl.innerHTML = `
                <span class="muted" style="padding:8px">
                    No file loaded. Upload an Excel file,
                    or select a cell and press Ctrl+V
                    to paste data.
                </span>`;

            return;
        }

        this.tabsEl.innerHTML =
            this.book.sheets
                .map((s, i) => {

                    return `
                    <button
                        type="button"
                        class="sheet-tab${i === this.book.active ? " active" : ""}"
                        data-i="${i}"
                        title="${esc(s.name)}">

                        ${esc(s.name)}

                    </button>`;
                })
                .join("");

        this.tabsEl
            .querySelectorAll(".sheet-tab")
            .forEach(btn => {

                btn.onclick = () => {
                    this.showSheet(
                        Number(btn.dataset.i)
                    );
                };

            });
    }


    /* --------------------------------------------------------
       VIEW
    -------------------------------------------------------- */

    isIdentityView() {

        const ui =
            this.sheet.ui;

        const hasFilter =
            Object.values(ui.filters)
                .some(v => v !== "");

        return (
            !hasFilter &&
            ui.sortCol < 0
        );
    }


    rebuildView() {

        const sheet = this.sheet;

        const ui = sheet.ui;

        const data = sheet.data;

        this.ncols =
            Math.max(
                sheet.blank
                    ? BLANK_COLS
                    : 1,

                sheet.maxCols || 0
            );

        const active =
            Object.entries(ui.filters)
                .filter(([, v]) => v !== "")
                .map(
                    ([c, v]) => [
                        Number(c),
                        v.toLowerCase()
                    ]
                );

        const idx = [];

        for (
            let r = 0;
            r < data.length;
            r++
        ) {

            if (active.length) {

                const row =
                    data[r] || [];

                let ok = true;

                for (
                    const [c, needle]
                    of active
                ) {

                    if (
                        !fmt(row[c])
                            .toLowerCase()
                            .includes(needle)
                    ) {
                        ok = false;
                        break;
                    }
                }

                if (!ok) {
                    continue;
                }
            }

            idx.push(r);
        }


        if (
            ui.sortCol >= 0 &&
            ui.sortDir !== 0
        ) {

            const c =
                ui.sortCol;

            const dir =
                ui.sortDir;

            const numeric =
                /^-?\d+(\.\d+)?$/;

            idx.sort(
                (ra, rb) => {

                    const a =
                        fmt(
                            (data[ra] || [])[c]
                        );

                    const b =
                        fmt(
                            (data[rb] || [])[c]
                        );

                    if (
                        a === "" &&
                        b === ""
                    ) {
                        return 0;
                    }

                    if (a === "") {
                        return 1;
                    }

                    if (b === "") {
                        return -1;
                    }

                    if (
                        numeric.test(a) &&
                        numeric.test(b)
                    ) {

                        return (
                            Number(a) -
                            Number(b)
                        ) * dir;
                    }

                    return (
                        a.localeCompare(
                            b,
                            undefined,
                            {
                                numeric: true,
                                sensitivity: "base"
                            }
                        ) * dir
                    );
                }
            );
        }

        this.view = idx;
    }


    clearSortFilters() {

        const ui =
            this.sheet.ui;

        ui.filters = {};

        ui.sortCol = -1;

        ui.sortDir = 0;

        this.sel = null;

        this.rebuildView();

        this.renderHead();

        this.renderBody();

        this.updateStatus();

        this.runSearch(true);
    }


    /* --------------------------------------------------------
       WIDTHS
    -------------------------------------------------------- */

    ensureWidths() {

        const ui =
            this.sheet.ui;

        for (
            let c = 0;
            c < this.ncols;
            c++
        ) {

            if (!ui.widths[c]) {
                ui.widths[c] =
                    DEFAULT_COL_W;
            }
        }

        ui.widths.length =
            this.ncols;
    }


    tableWidth() {

        return (
            ROW_NUM_W +
            this.sheet.ui.widths
                .reduce(
                    (a, b) =>
                        a + b,
                    0
                )
        );
    }


    /* --------------------------------------------------------
       HEADER
    -------------------------------------------------------- */

    renderHead() {

        const ui =
            this.sheet.ui;

        this.ensureWidths();

        this.colgroup.innerHTML =
            `<col style="width:${ROW_NUM_W}px">` +
            ui.widths
                .map(
                    w =>
                        `<col style="width:${w}px">`
                )
                .join("");

        this.table.style.width =
            `${this.tableWidth()}px`;


        let row1 = `
            <tr>
                <th
                    class="row-number-header corner"
                    title="Select all">
                    &#9698;
                </th>`;

        for (
            let c = 0;
            c < this.ncols;
            c++
        ) {

            const sorted =
                ui.sortCol === c &&
                ui.sortDir !== 0;

            const arrow =
                sorted
                    ? (
                        ui.sortDir === 1
                            ? "&#9650;"
                            : "&#9660;"
                    )
                    : "&#8645;";

            row1 += `
                <th
                    class="column-header"
                    data-c="${c}">

                    <span
                        class="hdr-label"
                        data-c="${c}">
                        ${colLetter(c)}
                    </span>

                    <button
                        type="button"
                        class="sort-btn${sorted ? " active" : ""}"
                        data-c="${c}"
                        title="Sort">
                        ${arrow}
                    </button>

                    <div
                        class="column-resize-handle"
                        data-c="${c}">
                    </div>

                </th>`;
        }

        row1 += "</tr>";


        let row2 = "";

        if (ui.showFilters) {

            row2 = `
                <tr>
                    <th
                        class="row-number-header filter-corner">
                    </th>`;

            for (
                let c = 0;
                c < this.ncols;
                c++
            ) {

                row2 += `
                    <th class="filter-cell">

                        <input
                            type="text"
                            data-fc="${c}"
                            placeholder="filter"
                            value="${esc(
                                ui.filters[c] || ""
                            )}">

                    </th>`;
            }

            row2 += "</tr>";
        }

        this.thead.innerHTML =
            row1 + row2;

        this.updateHeaderSel();

        $(`${this.kind}FilterBtn`)
            .classList
            .toggle(
                "primary-btn",
                ui.showFilters
            );
    }


    /* --------------------------------------------------------
       SELECTION
    -------------------------------------------------------- */

    getRange() {

        const s =
            this.sel;

        const n =
            this.view.length;

        if (!s || !n) {
            return null;
        }

        let r1 =
            Math.min(
                s.ar,
                s.fr
            );

        let r2 =
            Math.max(
                s.ar,
                s.fr
            );

        let c1 =
            Math.min(
                s.ac,
                s.fc
            );

        let c2 =
            Math.max(
                s.ac,
                s.fc
            );

        if (
            s.mode === "row" ||
            s.mode === "all"
        ) {

            c1 = 0;
            c2 = this.ncols - 1;
        }

        if (
            s.mode === "col" ||
            s.mode === "all"
        ) {

            r1 = 0;
            r2 = n - 1;
        }

        r1 =
            clamp(
                r1,
                0,
                n - 1
            );

        r2 =
            clamp(
                r2,
                0,
                n - 1
            );

        c1 =
            clamp(
                c1,
                0,
                this.ncols - 1
            );

        c2 =
            clamp(
                c2,
                0,
                this.ncols - 1
            );

        return {
            r1,
            r2,
            c1,
            c2
        };
    }


    /* --------------------------------------------------------
       BODY RENDER
    -------------------------------------------------------- */

    renderBody() {

        const c =
            this.container;

        const n =
            this.view.length;

        const ncols =
            this.ncols;

        const data =
            this.sheet.data;

        const wrap =
            this.wrap;


        let start = 0;

        let end = n;


        /*
         * Virtual rendering.
         *
         * Only visible rows are inserted into DOM.
         */
        if (!wrap) {

            const ch =
                c.clientHeight || 520;

            start =
                Math.max(
                    0,
                    Math.floor(
                        c.scrollTop /
                        ROW_H
                    ) - 6
                );

            end =
                Math.min(
                    n,
                    Math.ceil(
                        (
                            c.scrollTop +
                            ch
                        ) / ROW_H
                    ) + 6
                );
        }


        const range =
            this.getRange();

        const rowMode =
            this.sel &&
            (
                this.sel.mode === "row" ||
                this.sel.mode === "all"
            );

        const cur =
            this.matchIdx >= 0
                ? this.matchList[
                    this.matchIdx
                ]
                : null;

        const cols =
            ncols + 1;

        let html = "";


        if (start > 0) {

            html += `
                <tr
                    style="height:${start * ROW_H}px">

                    <td
                        class="spacer"
                        colspan="${cols}">
                    </td>

                </tr>`;
        }


        for (
            let vi = start;
            vi < end;
            vi++
        ) {

            const src =
                this.view[vi];

            const row =
                data[src] || [];

            const inRows =
                range &&
                vi >= range.r1 &&
                vi <= range.r2;

            const hitCols =
                this.hits.get(vi);


            html += `
                <tr>

                    <td
                        class="row-number${inRows && rowMode
                            ? " row-selected"
                            : ""}"
                        data-r="${vi}">
                        ${src + 1}
                    </td>`;


            for (
                let col = 0;
                col < ncols;
                col++
            ) {

                let cls =
                    "excel-cell";

                if (
                    inRows &&
                    col >= range.c1 &&
                    col <= range.c2
                ) {
                    cls += " in-range";
                }

                if (
                    hitCols &&
                    hitCols.has(col)
                ) {
                    cls += " search-hit";
                }

                if (
                    cur &&
                    cur[0] === vi &&
                    cur[1] === col
                ) {
                    cls += " search-current";
                }

                if (
                    this.sel &&
                    this.sel.fr === vi &&
                    this.sel.fc === col &&
                    this.sel.mode === "cell"
                ) {
                    cls += " active-cell";
                }


                html += `
                    <td
                        class="${cls}"
                        data-r="${vi}"
                        data-c="${col}">
                        ${esc(
                            fmt(row[col])
                        )}
                    </td>`;
            }

            html += "</tr>";
        }


        if (end < n) {

            html += `
                <tr
                    style="height:${(n - end) * ROW_H}px">

                    <td
                        class="spacer"
                        colspan="${cols}">
                    </td>

                </tr>`;
        }


        this.tbody.innerHTML =
            html;

        this.table.classList.toggle(
            "wrap-text",
            wrap
        );

        $(`${this.kind}WrapBtn`)
            .classList
            .toggle(
                "primary-btn",
                wrap
            );
    }


    updateHeaderSel() {

        const range =
            this.getRange();

        this.thead
            .querySelectorAll(
                "th.column-header"
            )
            .forEach(th => {

                const c =
                    Number(
                        th.dataset.c
                    );

                th.classList.toggle(
                    "col-selected",
                    !!range &&
                    c >= range.c1 &&
                    c <= range.c2
                );
            });
    }


    updateStatus() {

        const k =
            this.kind;

        const sheet =
            this.sheet;

        const fileName =
            this.book &&
            this.book.file
                ? ` | ${this.book.file.name}`
                : "";

        $(`${k}ActiveSheet`)
            .textContent =
                `Sheet: ${sheet.name}${fileName}${sheet.dirty
                    ? " (edited)"
                    : ""}`;


        const total =
            sheet.data.length;

        const shown =
            this.view.length;


        $(`${k}RowCount`)
            .textContent =
                `${shown === total
                    ? total
                    : shown + " of " + total
                } rows | ${this.ncols} cols`;


        const range =
            this.getRange();

        const info =
            $(`${k}SelectionInfo`);


        if (!range) {

            info.textContent =
                "Ready";

        } else if (
            range.r1 === range.r2 &&
            range.c1 === range.c2
        ) {

            const src =
                this.view[
                    range.r1
                ];

            const value =
                fmt(
                    (
                        this.sheet.data[src] ||
                        []
                    )[range.c1]
                );

            info.textContent =
                `${colLetter(range.c1)}${src + 1}: ` +
                `${value.length > 60
                    ? value.slice(0, 60) + "..."
                    : value || "(empty)"
                }`;

        } else {

            info.textContent =
                `${range.r2 - range.r1 + 1} rows x ` +
                `${range.c2 - range.c1 + 1} cols selected`;
        }
    }


    /* --------------------------------------------------------
       SELECTION ACTIONS
    -------------------------------------------------------- */

    setSel(sel, scroll) {

        const old =
            this.sel;

        const changed =
            JSON.stringify(old) !==
            JSON.stringify(sel);

        this.sel =
            sel;

        if (!changed) {
            return;
        }

        this.renderBody();

        this.updateHeaderSel();

        this.updateStatus();

        if (
            scroll &&
            sel
        ) {
            this.ensureVisible(
                sel.fr,
                sel.fc
            );
        }
    }


    ensureVisible(vi, col) {

        const c =
            this.container;

        const ui =
            this.sheet.ui;

        const hh =
            ROW_H *
            (
                ui.showFilters
                    ? 2
                    : 1
            );

        const sb =
            17;


        if (!this.wrap) {

            const y =
                hh +
                vi * ROW_H;

            if (
                y - hh <
                c.scrollTop
            ) {

                c.scrollTop =
                    y - hh;

            } else if (
                y + ROW_H >
                c.scrollTop +
                c.clientHeight -
                sb
            ) {

                c.scrollTop =
                    y +
                    ROW_H -
                    c.clientHeight +
                    sb;
            }
        }


        let x =
            ROW_NUM_W;

        for (
            let i = 0;
            i < col;
            i++
        ) {

            x +=
                ui.widths[i] ||
                DEFAULT_COL_W;
        }

        const w =
            ui.widths[col] ||
            DEFAULT_COL_W;


        if (
            x - ROW_NUM_W <
            c.scrollLeft
        ) {

            c.scrollLeft =
                x - ROW_NUM_W;

        } else if (
            x + w >
            c.scrollLeft +
            c.clientWidth -
            sb
        ) {

            c.scrollLeft =
                x +
                w -
                c.clientWidth +
                sb;
        }

        this.renderBody();
    }


    cellFromEvent(e) {

        const td =
            e.target.closest(
                "td.excel-cell"
            );

        if (!td) {
            return null;
        }

        return {
            r: Number(td.dataset.r),
            c: Number(td.dataset.c)
        };
    }


    /* --------------------------------------------------------
       MOUSE
    -------------------------------------------------------- */

    onMouseDown(e) {

        if (e.button !== 0) {
            return;
        }

        const t =
            e.target;


        if (
            t.closest(
                ".column-resize-handle"
            )
        ) {

            e.preventDefault();

            const c =
                Number(
                    t.closest(
                        ".column-resize-handle"
                    ).dataset.c
                );

            this.drag = {
                type: "resize",
                c,
                startX: e.clientX,
                startW:
                    this.sheet.ui.widths[c]
            };

            return;
        }


        if (
            t.closest(".sort-btn") ||
            t.closest(".filter-cell")
        ) {
            return;
        }


        const n =
            this.view.length;

        if (!n) {

            this.container.focus({
                preventScroll: true
            });

            return;
        }


        const cell =
            this.cellFromEvent(e);

        const rowNum =
            t.closest(
                "td.row-number"
            );

        const hdr =
            t.closest(
                ".hdr-label"
            );

        const corner =
            t.closest(
                "th.corner"
            );


        if (cell) {

            e.preventDefault();

            this.container.focus({
                preventScroll: true
            });


            if (
                e.shiftKey &&
                this.sel
            ) {

                this.setSel({
                    ...this.sel,
                    mode: "cell",
                    fr: cell.r,
                    fc: cell.c
                });

            } else {

                this.setSel({
                    mode: "cell",

                    ar: cell.r,
                    ac: cell.c,

                    fr: cell.r,
                    fc: cell.c
                });
            }

            this.drag = {
                type: "select",
                mode: "cell"
            };


        } else if (rowNum) {

            e.preventDefault();

            this.container.focus({
                preventScroll: true
            });

            const r =
                Number(
                    rowNum.dataset.r
                );

            const ar =
                e.shiftKey &&
                this.sel
                    ? this.sel.ar
                    : r;

            this.setSel({
                mode: "row",

                ar,
                ac: 0,

                fr: r,
                fc: this.ncols - 1
            });

            this.drag = {
                type: "select",
                mode: "row"
            };


        } else if (hdr) {

            e.preventDefault();

            this.container.focus({
                preventScroll: true
            });

            const c =
                Number(
                    hdr.dataset.c
                );

            const ac =
                e.shiftKey &&
                this.sel
                    ? this.sel.ac
                    : c;

            this.setSel({
                mode: "col",

                ar: 0,
                ac,

                fr: n - 1,
                fc: c
            });

            this.drag = {
                type: "select",
                mode: "col"
            };


        } else if (corner) {

            e.preventDefault();

            this.container.focus({
                preventScroll: true
            });

            this.setSel({
                mode: "all",

                ar: 0,
                ac: 0,

                fr: n - 1,
                fc: this.ncols - 1
            });
        }
    }


    onMouseOver(e) {

        if (
            !this.drag ||
            this.drag.type !== "select" ||
            !this.sel
        ) {
            return;
        }

        const mode =
            this.drag.mode;


        if (mode === "cell") {

            const cell =
                this.cellFromEvent(e);

            if (cell) {

                this.setSel({
                    ...this.sel,
                    fr: cell.r,
                    fc: cell.c
                });
            }

        } else if (
            mode === "row"
        ) {

            const td =
                e.target.closest(
                    "td[data-r]"
                );

            if (td) {

                this.setSel({
                    ...this.sel,
                    fr:
                        Number(
                            td.dataset.r
                        )
                });
            }

        } else if (
            mode === "col"
        ) {

            const th =
                e.target.closest(
                    "th.column-header"
                );

            const td =
                e.target.closest(
                    "td.excel-cell"
                );

            const c =
                th
                    ? Number(th.dataset.c)
                    : td
                        ? Number(td.dataset.c)
                        : null;

            if (c !== null) {

                this.setSel({
                    ...this.sel,
                    fc: c
                });
            }
        }
    }


    onClick(e) {

        const sortBtn =
            e.target.closest(
                ".sort-btn"
            );

        if (!sortBtn) {
            return;
        }

        const c =
            Number(
                sortBtn.dataset.c
            );

        const ui =
            this.sheet.ui;


        if (
            ui.sortCol !== c
        ) {

            ui.sortCol = c;
            ui.sortDir = 1;

        } else if (
            ui.sortDir === 1
        ) {

            ui.sortDir = -1;

        } else {

            ui.sortCol = -1;
            ui.sortDir = 0;
        }


        this.sel = null;

        this.rebuildView();

        this.renderHead();

        this.renderBody();

        this.updateStatus();

        this.runSearch(true);
    }


    onDblClick(e) {

        const handle =
            e.target.closest(
                ".column-resize-handle"
            );

        if (handle) {
            this.autoFit(
                Number(
                    handle.dataset.c
                )
            );
        }
    }


    onFilterInput(e) {

        const input =
            e.target.closest(
                "input[data-fc]"
            );

        if (!input) {
            return;
        }

        const c =
            Number(
                input.dataset.fc
            );

        this.sheet.ui.filters[c] =
            input.value;

        this.applyFilterDebounced();
    }


    applyFilterDebounced =
        debounce(
            () => {

                this.sel = null;

                this.rebuildView();

                this.container.scrollTop = 0;

                this.renderBody();

                this.updateStatus();

                this.runSearch(true);

            },
            150
        );


    /* --------------------------------------------------------
       KEYBOARD
    -------------------------------------------------------- */

    onKeyDown(e) {

        if (
            e.target.tagName === "INPUT"
        ) {
            return;
        }

        const n =
            this.view.length;

        if (!n) {
            return;
        }


        if (
            (e.ctrlKey ||
                e.metaKey) &&
            e.key.toLowerCase() === "a"
        ) {

            e.preventDefault();

            this.setSel({
                mode: "all",

                ar: 0,
                ac: 0,

                fr: n - 1,
                fc: this.ncols - 1
            });

            return;
        }


        const moves = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
            PageUp: [-15, 0],
            PageDown: [15, 0]
        };

        const m =
            moves[e.key];

        if (!m) {
            return;
        }

        e.preventDefault();


        const s =
            this.sel ||
            {
                mode: "cell",
                ar: 0,
                ac: 0,
                fr: 0,
                fc: 0
            };


        const fr =
            clamp(
                s.fr +
                (
                    this.sel
                        ? m[0]
                        : 0
                ),
                0,
                n - 1
            );

        const fc =
            clamp(
                s.fc +
                (
                    this.sel
                        ? m[1]
                        : 0
                ),
                0,
                this.ncols - 1
            );


        if (
            e.shiftKey &&
            this.sel
        ) {

            this.setSel(
                {
                    ...s,
                    mode: "cell",
                    fr,
                    fc
                },
                true
            );

        } else {

            this.setSel(
                {
                    mode: "cell",

                    ar: fr,
                    ac: fc,

                    fr,
                    fc
                },
                true
            );
        }
    }


    /* --------------------------------------------------------
       COPY / PASTE
    -------------------------------------------------------- */

    rangeToMatrix(range) {

        const rows = [];

        for (
            let vi = range.r1;
            vi <= range.r2;
            vi++
        ) {

            const src =
                this.view[vi];

            const row =
                this.sheet.data[src] ||
                [];

            const out = [];

            for (
                let c = range.c1;
                c <= range.c2;
                c++
            ) {
                out.push(
                    fmt(row[c])
                );
            }

            rows.push(out);
        }

        return rows;
    }


    onCopy(e) {

        if (
            e.target.tagName === "INPUT"
        ) {
            return;
        }

        const range =
            this.getRange();

        if (!range) {
            return;
        }

        e.preventDefault();

        e.clipboardData.setData(
            "text/plain",
            toTSV(
                this.rangeToMatrix(
                    range
                )
            )
        );

        toast(
            `Copied ${range.r2 - range.r1 + 1} rows x ` +
            `${range.c2 - range.c1 + 1} cols`
        );
    }


    async copySheet() {

        if (!this.view.length) {

            toast(
                "Nothing to copy."
            );

            return;
        }

        const range = {
            r1: 0,
            r2:
                this.view.length - 1,
            c1: 0,
            c2:
                this.ncols - 1
        };

        const ok =
            await copyText(
                toTSV(
                    this.rangeToMatrix(
                        range
                    )
                )
            );

        toast(
            ok
                ? `Copied whole sheet (${this.view.length} rows)`
                : "Copy failed. Select all (Ctrl+A) and press Ctrl+C.",
            !ok
        );
    }


    onPaste(e) {

        if (
            e.target.tagName === "INPUT"
        ) {
            return;
        }

        e.preventDefault();

        this.pasteText(
            e.clipboardData.getData(
                "text/plain"
            )
        );
    }


    async pasteFromClipboard() {

        try {

            const text =
                await navigator
                    .clipboard
                    .readText();

            this.pasteText(text);

        } catch (e) {

            this.container.focus();

            toast(
                "Browser blocked clipboard access. Click a cell and press Ctrl+V instead.",
                true
            );
        }
    }


    pasteText(text) {

        const matrix =
            parseTSV(text);

        if (!matrix.length) {

            toast(
                "Clipboard is empty."
            );

            return;
        }


        if (!this.isIdentityView()) {

            toast(
                "Clear sort/filters before pasting.",
                true
            );

            return;
        }


        const range =
            this.getRange();

        let startRow;
        let startCol;


        if (range) {

            startRow =
                this.view[
                    range.r1
                ];

            startCol =
                range.c1;

        } else if (
            this.sheet.blank
        ) {

            startRow = 0;
            startCol = 0;

        } else {

            toast(
                "Click the top-left cell where the data should be pasted.",
                true
            );

            return;
        }


        if (!this.book) {

            this.book =
                app.createBlankBook(
                    this.kind,
                    this.sheet
                );
        }


        const sheet =
            this.sheet;

        let widest = 0;


        matrix.forEach(
            (row, i) => {

                const r =
                    startRow + i;

                while (
                    sheet.data.length <= r
                ) {
                    sheet.data.push([]);
                }

                const target =
                    sheet.data[r] ||
                    (
                        sheet.data[r] = []
                    );


                row.forEach(
                    (value, j) => {

                        const c =
                            startCol + j;

                        while (
                            target.length < c
                        ) {
                            target.push("");
                        }

                        target[c] =
                            value;
                    }
                );

                widest =
                    Math.max(
                        widest,
                        row.length
                    );
            }
        );


        sheet.blank = false;
        sheet.dirty = true;

        sheet.maxCols =
            maxCols(
                sheet.data
            );


        this.rebuildView();

        this.renderTabs();

        this.renderHead();


        const r1 =
            startRow;

        const r2 =
            startRow +
            matrix.length -
            1;


        this.sel = {

            mode: "cell",

            ar: r1,
            ac: startCol,

            fr: r2,

            fc:
                startCol +
                Math.max(
                    0,
                    widest - 1
                )
        };


        this.renderBody();

        this.updateHeaderSel();

        this.updateStatus();

        this.ensureVisible(
            r1,
            startCol
        );

        this.runSearch(true);


        toast(
            `Pasted ${matrix.length} rows x ` +
            `${widest} cols at ` +
            `${colLetter(startCol)}${startRow + 1}`
        );


        app.onSheetChanged(
            this.kind
        );
    }


    /* --------------------------------------------------------
       RESIZE
    -------------------------------------------------------- */

    onResizeMove(e) {

        if (
            !this.drag ||
            this.drag.type !== "resize"
        ) {
            return;
        }

        const ui =
            this.sheet.ui;

        const c =
            this.drag.c;

        ui.widths[c] =
            Math.max(
                40,
                this.drag.startW +
                (
                    e.clientX -
                    this.drag.startX
                )
            );


        const col =
            this.colgroup
                .children[c + 1];

        if (col) {

            col.style.width =
                `${ui.widths[c]}px`;
        }

        this.table.style.width =
            `${this.tableWidth()}px`;
    }


    onResizeEnd() {

        if (
            this.drag &&
            this.drag.type === "resize"
        ) {
            this.drag = null;
        }
    }


    autoFit(only) {

        const ui =
            this.sheet.ui;

        /*
         * Do not scan entire huge Excel file
         * for AutoFit.
         *
         * First 400 visible records are enough
         * for practical column sizing.
         */
        const sample =
            this.view.slice(
                0,
                400
            );

        const cols =
            only === undefined
                ? [
                    ...Array(
                        this.ncols
                    ).keys()
                ]
                : [only];


        for (
            const c of cols
        ) {

            let longest =
                colLetter(c).length;

            for (
                const src of sample
            ) {

                const len =
                    fmt(
                        (
                            this.sheet
                                .data[src] ||
                            []
                        )[c]
                    ).length;

                if (
                    len >
                    longest
                ) {
                    longest = len;
                }
            }

            ui.widths[c] =
                clamp(
                    Math.round(
                        longest * 7.2 +
                        24
                    ),
                    60,
                    500
                );
        }


        this.renderHead();

        this.renderBody();
    }


    toggleWrap() {

        if (
            !this.wrap &&
            this.view.length >
            WRAP_ROW_LIMIT
        ) {

            toast(
                `Wrap Text works up to ${WRAP_ROW_LIMIT} rows. Use filters to reduce the rows first.`,
                true
            );

            return;
        }

        this.wrap =
            !this.wrap;

        this.renderBody();
    }


    /* --------------------------------------------------------
       SEARCH
    -------------------------------------------------------- */

    runSearch(silent) {

        const query =
            this.searchInput
                ? this.searchInput.value
                    .trim()
                    .toLowerCase()
                : "";

        this.query =
            query;

        this.hits.clear();

        this.matchList = [];

        this.matchIdx = -1;


        if (!query) {

            const info =
                $(`${this.kind}SearchInfo`);

            if (info) {
                info.textContent =
                    "";
            }

            if (!silent) {
                this.renderBody();
            }

            return;
        }


        /*
         * Search only currently loaded
         * sheet data.
         *
         * This is intentionally simple
         * and avoids creating large DOM.
         */
        for (
            let vi = 0;
            vi < this.view.length;
            vi++
        ) {

            const src =
                this.view[vi];

            const row =
                this.sheet.data[src] ||
                [];

            let rowHits = null;

            for (
                let c = 0;
                c < this.ncols;
                c++
            ) {

                const value =
                    fmt(row[c])
                        .toLowerCase();

                if (
                    value.includes(
                        query
                    )
                ) {

                    if (!rowHits) {
                        rowHits =
                            new Set();
                    }

                    rowHits.add(c);

                    this.matchList.push([
                        vi,
                        c
                    ]);
                }
            }

            if (rowHits) {
                this.hits.set(
                    vi,
                    rowHits
                );
            }
        }


        const info =
            $(`${this.kind}SearchInfo`);

        if (info) {

            info.textContent =
                `${this.matchList.length} match` +
                (
                    this.matchList.length === 1
                        ? ""
                        : "es"
                );
        }


        if (!silent) {
            this.renderBody();
        }
    }


    gotoMatch(direction) {

        if (!this.matchList.length) {
            return;
        }


        if (
            this.matchIdx < 0
        ) {

            this.matchIdx =
                direction > 0
                    ? 0
                    : this.matchList.length - 1;

        } else {

            this.matchIdx =
                (
                    this.matchIdx +
                    direction +
                    this.matchList.length
                ) %
                this.matchList.length;
        }


        const [vi, c] =
            this.matchList[
                this.matchIdx
            ];


        this.setSel({
            mode: "cell",

            ar: vi,
            ac: c,

            fr: vi,
            fc: c

        }, true);


        this.renderBody();
    }
}


/* ============================================================
   APP
============================================================ */

const app = {

    /* --------------------------------------------------------
       INIT
    -------------------------------------------------------- */

    init() {

        /*
         * Create grids only once.
         */
        for (
            const kind of
            Object.keys(KINDS)
        ) {

            state.grids[kind] =
                new Grid(kind);
        }


        this.bindGlobalEvents();

        this.showTab(
            "comparison"
        );

        this.updateUploadStatus();

        setFooterStatus(
            "Ready"
        );
    },


    /* --------------------------------------------------------
       GLOBAL EVENTS
    -------------------------------------------------------- */

    bindGlobalEvents() {

        /*
         * Upload buttons
         */
        for (
            const kind of
            Object.keys(KINDS)
        ) {

            const input =
                $(`${kind}ExcelInput`);

            if (input) {

                input.addEventListener(
                    "change",
                    e =>
                        this.handleUpload(
                            kind,
                            e
                        )
                );
            }
        }


        const runBtn =
            $("runComparisonBtn");

        if (runBtn) {

            runBtn.addEventListener(
                "click",
                () =>
                    this.runComparison()
            );
        }


        const copySelectedBtn =
            $("copySelectedBtn");

        if (copySelectedBtn) {

            copySelectedBtn.addEventListener(
                "click",
                () =>
                    this.copySelected()
            );
        }


        const copyAllBtn =
            $("copyAllBtn");

        if (copyAllBtn) {

            copyAllBtn.addEventListener(
                "click",
                () =>
                    this.copyAll()
            );
        }


        const resetBtn =
            $("resetBtn");

        if (resetBtn) {

            resetBtn.addEventListener(
                "click",
                () =>
                    this.reset()
            );
        }


        const statusFilter =
            $("statusFilter");

        if (statusFilter) {

            statusFilter.addEventListener(
                "change",
                () =>
                    this.applyFilters()
            );
        }


        const resultSearch =
            $("resultSearch");

        if (resultSearch) {

            resultSearch.addEventListener(
                "input",
                debounce(
                    () =>
                        this.applyFilters(),
                    150
                )
            );
        }


        const resultBoxes =
            $("resultBoxes");

        if (resultBoxes) {

            resultBoxes.addEventListener(
                "click",
                e =>
                    this.onResultClick(
                        e
                    )
            );
        }


        document
            .querySelectorAll(
                ".ribbon-tab"
            )
            .forEach(btn => {

                btn.addEventListener(
                    "click",
                    () => {

                        const tab =
                            btn.dataset.tab;

                        if (tab) {
                            this.showTab(
                                tab
                            );
                        }
                    }
                );
            });
    },


    /* --------------------------------------------------------
       EXCEL FILE READER
    -------------------------------------------------------- */

    async readExcelFile(file) {

        if (!file) {
            throw new Error(
                "No Excel file selected."
            );
        }


        const name =
            String(
                file.name || ""
            ).toLowerCase();


        const valid =
            [
                ".xlsx",
                ".xlsm",
                ".xltx",
                ".xltm"
            ].some(
                ext =>
                    name.endsWith(ext)
            );


        if (!valid) {

            throw new Error(
                "Please select a valid Excel file (.xlsx, .xlsm, .xltx or .xltm)."
            );
        }


        if (file.size === 0) {

            throw new Error(
                "The selected Excel file is empty."
            );
        }


        if (
            typeof XLSX === "undefined"
        ) {

            throw new Error(
                "Excel reader library is not loaded."
            );
        }


        setFooterStatus(
            `Reading ${file.name}...`
        );


        /*
         * arrayBuffer is required by SheetJS.
         */
        const buffer =
            await file.arrayBuffer();


        try {

            /*
             * PERFORMANCE:
             *
             * dense:true
             * cellDates:false
             * cellStyles:false
             *
             * These reduce parser overhead.
             */
            const workbook =
                XLSX.read(
                    buffer,
                    EXCEL_READ_OPTIONS
                );


            if (
                !workbook ||
                !workbook.SheetNames ||
                !workbook.SheetNames.length
            ) {

                throw new Error(
                    "No worksheet found."
                );
            }


            return workbook;

        } catch (error) {

            throw new Error(
                `Invalid or corrupted Excel file. ${error.message}`
            );
        }
    },


    /* --------------------------------------------------------
       UPLOAD
    -------------------------------------------------------- */

    async handleUpload(
        kind,
        event
    ) {

        const input =
            event.target;

        const file =
            input.files &&
            input.files.length
                ? input.files[0]
                : null;


        if (!file) {
            return;
        }


        try {

            setFooterStatus(
                `Loading ${KINDS[kind].name}: ${file.name}`
            );


            const workbook =
                await this.readExcelFile(
                    file
                );


            const book = {

                file,

                wb:
                    workbook,

                sheets:
                    workbook.SheetNames
                        .map(name => ({
                            name,

                            /*
                             * Lazy loaded.
                             *
                             * This is important:
                             * sheet data is NOT converted
                             * until the sheet is actually shown.
                             */
                            data: null,

                            maxCols: 0,

                            blank: false,

                            dirty: false,

                            ui: newUi()
                        })),

                active: 0
            };


            state.books[kind] =
                book;


            setFileName(
                `${kind}ExcelFileName`,
                file.name
            );


            state.grids[kind]
                .setBook(book);


            renderMessages(
                [],
                []
            );


            setFooterStatus(
                `${KINDS[kind].name} loaded: ${file.name} | Sheet: ${book.sheets[0].name}`
            );


            toast(
                `${KINDS[kind].name} loaded (${book.sheets.length} sheet${book.sheets.length > 1 ? "s" : ""})`
            );


        } catch (error) {

            console.error(
                `${kind} upload error:`,
                error
            );

            state.books[kind] =
                null;


            state.grids[kind]
                .setBook(null);


            setFileName(
                `${kind}ExcelFileName`,
                "No file selected"
            );


            this.onSheetChanged(
                kind
            );


            showError(
                `${KINDS[kind].name} could not be read: ${error.message}`
            );

        } finally {

            /*
             * Allows selecting same file again.
             */
            input.value = "";
        }
    },


    /* --------------------------------------------------------
       CREATE BLANK BOOK
    -------------------------------------------------------- */

    createBlankBook(
        kind,
        sheet
    ) {

        const book = {

            file: null,

            wb: null,

            sheets: [
                sheet
            ],

            active: 0
        };


        state.books[kind] =
            book;


        setFileName(
            `${kind}ExcelFileName`,
            "Pasted data (no file)"
        );


        return book;
    },


    /* --------------------------------------------------------
       SHEET CHANGE
    -------------------------------------------------------- */

    onSheetChanged(kind) {

        const book =
            state.books[kind];

        const select =
            $(`${kind}ExcelSheetSelect`);


        if (book) {

            select.innerHTML =
                book.sheets
                    .map(
                        (s, i) =>
                            `<option value="${i}">
                                ${esc(s.name)}
                             </option>`
                    )
                    .join("");

            select.value =
                String(
                    book.active
                );

            select.hidden =
                false;

        } else {

            select.hidden =
                true;

            select.innerHTML =
                "";
        }


        /*
         * Scenario SSN extraction only.
         */
        if (
            kind === "scenario"
        ) {

            this.extractScenarioSsns();
        }


        this.updateUploadStatus();
    },


    /* --------------------------------------------------------
       SCENARIO SSN EXTRACTION
    -------------------------------------------------------- */

    extractScenarioSsns() {

        const sheet =
            activeSheetOf(
                "scenario"
            );

        const ssns = [];

        const seen =
            new Set();


        if (
            sheet &&
            sheet.data
        ) {

            /*
             * Avoid calling normaliseSsn()
             * multiple times for the same value.
             */
            for (
                const row
                of sheet.data
            ) {

                if (!row) {
                    continue;
                }


                for (
                    const cell
                    of row
                ) {

                    if (
                        cell === null ||
                        cell === undefined
                    ) {
                        continue;
                    }


                    const value =
                        String(cell)
                            .trim()
                            .replace(
                                /[-\s.]/g,
                                ""
                            );


                    if (
                        /^\d{9}$/.test(
                            value
                        ) &&
                        !seen.has(value)
                    ) {

                        seen.add(value);

                        ssns.push(
                            value
                        );
                    }
                }
            }
        }


        state.scenarioSsns =
            ssns;


        const count =
            $("scenarioSsnCount");

        if (count) {

            count.textContent =
                `${ssns.length} SSN${ssns.length === 1 ? "" : "s"}`;
        }


        const list =
            $("scenarioSsnList");

        if (list) {

            /*
             * Do not create huge DOM
             * if scenario contains many SSNs.
             */
            const MAX_DISPLAY =
                1000;

            const display =
                ssns.slice(
                    0,
                    MAX_DISPLAY
                );

            list.innerHTML =
                display
                    .map(
                        (ssn, i) =>
                            `<div class="scenario-ssn-item">
                                <span>${i + 1}</span>
                                <strong>${esc(ssn)}</strong>
                            </div>`
                    )
                    .join("");

            if (
                ssns.length >
                MAX_DISPLAY
            ) {

                list.innerHTML += `
                    <div class="muted"
                         style="padding:8px">
                        Showing first ${MAX_DISPLAY}
                        of ${ssns.length} SSNs.
                    </div>`;
            }
        }


        this.refreshVisibility();
    },


    /* --------------------------------------------------------
       UPLOAD STATUS
    -------------------------------------------------------- */

    updateUploadStatus() {

        const missing = [];


        for (
            const kind
            of Object.keys(KINDS)
        ) {

            const sheet =
                activeSheetOf(
                    kind
                );

            if (
                !sheet ||
                !sheetHasData(
                    sheet
                )
            ) {

                missing.push(
                    KINDS[kind].name
                );
            }
        }


        const ready =
            missing.length === 0;


        const btn =
            $("runComparisonBtn");

        if (btn) {
            btn.disabled =
                !ready;
        }


        const box =
            $("uploadStatus");

        if (box) {

            box.classList.toggle(
                "success",
                ready
            );


            box.textContent =
                ready
                    ? `Ready: ${state.scenarioSsns.length} SSN(s) will be compared. Click Run Comparison.`
                    : `Waiting for: ${missing.join(", ")}`;
        }
    },


    /* --------------------------------------------------------
       TABS
    -------------------------------------------------------- */

    showTab(tab) {

        state.tab =
            tab;


        document
            .querySelectorAll(
                ".ribbon-tab"
            )
            .forEach(btn => {

                btn.classList.toggle(
                    "active",
                    btn.dataset.tab === tab
                );
            });


        const kind =
            TAB_TO_KIND[tab];


        if (kind) {

            for (
                const k
                of Object.keys(KINDS)
            ) {

                $(`${k}ExcelViewer`)
                    .hidden =
                    k !== kind;
            }


            const title =
                $("viewerTitle");

            if (title) {

                title.textContent =
                    `${KINDS[kind].name} Viewer`;
            }
        }


        this.refreshVisibility();


        if (kind) {

            const grid =
                state.grids[kind];

            /*
             * Body rendering remains virtualized.
             */
            grid.renderBody();
        }
    },


    /* --------------------------------------------------------
       VISIBILITY
    -------------------------------------------------------- */

    refreshVisibility() {

        const ready = {

            scenarioPreviewSection:
                state.scenarioSsns.length > 0,

            summarySection:
                !!state.data,

            resultsSection:
                !!state.data
        };


        document
            .querySelectorAll(
                "[data-views]"
            )
            .forEach(el => {

                const views =
                    el.dataset.views
                        .split(" ");

                const contentOk =
                    el.id in ready
                        ? ready[el.id]
                        : true;

                el.hidden =
                    !(
                        views.includes(
                            state.tab
                        ) &&
                        contentOk
                    );
            });
    },


    /* --------------------------------------------------------
       RESET
    -------------------------------------------------------- */

    reset() {

        for (
            const kind
            of Object.keys(KINDS)
        ) {

            state.books[kind] =
                null;

            state.grids[kind]
                .setBook(null);

            setFileName(
                `${kind}ExcelFileName`,
                "No file selected"
            );

            const search =
                $(`${kind}SheetSearch`);

            if (search) {
                search.value = "";
            }

            this.onSheetChanged(
                kind
            );
        }


        state.scenarioSsns =
            [];

        state.data =
            null;

        state.items =
            [];

        state.selected.clear();


        const resultBoxes =
            $("resultBoxes");

        if (resultBoxes) {
            resultBoxes.innerHTML =
                "";
        }


        const copyPreviewSection =
            $("copyPreviewSection");

        if (copyPreviewSection) {
            copyPreviewSection.hidden =
                true;
        }


        const header =
            $("headerRowInput");

        if (header) {
            header.value =
                "0";
        }


        renderMessages(
            [],
            []
        );


        this.extractScenarioSsns();

        this.showTab(
            "comparison"
        );


        setFooterStatus(
            "Ready"
        );
    },


    /* ========================================================
       RUN COMPARISON
    ======================================================== */

    buildUpload(kind) {

        const book =
            state.books[kind];

        const sheet =
            book.sheets[
                book.active
            ];


        /*
         * IMPORTANT:
         *
         * If user has not edited the uploaded Excel,
         * send the ORIGINAL File object.
         *
         * This avoids:
         *
         * Excel
         *   ↓
         * sheet_to_json
         *   ↓
         * aoa_to_sheet
         *   ↓
         * XLSX.write
         *   ↓
         * new Excel
         *
         * before comparison.
         */
        if (
            book.file &&
            !sheet.dirty
        ) {

            return {

                blob:
                    book.file,

                filename:
                    book.file.name,

                sheetName:
                    sheet.name
            };
        }


        /*
         * Only edited/pasted sheets
         * need to be recreated.
         */
        const ws =
            XLSX.utils.aoa_to_sheet(
                sheet.data,
                {
                    cellDates:
                        false
                }
            );


        const wb =
            XLSX.utils.book_new();


        XLSX.utils.book_append_sheet(
            wb,
            ws,
            sheet.name.slice(
                0,
                31
            )
        );


        const out =
            XLSX.write(
                wb,
                {
                    bookType: "xlsx",
                    type: "array",
                    cellDates: false
                }
            );


        const blob =
            new Blob(
                [out],
                {
                    type:
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
            );


        const base =
            book.file
                ? book.file.name
                    .replace(
                        /\.[^.]+$/,
                        ""
                    )
                : kind;


        return {

            blob,

            filename:
                `${base}_edited.xlsx`,

            sheetName:
                sheet.name.slice(
                    0,
                    31
                )
        };
    },


    /* --------------------------------------------------------
       RUN COMPARISON
    -------------------------------------------------------- */

    async runComparison() {

        const btn =
            $("runComparisonBtn");


        try {

            btn.disabled =
                true;

            btn.textContent =
                "Comparing...";


            setFooterStatus(
                "Running comparison..."
            );


            const form =
                new FormData();


            for (
                const kind
                of Object.keys(KINDS)
            ) {

                const up =
                    this.buildUpload(
                        kind
                    );


                form.append(
                    `${kind}_excel`,
                    up.blob,
                    up.filename
                );


                form.append(
                    `${kind}_sheet`,
                    up.sheetName
                );
            }


            const header =
                Math.max(
                    0,
                    parseInt(
                        $("headerRowInput")
                            ?.value,
                        10
                    ) || 0
                );


            form.append(
                "header_row",
                String(
                    header
                )
            );


            const response =
                await fetch(
                    "/api/r2/compare",
                    {
                        method:
                            "POST",

                        body:
                            form
                    }
                );


            if (!response.ok) {

                let detail =
                    response.statusText;

                try {

                    const json =
                        await response.json();

                    detail =
                        json.detail ||
                        detail;

                } catch (e) {
                    /* ignore */
                }


                throw new Error(
                    detail
                );
            }


            const data =
                await response.json();


            this.renderResults(
                data
            );


            const s =
                data.summary;


            setFooterStatus(
                `Comparison complete: ${s.total_ssns} SSNs`
            );


            toast(
                `Comparison complete: ${s.total_ssns} SSNs`
            );


        } catch (error) {

            console.error(
                error
            );

            showError(
                String(
                    error.message ||
                    error
                )
            );

        } finally {

            btn.textContent =
                "Run Comparison";

            this.updateUploadStatus();
        }
    },


    /* ========================================================
       RESULTS
    ======================================================== */

    renderResults(data) {

        state.data =
            data;

        state.selected.clear();


        state.items =
            (data.results || [])
                .map(
                    (item, id) => ({
                        id,
                        item,
                        search:
                            this.searchText(
                                item
                            )
                    })
                );


        const s =
            data.summary;


        $("summaryTotal").textContent =
            s.total_ssns;

        $("summaryChanged").textContent =
            s.changed;

        $("summaryExtra").textContent =
            s.extra;

        $("summaryMissing").textContent =
            s.missing;

        $("summaryNew").textContent =
            s.new;

        $("summaryError").textContent =
            s.error;

        $("summaryNoChange").textContent =
            s.no_change;


        /*
         * Do not expand many results.
         *
         * Large result sets remain collapsed.
         */
        const expandFirst =
            state.items.length <= 30;


        /*
         * Browser can become slow if
         * thousands of result boxes are
         * inserted at once.
         *
         * We still keep the existing
         * functionality, but initially
         * render result boxes in batches.
         */
        const container =
            $("resultBoxes");

        container.innerHTML =
            "";


        this.renderResultBatch(
            0,
            expandFirst
        );


        $("statusFilter").value =
            "ALL";

        $("resultSearch").value =
            "";


        const msgs =
            data.messages ||
            {
                errors: [],
                warnings: []
            };


        renderMessages(
            msgs.errors ||
                [],
            msgs.warnings ||
                []
        );


        this.applyFilters();

        this.showTab(
            "results"
        );
    },


    /*
     * Render results in batches instead of
     * blocking the browser for one huge DOM
     * operation.
     */
    renderResultBatch(
        startIndex,
        expandFirst
    ) {

        const container =
            $("resultBoxes");

        if (!container) {
            return;
        }


        const BATCH =
            100;


        const end =
            Math.min(
                startIndex +
                    BATCH,

                state.items.length
            );


        let html = "";


        for (
            let i =
                startIndex;

            i < end;

            i++
        ) {

            const entry =
                state.items[i];

            const item =
                entry.item;


            const open =
                expandFirst &&
                item.status !==
                    "NO CHANGE";


            html +=
                this.boxHtml(
                    entry.id,
                    item,
                    open
                );
        }


        container.insertAdjacentHTML(
            "beforeend",
            html
        );


        if (
            expandFirst &&
            startIndex === 0
        ) {

            container
                .querySelectorAll(
                    ".ssn-result-box"
                )
                .forEach(box => {

                    if (
                        box.dataset.open === "1"
                    ) {

                        this.setBox(
                            box,
                            true
                        );
                    }
                });
        }


        if (
            end <
            state.items.length
        ) {

            requestAnimationFrame(
                () => {

                    this.renderResultBatch(
                        end,
                        false
                    );
                }
            );
        }
    },


    searchText(item) {

        const parts = [
            item.ssn,
            item.employee_name,
            item.status,
            item.message
        ];


        for (
            const rec
            of (
                item.records ||
                []
            )
        ) {

            parts.push(
                rec.record_type,
                rec.name,
                rec.status
            );


            for (
                const ch
                of (
                    rec.changes ||
                    []
                )
            ) {

                parts.push(
                    ch.field,
                    ch.column
                );
            }
        }


        return parts
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
    },


    statusClass(status) {

        return (
            "status-" +
            String(
                status
            )
                .toLowerCase()
                .replace(
                    /\s+/g,
                    "-"
                )
        );
    },


    boxHtml(
        id,
        item,
        open
    ) {

        const counts =
            item.record_counts ||
            {};

        const bits = [];


        if (
            item.change_count
        ) {

            bits.push(
                `${item.change_count} field change` +
                (
                    item.change_count === 1
                        ? ""
                        : "s"
                )
            );
        }


        if (
            counts.NEW &&
            item.status !== "NEW" &&
            item.status !== "EXTRA"
        ) {

            bits.push(
                `${counts.NEW} new record` +
                (
                    counts.NEW > 1
                        ? "s"
                        : ""
                )
            );
        }


        if (
            counts.MISSING &&
            item.status !== "MISSING"
        ) {

            bits.push(
                `${counts.MISSING} missing record` +
                (
                    counts.MISSING > 1
                        ? "s"
                        : ""
                )
            );
        }


        return `
        <article
            class="ssn-result-box"
            data-id="${id}"
            data-status="${esc(item.status)}"
            data-open="${open ? 1 : 0}">

            <div class="ssn-result-header">

                <div class="ssn-select-area">

                    <input
                        type="checkbox"
                        class="ssn-checkbox"
                        title="Select for Copy Selected">

                    <button
                        type="button"
                        class="ssn-expand-btn"
                        aria-expanded="false">
                        &#9654;
                    </button>

                </div>


                <div class="ssn-main-info">

                    <div class="ssn-number">
                        SSN:
                        <strong>
                            ${esc(item.ssn)}
                        </strong>
                    </div>

                    <div class="employee-name">
                        ${esc(
                            item.employee_name ||
                            ""
                        )}
                    </div>

                </div>


                <div class="ssn-status-area">

                    <span
                        class="status-badge ${this.statusClass(item.status)}">
                        ${esc(item.status)}
                    </span>

                    <span class="change-count">
                        ${esc(bits.join(" | "))}
                    </span>

                </div>


                <div class="ssn-box-actions">

                    <button
                        type="button"
                        class="copy-ssn-btn">
                        Copy
                    </button>

                    <button
                        type="button"
                        class="minimize-ssn-btn">
                        Expand
                    </button>

                </div>

            </div>


            <div
                class="ssn-result-content collapsed"
                data-rendered="0">
            </div>

        </article>`;
    },


    setBox(
        box,
        expand
    ) {

        const content =
            box.querySelector(
                ".ssn-result-content"
            );

        const arrow =
            box.querySelector(
                ".ssn-expand-btn"
            );

        const label =
            box.querySelector(
                ".minimize-ssn-btn"
            );


        if (
            expand &&
            content.dataset.rendered !== "1"
        ) {

            const {
                item
            } =
                state.items[
                    Number(
                        box.dataset.id
                    )
                ];


            content.innerHTML =
                this.boxBody(
                    item
                );


            content.dataset.rendered =
                "1";
        }


        content.classList.toggle(
            "collapsed",
            !expand
        );


        arrow.innerHTML =
            expand
                ? "&#9660;"
                : "&#9654;";


        arrow.setAttribute(
            "aria-expanded",
            expand
                ? "true"
                : "false"
        );


        label.textContent =
            expand
                ? "Minimize"
                : "Expand";
    },


    onResultClick(e) {

        const box =
            e.target.closest(
                ".ssn-result-box"
            );

        if (!box) {
            return;
        }


        const id =
            Number(
                box.dataset.id
            );


        if (
            e.target.closest(
                ".ssn-checkbox"
            )
        ) {

            if (
                e.target.checked
            ) {

                state.selected.add(
                    id
                );

            } else {

                state.selected.delete(
                    id
                );
            }

            return;
        }


        if (
            e.target.closest(
                ".copy-ssn-btn"
            )
        ) {

            this.copyItems(
                [
                    state.items[id]
                        .item
                ],

                `Copied SSN ${state.items[id].item.ssn}`
            );

            return;
        }


        if (
            e.target.closest(
                ".ssn-result-header"
            )
        ) {

            const content =
                box.querySelector(
                    ".ssn-result-content"
                );

            this.setBox(
                box,
                content.classList.contains(
                    "collapsed"
                )
            );
        }
    },


    setAllBoxes(expand) {

        document
            .querySelectorAll(
                ".ssn-result-box"
            )
            .forEach(box => {

                if (box.hidden) {
                    return;
                }

                this.setBox(
                    box,
                    expand
                );
            });
    },


    boxBody(item) {

        if (
            item.status === "ERROR"
        ) {

            return `
                <div class="error-note">
                    ${esc(
                        item.message ||
                        "This SSN could not be processed."
                    )}
                </div>

                ${this.sourceHtml(item)}
            `;
        }


        const employees =
            (
                item.records ||
                []
            )
                .filter(
                    r =>
                        r.kind ===
                        "employee"
                );


        const dependents =
            (
                item.records ||
                []
            )
                .filter(
                    r =>
                        r.kind ===
                        "dependent"
                );


        let html = "";


        if (
            item.message &&
            item.status === "EXTRA"
        ) {

            html += `
                <div
                    class="error-note"
                    style="background:#f5f3ff;color:#6d28d9">

                    ${esc(
                        item.message
                    )}

                </div>`;
        }


        if (
            employees.length
        ) {

            html +=
                `<div class="group-title">
                    Employee
                </div>`;


            html +=
                employees
                    .map(
                        (r, i) =>
                            this.recordHtml(
                                r,
                                employees.length > 1
                                    ? i + 1
                                    : 0
                            )
                    )
                    .join("");
        }


        if (
            dependents.length
        ) {

            html +=
                `<div class="group-title">
                    Dependents
                </div>`;


            html +=
                dependents
                    .map(
                        (r, i) =>
                            this.recordHtml(
                                r,
                                i + 1
                            )
                    )
                    .join("");
        }


        return (
            html +
            this.sourceHtml(
                item
            )
        );
    },


    recordLabel(
        rec,
        n
    ) {

        if (
            rec.kind ===
            "dependent"
        ) {

            return `Dependent ${n}`;
        }

        return n
            ? `Employee ${n}`
            : "Employee";
    },


    recordHtml(
        rec,
        n
    ) {

        const title =
            this.recordLabel(
                rec,
                n
            );


        const rows =
            (
                rec.changes ||
                []
            )
                .map(
                    ch => {

                        const label =
                            ch.status === "CHANGED"
                                ? "CHANGED"
                                : ch.status;

                        const cls =
                            ch.status === "CHANGED"
                                ? "status-what-changed"
                                : this.statusClass(
                                    ch.status
                                );


                        const oldTxt =
                            ch.old_value === ""
                                ? `
                                    <td class="old-val empty-val">
                                        (empty)
                                    </td>`
                                : `
                                    <td class="old-val">
                                        ${esc(
                                            ch.old_value
                                        )}
                                    </td>`;


                        const newTxt =
                            ch.new_value === ""
                                ? `
                                    <td class="new-val empty-val">
                                        (empty)
                                    </td>`
                                : `
                                    <td class="new-val">
                                        ${esc(
                                            ch.new_value
                                        )}
                                    </td>`;


                        return `
                        <tr>

                            <td class="col-field">
                                ${esc(ch.field)}
                            </td>

                            ${oldTxt}

                            ${newTxt}

                            <td>
                                <span
                                    class="table-status ${cls}">
                                    ${esc(label)}
                                </span>
                            </td>

                        </tr>`;
                    }
                )
                .join("");


        const body =
            rec.status === "NO CHANGE"

                ? `
                    <div class="record-empty">
                        No changes. All values are identical in Old and New Excel.
                    </div>`

                : `
                    <div
                        class="comparison-table-wrapper"
                        style="border:0;border-radius:0">

                        <table
                            class="comparison-table">

                            <thead>
                                <tr>
                                    <th>Field</th>
                                    <th>Old Excel</th>
                                    <th>New Excel</th>
                                    <th>Status</th>
                                </tr>
                            </thead>

                            <tbody>
                                ${rows}
                            </tbody>

                        </table>

                    </div>`;


        const meta = [
            rec.old_row
                ? `Old row ${rec.old_row}`
                : "Not in Old",

            rec.new_row
                ? `New row ${rec.new_row}`
                : "Not in New"

        ].join(" | ");


        return `
        <section class="record-block">

            <div class="record-head">

                <span class="record-title">
                    ${esc(title)}

                    ${
                        rec.name
                            ? " - " +
                              esc(rec.name)
                            : ""
                    }

                </span>

                <span class="muted">
                    [${esc(
                        rec.record_type
                    )}]
                </span>

                <span
                    class="table-status ${this.statusClass(rec.status)}">
                    ${esc(
                        rec.status
                    )}
                </span>

                <span class="record-meta">
                    ${esc(meta)}
                </span>

            </div>

            ${body}

            ${this.fullRowHtml(rec)}

        </section>`;
    },


    fullRowHtml(rec) {

        const columns =
            (
                state.data &&
                state.data.columns
            ) || [];


        const letters =
            Object.keys(
                rec.old_values ||
                {}
            ).concat(
                Object.keys(
                    rec.new_values ||
                    {}
                )
            );


        let widest = 0;


        for (
            const l of letters
        ) {

            let n = 0;

            for (
                const ch of l
            ) {

                n =
                    n * 26 +
                    (
                        ch.charCodeAt(0) -
                        64
                    );
            }

            widest =
                Math.max(
                    widest,
                    n
                );
        }


        if (!widest) {
            return "";
        }


        const shown =
            columns.slice(
                0,
                widest
            );


        const changed =
            new Set(
                rec.changed_columns ||
                []
            );


        const head =
            shown
                .map(
                    c =>
                        `<th title="${esc(c.title)}">
                            ${esc(c.column)}
                            ${
                                c.title !==
                                "Column " +
                                c.column
                                    ? `<br><small>
                                        ${esc(c.title)}
                                       </small>`
                                    : ""
                            }
                        </th>`
                )
                .join("");


        const line =
            (
                label,
                values,
                markDiff
            ) => {

                return `
                    <tr>
                        <td class="rowlabel">
                            ${esc(label)}
                        </td>

                        ${
                            shown
                                .map(
                                    c =>
                                        `<td class="${
                                            markDiff &&
                                            changed.has(
                                                c.column
                                            )
                                                ? "diff"
                                                : ""
                                        }">
                                            ${esc(
                                                values[
                                                    c.column
                                                ] ||
                                                ""
                                            )}
                                        </td>`
                                )
                                .join("")
                        }

                    </tr>`;
            };


        return `
        <details class="full-row">

            <summary>
                Full row view (Excel columns)
            </summary>

            <div class="mini-grid-wrap">

                <table class="mini-grid">

                    <thead>
                        <tr>
                            <th></th>
                            ${head}
                        </tr>
                    </thead>

                    <tbody>

                        ${line(
                            rec.old_row
                                ? `Old (row ${rec.old_row})`
                                : "Old",

                            rec.old_values ||
                                {},

                            true
                        )}

                        ${line(
                            rec.new_row
                                ? `New (row ${rec.new_row})`
                                : "New",

                            rec.new_values ||
                                {},

                            true
                        )}

                    </tbody>

                </table>

            </div>

        </details>`;
    },


    sourceHtml(item) {

        return `
        <section class="source-section">

            <div>
                Old Sheet:
                <strong>
                    ${esc(
                        item.selected_old_sheet
                    )}
                </strong>
            </div>

            <div>
                New Sheet:
                <strong>
                    ${esc(
                        item.selected_new_sheet
                    )}
                </strong>
            </div>

            <div>
                Scenario Sheet:
                <strong>
                    ${esc(
                        item.selected_scenario_sheet
                    )}
                </strong>
            </div>

        </section>`;
    },


    /* ========================================================
       FILTER / SEARCH
    ======================================================== */

    applyFilters() {

        const status =
            $("statusFilter")
                .value;


        const q =
            $("resultSearch")
                .value
                .trim()
                .toLowerCase();


        state.statusFilter =
            status;


        let visible =
            0;


        document
            .querySelectorAll(
                ".ssn-result-box"
            )
            .forEach(box => {

                const entry =
                    state.items[
                        Number(
                            box.dataset.id
                        )
                    ];


                const okStatus =
                    status === "ALL" ||
                    entry.item.status ===
                        status;


                const okSearch =
                    !q ||
                    entry.search.includes(
                        q
                    );


                box.hidden =
                    !(
                        okStatus &&
                        okSearch
                    );


                if (!box.hidden) {
                    visible++;
                }
            });


        $("visibleResultCount")
            .textContent =
                `${visible} of ${state.items.length} results`;


        $("noResultsMessage")
            .hidden =
                visible > 0 ||
                !state.items.length;


        document
            .querySelectorAll(
                ".summary-card[data-filter]"
            )
            .forEach(card => {

                card.classList.toggle(
                    "active-filter",
                    card.dataset.filter ===
                        status
                );
            });
    },


    /* ========================================================
       COPY RESULTS
    ======================================================== */

    itemRows(item) {

        const rows = [];


        if (
            item.status ===
            "ERROR"
        ) {

            rows.push([
                item.ssn,
                item.status,
                "-",
                "-",
                "-",
                "-",
                item.message ||
                    ""
            ]);

            return rows;
        }


        const dependents =
            (
                item.records ||
                []
            )
                .filter(
                    r =>
                        r.kind ===
                        "dependent"
                );


        const employees =
            (
                item.records ||
                []
            )
                .filter(
                    r =>
                        r.kind ===
                        "employee"
                );


        const add =
            (
                rec,
                label
            ) => {

                for (
                    const ch
                    of (
                        rec.changes ||
                        []
                    )
                ) {

                    rows.push([
                        item.ssn,
                        item.status,
                        label,
                        ch.field,
                        ch.old_value,
                        ch.new_value,
                        ch.status
                    ]);
                }
            };


        employees.forEach(
            (r, i) =>
                add(
                    r,
                    this.recordLabel(
                        r,
                        employees.length > 1
                            ? i + 1
                            : 0
                    )
                )
        );


        dependents.forEach(
            (r, i) =>
                add(
                    r,
                    this.recordLabel(
                        r,
                        i + 1
                    )
                )
        );


        if (!rows.length) {

            rows.push([
                item.ssn,
                item.status,
                "-",
                "-",
                "-",
                "-",
                "-"
            ]);
        }


        return rows;
    },


    async copyItems(
        items,
        doneMessage
    ) {

        const header = [
            "SSN",
            "Status",
            "Record",
            "Field",
            "Old Value",
            "New Value",
            "Field Status"
        ];


        const matrix =
            [header];


        items.forEach(
            item => {

                matrix.push(
                    ...this.itemRows(
                        item
                    )
                );
            }
        );


        const text =
            toTSV(
                matrix
            );


        const ok =
            await copyText(
                text
            );


        if (ok) {

            toast(
                doneMessage ||
                `Copied ${items.length} SSN(s)`
            );

        } else {

            $("copyPreview")
                .value =
                    text;

            $("copyPreviewSection")
                .hidden =
                    false;

            toast(
                "Automatic copy was blocked. Select the text in Copy Preview and press Ctrl+C.",
                true
            );
        }
    },


    copySelected() {

        const items =
            state.items
                .filter(
                    e =>
                        state.selected
                            .has(
                                e.id
                            )
                )
                .map(
                    e =>
                        e.item
                );


        if (!items.length) {

            toast(
                "Tick at least one SSN box first.",
                true
            );

            return;
        }


        this.copyItems(
            items,
            `Copied ${items.length} selected SSN(s)`
        );
    },


    copyAll() {

        const visibleIds =
            new Set();


        document
            .querySelectorAll(
                ".ssn-result-box"
            )
            .forEach(box => {

                if (!box.hidden) {

                    visibleIds.add(
                        Number(
                            box.dataset.id
                        )
                    );
                }
            });


        const items =
            state.items
                .filter(
                    e =>
                        visibleIds.has(
                            e.id
                        )
                )
                .map(
                    e =>
                        e.item
                );


        if (!items.length) {

            toast(
                "No results to copy.",
                true
            );

            return;
        }


        this.copyItems(
            items,
            `Copied ${items.length} SSN(s) (current filter)`
        );
    }
};


/* ============================================================
   DOM READY
============================================================ */

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        () =>
            app.init()
    );

} else {

    app.init();
}