def detect_field_separator(data):
    """
    EDI segments ko separate karne wala delimiter detect karta hai.
    Example: |EE RECORD|INS|REF*0F*123|
    """

    candidates = ["|", "~", "\t", ";", ","]

    counts = {
        separator: data.count(separator)
        for separator in candidates
    }

    best_separator = max(
        counts,
        key=counts.get
    )

    if counts[best_separator] == 0:
        return "|"

    return best_separator


def parse_records(
    data,
    record_separator="auto",
    field_separator="auto",
    custom_record_separator="",
    custom_field_separator="",
):
    """
    Raw input ko logical records mein convert karta hai.

    Returns:
        records,
        detected_record_separator,
        detected_field_separator
    """

    if not isinstance(data, str) or not data.strip():
        return [], "\n", "|"

    # Segment separator
    if field_separator == "custom":
        if not custom_field_separator:
            raise ValueError(
                "Custom field separator is required."
            )

        detected_field_separator = custom_field_separator

    elif field_separator == "auto":
        detected_field_separator = detect_field_separator(data)

    else:
        detected_field_separator = field_separator

    # Record separator
    if record_separator == "custom":
        if not custom_record_separator:
            raise ValueError(
                "Custom record separator is required."
            )

        detected_record_separator = custom_record_separator

    elif record_separator == "auto":
        # Newline is the default logical record boundary.
        detected_record_separator = "\n"

    else:
        detected_record_separator = record_separator

    # A pipe may be the segment separator, not the record separator.
    # The user should select newline for record separation when
    # multiple segments appear on one line.
    if detected_record_separator == "newline":
        detected_record_separator = "\n"

    if detected_record_separator == "pipe":
        detected_record_separator = "|"

    if detected_record_separator == "tilde":
        detected_record_separator = "~"

    if detected_record_separator == "semicolon":
        detected_record_separator = ";"

    if detected_record_separator == "custom":
        detected_record_separator = custom_record_separator

    records = [
        record.strip()
        for record in data.split(detected_record_separator)
        if record.strip()
    ]

    return (
        records,
        detected_record_separator,
        detected_field_separator,
    )
