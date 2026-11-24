def map_records(records, field_separator="|"):
    parsed_records = []
    employee_count = 0
    dependent_count = 0

    key_order = ["TYPE"]

    def get_key(segment):
        parts = segment.split("*")
        tag = parts[0].strip()

        # Numeric segment followed by *
        # Examples: 18*030, 20*ABC, 01*XYZ
        if tag.isdigit() and len(parts) > 1:
            return "NUMBER"

        # INS segment
        if tag == "INS":
            return "INS"

        # REF qualifier
        if tag == "REF" and len(parts) > 1:
            return f"REF*{parts[1].strip()}"

        # DMG qualifier
        if tag == "DMG" and len(parts) > 1:
            return f"DMG*{parts[1].strip()}"

        # DTP qualifier
        if tag == "DTP" and len(parts) > 1:
            return f"DTP*{parts[1].strip()}"

        # HD qualifier
        if tag == "HD" and len(parts) > 1:
            return f"HD*{parts[1].strip()}"

        # Standalone numeric segment: SSN/ID
        if tag.isdigit():
            return "SSN"

        return tag

    def merge_key(key, prev_key):
        if key in key_order:
            return

        if prev_key in key_order:
            key_order.insert(key_order.index(prev_key) + 1, key)
        else:
            key_order.append(key)

    for record in records:
        if not isinstance(record, str) or not record.strip():
            continue

        raw_segments = record.split(field_separator)

        # Remove starting and ending empty segments
        if raw_segments and raw_segments[0] == "":
            raw_segments = raw_segments[1:]

        if raw_segments and raw_segments[-1] == "":
            raw_segments = raw_segments[:-1]

        if not raw_segments:
            continue

        record_type = raw_segments[0].strip()
        data_segments = raw_segments[1:]

        if "EE RECORD" in record_type:
            employee_count += 1
        elif "DEPENDENT RECORD" in record_type:
            dependent_count += 1

        # Every record gets its own row map
        row_map = {"TYPE": record_type}
        prev_key = "TYPE"

        # Ek record me same segment kitni baar aaya (DTP*348, REF*1L ...)
        occurrences = {}

        for seg in data_segments:
            if not seg.strip():
                continue

            base_key = get_key(seg)

            # Repeated segment ko alag column milta hai:
            # 1st -> "DTP*348", 2nd -> "DTP*348#2", 3rd -> "DTP*348#3"
            occurrences[base_key] = occurrences.get(base_key, 0) + 1
            count = occurrences[base_key]

            key = base_key if count == 1 else f"{base_key}#{count}"

            merge_key(key, prev_key)

            row_map[key] = seg

            prev_key = key

        parsed_records.append(row_map)

    columns = [
        f"Column_{i + 1}"
        for i in range(len(key_order))
    ]

    rows = []

    for row_map in parsed_records:
        row = {}

        for col_name, key in zip(columns, key_order):
            row[col_name] = row_map.get(key, "")

        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "employee_count": employee_count,
        "dependent_count": dependent_count,
    }