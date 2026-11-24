from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, time
from io import BytesIO
from typing import Any

from openpyxl import load_workbook


# =========================================================
# SETTINGS
# =========================================================

# A record whose "type" (first non-empty cell of the row) matches this
# pattern is shown under DEPENDENTS. Everything else is shown under EMPLOYEE.
# Change this if your sheets use different labels.
DEPENDENT_PATTERN = re.compile(r"dep|spouse|child|partner", re.IGNORECASE)

# Minimum share of equal cells for two rows to be treated as
# "the same record that was edited" (otherwise: MISSING + NEW).
SIMILARITY_THRESHOLD = 0.5

NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z.'\- ]{1,40}$")
NOT_A_NAME = {
    "ACTIVE", "TERMINATED", "INACTIVE", "M", "F", "MALE", "FEMALE", "Y", "N",
    "YES", "NO", "EMPLOYEE", "SPOUSE", "CHILD", "DEPENDENT", "SELF", "NEW",
    "OLD", "NONE", "NULL", "TRUE", "FALSE", "BASIC", "PREMIUM", "COBRA",
}


# =========================================================
# BASIC HELPERS
# =========================================================

def clean(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, datetime):
        if value.time() == time(0, 0):
            return value.date().isoformat()
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    return str(value).strip()


def normalise_ssn(value: Any) -> str:
    value = clean(value)
    if not value:
        return ""
    return value.replace("-", "").replace(" ", "").replace(".", "")


def looks_like_ssn(value: Any) -> bool:
    value = normalise_ssn(value)
    return len(value) == 9 and value.isdigit()


def column_letter(number: int) -> str:
    result = ""
    while number > 0:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def column_index(letter: str) -> int:
    number = 0
    for ch in letter:
        number = number * 26 + (ord(ch) - 64)
    return number


# =========================================================
# READ ONLY THE SELECTED SHEET
# =========================================================

def read_selected_sheet(
    file_bytes: bytes,
    filename: str,
    selected_sheet: str,
    header_row: int = 0,
):
    """
    Reads ONE sheet and builds an SSN index so that lookups are O(1)
    instead of scanning the whole sheet for every SSN.
    """
    if not selected_sheet:
        raise ValueError("A sheet must be selected.")

    workbook = load_workbook(
        BytesIO(file_bytes),
        data_only=True,
        read_only=True,
    )

    try:
        if selected_sheet not in workbook.sheetnames:
            raise ValueError(
                f"Selected sheet '{selected_sheet}' was not found in {filename}."
            )

        worksheet = workbook[selected_sheet]

        rows = []
        titles = {}
        max_column = 0

        for row_number, raw_row in enumerate(
            worksheet.iter_rows(values_only=True), start=1
        ):
            cells = [clean(v) for v in raw_row]

            while cells and cells[-1] == "":
                cells.pop()

            max_column = max(max_column, len(cells))

            if header_row and row_number == header_row:
                for idx, text in enumerate(cells, start=1):
                    if text:
                        titles[column_letter(idx)] = text

            if cells:
                rows.append({"excel_row": row_number, "cells": cells})
    finally:
        workbook.close()

    ssn_index = defaultdict(list)
    all_rows = []

    for row in rows:
        values = [
            {"column": column_letter(i + 1), "value": v}
            for i, v in enumerate(row["cells"])
        ]
        entry = {
            "sheet": selected_sheet,
            "excel_row": row["excel_row"],
            "values": values,
        }
        all_rows.append(entry)

        seen = set()
        for v in row["cells"]:
            ssn = normalise_ssn(v)
            if ssn and looks_like_ssn(ssn) and ssn not in seen:
                seen.add(ssn)
                ssn_index[ssn].append(entry)

    return {
        "sheet": selected_sheet,
        "max_column": max_column,
        "titles": titles,
        "rows": all_rows,
        "ssn_index": ssn_index,
        "header_row": header_row,
    }


def read_workbook(file_bytes: bytes, filename: str, selected_sheet: str):
    return read_selected_sheet(file_bytes, filename, selected_sheet)


