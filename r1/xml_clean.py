"""
Pasted XML ko parse se pehle saaf karta hai, aur har change/error ko
"issue" rows ke roop me report karta hai (line number, original line,
fixed line).

Line numbers user ke paste kiye text ke barabar rehte hain: jo hissa hatana
hota hai use spaces se badalte hain (newline rehti hai).
"""

import bisect
import re

# XML me allowed nahi hone wale control characters
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# '&' jo kisi entity (&amp; &#123; ...) ka hissa nahi hai
BARE_AMP = re.compile(
    r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)"
)

DECLARATION = re.compile(r"^\s*<\?xml[^>]*\?>")

ANY_TAG = re.compile(r"<([^<>]*)>")
TAG_TOKEN = re.compile(r"<(/?)([A-Za-z_][^\s<>/]*)[^<>]*?(/?)>")
DOUBLE_LT = re.compile(r"<(?:\s*<)+")
LINE_MISSING_LT = re.compile(
    r"(?m)^([ \t]*)((?:/[A-Za-z_][\w.\- ]*|[A-Za-z_][\w.\- ]*/)>)[ \t]*$"
)
LINE_MISSING_GT = re.compile(r"(?m)<([^<>\n!?][^<>\n]*)$")

MAX_DETAILS = 3000

MESSAGES = {
    "control_chars": "Invalid control character replaced with a space",
    "junk_text_removed": "Text outside the XML tags was ignored",
    "double_lt": "Extra '<' removed",
    "missing_lt": "Missing '<' added at the start of the tag",
    "missing_gt": "Missing '>' added at the end of the tag",
    "space_after_lt": "Space after '<' removed",
    "spaces_in_tag_names": "Spaces removed from tag name",
    "closing_tags_added": "Missing closing tag added at the end of the document",
    "bare_ampersand": "'&' replaced with '&amp;'",
}


def _blank(segment):
    return re.sub(r"[^\n]", " ", segment)


def _newlines(text):
    return [i for i, ch in enumerate(text) if ch == "\n"]


def _line(newlines, position):
    return bisect.bisect_left(newlines, position) + 1


def repair_tags(text, bump):
    """Sirf tags theek karta hai, values ko haath nahi lagata.
    bump(kind, line) har fix par bulaya jata hai."""

    # '<<Tag>' -> '<Tag>'
    newlines = _newlines(text)

    def double_lt(match):
        bump("double_lt", _line(newlines, match.start()))
        return "<"

    text = DOUBLE_LT.sub(double_lt, text)

    # line ke shuru ka '<' gayab: 'DependentEthnicity/>' ya '/Tag>'
    newlines = _newlines(text)

    def missing_lt(match):
        bump("missing_lt", _line(newlines, match.start()))
        return f"{match.group(1)}<{match.group(2)}"

    text = LINE_MISSING_LT.sub(missing_lt, text)

    # line ke end ka '>' gayab: '<Tag/'
    newlines = _newlines(text)

    def missing_gt(match):
        bump("missing_gt", _line(newlines, match.start()))
        return f"<{match.group(1)}>"

    text = LINE_MISSING_GT.sub(missing_gt, text)

    # Tag names ke andar spaces, '< Tag'
    newlines = _newlines(text)

    def fix(match):
        inner = match.group(1)
        stripped = inner.strip()

        if not stripped or stripped[0] in "!?":
            return match.group(0)

        line = _line(newlines, match.start())

        if inner[:1].isspace():
            bump("space_after_lt", line)

        closing = stripped.startswith("/")
        if closing:
            stripped = stripped[1:].strip()

        self_closing = stripped.endswith("/")
        if self_closing:
            stripped = stripped[:-1].strip()

        if "=" in stripped:
            # attributes wala tag (jaise <Transaction fileId='1'>): chhedo mat
            body = stripped
        else:
            body = re.sub(r"\s+", "", stripped)
            if body != stripped:
                bump("spaces_in_tag_names", line)

        return (
            "<" + ("/" if closing else "") + body
            + ("/" if self_closing else "") + ">"
        )

    text = ANY_TAG.sub(fix, text)

    # Aakhir me jo elements band nahi hue (jaise </Transaction> kata hua)
    stack = []
    for match in TAG_TOKEN.finditer(text):
        closing, name, self_closing = match.groups()

        if self_closing:
            continue
        if not closing:
            stack.append(name)
        elif stack and stack[-1] == name:
            stack.pop()

    if stack:
        text = text.rstrip() + "\n" + "".join(
            f"</{name}>" for name in reversed(stack)
        )
        bump("closing_tags_added", text.count("\n") + 1, len(stack))

    return text


