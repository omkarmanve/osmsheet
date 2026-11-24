"""
Pasted XML me se har employee (aur uske dependents) alag nikalta hai.

- Employee records: <Employee>/<User>, nahi to jo element repeat hota hai
  (r1.xml_table.find_records wali hi detection).
- Dependent block: employee ke andar koi bhi element (kisi bhi depth par)
  jiske naam me "dependent" ho aur jisme child tags hon
  (CoveredDependent, Dependent, ...). Ye employee ke fields me mix nahi hote.
- Kisi tag ki value ya logic yahan hard-coded nahi hai.
"""

import re
import xml.etree.ElementTree as ET

from r1.xml_clean import clean_xml_text, describe_parse_error
from r1.xml_table import find_records


def _local(tag):
    """Namespace hatao aur lowercase karo: '{ns}LastName' -> 'lastname'."""
    return str(tag).split("}", 1)[-1].lower()


def norm_id(value):
    """SSN compare ke liye: dash/space hatao, uppercase."""
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def _is_dependent_block(child):
    return len(child) > 0 and "dependent" in _local(child.tag)


def _dependent_blocks(element):
    for child in element:
        if len(child) == 0:
            continue

        if "dependent" in _local(child.tag):
            nested = [g for g in child if _is_dependent_block(g)]
            if nested:                      # <CoveredDependents><CoveredDependent>
                yield from nested
            else:
                yield child
        else:
            yield from _dependent_blocks(child)


def _collect(element, fields, values, names):
    for child in element:
        if _is_dependent_block(child):
            continue

        name = _local(child.tag)

        if len(child) == 0:
            # original-case naam (khali tags ke saath): logic engine ko chahiye
            names.setdefault(name, str(child.tag).split("}", 1)[-1])

            text = (child.text or "").strip()
            if text:
                fields.setdefault(name, []).append(text)
                values.append(text)
        else:
            _collect(child, fields, values, names)


def get_field(record, *names):
    """Record ke pehle non-empty tag ki value (tag name lowercase me do)."""
    for name in names:
        found = record["fields"].get(name.lower())
        if found:
            return found[0]
    return ""


def _find(fields, exact, suffixes):
    for name in exact:
        if fields.get(name):
            return fields[name][0]
    for key, values in fields.items():
        if values and any(key.endswith(s) for s in suffixes):
            return values[0]
    return ""


def _build_record(element, number):
    fields, values, names = {}, [], {}
    _collect(element, fields, values, names)

    record = {
        "number": number,
        "fields": fields,
        "tag_names": names,
        "id_values": {norm_id(v) for v in values if norm_id(v)},
    }

    record["first"] = _find(fields, ("firstname",), ("firstname",))
    record["last"] = _find(fields, ("lastname",), ("lastname",))
    record["dob"] = _find(
        fields, ("dateofbirth", "dob", "birthdate"), ("dateofbirth", "birthdate")
    )
    record["ssn"] = _find(
        fields, ("ssn", "employeessn", "dependentssn"),
        ("ssn", "socialsecuritynumber"),
    )

    ident = (
        get_field(record, "employeeid", "userid", "employeessn", "ssn")
        or record["ssn"]
    )
    record["label"] = ident or f"#{number}"

    return record


def parse_xml_users(xml_text):
    text = (xml_text or "").strip()

    if not text:
        raise ValueError("XML is empty.")

    # Entity expansion attacks se bachne ke liye DOCTYPE allow nahi.
    upper = text.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper:
        raise ValueError("DOCTYPE/ENTITY is not allowed in XML.")

    text = clean_xml_text(text)

    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise ValueError(describe_parse_error(text, error))

    elements = find_records(root)[0][1]
    users = []

    for number, element in enumerate(elements, start=1):
        user = _build_record(element, number)
        user["dependents"] = []

        for index, block in enumerate(_dependent_blocks(element), start=1):
            dependent = _build_record(block, index)
            name = " ".join(p for p in (dependent["last"], dependent["first"]) if p)
            dependent["label"] = dependent["ssn"] or name or f"dependent #{index}"
            user["dependents"].append(dependent)

        users.append(user)

    return users