# =========================================================
# SCENARIO SSNs - SELECTED SHEET ONLY
# =========================================================

def extract_scenario_ssns(
    file_bytes: bytes,
    filename: str,
    selected_sheet: str,
):
    sheet_data = read_selected_sheet(file_bytes, filename, selected_sheet)

    ssns = []
    seen = set()

    for row in sheet_data["rows"]:
        for cell in row["values"]:
            ssn = normalise_ssn(cell["value"])
            if looks_like_ssn(ssn) and ssn not in seen:
                seen.add(ssn)
                ssns.append(ssn)

    return ssns


# =========================================================
# RECORD HELPERS
# =========================================================

def get_record_type(record):
    for cell in record["values"]:
        value = clean(cell["value"])
        if value:
            if looks_like_ssn(value):
                return "RECORD"
            return value
    return "UNKNOWN RECORD"


def record_key(record):
    return get_record_type(record).upper().strip()


def record_to_full_data(record):
    if not record:
        return {}
    return {
        cell["column"]: cell["value"]
        for cell in record.get("values", [])
    }


def is_dependent_type(record_type: str) -> bool:
    return bool(DEPENDENT_PATTERN.search(record_type or ""))


def guess_name(record) -> str:
    """Best-effort employee / dependent name: first two text-only cells."""
    if not record:
        return ""
    parts = []
    skipped_type = False
    for cell in record["values"]:
        value = cell["value"]
        if not value:
            continue
        if not skipped_type:
            skipped_type = True  # first non-empty cell is the record type
            continue
        if NAME_PATTERN.match(value) and value.upper() not in NOT_A_NAME:
            parts.append(value)
            if len(parts) == 2:
                break
    return " ".join(parts)


def _non_empty(values: dict) -> dict:
    return {k: v for k, v in values.items() if v != ""}


def _similarity(old_values: dict, new_values: dict) -> float:
    old_ne = _non_empty(old_values)
    new_ne = _non_empty(new_values)
    biggest = max(len(old_ne), len(new_ne))
    if biggest == 0:
        return 0.0
    same = sum(1 for k, v in new_ne.items() if old_ne.get(k) == v)
    return same / biggest


# =========================================================
# COMPARE TWO RECORDS CELL BY CELL
# =========================================================

def compare_record_values(old_record, new_record, titles=None):
    titles = titles or {}
    old_values = record_to_full_data(old_record)
    new_values = record_to_full_data(new_record)

    all_columns = sorted(
        set(old_values) | set(new_values),
        key=column_index,
    )

    changes = []
    changed_columns = set()

    for column in all_columns:
        old_value = old_values.get(column, "")
        new_value = new_values.get(column, "")
        field = titles.get(column) or f"Column {column}"

        if old_record is None:
            if new_value != "":
                changes.append({
                    "column": column, "field": field,
                    "old_value": "", "new_value": new_value,
                    "status": "NEW",
                })
                changed_columns.add(column)
            continue

        if new_record is None:
            if old_value != "":
                changes.append({
                    "column": column, "field": field,
                    "old_value": old_value, "new_value": "",
                    "status": "MISSING",
                })
                changed_columns.add(column)
            continue

        if old_value != new_value:
            changes.append({
                "column": column, "field": field,
                "old_value": old_value, "new_value": new_value,
                "status": "CHANGED",
            })
            changed_columns.add(column)

    return changes, changed_columns


# =========================================================
# PAIR OLD / NEW RECORDS OF THE SAME TYPE
# =========================================================

