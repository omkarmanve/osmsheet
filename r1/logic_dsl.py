"""
Mapping ke "logic" column ka free text samajhna aur XML se expected value
nikalna.

Ye har tarah ka English nahi samajhta; ye in patterns ko samajhta hai:

  Hardcoded to "Y"                 -> constant
  030 - Audit or Compare           -> constant (code - description)
  [Blank] / NOT USED               -> blank hona chahiye
  <EmployeeSSN>                    -> XML tag ki value
  Middle Initial                   -> MiddleName ka pehla letter
  <CurrentEffectiveDate> of 10/01/2026 or thereafter
  If AddressLine2 is not null then set to AddressLine2
  IF <A> starts with "X" THEN set INS05 = "S" ELSE IF <B> = "Y" THEN "C" ELSE "A"
  if BPTier=3 set IND           (abbreviation: BPTier = BenefitPlanTier)
  remove spaces from <Tag>
  (Note: If the A is prior to the B, use the B ...)

Conditions: =, equals, not equals, !=, starts with, ends with, contains,
is null, is not null, AND, OR.

Jo samajh nahi aata wo "unsupported" rule banta hai (chup-chaap pass nahi hota).
Lookup tables (LUT / Mapping from table) "unverifiable" hote hain.

Semantics (ek hi element ke liye likhe kai IF statements):
  - IF/ELSE IF branch sach ho to wo value set hoti hai, aur baad ke statement
    use override kar sakte hain.
  - Statement ka akhri ELSE tabhi chalta hai jab ab tak koi branch fire na hua ho.
  - Kuch fire na ho to value blank maani jati hai.
"""

import re
from datetime import date

PH = "\x00"
PH_RE = re.compile(r"\x00(\d+)\x00")

QUOTE_FIX = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'"})

BLANKS = {
    "[blank]", "blank", "[empty]", "empty", "[null]", "null", "not used",
}


class LogicParseError(Exception):
    pass


# ---------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------
def _norm(name):
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def parse_date(text):
    text = str(text or "").strip()

    match = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", text)
    if match:
        y, m, d = map(int, match.groups())
    else:
        match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
        if not match:
            return None
        m, d, y = map(int, match.groups())

    try:
        return date(y, m, d)
    except ValueError:
        return None


def same(a, b):
    a = str(a).strip().upper()
    b = str(b).strip().upper()

    if a == b:
        return True

    return a.isdigit() and b.isdigit() and int(a) == int(b)


