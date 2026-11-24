def validate_rows(rows):
    """
    Validate table rows without removing or modifying data.
    """

    errors = []
    warnings = []

    if not rows:
        warnings.append("No data rows found.")

    for row_number, row in enumerate(rows, start=1):

        if not isinstance(row, dict):
            errors.append(
                f"Row {row_number}: invalid row format."
            )
            continue

        if not any(
            str(value).strip()
            for value in row.values()
        ):
            warnings.append(
                f"Row {row_number}: row is empty."
            )

    return {
        "errors": errors,
        "warnings": warnings,
        "valid": len(errors) == 0,
    }
