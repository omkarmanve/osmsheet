"use strict";

// ============================================
// DOM ELEMENTS
// ============================================

const ediInput = document.getElementById("ediInput");
const processBtn = document.getElementById("processBtn");
const statusMessage = document.getElementById("statusMessage");

const recordSeparator = document.getElementById("recordSeparator");
const fieldSeparator = document.getElementById("fieldSeparator");
const customRecordSeparator = document.getElementById("customRecordSeparator");
const customFieldSeparator = document.getElementById("customFieldSeparator");

const resultTable = document.getElementById("resultTable");
const tableHead = resultTable.querySelector("thead");
const tableBody = resultTable.querySelector("tbody");

const summary = document.getElementById("summary");
const errorsList = document.getElementById("errorsList");
const warningsList = document.getElementById("warningsList");

const cellAddress = document.getElementById("cellAddress");
const formulaInput = document.getElementById("formulaInput");
const selectionInfo = document.getElementById("selectionInfo");
const rowCount = document.getElementById("rowCount");
const zoomLabel = document.getElementById("zoomLabel");

const sequenceList = document.getElementById("sequenceList");
const newSequenceType = document.getElementById("newSequenceType");
const addSequenceBtn = document.getElementById("addSequenceBtn");
const applySequenceBtn = document.getElementById("applySequenceBtn");
const resetSequenceBtn = document.getElementById("resetSequenceBtn");
const sequenceStatus = document.getElementById("sequenceStatus");

// ============================================
// APPLICATION STATE
// ============================================

let currentColumns = [];
let currentRows = [];

let originalColumns = [];
let originalRows = [];

let zoomLevel = 1;
let wrapEnabled = false;
let selectedCell = null;
let columnWidths = {};

let columnFilters = {};
let columnSearches = {};
let rowSearchValue = "";

const DEFAULT_SEQUENCE = [
    "EE RECORD",
    "DEPENDENT RECORD",
    "18*",
    "01*",
    "19*",
    "53*",
    "N*",
    "REF",
    "NM1",
    "PER",
    "N3",
    "N4",
    "DMG",
    "HD",
    "DTP",
    "REF"
];

let sequenceTypes = [...DEFAULT_SEQUENCE];

// ============================================
// EXCEL COLUMN NAME
// ============================================