def pair_records(old_list, new_list):
    """
    1. identical rows are paired first (so re-ordering is not a change)
    2. remaining rows are paired by best similarity
    3. whatever is left is MISSING (old only) or NEW (new only)
    Returns a list of (old_record|None, new_record|None).
    """
    old_free = list(range(len(old_list)))
    new_free = list(range(len(new_list)))
    pairs = []

    old_maps = [_non_empty(record_to_full_data(r)) for r in old_list]
    new_maps = [_non_empty(record_to_full_data(r)) for r in new_list]

    # 1. identical
    for ni in list(new_free):
        for oi in old_free:
            if old_maps[oi] == new_maps[ni]:
                pairs.append((oi, ni))
                old_free.remove(oi)
                new_free.remove(ni)
                break

    # 2. best similarity (global greedy)
    scored = []
    for oi in old_free:
        for ni in new_free:
            score = _similarity(old_maps[oi], new_maps[ni])
            if score >= SIMILARITY_THRESHOLD:
                scored.append((score, -abs(oi - ni), oi, ni))
    scored.sort(reverse=True)

    used_old, used_new = set(), set()
    for _score, _dist, oi, ni in scored:
        if oi in used_old or ni in used_new:
            continue
        used_old.add(oi)
        used_new.add(ni)
        pairs.append((oi, ni))

    # 3. leftovers
    for oi in old_free:
        if oi not in used_old:
            pairs.append((oi, None))
    for ni in new_free:
        if ni not in used_new:
            pairs.append((None, ni))

    def order(pair):
        oi, ni = pair
        if ni is not None:
            return (0, new_list[ni]["excel_row"])
        return (1, old_list[oi]["excel_row"])

    pairs.sort(key=order)

    return [
        (
            old_list[oi] if oi is not None else None,
            new_list[ni] if ni is not None else None,
        )
        for oi, ni in pairs
    ]


# =========================================================
# COMPARE EMPLOYEE / DEPENDENT RECORD OCCURRENCES
# =========================================================

def compare_record_groups(old_records, new_records, titles=None):
    old_groups = defaultdict(list)
    new_groups = defaultdict(list)
    labels = {}

    for r in old_records:
        old_groups[record_key(r)].append(r)
        labels.setdefault(record_key(r), get_record_type(r))
    for r in new_records:
        new_groups[record_key(r)].append(r)
        labels.setdefault(record_key(r), get_record_type(r))

    record_types = []
    for key in list(new_groups.keys()) + list(old_groups.keys()):
        if key not in record_types:
            record_types.append(key)

    flat = []

    for key in record_types:
        pairs = pair_records(old_groups.get(key, []), new_groups.get(key, []))
        kind = "dependent" if is_dependent_type(key) else "employee"

        for index, (old_record, new_record) in enumerate(pairs, start=1):
            changes, changed_columns = compare_record_values(
                old_record, new_record, titles
            )

            if old_record is None:
                status = "NEW"
            elif new_record is None:
                status = "MISSING"
            elif changes:
                status = "WHAT CHANGED"
            else:
                status = "NO CHANGE"

            flat.append({
                "record_type": labels[key],
                "kind": kind,
                "occurrence": index,
                "status": status,
                "name": guess_name(new_record or old_record),
                "old_row": old_record["excel_row"] if old_record else None,
                "new_row": new_record["excel_row"] if new_record else None,
                "old_values": record_to_full_data(old_record),
                "new_values": record_to_full_data(new_record),
                "changed_columns": sorted(changed_columns, key=column_index),
                "changes": changes,
            })

    return flat


# =========================================================
# OTHER (EXTRA) SSNs: present in New, absent in Old and Scenario
# =========================================================

def find_extra_ssns(old_sheet, new_sheet, scenario_ssns):
    scenario_set = {normalise_ssn(x) for x in scenario_ssns}
    old_ssns = set(old_sheet["ssn_index"].keys())

    claimed_rows = set()
    extras = []

    for row in new_sheet["rows"]:
        for cell in row["values"]:
            ssn = normalise_ssn(cell["value"])
            if not looks_like_ssn(ssn):
                continue
            if ssn in scenario_set or ssn in old_ssns:
                continue
            if any(e["ssn"] == ssn for e in extras):
                continue

            rows = new_sheet["ssn_index"].get(ssn, [])
            if all(r["excel_row"] in claimed_rows for r in rows):
                continue

            for r in rows:
                claimed_rows.add(r["excel_row"])
            extras.append({"ssn": ssn, "rows": rows})

    return extras


# =========================================================
# SUMMARY
# =========================================================

