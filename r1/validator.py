
import re

SSN_PATTERN = re.compile(r"^[0-9]{9}$")

SEGMENT_CELL_PATTERN = re.compile(r"^\s*([A-Za-z][A-Za-z0-9]*)\*")

SKIP_ELEMENTS = {("INS", 1)}
def excel_column_name(index):
    if index < 0:
        return "?"

    result = ""
    number = index + 1

    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result

    return result


def make_issue(
    row_index,
    col_index,
    element,
    message,
    found="",
    expected="",
    level="error",
    segment="",
):
    return {
        "row": row_index,
        "col": col_index,
        "cell": f"{excel_column_name(col_index)}{row_index + 1}",
        "segment": segment,
        "element": element,
        "level": level,
        "message": message,
        "found": "" if found is None else str(found),
        "expected": expected,
    }


def cell_status(row_index, col_index, segment, ok):
    return {
        "row": row_index,
        "col": col_index,
        "cell": f"{excel_column_name(col_index)}{row_index + 1}",
        "segment": segment,
        "ok": bool(ok),
    }


def get_segment_name(value):
    if value is None:
        return None

    match = SEGMENT_CELL_PATTERN.match(str(value).strip())

    return match.group(1).upper() if match else None


def is_numeric_leading_record(value):
    return bool(re.match(r"^\s*\d+\*", str(value or "")))


def cell_text(cells, index):
    """Return a safely normalized Excel cell value as text."""
    if 0 <= index < len(cells) and cells[index] is not None:
        return str(cells[index]).strip()
    return ""


def parse_rule_value(value):
    text = str(value or "").strip()

    if text.upper() == "NOT USED":
        return {
            "allowed": [],
            "null_ok": True,
            "not_used": True,
            "blank_required": False,
            "free_text": False,
            "placeholder": "",
        }

    placeholder_match = re.fullmatch(r"<\s*([^<>]+)\s*>", text)

    if placeholder_match:
        return {
            "allowed": [],
            "null_ok": False,
            "not_used": False,
            "blank_required": False,
            "free_text": True,
            "placeholder": placeholder_match.group(1).strip(),
        }

    if not text:
        return {
            "allowed": [],
            "null_ok": False,
            "not_used": False,
            "blank_required": True,
            "free_text": False,
            "placeholder": "",
        }

    if " - " in text and "," not in text:
        text = text.split(" - ", 1)[0].strip()

    return {
        "allowed": [
            part.strip()
            for part in text.split(",")
            if part.strip()
        ],
        "null_ok": False,
        "not_used": False,
        "blank_required": False,
        "free_text": False,
        "placeholder": "",
    }


def check_element(value, rule):
    rule = rule or {}

    allowed = rule.get("allowed", []) or []
    expected = ",".join(str(item) for item in allowed)

    # UNIVERSAL POSITION RULE:
    # None means the element index does not exist because its delimiter
    # was missing. An empty string means the delimiter exists and the
    # element is intentionally blank. This applies to every segment and
    # every segment and every mapped element.
    if value is None:
        expected = expected or rule.get("placeholder") or "element position (*)"
        return (
            False,
            "Element position is missing from the raw data (the required '*' delimiter was not found).",
            expected,
        )

    blank = str(value).strip() == ""

    if rule.get("not_used", False):
        if blank:
            return True, "", "blank (*)"

        return (
            False,
            f"This element is marked as NOT USED, but the value '{value}' was provided.",
            "blank (*)",
        )

    if rule.get("blank_required", False):
        if not blank:
            return (
                False,
                f"The mapping requires this element to be blank, but the value '{value}' was provided.",
                "blank (*)",
            )

        return True, "", "blank (*)"

    if blank:
        if rule.get("null_ok", False) or rule.get("free_text", False):
            return True, "", rule.get("placeholder") or expected

        expected = expected or rule.get("placeholder") or "non-blank value"
        return (
            False,
            f"Value is blank; expected {expected}.",
            expected,
        )

    actual = str(value).strip()

    if allowed and actual not in [str(item).strip() for item in allowed]:
        return (
            False,
            f"Invalid value '{actual}'; expected {expected}.",
            expected,
        )

    if rule.get("placeholder"):
        return True, "", rule["placeholder"]

    if rule.get("free_text", False):
        return True, "", "any value"

    return True, "", expected