function excelColumnName(index) {
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

// ============================================
// FILTER STYLES
// ============================================

(function addFilterStyles() {
    if (document.getElementById("tableFilterStyles")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "tableFilterStyles";

    style.textContent = `
        #resultTable th.filterable-header {
            min-width: 145px;
            padding: 4px;
            vertical-align: top;
            position: relative;
        }

        #resultTable .column-header-content {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }

        #resultTable .column-header-label {
            text-align: center;
            font-weight: 600;
        }

        #resultTable select.column-filter {
            display: block;
            width: 100%;
            min-width: 0;
            height: 25px;
            padding: 2px 4px;
            border: 1px solid #c8cec8;
            border-radius: 3px;
            background: #fff;
            color: #202124;
            font-size: 11px;
            cursor: pointer;
        }

        #resultTable select.column-filter:focus {
            outline: 2px solid #217346;
            outline-offset: -1px;
        }

        #resultTable input.table-search {
            display: block;
            box-sizing: border-box;
            width: 100%;
            min-width: 0;
            height: 23px;
            padding: 2px 5px;
            border: 1px solid #c8cec8;
            border-radius: 3px;
            background: #fff;
            color: #202124;
            font-size: 11px;
        }

        #resultTable input.table-search:focus {
            outline: 2px solid #217346;
            outline-offset: -1px;
        }

        #resultTable thead tr.search-row th {
            position: sticky;
            top: 0;
            z-index: 10;
            box-sizing: border-box;
            height: 31px;
            padding: 3px 4px;
            background: #f8faf8;
            font-weight: normal;
            border-bottom: 1px solid #c8cec8;
        }

        #resultTable thead tr.search-row th.row-number {
            left: 0;
            z-index: 13;
        }

        #resultTable thead tr.header-row th {
            position: sticky;
            top: 31px;
            z-index: 8;
        }

        #resultTable thead tr.header-row th.row-number {
            left: 0;
            z-index: 12;
        }

        #resultTable .resize-handle {
            position: absolute;
            right: 0;
            top: 0;
            width: 5px;
            height: 100%;
            cursor: col-resize;
            z-index: 20;
        }

        #resultTable .resize-handle:hover {
            background: #217346;
        }
    `;

    document.head.appendChild(style);
})();

// ============================================
// NORMALIZE SEARCH
// ============================================

function normalizeSearchText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}

// ============================================
// COLUMN DROPDOWN FILTER
// ============================================

function getColumnFilterValue(columnIndex) {
    return columnFilters[columnIndex] ?? "";
}

function createColumnFilter(column, columnIndex) {
    const filter = document.createElement("select");

    filter.className = "column-filter";

    filter.title =
        `Filter column ${excelColumnName(columnIndex)}`;

    filter.setAttribute(
        "aria-label",
        `Filter column ${excelColumnName(columnIndex)}`
    );

    const allOption = document.createElement("option");

    allOption.value = "";
    allOption.textContent = "All";

    filter.appendChild(allOption);

    const uniqueValues = [
        ...new Set(
            currentRows.map(row =>
                String(row[column] ?? "")
            )
        )
    ].sort((a, b) =>
        a.localeCompare(b)
    );

    uniqueValues.forEach(value => {
        const option = document.createElement("option");

        option.value = value;

        option.textContent =
            value === ""
                ? "(Blank)"
                : value;

        filter.appendChild(option);
    });

    filter.value =
        getColumnFilterValue(columnIndex);

    if (
        ![...filter.options].some(
            option =>
                option.value === filter.value
        )
    ) {
        filter.value = "";
        delete columnFilters[columnIndex];
    }

    filter.addEventListener("change", () => {

        if (filter.value === "") {
            delete columnFilters[columnIndex];
        } else {
            columnFilters[columnIndex] =
                filter.value;
        }

        applyTableSearchAndFilters();
    });

    filter.addEventListener(
        "click",
        event => event.stopPropagation()
    );

    filter.addEventListener(
        "mousedown",
        event => event.stopPropagation()
    );

    return filter;
}

// ============================================
// COLUMN SEARCH
// ============================================

function createColumnSearchInput(columnIndex) {
    const input =
        document.createElement("input");

    const columnName =
        excelColumnName(columnIndex);

    input.type = "search";

    input.className =
        "table-search column-search";

    input.placeholder =
        `🔍 ${columnName}`;

    input.title =
        `Search column ${columnName}`;

    input.setAttribute(
        "aria-label",
        `Search column ${columnName}`
    );

    input.autocomplete = "off";

    input.value =
        columnSearches[columnIndex] ?? "";

    input.addEventListener("input", () => {

        const value =
            input.value.trim();

        if (value === "") {
            delete columnSearches[columnIndex];
        } else {
            columnSearches[columnIndex] =
                input.value;
        }

        applyTableSearchAndFilters();
    });

    input.addEventListener(
        "click",
        event => event.stopPropagation()
    );

    input.addEventListener(
        "mousedown",
        event => event.stopPropagation()
    );

    return input;
}

// ============================================
// ROW SEARCH
// ============================================

function createRowSearchInput() {
    const input =
        document.createElement("input");

    input.type = "search";

    input.className =
        "table-search row-search";

    input.placeholder =
        "🔍 Row";

    input.title =
        "Search exact row number or row data";

    input.setAttribute(
        "aria-label",
        "Search rows"
    );

    input.autocomplete = "off";

    input.value =
        rowSearchValue;

    input.addEventListener("input", () => {

        rowSearchValue =
            input.value;

        applyTableSearchAndFilters();
    });

    input.addEventListener(
        "click",
        event => event.stopPropagation()
    );

    input.addEventListener(
        "mousedown",
        event => event.stopPropagation()
    );

    return input;
}

// ============================================
// BUILD SEARCH ROW
// ============================================

function buildSearchRow() {

    const searchRow =
        document.createElement("tr");

    searchRow.className =
        "search-row";

    // Row number search
    const rowSearchCell =
        document.createElement("th");

    rowSearchCell.className =
        "row-number row-search-cell";

    rowSearchCell.appendChild(
        createRowSearchInput()
    );

    searchRow.appendChild(
        rowSearchCell
    );

    // Column searches
    currentColumns.forEach(
        (column, columnIndex) => {

            const th =
                document.createElement("th");

            th.className =
                "column-search-cell";

            th.appendChild(
                createColumnSearchInput(
                    columnIndex
                )
            );

            searchRow.appendChild(th);
        }
    );

    return searchRow;
}

// ============================================
// COLUMN SEARCH MATCH
// ============================================

function matchesColumnSearch(
    row,
    column,
    columnIndex
) {
    const query =
        normalizeSearchText(
            columnSearches[columnIndex]
        );

    if (query === "") {
        return true;
    }

    return normalizeSearchText(
        row[column]
    ).includes(query);
}

// ============================================
// ROW SEARCH MATCH
// ============================================

function matchesRowSearch(
    row,
    rowIndex
) {
    const query =
        normalizeSearchText(
            rowSearchValue
        );

    if (query === "") {
        return true;
    }

    /*
     * IMPORTANT:
     *
     * Numeric search:
     *
     * 1  -> row 1 only
     * 2  -> row 2 only
     * 10 -> row 10 only
     *
     * 1 will NOT match:
     * 10
     * 11
     * 12
     * etc.
     */

    if (/^\d+$/.test(query)) {

        const actualRowNumber =
            String(rowIndex + 1);

        return actualRowNumber === query;
    }

    /*
     * If search is text,
     * search in all cells of the row.
     */

    return currentColumns.some(
        column =>
            normalizeSearchText(
                row[column]
            ).includes(query)
    );
}

// ============================================
// COMPLETE ROW FILTER
// ============================================

function rowPassesTableFilters(
    rowIndex
) {
    const row =
        currentRows[rowIndex];

    if (!row) {
        return false;
    }

    // Row-number / row-data search
    if (
        !matchesRowSearch(
            row,
            rowIndex
        )
    ) {
        return false;
    }

    // Every column filter/search must pass
    return currentColumns.every(
        (column, columnIndex) => {

            // Dropdown filter
            const selectedValue =
                getColumnFilterValue(
                    columnIndex
                );

            if (
                selectedValue !== "" &&
                String(
                    row[column] ?? ""
                ) !== selectedValue
            ) {
                return false;
            }

            // Column search
            return matchesColumnSearch(
                row,
                column,
                columnIndex
            );
        }
    );
}

// Expose for validation.js / logic.js
window.ediColumnFilterMatchesRow =
    rowPassesTableFilters;

// ============================================
// APPLY ALL FILTERS
// ============================================

function applyTableSearchAndFilters() {

    const rows =
        tableBody.querySelectorAll("tr");

    rows.forEach(
        (tr, fallbackIndex) => {

            /*
             * Use stored original row index.
             * This is important after filtering.
             */

            let rowIndex =
                fallbackIndex;

            if (
                tr.dataset.rowIndex !==
                undefined
            ) {
                const parsed =
                    Number(
                        tr.dataset.rowIndex
                    );

                if (
                    Number.isInteger(
                        parsed
                    )
                ) {
                    rowIndex =
                        parsed;
                }
            }

            const show =
                rowPassesTableFilters(
                    rowIndex
                );

            tr.style.display =
                show ? "" : "none";
        }
    );

    const visibleCount =
        [...rows].filter(
            tr =>
                tr.style.display !==
                "none"
        ).length;

    rowCount.textContent =
        `${visibleCount} of ${currentRows.length} rows`;

    document.dispatchEvent(
        new Event(
            "ediColumnFiltersChanged"
        )
    );
}

// ============================================
// APPLY COLUMN FILTERS
// ============================================

function applyColumnFilters() {
    applyTableSearchAndFilters();
}

// ============================================
// RENDER TABLE
// ============================================

function renderTable() {

    tableHead.replaceChildren();
    tableBody.replaceChildren();

    formulaInput.value = "";
    cellAddress.value = "";

    // Search row
    tableHead.appendChild(
        buildSearchRow()
    );

    // ========================================
    // HEADER ROW
    // ========================================

    const headerRow =
        document.createElement("tr");

    headerRow.className =
        "header-row";

    const corner =
        document.createElement("th");

    corner.className =
        "row-number";

    corner.textContent = "";

    headerRow.appendChild(
        corner
    );

    currentColumns.forEach(
        (column, columnIndex) => {

            const th =
                document.createElement("th");

            const columnName =
                excelColumnName(
                    columnIndex
                );

            th.title =
                `Column ${columnName}`;

            th.classList.add(
                "filterable-header"
            );

            const headerContent =
                document.createElement("div");

            headerContent.className =
                "column-header-content";

            const headerLabel =
                document.createElement("div");

            headerLabel.className =
                "column-header-label";

            headerLabel.textContent =
                columnName;

            const filter =
                createColumnFilter(
                    column,
                    columnIndex
                );

            const handle =
                document.createElement("div");

            handle.className =
                "resize-handle";

            handle.addEventListener(
                "mousedown",
                event => {

                    startResize(
                        event,
                        columnIndex
                    );
                }
            );

            headerContent.appendChild(
                headerLabel
            );

            headerContent.appendChild(
                filter
            );

            th.appendChild(
                headerContent
            );

            th.appendChild(
                handle
            );

            headerRow.appendChild(
                th
            );
        }
    );

    tableHead.appendChild(
        headerRow
    );

    // ========================================
    // DATA ROWS
    // ========================================

    currentRows.forEach(
        (row, rowIndex) => {

            const tr =
                document.createElement(
                    "tr"
                );

            /*
             * VERY IMPORTANT
             *
             * Store the real row index.
             *
             * Example:
             * original row 10 remains rowIndex = 9
             * even if rows 1-9 are hidden.
             */

            tr.dataset.rowIndex =
                String(rowIndex);

            // Row number
            const numberCell =
                document.createElement(
                    "th"
                );

            numberCell.className =
                "row-number";

            numberCell.textContent =
                rowIndex + 1;

            tr.appendChild(
                numberCell
            );

            // Cells
            currentColumns.forEach(
                (
                    column,
                    columnIndex
                ) => {

                    const td =
                        document.createElement(
                            "td"
                        );

                    td.textContent =
                        String(
                            row[column] ??
                            ""
                        );

                    td.dataset.row =
                        rowIndex;

                    td.dataset.column =
                        columnIndex;

                    td.addEventListener(
                        "click",
                        () => {

                            selectCell(
                                rowIndex,
                                columnIndex
                            );
                        }
                    );

                    tr.appendChild(
                        td
                    );
                }
            );

            tableBody.appendChild(
                tr
            );
        }
    );

    applyColumnWidths();
    applyZoom();

    resultTable.classList.toggle(
        "wrap-text",
        wrapEnabled
    );

    // Apply all filters
    applyTableSearchAndFilters();

    if (
        currentRows.length > 0 &&
        currentColumns.length > 0
    ) {
        selectCell(
            0,
            0
        );
    } else {

        selectedCell =
            null;

        selectionInfo.textContent =
            "No data";
    }
}

// ============================================
// SELECT CELL
// ============================================

function selectCell(
    rowIndex,
    columnIndex
) {

    resultTable
        .querySelectorAll(
            ".selected-cell, .selected-column"
        )
        .forEach(
            element => {

                element.classList.remove(
                    "selected-cell",
                    "selected-column"
                );
            }
        );

    const cell =
        tableBody.querySelector(
            `td[data-row="${rowIndex}"][data-column="${columnIndex}"]`
        );

    const heading =
        tableHead.querySelectorAll(
            "tr.header-row th"
        )[columnIndex + 1];

    if (!cell) {
        return;
    }

    cell.classList.add(
        "selected-cell"
    );

    if (heading) {
        heading.classList.add(
            "selected-column"
        );
    }

    selectedCell = {
        rowIndex,
        columnIndex
    };

    const address =
        excelColumnName(
            columnIndex
        ) +
        (rowIndex + 1);

    cellAddress.value =
        address;

    formulaInput.value =
        cell.textContent;

    selectionInfo.textContent =
        `Selected ${address}`;

    cell.scrollIntoView({
        block: "nearest",
        inline: "nearest"
    });
}

// ============================================
// RESIZE COLUMNS
// ============================================

function startResize(
    event,
    columnIndex
) {

    event.preventDefault();
    event.stopPropagation();

    const th =
        event.currentTarget.parentElement;

    const startX =
        event.clientX;

    const startWidth =
        th.getBoundingClientRect()
            .width;

    function onMouseMove(
        moveEvent
    ) {

        const newWidth =
            Math.max(
                45,
                Math.min(
                    600,
                    startWidth +
                    moveEvent.clientX -
                    startX
                )
            );

        columnWidths[
            columnIndex
        ] =
            newWidth;

        applyColumnWidths();
    }

    function onMouseUp() {

        document.removeEventListener(
            "mousemove",
            onMouseMove
        );

        document.removeEventListener(
            "mouseup",
            onMouseUp
        );
    }

    document.addEventListener(
        "mousemove",
        onMouseMove
    );

    document.addEventListener(
        "mouseup",
        onMouseUp
    );
}

// ============================================
// APPLY COLUMN WIDTHS
// ============================================

function applyColumnWidths() {

    const headerCells =
        tableHead.querySelectorAll(
            "tr.header-row th"
        );

    const searchCells =
        tableHead.querySelectorAll(
            "tr.search-row th"
        );

    currentColumns.forEach(
        (column, index) => {

            const width =
                columnWidths[index] ||
                145;

            const cells = [
                headerCells[
                    index + 1
                ],

                searchCells[
                    index + 1
                ]
            ];

            cells.forEach(
                cell => {

                    if (cell) {

                        cell.style.width =
                            `${width}px`;

                        cell.style.minWidth =
                            `${width}px`;

                        cell.style.maxWidth =
                            `${width}px`;
                    }
                }
            );

            tableBody
                .querySelectorAll(
                    "tr"
                )
                .forEach(
                    tr => {

                        const cell =
                            tr.children[
                                index + 1
                            ];

                        if (cell) {

                            cell.style.width =
                                `${width}px`;

                            cell.style.minWidth =
                                `${width}px`;

                            cell.style.maxWidth =
                                `${width}px`;
                        }
                    }
                );
        }
    );
}

// ============================================
// PROCESS EDI DATA
// ============================================

if (processBtn) {

    processBtn.addEventListener(
        "click",
        processData
    );
}

async function processData() {

    const data =
        ediInput.value.trim();

    if (!data) {

        statusMessage.textContent =
            "Please paste EDI data first.";

        return;
    }

    processBtn.disabled =
        true;

    statusMessage.textContent =
        "Processing data...";

    try {

        const response =
            await fetch(
                "/api/process",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        data,

                        record_separator:
                            recordSeparator.value,

                        field_separator:
                            fieldSeparator.value,

                        custom_record_separator:
                            customRecordSeparator.value,

                        custom_field_separator:
                            customFieldSeparator.value
                    })
                }
            );

        const result =
            await response.json();

        if (!response.ok) {

            throw new Error(
                result.detail ||
                "Unable to process EDI data."
            );
        }

        if (
            !Array.isArray(
                result.columns
            )
        ) {

            throw new Error(
                "Invalid API response: columns must be an array."
            );
        }

        if (
            !Array.isArray(
                result.rows
            )
        ) {

            throw new Error(
                "Invalid API response: rows must be an array."
            );
        }

        originalColumns =
            [...result.columns];

        originalRows =
            result.rows.map(
                row => ({
                    ...row
                })
            );

        currentColumns =
            [...originalColumns];

        currentRows =
            originalRows.map(
                row => ({
                    ...row
                })
            );

        columnWidths = {};
        columnFilters = {};
        columnSearches = {};
        rowSearchValue = "";
        selectedCell = null;

        renderTable();
        renderMessages(result);

        summary.textContent =
            `Records: ${
                result.record_count ??
                currentRows.length
            } | Employees: ${
                result.employee_count ??
                0
            } | Dependents: ${
                result.dependent_count ??
                0
            }`;

        rowCount.textContent =
            `${currentRows.length} rows`;

        selectionInfo.textContent =
            `${currentRows.length} rows × ${currentColumns.length} columns`;

        statusMessage.textContent =
            "Data loaded successfully.";

        sequenceStatus.textContent =
            "Data loaded. You can now apply a column sequence.";

    } catch (error) {

        console.error(
            "EDI processing error:",
            error
        );

        statusMessage.textContent =
            error.message ||
            "An unexpected error occurred.";

    } finally {

        processBtn.disabled =
            false;
    }
}

