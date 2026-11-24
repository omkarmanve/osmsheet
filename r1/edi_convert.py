"""
Raw 834 (X12 EDI) text ko pipe-delimited format me badalna - bilkul UltraEdit macro
"834toSingleLine" ki tarah:

  1. segment ka end (`~` + line break)  ->  `|`
  2. `INS*Y*`  ->  nayi line + `|EE RECORD|`
  3. `INS*N*`  ->  nayi line + `|DEPENDENT RECORD|`
  4. `REF*0F*`  ->  `REF*0F*|`   (taaki SSN alag segment/cell bane)

Isse EE row `EE RECORD|18*030**A***FT|REF*0F*|300000001|NM1*...` jaisi ban jati hai
(INS01 hat jata hai, isliye pehla value INS02 hota hai).

Automatic tab hota hai jab text me `INS*Y*` / `INS*N*` ho aur `EE RECORD` /
`DEPENDENT RECORD` pehle se na ho (yaani macro already chal chuka hai to kuch nahi badalta).
Element separator (`*`) aur segment terminator (`~`) ISA header se liye jate hain
(ISA ka 4th aur 106th character), na mile to `*` aur `~`.
"""

import re


def _separators(text):
    element, terminator = "*", "~"

    head = text.lstrip("\ufeff \t\r\n")
    if head.startswith("ISA") and len(head) >= 106:
        candidate_element, candidate_term = head[3], head[105]
        if candidate_element not in "\r\n \t" and candidate_term not in "\r\n \t":
            element, terminator = candidate_element, candidate_term

    return element, terminator


def is_raw_834(text):
    if not isinstance(text, str) or not text.strip():
        return False

    element, _ = _separators(text)
    has_ins = (f"INS{element}Y{element}" in text) or (f"INS{element}N{element}" in text)
    already = "EE RECORD" in text or "DEPENDENT RECORD" in text

    return has_ins and not already


def convert_834(text):
    """Raw 834 -> pipe-delimited. Returns (text, converted: bool)."""
    if not is_raw_834(text):
        return text, False

    element, terminator = _separators(text)
    out = text.lstrip("\ufeff")

    out = re.sub(re.escape(terminator) + r"[\r\n]*", "|", out)
    out = out.replace(f"INS{element}Y{element}", "\n|EE RECORD|")
    out = out.replace(f"INS{element}N{element}", "\n|DEPENDENT RECORD|")
    out = out.replace(f"REF{element}0F{element}", f"REF{element}0F{element}|")

    return out, True