def get_numeric_leading_segment(sequence, rules):
    for segment in sequence:
        if 2 in (rules.get(segment, {}) or {}):
            return segment

    return sequence[0] if sequence else None


def split_segment_value(text, segment, sequence, rules):
    text = str(text or "").strip()
    parts = text.split("*")

    if get_segment_name(text):
        return parts

    numeric_segment = get_numeric_leading_segment(sequence, rules)

    if (
        numeric_segment == segment
        and is_numeric_leading_record(text)
    ):
        return ["", None] + parts

    return parts


def get_actual_segments(cells, sequence, rules):
    mapped_segments = set(sequence)
    numeric_segment = get_numeric_leading_segment(sequence, rules)

    actual = []

    for col, value in enumerate(cells):
        text = "" if value is None else str(value).strip()

        if not text:
            continue

        segment = get_segment_name(text)

        if segment is None and numeric_segment:
            if is_numeric_leading_record(text):
                segment = numeric_segment

        # Only collect segment tags known to the mapping.
        if segment in mapped_segments:
            actual.append({
                "col": col,
                "segment": segment,
                "value": text,
            })

    return actual


def build_occurrences(parsed_mapping):
    """
    Har mapping occurrence ko original order mein preserve karta hai.

    Preferred input:
        mapping_parser.py se aaya hua occurrences list.

    Fallback:
        mapping_rows ko order ke according group karta hai.
    """
    occurrences = parsed_mapping.get("occurrences", [])

    if occurrences:
        return occurrences

    mapping_rows = parsed_mapping.get("mapping_rows", [])
    result = []
    current = None

    for mapped in mapping_rows:
        segment = mapped["segment"]
        number = int(mapped["element_number"])

        starts_new = (
            current is None
            or current["segment"] != segment
            or number <= current["_last_number"]
        )

        if starts_new:
            current = {
                "occurrence": len(result) + 1,
                "segment": segment,
                "elements": [],
                "_last_number": 0,
            }
            result.append(current)

        current["elements"].append(mapped)
        current["_last_number"] = number

    for occurrence in result:
        occurrence.pop("_last_number", None)

    return result


def get_occurrence_rules(occurrence, parsed_mapping):
    """
    Occurrence ke apne rules return karta hai.
    Repeated REF01 rules ko global dictionary se overwrite nahi hone deta.
    """
    rules = {}

    for mapped in occurrence.get("elements", []):
        number = int(mapped["element_number"])
        rule = mapped.get("rule") or {}

        if not rule:
            rule = parse_rule_value(mapped.get("value", ""))

        rules[number] = rule

    # Legacy fallback only when mapping rows are unavailable.
    if not rules:
        rules = (
            parsed_mapping.get("rules", {}).get(
                occurrence["segment"], {}
            ) or {}
        )

    return rules