// ============================================
// RENDER ERRORS / WARNINGS
// ============================================

function renderMessages(result) {

    errorsList.replaceChildren();
    warningsList.replaceChildren();

    (result.errors || [])
        .forEach(message => {

            const li =
                document.createElement(
                    "li"
                );

            li.textContent =
                message;

            errorsList.appendChild(
                li
            );
        });

    (result.warnings || [])
        .forEach(message => {

            const li =
                document.createElement(
                    "li"
                );

            li.textContent =
                message;

            warningsList.appendChild(
                li
            );
        });
}

// ============================================
// AUTOFIT
// ============================================

const autoFitBtn =
    document.getElementById(
        "autoFitBtn"
    );

if (autoFitBtn) {

    autoFitBtn.addEventListener(
        "click",
        () => {

            currentColumns.forEach(
                (
                    column,
                    columnIndex
                ) => {

                    let maxLength =
                        excelColumnName(
                            columnIndex
                        ).length;

                    currentRows.forEach(
                        row => {

                            maxLength =
                                Math.max(
                                    maxLength,

                                    String(
                                        row[
                                            column
                                        ] ??
                                        ""
                                    ).length
                                );
                        }
                    );

                    columnWidths[
                        columnIndex
                    ] =
                        Math.max(
                            70,
                            Math.min(
                                600,
                                maxLength *
                                    8 +
                                    22
                            )
                        );
                }
            );

            applyColumnWidths();
        }
    );
}