def build_summary(results):
    summary = {
        "total_ssns": len(results),
        "changed": 0,
        "extra": 0,
        "missing": 0,
        "new": 0,
        "error": 0,
        "no_change": 0,
    }
    mapping = {
        "WHAT CHANGED": "changed",
        "EXTRA": "extra",
        "MISSING": "missing",
        "NEW": "new",
        "ERROR": "error",
        "NO CHANGE": "no_change",
    }
    for item in results:
        key = mapping.get(item["status"])
        if key:
            summary[key] += 1
    return summary


def _employee_name(records):
    for r in records:
        if r["kind"] == "employee" and r["name"]:
            return r["name"]
    for r in records:
        if r["name"]:
            return r["name"]
    return ""


def _record_counts(records):
    counts = defaultdict(int)
    for r in records:
        counts[r["status"]] += 1
    return dict(counts)


# =========================================================
# MAIN COMPARISON
# =========================================================

def compare_workbooks(
    old_bytes,
    old_filename,
    new_bytes,
    new_filename,
    scenario_bytes,
    scenario_filename,
    old_sheet,
    new_sheet,
    scenario_sheet,
    header_row: int = 0,
):
    """
    Old Excel vs New Excel is the real comparison.
    Scenario Excel is ONLY used to get the SSN list.
    Only the three selected sheets are loaded.
    """

    old_data = read_selected_sheet(old_bytes, old_filename, old_sheet, header_row)
    new_data = read_selected_sheet(new_bytes, new_filename, new_sheet, header_row)

    scenario_ssns = extract_scenario_ssns(
        scenario_bytes, scenario_filename, scenario_sheet
    )

    titles = dict(old_data["titles"])
    titles.update(new_data["titles"])

    max_column = max(old_data["max_column"], new_data["max_column"])
    columns = [
        {
            "column": column_letter(i),
            "title": titles.get(column_letter(i)) or f"Column {column_letter(i)}",
        }
        for i in range(1, max_column + 1)
    ]

    results = []
    selected = {
        "selected_old_sheet": old_sheet,
        "selected_new_sheet": new_sheet,
        "selected_scenario_sheet": scenario_sheet,
    }

    for ssn in scenario_ssns:
        old_records = old_data["ssn_index"].get(ssn, [])
        new_records = new_data["ssn_index"].get(ssn, [])

        if not old_records and not new_records:
            results.append({
                "ssn": ssn,
                "status": "ERROR",
                "employee_name": "",
                "message": "SSN not found in selected Old or New sheet.",
                "records": [],
                "changes": [],
                "change_count": 0,
                "record_counts": {},
                **selected,
            })
            continue

        records = compare_record_groups(old_records, new_records, titles)

        if not old_records:
            status = "NEW"
        elif not new_records:
            status = "MISSING"
        elif any(r["status"] != "NO CHANGE" for r in records):
            status = "WHAT CHANGED"
        else:
            status = "NO CHANGE"

        changes = [c for r in records for c in r["changes"]]

        results.append({
            "ssn": ssn,
            "status": status,
            "employee_name": _employee_name(records),
            "message": "",
            "records": records,
            "changes": changes,
            "change_count": len(changes),
            "record_counts": _record_counts(records),
            **selected,
        })

    for extra in find_extra_ssns(old_data, new_data, scenario_ssns):
        records = compare_record_groups([], extra["rows"], titles)
        changes = [c for r in records for c in r["changes"]]
        results.append({
            "ssn": extra["ssn"],
            "status": "EXTRA",
            "employee_name": _employee_name(records),
            "message": "SSN exists in New Excel only and is not in the Scenario list.",
            "records": records,
            "changes": changes,
            "change_count": len(changes),
            "record_counts": _record_counts(records),
            **selected,
        })

    return {
        "success": True,
        "selected_sheets": {
            "old": old_sheet,
            "new": new_sheet,
            "scenario": scenario_sheet,
        },
        "columns": columns,
        "scenario_ssns": scenario_ssns,
        "summary": build_summary(results),
        "results": results,
        "messages": {
            "errors": [],
            "warnings": (
                [] if scenario_ssns
                else ["No SSN (9 digits) was found in the selected Scenario sheet."]
            ),
        },
    }