def match_actual_to_mapping(actual, occurrences, row_index):
    """
    Actual segments ko mapping occurrences ke saath order-wise match karta hai.

    Important:
    - Same segment tag hona sufficient nahi hai.
    - Actual occurrence ko mapping sequence ki current position se match
      karna hoga.
    - Mapping ke end ke baad aane wala REF extra/unexpected hoga.
    """
    issues = []
    matches = []

    expected_pos = 0
    actual_pos = 0

    while actual_pos < len(actual):
        item = actual[actual_pos]
        actual_segment = item["segment"]

        if expected_pos >= len(occurrences):
            issues.append(
                make_issue(
                    row_index,
                    item["col"],
                    actual_segment,
                    (
                        f"Unexpected mapped segment '{actual_segment}': "
                        "the mapping sequence is already complete."
                    ),
                    found=item["value"],
                    expected="No additional mapped segment",
                    segment=actual_segment,
                )
            )

            actual_pos += 1
            continue

        expected_occurrence = occurrences[expected_pos]
        expected_segment = expected_occurrence["segment"]

        if actual_segment == expected_segment:
            matches.append({
                "actual": item,
                "occurrence": expected_occurrence,
            })

            expected_pos += 1
            actual_pos += 1
            continue

        # Check whether the actual segment belongs to a later mapping
        # occurrence. If yes, the current expected occurrence is missing.
        later_position = None

        for position in range(expected_pos + 1, len(occurrences)):
            if occurrences[position]["segment"] == actual_segment:
                later_position = position
                break

        if later_position is not None:
            issues.append(
                make_issue(
                    row_index,
                    item["col"],
                    expected_segment,
                    (
                        f"Sequence mismatch: '{expected_segment}' "
                        f"expected before '{actual_segment}'."
                    ),
                    found=actual_segment,
                    expected=expected_segment,
                    segment=expected_segment,
                )
            )

            # Mark the missing mapping occurrence and advance to the
            # occurrence that actually matches.
            expected_pos += 1
            continue

        # This actual segment does not belong at the current mapping
        # position or any later position.
        issues.append(
            make_issue(
                row_index,
                item["col"],
                actual_segment,
                (
                    f"Unexpected mapped segment '{actual_segment}'; "
                    f"expected '{expected_segment}'."
                ),
                found=item["value"],
                expected=expected_segment,
                segment=actual_segment,
            )
        )

        actual_pos += 1

    # Report all remaining required mapping occurrences.
    while expected_pos < len(occurrences):
        occurrence = occurrences[expected_pos]
        segment = occurrence["segment"]

        issues.append(
            make_issue(
                row_index,
                0,
                segment,
                f"Required mapped segment '{segment}' is missing.",
                found="",
                expected=segment,
                segment=segment,
            )
        )

        expected_pos += 1

    return matches, issues


def validate_extra_elements(
    item,
    occurrence,
    parsed_mapping,
    row_index,
):
    issues = []

    segment = item["segment"]
    col = item["col"]

    sequence = parsed_mapping.get("sequence", [])
    rules = parsed_mapping.get("rules", {})

    parts = split_segment_value(
        item["value"],
        segment,
        sequence,
        rules,
    )

    occurrence_rules = get_occurrence_rules(
        occurrence,
        parsed_mapping,
    )

    for number in range(1, len(parts)):
        value = parts[number]

        if value is None or str(value).strip() == "":
            continue

        if number not in occurrence_rules:
            issues.append(
                make_issue(
                    row_index,
                    col,
                    "NO MAPPING FOUND",
                    (
                        f"NO MAPPING FOUND: {segment}{number:02d} "
                        f"is not defined in this mapping occurrence, "
                        f"but the value '{value}' is present."
                    ),
                    found=value,
                    expected="",
                    segment=segment,
                )
            )

    return issues


def normalized_placeholder(rule):
    placeholder = str((rule or {}).get("placeholder", "")).strip().lower()
    return re.sub(r"[^a-z0-9]", "", placeholder)


def is_employee_ssn_rule(rule):
    """EmployeeSSN is stored in the Excel column immediately after REF."""
    return normalized_placeholder(rule) == "employeessn"


def is_inline_ssn_rule(rule):
    """SSN placeholders other than EmployeeSSN are stored in the segment."""
    return normalized_placeholder(rule) in {
        "ssn",
        "socialsecuritynumber",
    }


def is_external_ref_employee_ssn(segment, number, rule):
    return (
        str(segment).upper() == "REF"
        and int(number) == 2
        and is_employee_ssn_rule(rule)
    )


