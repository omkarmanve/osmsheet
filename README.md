# EDI Mapper

A tool that displays EDI data (pipe-separated records) in an Excel-like grid.

It allows you to:

1. Paste EDI data and arrange each segment into the correct column, leaving blank cells where data is missing.
2. Set the column sequence according to your requirements.
3. Paste mapping data from Excel and validate EE (employee) rows according to mapping rules.
4. Export the result to Excel (`.xlsx`).

Data is not stored anywhere. Everything is sent with the request and returned in the response.

---

## 1. How to Run

### Windows PowerShell

```powershell
cd edi_mapper
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

> Always run the command from the folder containing `main.py`.

---

## 2. Project Structure

```text
edi_mapper/
├── main.py
├── requirements.txt
├── README.md
├── render.yaml
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── validation.js
│   ├── import.js
│   ├── logic.js
│   ├── xml_table.js
│   │
│   └── round2/
│       ├── index.html
│       ├── style.css
│       └── round2.js
│
├── r1/
│   ├── __init__.py
│   ├── parser.py
│   ├── mapper.py
│   ├── checks.py
│   ├── mapping_parser.py
│   ├── validator.py
│   ├── validate_api.py
│   ├── edi_convert.py
│   ├── xml_parser.py
│   ├── xml_clean.py
│   ├── xml_table.py
│   ├── xml_table_api.py
│   ├── logic_dsl.py
│   ├── logic_mapping.py
│   ├── logic_runner.py
│   └── logic_api.py
│
└── r2/
    ├── __init__.py
    ├── api.py
    └── compare.py
```

---

## 3. Application Overview

The application processes EDI data, mapping rules, XML data, and Excel files.

```text
EDI Data
   |
   v
POST /api/process
   |
   +--> Parser
   |
   +--> Mapper
   |
   +--> Validation
   |
   v
Spreadsheet Grid
   |
   +--> Mapping Validation
   |
   +--> XML Logic Validation
   |
   +--> XML to Table
   |
   +--> Round 2 Excel Comparison