// ============================================
// RESET WIDTHS
// ============================================

const resetWidthsBtn =
    document.getElementById(
        "resetWidthsBtn"
    );

if (resetWidthsBtn) {

    resetWidthsBtn.addEventListener(
        "click",
        () => {

            columnWidths = {};

            applyColumnWidths();
        }
    );
}

// ============================================
// WRAP TEXT
// ============================================

const wrapBtn =
    document.getElementById(
        "wrapBtn"
    );

if (wrapBtn) {

    wrapBtn.addEventListener(
        "click",
        () => {

            wrapEnabled =
                !wrapEnabled;

            resultTable.classList.toggle(
                "wrap-text",
                wrapEnabled
            );
        }
    );
}

// ============================================
// ZOOM
// ============================================

const zoomInBtn =
    document.getElementById(
        "zoomInBtn"
    );

const zoomOutBtn =
    document.getElementById(
        "zoomOutBtn"
    );

if (zoomInBtn) {

    zoomInBtn.addEventListener(
        "click",
        () => {

            zoomLevel =
                Math.min(
                    zoomLevel +
                        0.1,
                    2
                );

            applyZoom();
        }
    );
}

if (zoomOutBtn) {

    zoomOutBtn.addEventListener(
        "click",
        () => {

            zoomLevel =
                Math.max(
                    zoomLevel -
                        0.1,
                    0.5
                );

            applyZoom();
        }
    );
}