def validate_occurrence(
    cells,
    row_index,
    item,
    occurrence,
    parsed_mapping,
    is_first_ref_occurrence=False,
):
    issues = []
    validated_cells = []

    segment = item["segment"]
    col = item["col"]

    rules = get_occurrence_rules(occurrence, parsed_mapping)
    sequence = parsed_mapping.get("sequence", [])
    all_rules = parsed_mapping.get("rules", {})

    parts = split_segment_value(
        item["value"],
        segment,
        sequence,
        all_rules,
    )

    segment_has_error = False

    for number, rule in sorted(rules.items()):
        number = int(number)

        if (segment, number) in SKIP_ELEMENTS:
            continue

        # Same position check for NM1, REF, INS, and every other segment.
        # If parts[number] is None, the required '*' position is missing.
        # If it is "", the position exists and check_element applies the
        # mapping's blank/free-text rule.
        value = parts[number] if number < len(parts) else None
        ok, message, expected = check_element(value, rule)

        if not ok:
            segment_has_error = True
            issues.append(
                make_issue(
                    row_index,
                    col,
                    f"{segment}{number:02d}",
                    message,
                    found="" if value is None else value,
                    expected=expected,
                    segment=segment,
                )
            )

        # Inline SSN placeholders are checked inside the segment.
        # EmployeeSSN is intentionally excluded here because REF02 gets
        # its value from the next Excel column (handled below).
        if is_inline_ssn_rule(rule) and value is not None:
            ssn = str(value).strip()

            if not ssn:
                segment_has_error = True
                issues.append(
                    make_issue(
                        row_index,
                        col,
                        f"{segment}{number:02d}",
                        "SSN is blank; expected exactly 9 numeric digits.",
                        found="",
                        expected="Exactly 9 numeric digits",
                        segment=segment,
                    )
                )
            elif not SSN_PATTERN.fullmatch(ssn):
                segment_has_error = True
                issues.append(
                    make_issue(
                        row_index,
                        col,
                        f"{segment}{number:02d}",
                        "SSN must contain exactly 9 numeric digits.",
                        found=ssn,
                        expected="Exactly 9 numeric digits",
                        segment=segment,
                    )
                )

    # Special storage convention from the mapping:
    # Only the FIRST REF mapping occurrence can map REF02 to <EmployeeSSN>.
    # Its actual SSN value is in the Excel cell immediately to the right
    # of the REF segment cell. Later REF occurrences are not checked here.
    if is_first_ref_occurrence and segment.upper() == "REF":
        ref02_rule = rules.get(2)
        if ref02_rule and is_external_ref_employee_ssn("REF", 2, ref02_rule):
            external_col = col + 1
            ssn = cell_text(cells, external_col)

            if not ssn:
                segment_has_error = True
                issues.append(
                    make_issue(
                        row_index,
                        external_col,
                        "REF02",
                        "EmployeeSSN is blank in the next column; expected exactly 9 numeric digits.",
                        found="",
                        expected="Exactly 9 numeric digits",
                        segment="REF",
                    )
                )
            elif not SSN_PATTERN.fullmatch(ssn):
                segment_has_error = True
                issues.append(
                    make_issue(
                        row_index,
                        external_col,
                        "REF02",
                        "EmployeeSSN must contain exactly 9 numeric digits.",
                        found=ssn,
                        expected="Exactly 9 numeric digits",
                        segment="REF",
                    )
                )

            validated_cells.append(
                cell_status(
                    row_index,
                    external_col,
                    "REF02 EmployeeSSN",
                    bool(ssn) and bool(SSN_PATTERN.fullmatch(ssn)),
                )
            )

    validated_cells.append(
        cell_status(
            row_index,
            col,
            segment,
            not segment_has_error,
        )
    )

    return issues, validated_cells


def validate_extra_data(
    cells,
    row_index,
    parsed_mapping,
    actual_segments,
    matches,
):
    issues = []

    # Validate unmapped populated elements only within matched segments.
    for match in matches:
        item = match["actual"]
        occurrence = match["occurrence"]

        issues.extend(
            validate_extra_elements(
                item,
                occurrence,
                parsed_mapping,
                row_index,
            )
        )

    # Segment cells are accounted for. The first REF occurrence may also
    # consume the immediately following Excel column for <EmployeeSSN>.
    accounted_columns = {match["actual"]["col"] for match in matches}

    first_ref_occurrence = next(
        (occ for occ in build_occurrences(parsed_mapping)
         if str(occ.get("segment", "")).upper() == "REF"),
        None,
    )

    if first_ref_occurrence is not None:
        for match in matches:
            item = match["actual"]
            occurrence = match["occurrence"]
            if occurrence is not first_ref_occurrence:
                continue
            if str(item["segment"]).upper() != "REF":
                continue

            occurrence_rules = get_occurrence_rules(occurrence, parsed_mapping)
            ref02_rule = occurrence_rules.get(2)
            if ref02_rule and is_external_ref_employee_ssn("REF", 2, ref02_rule):
                accounted_columns.add(item["col"] + 1)

    if accounted_columns:
        last_accounted_col = max(accounted_columns)

        for col in range(last_accounted_col + 1, len(cells)):
            value = "" if cells[col] is None else str(cells[col]).strip()

            if value:
                issues.append(
                    make_issue(
                        row_index,
                        col,
                        "NO MAPPING FOUND",
                        "NO MAPPING FOUND: No mapping code is defined for this column/value.",
                        found=value,
                        expected="",
                    )
                )

    return issues


