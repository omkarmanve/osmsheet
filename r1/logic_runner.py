"""
Mapping ke logic columns ke hisaab se Excel rows ko XML se compare karta hai.

Mapping grid: A = Element code, B = Valid values, C = Employee logic,
D = Dependent logic.  Kuch bhi hard-coded nahi: expected value sirf logic text
aur XML ke tags se aati hai.

Kaun si rows check hongi (XML aur mapping se apne aap):
  - XML me employees hain aur mapping me Employee logic hai  -> EE rows check
  - XML me dependents hain aur mapping me Dependent logic hai -> DEPENDENT rows check
  - baaki rows skip (aur result me batata hai kyun)

Har row ke liye:
  1. XML se match: employee -> SSN + Name (+ DOB); dependent -> Name (+ DOB,
     + employee SSN)
  2. Mapping ka har element jiska logic likha hai:
       expected = logic + XML,  found = Excel cell ka element
  3. Mismatch = error, lookup wala logic = warning (verify nahi ho sakta),
     samajh me na aane wala logic = warning (Logic not understood).
"""

import re

from r1.logic_dsl import (
    Context,
    evaluate,
    is_data_dependent,
    is_pure_field,
    is_qualifier_const,
    parse_date,
    parse_logic,
    same,
)
from r1.logic_engine import (
    extract_dependent_info,
    extract_row_info,
    match_dependent,
    match_user,
)
from r1.logic_mapping import build_occurrences

MODES = ("employee", "dependent")
LOGIC_KEY = {"employee": "logic", "dependent": "dep_logic"}

SEG_START = re.compile(r"^([A-Za-z][A-Za-z0-9]{0,3})\*")
NUM_START = re.compile(r"^\d+\*")
SSN_CELL = re.compile(r"^[\d-]{5,}$")


# ---------------------------------------------------------------
# Excel row ke cells
# ---------------------------------------------------------------
def parse_cells(cells):
    parsed = []

    for index, raw in enumerate(cells):
        text = str(raw or "").strip()

        if not text:
            continue

        if re.match(r"(?i)^INS\*", text):
            parsed.append({"idx": index, "segment": "INS", "style": "explicit",
                           "text": text})
        elif NUM_START.match(text):
            parsed.append({"idx": index, "segment": "INS", "style": "numeric",
                           "text": text})
        elif SEG_START.match(text):
            segment = SEG_START.match(text).group(1).upper()
            parsed.append({"idx": index, "segment": segment, "style": "plain",
                           "text": text})
        elif "*" not in text and SSN_CELL.match(text):
            parsed.append({"idx": index, "segment": None, "style": "ssn",
                           "text": text})

    # REF*0F* ke baad wala alag SSN cell us REF se judta hai
    for position, cell in enumerate(parsed):
        cell["attached"] = ""
        if cell["segment"] == "REF" and position + 1 < len(parsed):
            nxt = parsed[position + 1]
            if nxt["style"] == "ssn" and nxt["idx"] == cell["idx"] + 1:
                cell["attached"] = nxt["text"]

    return [c for c in parsed if c["segment"]]


def get_value(cell, number):
    """Element ki value. None = is layout me ye element hota hi nahi."""
    parts = cell["text"].split("*")

    if cell["segment"] == "INS" and cell["style"] == "numeric":
        if number == 1:
            return None
        position = number - 2
    else:
        position = number

    value = parts[position].strip() if 0 <= position < len(parts) else ""

    if cell["segment"] == "REF" and number == 2 and not value:
        value = cell["attached"]

    return value


def _q(text):
    return str(text).strip().upper().replace("O", "0")


def qualifier_candidates(occurrence):
    first = next((e for e in occurrence["elements"] if e["number"] == 1), None)
    if first is None:
        return []

    candidates = []

    for token in first["value"].split(","):
        token = token.split(" - ")[0].strip()
        if token:
            candidates.append(token)

    rule = first.get("rule")
    if rule and rule["kind"] == "expr" and rule["expr"][0] == "const":
        candidates.append(rule["expr"][1])

    return candidates