function applyZoom() {

    resultTable.style.fontSize =
        `${13 * zoomLevel}px`;

    if (zoomLabel) {

        zoomLabel.textContent =
            `${Math.round(
                zoomLevel * 100
            )}%`;
    }
}

// ============================================
// CLEAR
// ============================================

const clearBtn =
    document.getElementById(
        "clearBtn"
    );

if (clearBtn) {

    clearBtn.addEventListener(
        "click",
        () => {

            currentColumns = [];
            currentRows = [];

            originalColumns = [];
            originalRows = [];

            columnWidths = {};
            columnFilters = {};
            columnSearches = {};
            rowSearchValue = "";
            selectedCell = null;

            tableHead.replaceChildren();
            tableBody.replaceChildren();

            summary.textContent =
                "No data loaded";

            rowCount.textContent =
                "0 rows";

            selectionInfo.textContent =
                "Ready";

            cellAddress.value = "";
            formulaInput.value = "";

            errorsList.replaceChildren();
            warningsList.replaceChildren();

            sequenceStatus.textContent =
                "Process EDI data before applying a sequence.";

            statusMessage.textContent =
                "Results cleared.";
        }
    );
}

// ============================================
// EXPORT EXCEL
// ============================================

const exportBtn =
    document.getElementById(
        "exportBtn"
    );

