"""
Mapping rows (element, value, logic) ko ordered segment occurrences me
badalta hai. Kisi bhi tarah ka paste chalta hai: INS2 (1 digit) bhi.
"""

import re

KEY_2 = re.compile(r"^([A-Z]+\d?)(\d{2})$")
KEY_1 = re.compile(r"^([A-Z]+)(\d)$")

ALIASES = {"IEA": "INS"}


def parse_key(key):
    key = str(key or "").strip().upper()

    match = KEY_2.fullmatch(key) or KEY_1.fullmatch(key)
    if not match:
        return None

    return match.group(1), int(match.group(2))


def build_occurrences(mapping_rows, logic_key="logic"):
    """mapping_rows: [{line, element, value, logic, dep_logic}]
    logic_key: kaun sa logic column lena hai ("logic" ya "dep_logic").
    Returns (occurrences, warnings)."""

    entries, warnings = [], []

    for index, row in enumerate(mapping_rows):
        parsed = parse_key(row.get("element"))

        if parsed is None:
            if index > 0:
                warnings.append(
                    f"Mapping line {row.get('line')}: "
                    f"'{row.get('element')}' not recognised."
                )
            continue

        segment, number = parsed
        entries.append({
            "line": row.get("line"),
            "element": f"{segment}{number:02d}",
            "segment": segment,
            "original_segment": segment,
            "number": number,
            "value": str(row.get("value") or "").strip(),
            "logic": str(row.get(logic_key) or "").strip(),
        })

    first_ins = next(
        (i for i, e in enumerate(entries) if e["original_segment"] == "INS"),
        None,
    )

    for index, entry in enumerate(entries):
        seg = entry["original_segment"]
        if seg in ALIASES and first_ins is not None and index < first_ins:
            entry["segment"] = ALIASES[seg]
            entry["element"] = f"{entry['segment']}{entry['number']:02d}"

    occurrences, current = [], None

    for entry in entries:
        starts_new = (
            current is None
            or current["segment"] != entry["segment"]
            or entry["number"] <= current["last"]
        )

        if starts_new:
            current = {
                "segment": entry["segment"],
                "elements": [],
                "last": 0,
            }
            occurrences.append(current)

        current["elements"].append(entry)
        current["last"] = entry["number"]

    for occurrence in occurrences:
        occurrence.pop("last", None)

    return occurrences, warnings
