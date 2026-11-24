"""
Pasted mapping text ko rules aur ordered mapping occurrences mein badalta hai.

Repeated REF01 / REF02 jaise codes ko overwrite nahi karta.
Original mapping order preserve karta hai.
"""

import re

# NM101 -> NM1 + 01
# N301  -> N3 + 01
# INS02 -> INS + 02
# IEA01 -> IEA + 01
KEY_PATTERN = re.compile(r"^([A-Z]+\d?)(\d{2})$")

# Mapping sheet mein INS se pehle aane wale IEA rows ko INS maana jayega.
ALIASES = {"IEA": "INS"}


def parse_rule(raw):
    raw = str(raw or "").strip().strip('"').strip()

    rule = {
        "raw": raw,
        "allowed": [],
        "null_ok": False,
        "not_used": False,
        "free_text": False,
        "placeholder": "",
    }

    for token in raw.split(","):
        token = token.strip()

        if not token:
            continue

        upper = token.upper()

        if upper == "NOT USED":
            rule["not_used"] = True

        elif upper == "NULL":
            rule["null_ok"] = True

        elif (
            (token.startswith("(") and token.endswith(")"))
            or (token.startswith("<") and token.endswith(">"))
        ):
            rule["free_text"] = True
            rule["placeholder"] = token[1:-1].strip()

        else:
            if " - " in token:
                token = token.split(" - ", 1)[0].strip()

            rule["allowed"].append(token)

    return rule


def _split_line(line):
    if "\t" in line:
        key, value = line.split("\t", 1)

    elif "|" in line:
        key, value = line.split("|", 1)

    else:
        parts = line.split(None, 1)

        if len(parts) < 2:
            return None, None

        key, value = parts

    return key.strip().upper(), value.strip()


def parse_mapping(text):
    rules = {}
    warnings = []
    entries = []

    # Parse mapping rows without losing their original order.
    for line_no, line in enumerate(
        (text or "").splitlines(),
        start=1,
    ):
        if not line.strip():
            continue

        key, value = _split_line(line)

        if key is None:
            warnings.append(
                f"Mapping line {line_no}: value nahi mili."
            )
            continue

        match = KEY_PATTERN.fullmatch(key)

        if not match:
            if line_no > 1:
                warnings.append(
                    f"Mapping line {line_no}: "
                    f"'{key}' pehchana nahi gaya."
                )
            continue

        segment = match.group(1).upper()
        element_number = int(match.group(2))

        entries.append(
            {
                "line": line_no,
                "original_segment": segment,
                "segment": segment,
                "element_number": element_number,
                "element": key,
                "value": value,
                "rule": parse_rule(value),
            }
        )

    # Find the first actual INS mapping.
    first_ins_index = next(
        (
            index
            for index, entry in enumerate(entries)
            if entry["original_segment"] == "INS"
        ),
        None,
    )

    # Apply IEA -> INS alias only before the first INS entry.
    for index, entry in enumerate(entries):
        segment = entry["original_segment"]

        if (
            segment in ALIASES
            and first_ins_index is not None
            and index < first_ins_index
        ):
            segment = ALIASES[segment]

        entry["segment"] = segment

    # Preserve the legacy rules dictionary for existing callers.
    # Repeated keys in this dictionary still represent only the latest
    # rule, so sequence-sensitive validation must use mapping_rows.
    for entry in entries:
        segment = entry["segment"]
        element_number = entry["element_number"]

        rules.setdefault(segment, {})
        rules[segment][element_number] = entry["rule"]

    # Each mapping row remains available in its original order.
    mapping_rows = [
        {
            "line": entry["line"],
            "element": entry["element"],
            "segment": entry["segment"],
            "element_number": entry["element_number"],
            "value": entry["value"],
            "rule": entry["rule"],
        }
        for entry in entries
    ]

    # A new occurrence begins when a segment changes or its element
    # number restarts/repeats, for example REF01, REF02, REF01, REF02.
    occurrences = []
    current_occurrence = None

    for entry in mapping_rows:
        segment = entry["segment"]
        number = entry["element_number"]

        starts_new = (
            current_occurrence is None
            or current_occurrence["segment"] != segment
            or number <= current_occurrence["last_element_number"]
        )

        if starts_new:
            current_occurrence = {
                "occurrence": len(occurrences) + 1,
                "segment": segment,
                "elements": [],
                "last_element_number": 0,
            }
            occurrences.append(current_occurrence)

        current_occurrence["elements"].append(entry)
        current_occurrence["last_element_number"] = number

    # Remove the internal helper field.
    for occurrence in occurrences:
        occurrence.pop("last_element_number", None)

    # Keep repeated segment occurrences in the ordered sequence.
    sequence = [
        occurrence["segment"]
        for occurrence in occurrences
    ]

    return {
        "rules": rules,
        "sequence": sequence,
        "mapping_rows": mapping_rows,
        "occurrences": occurrences,
        "warnings": warnings,
    }