if (exportBtn) {

    exportBtn.addEventListener(
        "click",
        () => {

            if (
                !currentColumns.length ||
                !currentRows.length
            ) {

                statusMessage.textContent =
                    "Process data before exporting.";

                return;
            }

            if (
                typeof XLSX ===
                "undefined"
            ) {

                statusMessage.textContent =
                    "Excel export library did not load.";

                return;
            }

            const exportData = [
                currentColumns.map(
                    (
                        column,
                        index
                    ) =>
                        excelColumnName(
                            index
                        )
                ),

                ...currentRows.map(
                    row =>
                        currentColumns.map(
                            column =>
                                row[
                                    column
                                ] == null
                                    ? ""
                                    : String(
                                        row[
                                            column
                                        ]
                                    )
                        )
                )
            ];

            const worksheet =
                XLSX.utils.aoa_to_sheet(
                    exportData
                );

            worksheet["!cols"] =
                currentColumns.map(
                    (
                        column,
                        index
                    ) => ({
                        wch:
                            Math.max(
                                12,
                                Math.min(
                                    60,
                                    (
                                        columnWidths[
                                            index
                                        ] ||
                                        145
                                    ) / 7
                                )
                            )
                    })
                );

            const workbook =
                XLSX.utils.book_new();

            XLSX.utils.book_append_sheet(
                workbook,
                worksheet,
                "EDI Data"
            );

            XLSX.writeFile(
                workbook,
                "OSM_mapped_dataomkar.xlsx"
            );

            statusMessage.textContent =
                "Excel file downloaded.";
        }
    );
}

// ============================================
// IMPORTANT
// ============================================

// Keep the rest of your existing sequence,
// validation and other project-specific
// functions below this point unchanged.