def validate_mapping_rows(rows, parsed_mapping):
    issues = []
    validated_cells = []

    rules = parsed_mapping.get("rules", {})
    sequence = parsed_mapping.get("sequence", [])
    warnings = parsed_mapping.get("warnings", [])

    occurrences = build_occurrences(parsed_mapping)
    first_ref_occurrence = next(
        (occ for occ in occurrences
         if str(occ.get("segment", "")).upper() == "REF"),
        None,
    )

    for warning in warnings:
        issues.append(
            make_issue(
                0,
                0,
                "MAPPING",
                warning,
                level="warning",
            )
        )

    for position, row in enumerate(rows):
        row_index = row.get("row_index", position)
        cells = row.get("cells", [])

        # Identify only known mapped segment cells.
        actual_segments = get_actual_segments(
            cells,
            sequence,
            rules,
        )

        # Match by mapping order, not merely by matching segment tag.
        matches, sequence_issues = match_actual_to_mapping(
            actual_segments,
            occurrences,
            row_index,
        )

        issues.extend(sequence_issues)

        # Validate element values only for matched occurrences.
        for match in matches:
            item = match["actual"]
            occurrence = match["occurrence"]

            occurrence_issues, cell_statuses = validate_occurrence(
                cells,
                row_index,
                item,
                occurrence,
                parsed_mapping,
                is_first_ref_occurrence=(occurrence is first_ref_occurrence),
            )

            issues.extend(occurrence_issues)
            validated_cells.extend(cell_statuses)

        issues.extend(
            validate_extra_data(
                cells,
                row_index,
                parsed_mapping,
                actual_segments,
                matches,
            )
        )

    errors = sum(
        issue["level"] == "error"
        for issue in issues
    )

    warnings_count = sum(
        issue["level"] == "warning"
        for issue in issues
    )

    return {
        "issues": issues,
        "validated_cells": validated_cells,
        "summary": {
            "rows_checked": len(rows),
            "errors": errors,
            "warnings": warnings_count,
        },
    }


def validate_against_mapping(rows, rules):
    if isinstance(rules, str):
        from r1.mapping_parser import parse_mapping

        parsed = parse_mapping(rules)

        return validate_mapping_rows(rows, parsed)

    if isinstance(rules, dict) and "rules" in rules:
        parsed = dict(rules)

        parsed.setdefault(
            "sequence",
            list(parsed.get("rules", {}).keys()),
        )

        parsed.setdefault("mapping_rows", [])
        parsed.setdefault("occurrences", [])
        parsed.setdefault("warnings", [])

        return validate_mapping_rows(rows, parsed)

    # Backward-compatible legacy rules input.
    legacy_rows = []

    for segment, segment_rules in rules.items():
        for number, rule in segment_rules.items():
            number = int(number)

            legacy_rows.append({
                "line": len(legacy_rows) + 1,
                "element": f"{segment}{number:02d}",
                "segment": segment,
                "element_number": number,
                "value": rule.get("raw", ""),
                "rule": rule,
            })

    parsed = {
        "rules": rules,
        "sequence": list(rules.keys()),
        "mapping_rows": legacy_rows,
        "occurrences": [],
        "warnings": [],
    }

    return validate_mapping_rows(rows, parsed)