def find_cell(occurrence, cells, seg_counts):
    segment_cells = [c for c in cells if c["segment"] == occurrence["segment"]]

    if not segment_cells:
        return None

    if occurrence["segment"] == "INS" or seg_counts[occurrence["segment"]] == 1:
        return segment_cells[0]

    candidates = qualifier_candidates(occurrence)

    if not candidates:
        ordinal = occurrence["ordinal"]
        return segment_cells[ordinal] if ordinal < len(segment_cells) else None

    for cell in segment_cells:
        parts = cell["text"].split("*")
        qualifier = parts[1].strip() if len(parts) > 1 else ""
        if any(_q(qualifier) == _q(c) or same(qualifier, c) for c in candidates):
            return cell

    return None


def _show(value):
    return f"'{value}'" if value != "" else "(blank)"


def row_kind(cells):
    """Row employee hai ya dependent: kisi bhi cell me 'DEPENDENT RECORD' / 'EE RECORD'.
    (Column sequence badalne par type wala column pehla nahi bhi ho sakta.)"""
    for cell in cells:
        text = str(cell or "").strip().upper()
        if "DEPENDENT RECORD" in text:
            return "dependent"
        if text == "EE RECORD":
            return "employee"

    first = str(cells[0] or "").upper() if cells else ""
    return "dependent" if "DEPENDENT" in first else "employee"


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------
def run_logic(rows, users, mapping_rows):
    has_dependents = any(u["dependents"] for u in users)

    occurrences, mapping_warnings = {}, []

    for mode in MODES:
        occs, warns = build_occurrences(mapping_rows, LOGIC_KEY[mode])

        if mode == "employee":
            mapping_warnings = warns

        ordinals = {}
        for occ in occs:
            occ["ordinal"] = ordinals.get(occ["segment"], 0)
            ordinals[occ["segment"]] = occ["ordinal"] + 1

            for element in occ["elements"]:
                element["rule"] = parse_logic(element["logic"])

        occurrences[mode] = occs

    active = {
        mode: [
            occ for occ in occurrences[mode]
            if any(e["rule"]["kind"] != "none" for e in occ["elements"])
        ]
        for mode in MODES
    }

    check = {
        "employee": bool(active["employee"]),
        "dependent": bool(active["dependent"]) and has_dependents,
    }

    if not any(check.values()):
        if active["dependent"] and not has_dependents:
            raise ValueError(
                "The mapping has only Dependent logic, but the XML has no "
                "dependent data."
            )
        raise ValueError(
            "No logic found in the mapping. Paste the Employee logic and/or "
            "the Dependent logic into the mapping grid and select those "
            "columns in the Logic Validation panel."
        )

    seg_counts = {}
    for occ in occurrences["employee"]:
        seg_counts[occ["segment"]] = seg_counts.get(occ["segment"], 0) + 1

    issues, status_map = [], {}
    skipped_rows = {"employee": 0, "dependent": 0}
    summary = {
        "mode": "mapping",
        "employee_checked": check["employee"],
        "dependent_checked": check["dependent"],
        "rows_checked": 0,
        "employee_rows": 0,
        "dependent_rows": 0,
        "elements_checked": 0,
        "passed": 0,
        "errors": 0,
        "warnings": 0,
        "skipped": 0,
        "users_in_xml": len(users),
        "dependents_in_xml": sum(len(u["dependents"]) for u in users),
        "rules": sum(
            1 for mode in MODES if check[mode]
            for occ in active[mode] for e in occ["elements"]
            if e["rule"]["kind"] != "none"
        ),
        "rules_not_understood": 0,
    }

    def add(row_index, cell_index, level, kind, element, message,
            found="", expected="", record=""):
        issues.append({
            "row_index": row_index, "cell_index": cell_index, "level": level,
            "kind": kind, "record": record, "element": element,
            "message": message, "found": found, "expected": expected,
        })
        if level == "error":
            summary["errors"] += 1
        elif level == "warning":
            summary["warnings"] += 1

    def mark(row_index, cell_index, status):
        key = (row_index, cell_index)
        order = {"pass": 0, "warn": 1, "fail": 2}
        if key not in status_map or order[status] > order[status_map[key]]:
            status_map[key] = status

    for text in mapping_warnings:
        add(-1, 0, "warning", "mapping", "", text)

    for mode in MODES:
        if not check[mode]:
            continue
        for occ in active[mode]:
            for element in occ["elements"]:
                rule = element["rule"]
                if rule["kind"] == "unsupported":
                    summary["rules_not_understood"] += 1
                    add(
                        -1, 0, "warning", "logic_text", element["element"],
                        f"Logic not understood ({rule['reason']}): "
                        f"\"{rule['text'][:120]}\"",
                        record=mode,
                    )

    last_user = None            # grid me sabse nayi matched EE row ka XML employee
    employee_rows = []          # (user, row_index) jinke EE rows match hui
    seen_dependents = {}        # id(user) -> matched dependent numbers

    for row in rows:
        row_index, cells = row["row_index"], row["cells"]

        if not any(str(c or "").strip() for c in cells):
            summary["skipped"] += 1
            continue

        mode = row_kind(cells)

        if not check[mode]:
            summary["skipped"] += 1
            skipped_rows[mode] += 1
            continue

        summary["rows_checked"] += 1
        summary[f"{mode}_rows"] += 1

        if mode == "employee":
            info = extract_row_info(cells)
            user, errors = match_user(info, users)
            dependent = None
            last_user = None if errors else user
            if user is not None and not errors:
                employee_rows.append((user, row_index))
        else:
            info = extract_dependent_info(cells)
            user, dependent, errors = match_dependent(info, users, parent=last_user)
            if dependent is not None and not errors:
                seen_dependents.setdefault(id(user), set()).add(dependent["number"])

        mark_idx = info["nm1_idx"] if info["nm1_idx"] is not None else 0

        if errors:
            for message in errors:
                add(row_index, mark_idx, "error", "match", "", message,
                    record=mode)
            mark(row_index, mark_idx, "fail")
            continue

        ctx = Context(dependent, parent=user) if dependent else Context(user)
        label = (dependent or user)["label"]
        parsed_cells = parse_cells(cells)

        for occ in active[mode]:
            segment = occ["segment"]
            elements = occ["elements"]
            results = []

            for element in elements:
                rule = element["rule"]
                if rule["kind"] in ("none", "unsupported"):
                    results.append(None)
                else:
                    results.append(evaluate(rule, ctx))

            # Qualifier code tab nahi bheja jata jab uske saath ki value
            # (agla element, <Field>) blank ho
            for i, element in enumerate(elements[:-1]):
                nxt = elements[i + 1]
                if (
                    results[i] and results[i + 1]
                    and is_qualifier_const(element["rule"])
                    and is_pure_field(nxt["rule"])
                    and nxt["number"] == element["number"] + 1
                    and results[i + 1]["value"] == ""
                    and not results[i + 1]["unverifiable"]
                ):
                    results[i]["value"] = ""

            cell = find_cell(occ, parsed_cells, seg_counts)

            if cell is None:
                # Segment row me hai hi nahi
                for element, result in zip(elements, results):
                    if result is None or not is_data_dependent(element["rule"]):
                        continue
                    if result["value"] != "" and not result["unverifiable"]:
                        summary["elements_checked"] += 1
                        add(
                            row_index, 0, "error", "logic", element["element"],
                            f"{element['element']}: segment {segment} is missing "
                            f"in the row, expected {_show(result['value'])}",
                            found="", expected=result["value"], record=mode,
                        )
                        mark(row_index, 0, "fail")
                        break
                continue

            for element, result in zip(elements, results):
                if result is None:
                    continue

                found = get_value(cell, element["number"])
                if found is None:
                    continue

                summary["elements_checked"] += 1
                name = element["element"]
                excerpt = element["logic"][:90]

                if result["unverifiable"]:
                    add(
                        row_index, cell["idx"], "warning", "logic", name,
                        f"{name}: cannot verify - {result['unverifiable']} "
                        f"(found {_show(found)})",
                        found=found, record=mode,
                    )
                    mark(row_index, cell["idx"], "warn")
                    continue

                expected = result["value"]
                ok = same(found, expected) if expected != "" else found == ""

                if not ok:
                    add(
                        row_index, cell["idx"], "error", "logic", name,
                        f"{name}: expected {_show(expected)}, found "
                        f"{_show(found)}  [logic: {excerpt}]",
                        found=found, expected=expected, record=mode,
                    )
                    mark(row_index, cell["idx"], "fail")
                    continue

                if result["min_date"]:
                    minimum = parse_date(result["min_date"])
                    actual = parse_date(found)
                    if minimum and actual and actual < minimum:
                        add(
                            row_index, cell["idx"], "error", "logic", name,
                            f"{name}: date {found} is before "
                            f"{result['min_date']} (rule: 'or thereafter')",
                            found=found, expected=f">= {result['min_date']}",
                            record=mode,
                        )
                        mark(row_index, cell["idx"], "fail")
                        continue

                summary["passed"] += 1
                mark(row_index, cell["idx"], "pass")

        for name in ctx.missing:
            if name in ctx.ambiguous:
                add(
                    row_index, 0, "warning", "xml_tag", "",
                    f"XML tag name <{name}> matches several tags "
                    f"({', '.join(ctx.ambiguous[name])}) for {mode} {label}; "
                    f"treated as blank. Use a longer, clearer tag name in the logic.",
                    record=mode,
                )
            else:
                add(
                    row_index, 0, "warning", "xml_tag", "",
                    f"XML tag <{name}> not found for {mode} {label}; "
                    f"treated as blank.",
                    record=mode,
                )

        if mode == "dependent" and ctx.hints:
            pairs = "; ".join(
                f"<{name}> gave the EMPLOYEE's <{parent}> but the dependent has "
                f"<{'>, <'.join(own)}>"
                for name, (parent, own) in ctx.hints.items()
            )
            add(
                row_index, 0, "warning", "xml_tag", "",
                f"Dependent logic uses employee-level tags: {pairs}. "
                f"If you want the dependent's own value, change the tag in the Dependent logic column.",
                record="dependent",
            )

    # Logic on hai magar grid me us type ki ek bhi row nahi aayi: saaf batao
    if check["dependent"] and summary["dependent_rows"] == 0:
        add(-1, 0, "info", "note", "",
            "Dependent logic is set and the XML has dependents, but no DEPENDENT RECORD "
            "rows were found in the grid, so no dependent was checked.",
            record="dependent")

    # XML me jo dependents hain par grid me unki row nahi mili
    if check["dependent"] and summary["dependent_rows"] > 0:
        for user, row_index in employee_rows:
            done = seen_dependents.get(id(user), set())
            for dep in user["dependents"]:
                if dep["number"] in done:
                    continue
                who = " ".join(p for p in (dep["last"], dep["first"]) if p) or dep["label"]
                ssn = f"SSN {dep['ssn']}" if dep["ssn"] else "no SSN"
                add(
                    row_index, 0, "warning", "match", "",
                    f"Dependent {who} ({ssn}) is in the XML under employee "
                    f"{user['label']} but no matching DEPENDENT row was found for it in the grid.",
                    record="dependent",
                )

    if check["employee"] and summary["employee_rows"] == 0:
        add(-1, 0, "info", "note", "",
            "Employee logic is set, but no EE RECORD rows were found in the grid, "
            "so no employee was checked.", record="employee")

    if skipped_rows["employee"]:
        add(-1, 0, "info", "note", "",
            f"{skipped_rows['employee']} employee row(s) skipped: "
            f"the mapping has no Employee logic.", record="employee")

    if skipped_rows["dependent"]:
        reason = (
            "the mapping has no Dependent logic"
            if not active["dependent"]
            else "the XML has no dependent data"
        )
        add(-1, 0, "info", "note", "",
            f"{skipped_rows['dependent']} dependent row(s) skipped: {reason}.",
            record="dependent")

    validated = [
        {"row_index": r, "cell_index": c, "status": s}
        for (r, c), s in sorted(status_map.items())
    ]

    return {"issues": issues, "validated_cells": validated, "summary": summary}