def clean_xml_with_report(text):
    """Returns (cleaned_text, repair_counts, issue_rows)."""

    raw = (text or "").replace("\ufeff", "")
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    raw_lines = raw.split("\n")

    counts = {}
    notes = {}

    def bump(kind, line, amount=1):
        counts[kind] = counts.get(kind, 0) + amount

        key = (kind, line)
        if key in notes:
            notes[key] += amount
        elif len(notes) < MAX_DETAILS:
            notes[key] = amount

    text = raw

    newlines = _newlines(text)

    def control(match):
        bump("control_chars", _line(newlines, match.start()))
        return " "

    text = CONTROL.sub(control, text)

    # Pehle tag se pehle aur aakhri tag ke baad ka faltu text hatao
    first = text.find("<")
    last = text.rfind(">")

    if first != -1 and last != -1 and last > first:
        lead, tail = text[:first], text[last + 1:]
        newlines = _newlines(text)

        if lead.strip():
            bump("junk_text_removed",
                 _line(newlines, len(lead) - len(lead.lstrip())))
        if tail.strip():
            bump("junk_text_removed",
                 _line(newlines, last + 1 + len(tail) - len(tail.lstrip())))

        text = _blank(lead) + text[first:last + 1] + _blank(tail)

    # <?xml ... ?> declaration hatao (encoding str me already decode ho chuki)
    text = DECLARATION.sub(lambda m: _blank(m.group(0)), text)

    text = repair_tags(text, bump)

    newlines = _newlines(text)

    def amp(match):
        bump("bare_ampersand", _line(newlines, match.start()))
        return "&amp;"

    text = BARE_AMP.sub(amp, text)

    final_lines = text.split("\n")
    issues = []

    for (kind, line), amount in sorted(
        notes.items(), key=lambda item: (item[0][1], item[0][0])
    ):
        message = MESSAGES[kind]
        if amount > 1:
            message += f" (x{amount})"

        if kind == "closing_tags_added":
            original = ""
        elif 1 <= line <= len(raw_lines):
            original = raw_lines[line - 1].strip()[:200]
        else:
            original = ""

        fixed = (
            final_lines[line - 1].strip()[:200]
            if 1 <= line <= len(final_lines) else ""
        )

        issues.append({
            "level": "warning",
            "type": kind,
            "line": line,
            "column": "",
            "message": message,
            "original": original,
            "fixed": fixed,
        })

    return text, counts, issues


def clean_xml_text(text):
    return clean_xml_with_report(text)[0]


def parse_error_issue(text, error):
    """ET.ParseError -> ek issue row (line, column, us line ka text)."""
    position = getattr(error, "position", None)
    line, column, near = "", "", ""

    if position:
        line, column = position[0], position[1] + 1
        lines = text.split("\n")
        if 1 <= line <= len(lines):
            near = lines[line - 1].strip()[:200]

    message = re.sub(r"[:,]? ?line \d+, column \d+\s*$", "", str(error)).strip()

    return {
        "level": "error",
        "type": "parse_error",
        "line": line,
        "column": column,
        "message": message or str(error),
        "original": near,
        "fixed": "",
    }


def describe_parse_error(text, error):
    message = f"Invalid XML: {error}"
    position = getattr(error, "position", None)

    if position:
        line = position[0]
        lines = text.split("\n")
        if 1 <= line <= len(lines):
            snippet = lines[line - 1].strip()[:80]
            message += f" | Near: {snippet!r}"

    return message