def _split_camel(tag):
    return re.findall(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+", tag)


def abbrev_match(token, tag):
    """BPTier / BPT -> BenefitPlanTier (har word ka prefix, order me)."""
    words = [w.lower() for w in _split_camel(tag)]
    token = token.lower()

    if len(token) < 2 or not words:
        return False

    def ok(pos, index):
        if index == len(words):
            return pos == len(token)
        word = words[index]
        for k in range(1, len(word) + 1):
            if token.startswith(word[:k], pos) and ok(pos + k, index + 1):
                return True
        return False

    return ok(0, 0)


# ---------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------
def _hold(quotes, value):
    quotes.append(value)
    return f"{PH}{len(quotes) - 1}{PH}"


def _restore(text, quotes):
    return PH_RE.sub(lambda m: quotes[int(m.group(1))], text)


def _clean_tail(text):
    return text.strip().strip(",;").strip()


def _as_field(text, quotes):
    t = _clean_tail(text)

    match = PH_RE.fullmatch(t)
    if match:
        return ("const", quotes[int(match.group(1))], False)

    match = re.fullmatch(r"<([^<>]+)>", t)
    if match:
        return ("field", match.group(1).strip(), None)

    if not t:
        raise LogicParseError("empty operand")

    return ("field", t, None)


def _as_literal(text, quotes):
    t = _clean_tail(text)

    match = PH_RE.fullmatch(t)
    if match:
        return ("const", quotes[int(match.group(1))], False)

    match = re.fullmatch(r"<([^<>]+)>", t)
    if match:
        return ("field", match.group(1).strip(), None)

    return ("const", _restore(t, quotes).strip(), False)


ATOM_PATTERNS = [
    ("null_not", re.compile(r"(?i)^(.+?)\s+is\s+not\s+(?:null|blank|empty)$")),
    ("null", re.compile(r"(?i)^(.+?)\s+is\s+(?:null|blank|empty)$")),
    ("startswith", re.compile(r"(?i)^(.+?)\s+starts?\s+with\s+(.+)$")),
    ("endswith", re.compile(r"(?i)^(.+?)\s+ends?\s+with\s+(.+)$")),
    ("contains", re.compile(r"(?i)^(.+?)\s+contains\s+(.+)$")),
    ("ne", re.compile(r"(?i)^(.+?)\s*(?:!=|<>)\s*(.+)$")),
    ("ne", re.compile(r"(?i)^(.+?)\s+not\s+equals?(?:\s+to)?\s+(.+)$")),
    ("eq", re.compile(r"(?i)^(.+?)\s*==\s*(.+)$")),
    ("eq", re.compile(r"(?i)^(.+?)\s+equals?(?:\s+to)?\s+(.+)$")),
    ("eq", re.compile(r"^(.+?)\s*=\s*(.+)$")),
]


def _parse_atom(text, quotes):
    t = _clean_tail(text)

    for op, pattern in ATOM_PATTERNS:
        match = pattern.match(t)
        if not match:
            continue

        left = _as_field(match.group(1), quotes)

        if op in ("null", "null_not"):
            return ("null", left, op == "null_not")

        return ("cmp", op, left, _as_literal(match.group(2), quotes))

    raise LogicParseError(f"condition not understood: {_restore(t, quotes)!r}")


def _parse_cond(text, quotes):
    or_parts = re.split(r"(?i)\s+or\s+", text.strip())
    ors = []

    for part in or_parts:
        ands = [
            _parse_atom(piece, quotes)
            for piece in re.split(r"(?i)\s+and\s+", part.strip())
        ]
        ors.append(ands[0] if len(ands) == 1 else ("and", ands))

    return ors[0] if len(ors) == 1 else ("or", ors)


def _parse_action(text, quotes):
    t = _clean_tail(text)
    t = re.sub(r"(?i)^set\s+", "", t)
    t = re.sub(r"(?i)^to\s+", "", t)
    t = re.sub(r"^[A-Za-z]{2,4}\d{2}\s*=\s*", "", t)
    t = _clean_tail(t).rstrip(".").strip()

    low = _restore(t, quotes).lower()

    if (
        low in BLANKS
        or "empty segment" in low
        or low.startswith("send as empty")
        or low in ("not sent", "do not send")
    ):
        return ("const", "", False)

    match = PH_RE.fullmatch(t)
    if match:
        return ("const", quotes[int(match.group(1))], False)

    match = re.fullmatch(r"<([^<>]+)>", t)
    if match:
        return ("field", match.group(1).strip(), None)

    match = re.fullmatch(r"(?i)remove\s+spaces\s+from\s+<([^<>]+)>", t)
    if match:
        return ("strip_spaces", ("field", match.group(1).strip(), None))

    if re.search(r"(?i)mapping|lookup|\blut\b|\btable\b", t):
        return ("unverifiable", f"needs a lookup/mapping that is not available here: {_restore(t, quotes)}", [])

    if re.fullmatch(r"[A-Za-z0-9_]+", t):
        return ("bare", t)

    raise LogicParseError(f"action not understood: {_restore(t, quotes)!r}")


def _parse_if(protected, quotes):
    adjust = []

    for note in re.findall(r"\(([^()]*)\)", protected):
        match = re.search(
            r"(?i)if\s+(?:the\s+)?(\w+)\s+is\s+prior\s+to\s+(?:the\s+)?(\w+)"
            r"\s*,?\s*use\s+(?:the\s+)?(\w+)",
            note,
        )
        if match:
            adjust.append(match.groups())

    body = re.sub(r"\([^()]*\)", " ", protected)
    parts = re.split(r"(?i)\b(else\s+if|else|if)\b", body)

    if parts[0].strip():
        raise LogicParseError("text before the first IF")

    statements = []
    current = None

    for i in range(1, len(parts), 2):
        keyword = re.sub(r"\s+", " ", parts[i].lower())
        chunk = parts[i + 1]

        if keyword in ("if", "else if"):
            if keyword == "if":
                current = {"branches": [], "else": None}
                statements.append(current)
            elif current is None:
                raise LogicParseError("ELSE IF without IF")

            split = re.search(r"(?i)\b(then|set)\b", chunk)
            if not split:
                raise LogicParseError("THEN/set not found after the condition")

            cond = _parse_cond(chunk[:split.start()], quotes)
            action_text = chunk[split.start():]
            action_text = re.sub(r"(?i)^then\b", "", action_text.strip())
            action = _parse_action(action_text, quotes)
            current["branches"].append((cond, action))
        else:
            if current is None:
                raise LogicParseError("ELSE without IF")
            current["else"] = _parse_action(chunk, quotes)

    if not statements:
        raise LogicParseError("no IF statement found")

    return {"kind": "statements", "statements": statements, "adjust": adjust}


def _parse(text):
    quotes = []
    protected = re.sub(r'"([^"]*)"', lambda m: _hold(quotes, m.group(1)), text)
    low = protected.lower().strip().rstrip(".")

    if low in BLANKS:
        return {"kind": "expr", "expr": ("const", "", False)}

    match = re.match(
        r"(?i)^hard\s*-?\s*coded\s*(?:to|as|value|=|:)?\s*(.+?)\s*\.?$", protected
    )
    if match:
        value = _restore(match.group(1), quotes).strip().strip('"').strip()
        return {"kind": "expr", "expr": ("const", value, False)}

    match = re.match(r"^([A-Za-z0-9]{1,6})\s+[-\u2013]\s+(.+)$", protected)
    if match and not low.startswith("if "):
        return {"kind": "expr", "expr": ("const", match.group(1), True)}

    if re.match(r"(?i)^refer\b", protected) or re.search(r"(?i)\bLUT\b", protected):
        if not re.match(r"(?i)^if\b", protected):
            fields = re.findall(r"<([^<>]+)>", protected)
            return {
                "kind": "expr",
                "expr": ("unverifiable", "needs a lookup table (LUT) that is not available here", fields),
            }

    match = re.fullmatch(r"<([^<>]+)>", protected.strip())
    if match:
        return {"kind": "expr", "expr": ("field", match.group(1).strip(), None)}

    match = re.fullmatch(
        r"(?i)<([^<>]+)>\s+of\s+(\d{1,2}/\d{1,2}/\d{4})\s+or\s+(?:thereafter|later|after)\.?",
        protected.strip(),
    )
    if match:
        return {
            "kind": "expr",
            "expr": ("field", match.group(1).strip(), match.group(2)),
        }

    match = re.fullmatch(r"(?i)([A-Za-z]+)\s+initial\.?", protected.strip())
    if match:
        return {"kind": "expr", "expr": ("initial", match.group(1) + "Name")}

    if re.search(r"(?i)\bif\b", protected):
        return _parse_if(protected, quotes)

    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", protected.strip()):
        return {"kind": "expr", "expr": ("bare", protected.strip())}

    raise LogicParseError("pattern not recognised")


def parse_logic(raw):
    text = re.sub(r"\s+", " ", str(raw or "").translate(QUOTE_FIX)).strip()

    if not text:
        return {"kind": "none", "text": ""}

    try:
        rule = _parse(text)
    except LogicParseError as error:
        return {"kind": "unsupported", "text": text, "reason": str(error)}

    rule["text"] = text
    return rule


# ---------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------
class Context:
    """XML ke fields; tag names fuzzy (case/space/abbreviation).

    Dependent ke liye parent=employee do: pehle dependent ke tags dekhe jate
    hain, na mile to employee ke."""

    def __init__(self, user, parent=None):
        self.layers = [self._layer(user)]
        if parent is not None:
            self.layers.append(self._layer(parent))
        self.missing = []        # XML me na mile / ambiguous tag names
        self.ambiguous = {}      # naam -> [kai tags jo match hue]
        self.hints = {}          # dependent logic me employee ka tag liya gaya
        self.preferred = set()   # jo tags pehle saaf (unique) resolve ho chuke
        self._cache = {}

    @staticmethod
    def _layer(user):
        names = user.get("tag_names", {})
        return {
            "fields": user["fields"],
            "names": names,
            "by_norm": {_norm(k): k for k in names},
        }

    def _note_hint(self, name, wanted, layer_index, key):
        """Dependent logic me employee wala tag liya gaya par dependent ka apna tag bhi hai."""
        if layer_index == 0 or len(self.layers) < 2:
            return

        cores = {wanted}
        if wanted.startswith("employee"):
            cores.add(wanted[len("employee"):])

        own = [
            original for original in self.layers[0]["names"].values()
            if any(c and _norm(original).endswith(c) and _norm(original) != c for c in cores)
        ]

        if own:
            parent_tag = self.layers[layer_index]["names"][key]
            self.hints[name] = (parent_tag, own)

    def resolve(self, name):
        if name in self._cache:
            return self._cache[name]

        found = None
        wanted = _norm(name)

        for index, layer in enumerate(self.layers):
            if wanted in layer["by_norm"]:
                key = layer["by_norm"][wanted]
                found = (layer, key)
                self.preferred.add((index, key))
                self._note_hint(name, wanted, index, key)
                break

        if found is None and " " not in name.strip():
            for index, layer in enumerate(self.layers):
                matches = [
                    k for k, original in layer["names"].items()
                    if abbrev_match(name, original)
                ]

                if len(matches) > 1:
                    # BPT = BenefitPlanTier ya BenefitPlanType? Jo tag isi logic me pehle
                    # saaf naam se aa chuka hai wahi lo.
                    preferred = [k for k in matches if (index, k) in self.preferred]
                    if len(preferred) == 1:
                        matches = preferred
                    else:
                        self.ambiguous[name] = [layer["names"][k] for k in matches]

                if len(matches) == 1:
                    key = matches[0]
                    found = (layer, key)
                    self.preferred.add((index, key))
                    self.ambiguous.pop(name, None)
                    self._note_hint(name, wanted, index, key)
                    break

        if found is not None or name not in self.ambiguous:
            self._cache[name] = found
        return found

    def get(self, name):
        found = self.resolve(name)

        if found is None:
            if name not in self.missing:
                self.missing.append(name)
            return ""

        layer, key = found
        values = layer["fields"].get(key)
        return values[0] if values else ""


def _result(value, unverifiable=None, min_date=None):
    return {"value": value, "unverifiable": unverifiable, "min_date": min_date}


def eval_expr(expr, ctx):
    kind = expr[0]

    if kind == "const":
        return _result(expr[1])

    if kind == "field":
        return _result(ctx.get(expr[1]), None, expr[2])

    if kind == "strip_spaces":
        inner = eval_expr(expr[1], ctx)
        return _result(inner["value"].replace(" ", ""))

    if kind == "initial":
        return _result(ctx.get(expr[1])[:1])

    if kind == "bare":
        token = expr[1]
        if ctx.resolve(token) is not None:
            return _result(ctx.get(token))
        if token.upper() == token:
            return _result(token)          # EMP, FAM, TE ... literal code
        return _result(ctx.get(token))     # CamelCase = missing XML tag

    if kind == "unverifiable":
        reason = expr[1]
        fields = expr[2] if len(expr) > 2 else []
        if fields:
            key = "|".join(ctx.get(f) for f in fields)
            reason += f" (key = {key})"
        return _result("", reason)

    raise LogicParseError(f"unknown expression {kind}")


def eval_cond(cond, ctx):
    kind = cond[0]

    if kind == "and":
        return all(eval_cond(c, ctx) for c in cond[1])

    if kind == "or":
        return any(eval_cond(c, ctx) for c in cond[1])

    if kind == "null":
        value = eval_expr(cond[1], ctx)["value"].strip()
        return (value != "") if cond[2] else (value == "")

    op = cond[1]
    left = eval_expr(cond[2], ctx)["value"].strip()
    right = eval_expr(cond[3], ctx)["value"].strip()

    if op == "eq":
        return same(left, right)
    if op == "ne":
        return not same(left, right)
    if op == "startswith":
        return left.upper().startswith(right.upper())
    if op == "endswith":
        return left.upper().endswith(right.upper())
    return right.upper() in left.upper()


def is_data_dependent(rule):
    if rule["kind"] == "statements":
        return True
    return rule["expr"][0] != "const"


def is_pure_field(rule):
    return rule["kind"] == "expr" and rule["expr"][0] == "field"


def is_qualifier_const(rule):
    return rule["kind"] == "expr" and rule["expr"][0] == "const" and rule["expr"][2]


def evaluate(rule, ctx):
    """Returns {"value", "unverifiable", "min_date"}."""

    if rule["kind"] == "expr":
        return eval_expr(rule["expr"], ctx)

    value, unverifiable, fired = "", None, False

    for statement in rule["statements"]:
        matched = False

        for cond, action in statement["branches"]:
            if eval_cond(cond, ctx):
                result = eval_expr(action, ctx)
                value, unverifiable = result["value"], result["unverifiable"]
                fired = matched = True
                break

        if not matched and statement["else"] is not None and not fired:
            result = eval_expr(statement["else"], ctx)
            value, unverifiable = result["value"], result["unverifiable"]
            fired = True

    if fired and value and not unverifiable:
        for a_name, b_name, c_name in rule.get("adjust", []):
            a_text = ctx.get(a_name)
            a_date, b_date = parse_date(a_text), parse_date(ctx.get(b_name))
            if value == a_text and a_date and b_date and a_date < b_date:
                value = ctx.get(c_name)

    return _result(value, unverifiable)