```

---

# Round 1

## 4. EDI Processing

The application accepts EDI data and converts it into an Excel-like spreadsheet.

### Supported Separators

```text
|
~
TAB
;
,
```

The application can automatically detect the field separator.

Users can also select a custom separator.

---

## 5. EDI Parser

File:

```text
r1/parser.py
```

Responsibilities:

- Detect field separator.
- Detect record separator.
- Split EDI data into records.
- Support custom separators.
- Remove empty records.

---

## 6. EDI Mapper

File:

```text
r1/mapper.py
```

The mapper creates spreadsheet columns based on segment keys.

Examples:

```text
INS
REF*0F
REF*1L
DMG*D8
DTP*348
HD*030
NM1
PER
N3
N4
```

Missing segments do not shift other data into the wrong column.

The corresponding cell remains blank.

### Repeated Segments

Repeated segments receive separate columns.

Example:

```text
DTP*348
DTP*348#2
DTP*348#3
```

Similarly:

```text
REF*1L
REF*1L#2
```

Data is not merged.

---

## 7. Column Sequence

The application supports custom column sequencing.

Users can:

- Add sequence items.
- Delete sequence items.
- Change sequence order.
- Apply the sequence.
- Preserve original data.

If a segment is not available in the selected sequence, it can be placed into an additional column.

---

## 8. Basic Validation

File:

```text
r1/checks.py
```

Basic validation checks include:

- Empty rows.
- Invalid row structures.
- Missing data.
- General warnings.

The validation does not modify the original EDI data.

---

# Mapping Validation

## 9. Mapping Parser

File:

```text
r1/mapping_parser.py
```

The application accepts mapping data copied directly from Excel.

Example:

```text
INS02    01,18,19,53
INS03    30
```

The parser converts the mapping into validation rules.

### Supported Mapping Values

```text
01,18,19,53
30
NOT USED
NULL
<SSN>
<LastName>
A - Active
```

---

## 10. Mapping Validation

Files:

```text
r1/validator.py
r1/validate_api.py
```

Endpoint:

```text
POST /api/validate
```

Validation status:

```text
Green  = Pass
Red    = Error
Yellow = Warning
```

Validation issues are displayed in the UI.

---

# XML Validation

## 11. XML Processing

The application supports XML validation against mapping logic.

Files:

```text
r1/xml_parser.py
r1/xml_clean.py
r1/logic_dsl.py
r1/logic_mapping.py
r1/logic_runner.py
r1/logic_api.py
```

The XML workflow supports:

```text
Employee
User
CoveredDependent
Dependent
```

---

## 12. XML Cleaning

The XML cleaner handles common copied XML problems.

Examples include:

```text
BOM
Control characters
Unnecessary text
Bare &
Malformed tag spacing
```

It can repair common formatting problems before XML parsing.

---

## 13. XML to Table

Files:

```text
r1/xml_table.py
r1/xml_table_api.py
frontend/xml_table.js
```

XML can be converted into an Excel-like table.

Features include:

- XML paste.
- XML file upload.
- Employee table.
- Dependent table.
- Search.
- Column filters.
- Hide empty columns.
- Pagination.
- Excel export.

Repeated tags are represented separately.

Example:

```text
Phone
Phone#2
Phone#3
```

---

# Logic Validation

## 14. Logic Check

The Logic Check compares XML data against mapping logic.

Example:

```text
NM103 | (Last Name) | <LastName>
```

Supported logic examples include:

```text
Hardcoded to "Y"
030 - Audit or Compare
[Blank]
NOT USED
<EmployeeSSN>
<LastName>
<CurrentEffectiveDate>
```

Supported conditions include:

```text
=
equals
not equals
!=
starts with
ends with
contains
is null
is not null
AND
OR
```

Unsupported logic generates warnings instead of silently passing.

---

# Employee and Dependent Validation

## 15. Employee Matching

Employee matching can use:

```text
SSN
Name
DOB
```

when available.

The matching process is strict.

If a corresponding XML employee cannot be found, an issue is generated.

---

## 16. Dependent Matching

Dependent records are matched under the correct employee.

Matching can use:

```text
Dependent Name
Dependent DOB
Dependent SSN
Employee relationship
```

Dependent SSN can be obtained from fields such as:

```text
NM109
REF*0F
```

Incorrect SSNs generate an error such as:

```text
Dependent SSN does not match
```

Dependents that exist in XML but are not found in the spreadsheet can generate warnings.

---

# File Import

## 17. EDI File Import

The application supports:

- Import File.
- Drag and drop.
- Paste EDI text.

Supported encodings include:

```text
UTF-8
UTF-16
Windows-1252
BOM
```

---

# Raw 834 Conversion

## 18. X12 834 Auto Conversion

Raw X12 834 files can be converted automatically.

For example:

```text
INS*Y*
INS*N*
```

can be converted into employee/dependent record structures.

The application can also detect separators from the ISA header.

Already converted data is not converted again.

The `/api/process` response includes:

```json
{
  "converted_from_834": true
}
```

or:

```json
{
  "converted_from_834": false
}
```

---

# Round 2

## 19. Excel Comparison

Round 2 compares Excel workbooks.

Files:

```text
r2/api.py
r2/compare.py
frontend/round2/index.html
frontend/round2/style.css
frontend/round2/round2.js
```

Supported Excel formats:

```text
.xlsx
.xlsm
.xltx
.xltm
```

The comparison supports:

- Old Excel file.
- New Excel file.
- Scenario Excel file.
- Sheet selection.
- Header row selection.
- Employee/SSN-based comparison.
- Added records.
- Removed records.
- Changed values.
- Unchanged records.
- Scenario data.

### Round 2 API

Endpoint:

```text
POST /api/r2/compare
```

The API receives:

```text
old_excel
new_excel
scenario_excel
old_sheet
new_sheet
scenario_sheet
header_row
```

The comparison response contains:

```text
summary
comparison
scenario
files
sheets
header_row
```

---

## 20. Round 2 Comparison Result

### Changed

Records that exist in both files but contain different values.

### Added

Records that exist in the new file but not in the old file.

### Removed

Records that exist in the old file but not in the new file.

### Unchanged

Records that exist in both files and have matching values.

---

# API Reference

## 21. Process API

Endpoint:

```text
POST /api/process
```

Request:

```json
{
  "data": "...",
  "record_separator": "auto",
  "field_separator": "auto",
  "custom_record_separator": "",
  "custom_field_separator": ""
}
```

Response contains:

```text
columns
rows
record_count
employee_count
dependent_count
errors
warnings
converted_from_834
```

---

## 22. Validation API

Endpoint:

```text
POST /api/validate
```

Example:

```json
{
  "mapping": "INS02\t01,18,19,53\nINS03\t30",
  "rows": [
    {
      "row_index": 0,
      "cells": [
        "EE RECORD",
        "18*030**A***FT"
      ]
    }
  ]
}
```

Response contains:

```text
issues
validated_cells
summary
mapping_warnings
```

---

# Data Privacy

## 23. Data Handling

The application does not require a database for normal processing.

Uploaded EDI, Excel, mapping, and XML data is processed during the request.

The application does not intentionally persist business data.

Mapping data remains available in browser memory during the current session.

---

# Development

## 24. Start Development Server

```powershell
python -m uvicorn main:app --reload
```

The application starts at:

```text
http://127.0.0.1:8000
```

Round 2:

```text
http://127.0.0.1:8000/round2
```

---

# Common Errors

## 25. `Could not import module "main"`

Run the command from the folder containing:

```text
main.py
```

---

## 26. `No module named "fastapi"`

Activate the virtual environment:

```powershell
.\venv\Scripts\activate
```

Then install dependencies:

```powershell
pip install -r requirements.txt
```

---

## 27. JavaScript Changes Are Not Visible

Use:

```text
Ctrl + F5
```

or open Developer Tools and disable browser cache while developing.

---

## 28. Port Already in Use

If port `8000` is already occupied, stop the previous Uvicorn process or run on another port:

```powershell
python -m uvicorn main:app --reload --port 8001
```

---

# Deployment

## 29. Render Deployment

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Configure environment variables:

```text
APP_USERNAME
APP_PASSWORD
```

`APP_USERNAME` defaults to:

```text
admin
```

If `APP_PASSWORD` is not configured locally, login protection is disabled.

---

## 30. GitHub

The project repository should contain the project files directly:

```text
main.py
requirements.txt
frontend/
r1/
r2/
render.yaml
README.md
```

Do not commit:

```text
venv/
__pycache__/
```

These should be excluded using `.gitignore`.

---

# Project Features

The current application includes:

- EDI 834 processing.
- EDI segment mapping.
- Excel-style spreadsheet display.
- Custom column sequencing.
- Mapping validation.
- Employee validation.
- Dependent validation.
- XML parsing.
- XML cleaning.
- XML-to-table conversion.
- XML search and filters.
- Logic validation.
- Employee/XML matching.
- Dependent/XML matching.
- EDI file import.
- Raw X12 834 conversion.
- Excel export.
- Round 2 Excel comparison.
- Added/removed/changed record detection.
- Scenario Excel support.
- FastAPI backend.
- Browser-based frontend.
- Render deployment support.

---

# License

Add your preferred license here if this project will be distributed publicly.
