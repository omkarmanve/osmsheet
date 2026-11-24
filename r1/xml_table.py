"""
Kisi bhi XML ko tables (rows + columns) me todta hai.

Record kaise pehchana jata hai:
  1. <Employee> / <User> mile to wahi record hai.
  2. Nahi to structure se: jo element baar-baar repeat hota hai (same parent
     ke andar, same naam ke kai non-leaf elements) wahi record hai.
     Wrapper elements (Root -> Users -> User) apne aap chhod diye jate hain.
  3. Repeat na ho to poora document ek record (ek row) banta hai.

Har record = ek row. Record ke andar:
  - har leaf tag ek column (tag ka naam = header), khali tag ka column bhi banta hai
  - attributes columns bante hain: Tag@attr (record ke apne attributes: @attr)
  - same tag dobara aaye to Tag, Tag#2, Tag#3
  - jo nested element kisi parent ke andar repeat hota hai (jaise
    <CoveredDependent> ya <Item>) wo alag table banta hai, har occurrence ki
    alag row, aur pehle 2-3 columns record se link karte hain:
    <Record>_Row, <Record>_ID, <Record>_Name
Root ke attributes ignore hote hain.
"""

import xml.etree.ElementTree as ET
from collections import Counter

from r1.xml_clean import (
    clean_xml_with_report,
    parse_error_issue,
)

EMPLOYEE_TAGS = ("employee", "user")
ALWAYS_CHILD = ("covereddependent", "dependent")

ID_KEYS = (
    "employeessn", "ssn", "socialsecuritynumber", "employeeid",
    "employeeassignedid", "userid", "id",
)


class XmlProblem(ValueError):
    """XML parse nahi ho saki; .issues me table ke liye rows hain."""

    def __init__(self, message, issues):
        super().__init__(message)
        self.issues = issues


def _simple_issue(kind, message):
    return {
        "level": "error", "type": kind, "line": "", "column": "",
        "message": message, "original": "", "fixed": "",
    }


def _name(tag):
    """Namespace hatao, case waisa hi rakho (header ke liye)."""
    return str(tag).split("}", 1)[-1]


class ColumnOrder:
    """Naya column us column ke theek baad aata hai jo us record me
    uske pehle tha (mapper.py wala merge-order)."""

    def __init__(self, initial=None):
        self.keys = list(initial or [])
        self.seen = set(self.keys)

    def merge(self, key, prev):
        if key in self.seen:
            return

        self.seen.add(key)

        if prev in self.seen and prev in self.keys:
            self.keys.insert(self.keys.index(prev) + 1, key)
        else:
            self.keys.append(key)


class _Table:
    def __init__(self, links):
        self.links = list(links)
        self.order = ColumnOrder(self.links)
        self.records = []


# ---------------------------------------------------------------
# Record detection
# ---------------------------------------------------------------
def find_records(root):
    """Returns [(table_name, [elements...]), ...]"""

    found = []

    def walk(element):
        if _name(element.tag).lower() in EMPLOYEE_TAGS:
            found.append(element)
            return
        for child in element:
            walk(child)

    walk(root)

    if found:
        return [(_name(found[0].tag), found)]

    node = root

    while True:
        kids = list(node)

        if not kids:
            return [(_name(node.tag), [node])]

        nonleaf = [k for k in kids if len(k)]
        leaves = [k for k in kids if not len(k)]

        counts = Counter(_name(k.tag) for k in nonleaf)
        groups = [
            (tag, [k for k in nonleaf if _name(k.tag) == tag])
            for tag, count in counts.items() if count >= 2
        ]

        if groups:
            return groups

        if not nonleaf:
            leaf_tags = {_name(k.tag) for k in leaves}
            if len(leaf_tags) == 1 and len(leaves) >= 2:
                return [(next(iter(leaf_tags)), leaves)]
            return [(_name(node.tag), [node])]

        if len(nonleaf) == 1 and not leaves:
            node = nonleaf[0]
            continue

        return [(_name(node.tag), [node])]


def find_child_tags(records):
    """Wo nested tags (lowercase) jo kisi parent ke andar repeat hote hain."""
    tags = set(ALWAYS_CHILD)
    stack = list(records)

    while stack:
        element = stack.pop()
        nonleaf = [c for c in element if len(c)]
        counts = Counter(_name(c.tag).lower() for c in nonleaf)
        tags.update(tag for tag, n in counts.items() if n >= 2)
        stack.extend(nonleaf)

    return tags


# ---------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------
def _add(key, value, rec, order, counts, state):
    counts[key] = counts.get(key, 0) + 1
    count = counts[key]
    full = key if count == 1 else f"{key}#{count}"

    order.merge(full, state["prev"])
    rec[full] = value
    state["prev"] = full


def _flatten(element, rec, order, counts, state, child_tags, children):
    for child in element:
        name = _name(child.tag)

        if len(child) == 0:
            _add(name, (child.text or "").strip(), rec, order, counts, state)
            for attr, value in child.attrib.items():
                _add(f"{name}@{_name(attr)}", value.strip(),
                     rec, order, counts, state)
            continue

        if name.lower() in child_tags or "dependent" in name.lower():
            children.append(child)
            continue

        for attr, value in child.attrib.items():
            _add(f"{name}@{_name(attr)}", value.strip(),
                 rec, order, counts, state)

        _flatten(child, rec, order, counts, state, child_tags, children)


def _lower_map(rec):
    mapping = {}
    for key, value in rec.items():
        if "#" in key or "@" in key:
            continue
        mapping.setdefault(key.lower(), value)
    return mapping


def _identify(rec):
    mapping = _lower_map(rec)

    ident = next((mapping[k] for k in ID_KEYS if mapping.get(k)), "")

    last, first = mapping.get("lastname", ""), mapping.get("firstname", "")
    label = " ".join(p for p in (last, first) if p)
    if not label:
        label = mapping.get("name", "") or mapping.get("fullname", "")

    return ident, label


def _link_names(top_name):
    return [f"{top_name}_Row", f"{top_name}_ID", f"{top_name}_Name"]


def _process(element, name, tables, child_tags, top):
    table = tables.get(name)

    if table is None:
        table = _Table([] if top is None else _link_names(top["name"]))
        tables[name] = table

    rec = {}
    state = {"prev": table.links[-1] if table.links else None}
    counts = {}
    children = []

    if top is not None:
        names = table.links
        rec[names[0]] = str(top["row"])
        rec[names[1]] = top["id"]
        rec[names[2]] = top["label"]

    if len(element) == 0:
        text = (element.text or "").strip()
        # sirf attributes wala khali element: faltu blank column nahi
        if text or not element.attrib:
            _add(name, text, rec, table.order, counts, state)

    for attr, value in element.attrib.items():
        _add(f"@{_name(attr)}", value.strip(), rec, table.order, counts, state)

    _flatten(element, rec, table.order, counts, state, child_tags, children)
    table.records.append(rec)

    if top is None:
        ident, label = _identify(rec)
        context = {
            "name": name,
            "row": len(table.records),
            "id": ident,
            "label": label,
        }
    else:
        context = top

    for child in children:
        _process(child, _name(child.tag), tables, child_tags, context)


def build_tables(xml_text):
    text = (xml_text or "").strip()

    if not text:
        raise XmlProblem(
            "XML is empty.", [_simple_issue("empty_xml", "XML is empty.")]
        )

    upper = text.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper:
        message = "DOCTYPE/ENTITY is not allowed in XML."
        raise XmlProblem(message, [_simple_issue("doctype_not_allowed", message)])

    text, repairs, issues = clean_xml_with_report(text)

    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        # Parse fail hui to "closing tags added" wali repair bhramak hai
        issues = [i for i in issues if i["type"] != "closing_tags_added"]
        problem = parse_error_issue(text, error)
        raise XmlProblem(
            f"Invalid XML: {problem['message']} "
            f"(line {problem['line']}, column {problem['column']})",
            issues + [problem],
        )

    groups = find_records(root)
    all_records = [el for _, els in groups for el in els]
    child_tags = find_child_tags(all_records)

    tables = {}

    for tag, elements in groups:
        for element in elements:
            _process(element, tag, tables, child_tags, None)

    result = []

    for name, table in tables.items():
        keys = list(table.order.keys)

        # Name link column agar poori khali hai to hata do
        for link in table.links:
            if link.endswith("_Name") and not any(
                rec.get(link) for rec in table.records
            ):
                keys = [k for k in keys if k != link]

        result.append({
            "name": name,
            "columns": keys,
            "rows": [[rec.get(k, "") for k in keys] for rec in table.records],
        })

    return {
        "ok": True,
        "tables": result,
        "issues": issues,
        "summary": {
            "tables": [
                {"name": t["name"], "rows": len(t["rows"]),
                 "columns": len(t["columns"])}
                for t in result
            ],
            "repairs": repairs,
        },
    }
