EDI Mapper
A tool that displays EDI data (pipe-separated records) in an Excel-like
grid.

It allows you to:
1. Paste EDI data and arrange each segment into the correct column,
   leaving blank cells where data is missing.
2. Set the column sequence according to your requirements.
3. Paste mapping data from Excel and validate EE (employee) rows
   according to mapping rules.
4. Export the result to Excel (.xlsx).
Data is not stored anywhere. Everything is sent with the request and
returned in the response.
1. How to Run (Windows PowerShell)
cd edi_mapper
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload
Then open:

http://127.0.0.1:8000
Always run the command from the folder containing main.py. After
extracting a ZIP file, you may sometimes get edi_mapper\edi_mapper\;
in that case, move one folder inside.

2. Folder Structure
edi_mapper/
├── main.py                    # FastAPI app: page, static files, /api/process
├── requirements.txt           # fastapi, uvicorn, pydantic
├── README.md                  # This file
│
├── frontend/                  # Browser-side HTML / CSS / JS
│   ├── index.html             # Page layout
│   ├── style.css              # Excel-like styling
│   ├── script.js              # Grid, processing, sequence, zoom, export
│   ├── validation.js          # Mapping grid, Validate button, cell colors
│   ├── import.js              # EDI/file import
│   ├── logic.js               # XML logic validation UI
│   └── xml_table.js           # XML-to-table UI
│
└── r1/                        # Backend logic (Python package)
    ├── __init__.py            # Makes r1 a Python package
    ├── parser.py              # Raw text -> records, separator detection
    ├── mapper.py              # Records -> columns/rows
    ├── checks.py              # Basic table checks
    ├── mapping_parser.py      # Pasted mapping text -> rules
    ├── validator.py           # Validate cells according to rules
    ├── validate_api.py        # POST /api/validate endpoint
    ├── edi_convert.py         # Raw 834/X12 conversion
    ├── xml_parser.py          # XML parsing
    ├── xml_clean.py           # XML cleanup and tag repair
    ├── xml_table.py           # XML-to-table conversion
    ├── xml_table_api.py       # POST /api/xml-table
    ├── logic_dsl.py           # Logic expression parsing
    ├── logic_mapping.py       # Mapping logic extraction
    ├── logic_runner.py        # XML logic execution
    └── logic_api.py           # POST /api/logic-run
3. Overall Flow
EDI paste
   |
   | Process
   v
POST /api/process
   |
   +--> parser.parse_records()
   |        -> records
   |
   +--> mapper.map_records()
   |        -> columns + aligned rows
   |
   +--> checks.validate_rows()
   |        -> errors / warnings
   |
   v
Spreadsheet Grid
   |
   +--> Paste Mapping
   +--> Apply Filter
   +--> Validate
            |
            v
      POST /api/validate
            |
            +--> mapping_parser.parse_mapping()
            |        -> rules
            |
            +--> validator.validate_against_mapping()
            |
            v
      Green = Pass
      Red   = Error
      Yellow = Warning
4. Backend Logic
main.py
- GET / displays frontend/index.html.
- /static/... serves files from the frontend folder.
- POST /api/process receives EDI text and runs:
  - parse_records
  - map_records
  - validate_rows
- The response contains:
  - columns
  - rows
  - record_count
  - employee_count
  - dependent_count
  - errors
  - warnings
- The /api/validate router is connected through
  r1/validate_api.py.
- Dropdown separator names such as pipe, tilde, tab,
  semicolon, and comma are converted into their actual characters.
r1/parser.py
detect_field_separator(data) checks:
|
~
TAB
;
,
and selects the separator that occurs most frequently.

If no separator is detected, | is used.

parse_records(...):
- Splits raw text into records.
- Uses newline as the default record separator.
- Supports custom separators.
- Supports separator selection from the UI.
- Removes empty lines.
Returns:
records
record_separator
field_separator
r1/mapper.py
This is the main mapping logic.

Each record is split into segments and each segment receives a key.
Column placement is determined by the key rather than the physical
position.

Therefore, if a segment is missing from a record, its cell remains blank
while the remaining data stays in the correct column.
Key Rules
  Segment                                           Key
  18*030..., 01*...                             NUMBER
INS*N*01*...                                    INS
REF*0F*... / REF*1L*...                       REF*0F / REF*1L
DMG*D8*...                                      DMG*D8
DTP*348*...                                     DTP*348
HD*030*...                                      HD*030
Numeric value without *                         SSN
Other segments such as NM1, PER, N3, N4   First tag
Repeated Segments
If the same key appears multiple times in one record, separate columns
are created:
DTP*348
DTP*348#2
DTP*348#3
Similarly:
REF*1L
REF*1L#2
Data is never merged.
Column Ordering
When a new key appears, it is inserted immediately after the key that
came before it in that record.

For example, if PER is missing from the first record but appears in
another record, it is placed between NM1 and N3.

This keeps the segment sequence consistent.

Other behavior:
- Empty segments such as || are skipped.
- EE and dependent records are counted separately.
- Output columns are named Column_1, Column_2, etc.
- The UI displays them as Excel-style column letters.
r1/checks.py
validate_rows(rows) performs basic checks without modifying the data.

Checks include:
- No rows -> warning.
- Row is not a dictionary -> error.
- Completely empty row -> warning.
r1/mapping_parser.py
Converts mapping copied from Excel into validation rules.

For example:
NM101    IL
is converted into a mapping rule.

The parser supports:
- Tab-separated values
- | separated values
- Space-separated values
Mapping keys are converted into segment + element numbers.

Examples:
NM101 -> NM1 + 01
N301  -> N3 + 01
INS02 -> INS + 02
Mapping Values
  Mapping Value            Meaning
  01,18,19,53            Any one of these values
30                     Exactly 30; 030 is also accepted
NOT USED               Must be blank
NULL                   Blank is allowed
(Last Name), <SSN>   Any non-blank value
A - Active             Only A is compared
(Addr line 2),NULL     Free text; blank is allowed

Unknown mapping lines generate warnings.
r1/validator.py
Currently validates the INS segment.

The INS cell is found by text rather than fixed column position.

This means validation continues to work even when the column sequence
changes.

Elements are split using *.

For example:
INS*N*01*030*XN*A***FT
contains:
INS01 = N
INS02 = 01
INS03 = 030
...
For EE records such as:
18*030**A***FT
the first value corresponds to INS02.

INS01 is skipped.

Validation rules include:
- NOT USED -> value must not exist.
- Blank/missing value with a non-`NULL` rule -> error.
- Value not in the allowed list -> error.
- Elements not present in the mapping are not checked.
The output contains:
issues
validated_cells
summary
If the INS cell cannot be found, a warning is generated.
r1/validate_api.py
Endpoint:
POST /api/validate
Request:
{
  "mapping": "INS02\t01,18,19,53\nINS03\t30",
  "rows": [
    {
      "row_index": 0,
      "cells": ["EE RECORD", "18*030**A***FT"]
    }
  ]
}
No data is stored.
5. Frontend Logic
frontend/index.html
The page contains:
1. Header
2. Export button
3. Ribbon
4. Separator controls
5. Auto Fit
6. Wrap Text
7. Reset Widths
8. Zoom
9. EDI input panel
10. Column Sequence panel
11. Validate with Mapping panel
12. Spreadsheet grid
13. Validation Messages
14. Footer
Script order is important:
script.js
validation.js
frontend/style.css
Provides the Excel-like interface:
- Green Excel-style theme
- Sticky headers
- Row numbers
- Selected-cell border
- Column resize handles
frontend/script.js
Handles:
- EDI processing
- Grid rendering
- Column letters
- Row numbers
- Cell selection
- Formula bar
- Column resizing
- Auto Fit
- Wrap Text
- Zoom from 50% to 200%
- Clear Results
- Excel export
The Process operation calls:
/api/process
and stores:
currentColumns
currentRows
originalColumns
originalRows
The original data is preserved so sequence changes can safely be applied
multiple times.
Column Sequence
The DEFAULT_SEQUENCE defines the segment ordering.

Users can:
- Change the order
- Add sequence types
- Delete sequence types
- Apply the sequence
When applied:
1. Each segment type is identified.
2. The first available matching slot is used.
3. If no slot exists, an Extra_n column is created.
4. Data is never discarded.
frontend/validation.js
Provides the mapping validation interface.

Features include:
- Excel-like mapping grid.
- Paste mapping directly from Excel.
- Dynamic row creation.
- Enter / Up / Down navigation.
- .xlsx and .csv import.
- Clear Mapping.
- Mapping row counter.
- Row filters:
  - All
  - EE RECORD only
  - DEPENDENT RECORD only
- Validate button.
- Green = pass.
- Red = error.
- Yellow = warning.
- Error tooltip.
- Clickable issue list.
6. Data Privacy
The backend does not store:
- Files
- EDI data
- Mapping data
- Database records
Mapping data remains in browser memory.

The only external library loaded through CDN is SheetJS for Excel
import/export. The rest of the application runs locally.
7. Current Limitations and Future Improvements
Current validation mainly focuses on the INS segment.

Additional handlers can be added for:
REF
NM1
PER
N3
N4
DMG
HD
DTP
Placeholder values currently receive a basic non-blank validation.

Future validation can include:
- Phone number format
- Date format
- SSN format
- Other field-specific validation
Cross-check rules such as dependent REF*0F matching the employee are
additional validation opportunities.
8. Common Errors
  Error                                          Cause / Solution
  Could not import module "main"               Run the command from the folder
containing main.py.

  Attribute "app" not found in module "main"   Check that main.py contains
app = FastAPI(...).

  No module named 'r1.validate_api'            Check that the file exists inside
r1/.

  No module named 'fastapi'                    Activate the virtual environment and
run
pip install -r requirements.txt.

  JS changes are not visible                     Use Ctrl+F5 to clear the browser
cache.

  Excel import/export does not work              Check your internet connection
because SheetJS is loaded from a
CDN.
030 becomes 30                             Excel may remove leading zeros. The
validator treats 030 and 30 as
equivalent.
9. API Reference
POST /api/process
Request:
{
  "data": "...",
  "record_separator": "auto",
  "field_separator": "auto",
  "custom_record_separator": "",
  "custom_field_separator": ""
}
Response:
columns
rows
record_count
employee_count
dependent_count
errors
warnings
POST /api/validate
Request:
{
  "mapping": "INS02\t01,18,19,53\nINS03\t30",
  "rows": [
    {
      "row_index": 0,
      "cells": ["EE RECORD", "18*030**A***FT"]
    }
  ]
}
Response:
issues
validated_cells
summary
mapping_warnings
10. Logic Validation (XML)
Logic validation checks XML data against the mapping logic.

Files:
r1/xml_parser.py
r1/logic_engine.py
r1/logic_api.py
frontend/logic.js
Flow:
EDI Process
    ↓
Apply Filter
    ↓
Logic Validation (XML)
    ↓
Paste XML
    ↓
Logic Check
The XML parser identifies:
- Employee blocks
- User blocks
- CoveredDependent blocks
Employee and dependent data are handled separately.
Matching
Employee matching uses:
SSN + Name + DOB (when available)
Matching is strict.

If the match fails, an error is generated.

The XML SSN tag is not hardcoded. All employee tag values are searched.
11. Dynamic Mapping Columns
The mapping grid supports dynamic columns.

Users can paste any number of rows and columns from Excel.

Columns are created automatically and data remains in the same column
position as it appeared in Excel.

For validation:
- Element column can be selected.
- Value column can be selected.
- Additional columns remain available for display.
12. XML to Table
XML can be converted into an Excel-like table.

Files:
r1/xml_table.py
r1/xml_table_api.py
frontend/xml_table.js
Features:
- XML paste
- XML file upload
- Employee table
- Dependent table
- Search
- Column filters
- Hide empty columns
- Pagination
- Excel export
Each employee becomes a row.

Each leaf XML tag becomes a column.

If a tag does not exist for an employee, the cell remains blank.

Repeated tags become:
Tag
Tag#2
Dependents are displayed in a separate table.

The first three dependent columns provide relationship information:
Employee_Row
Employee_SSN
Employee_Name
Values remain as text so leading zeros are preserved.
13. XML Cleaning
Before XML parsing, r1/xml_clean.py cleans common XML formatting
problems.

It handles:
- BOM
- Control characters
- Unnecessary text before the first tag
- Unnecessary text after the final tag
- XML declaration
- Bare & characters
It can also repair common copied XML issues such as:
<Smoker Indicator>
<Marital Status>
<<Tag>
< Tag>
Only XML tags are repaired; values are not changed.

The system reports repairs in the XML Issues section.

Whenever possible, upload the original XML file instead of copied text.
14. XML to Table for Any XML Structure
The XML-to-table system can automatically detect different XML
structures.
Record Detection
If <Employee> or <User> exists, it is used as the record.

Otherwise, the system detects repeated elements under the same parent.

Wrapper elements are ignored.

If no repeated record structure exists, the entire XML document becomes
one row.
Columns
The system extracts:
- Leaf tags
- Attributes
- Record-specific attributes
- Repeated tags
Repeated tags become:
Tag
Tag#2
Nested repeating elements such as:
CoveredDependent
Item
Election
are placed into separate tables/tabs.

Each table is exported as a separate Excel sheet.
15. XML Issues, Search and Filters
The XML Issues tab displays:
- Level
- Type
- Line
- Column
- Message
- Original
- Fixed
Users can click an issue row to jump to the relevant XML location.

The search bar searches all rows and columns.

Column filters are available for each active table.

The Issues section supports:
- Level filter
- Type filter
- Search
- Clear Search & Filters
- Find Column
Issues are also exported to a separate Excel sheet.
16. Logic Check Using Mapping Logic
The Logic Check uses the logic columns from the mapping grid.

Example:
NM103 | (Last Name) | <LastName>
The user can select the Logic column and run the Logic Check.

The system compares each mapped element against the corresponding XML
value.

Supported logic includes:
Hardcoded to "Y"
030 - Audit or Compare
[Blank]
NOT USED
<EmployeeSSN>
Middle Initial
<CurrentEffectiveDate> of 10/01/2026 or thereafter
If X is not null then set to X
IF <A> starts with "S" THEN set INS05 = "S" ELSE IF <B> = "C" THEN "C" ELSE "A"
if BPTier=3 set IND
Supported conditions include:
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
Unsupported lookup/LUT rules generate warnings instead of silently
passing.

Unknown logic generates:
Logic not understood
17. Employee and Dependent Logic
Employee and dependent logic is mapping-driven.

The mapping grid supports four columns:

  Column   Purpose
  A        Element code
B        Valid values
C        Employee logic
D        Dependent logic

The Logic Validation panel allows the user to choose the Employee Logic
and Dependent Logic columns.
Which Rows Are Checked?
If XML contains only employees:
- Employee rows are checked.
- Dependent rows are skipped.
If XML contains employees and dependents:
- Employee rows use Employee Logic.
- Dependent rows use Dependent Logic.
If dependent logic is unavailable, dependent rows are skipped with an
appropriate note.
Matching
Employee:
SSN + Name + DOB
Dependent:
Name + DOB + Dependent SSN (when available)
+ Employee relationship
Dependent validation ensures that the dependent belongs to the correct
employee.

The Issues table contains:
Level
Record
Row
Cell
Element
Message
Found
Expected
18. Deploying to Render
The application can be deployed to Render.
1. Configure Login
Set the following environment variables:
APP_PASSWORD
APP_USERNAME
APP_USERNAME defaults to:
admin
If APP_PASSWORD is not configured locally, login is disabled.
2. Push the Project to GitHub
Push the contents of the project folder to GitHub:
main.py
requirements.txt
frontend/
r1/
r2/
...
Do not push the outer edi_mapper folder itself.

Do not push:
venv/
The .gitignore should handle this.
3. Create Render Web Service
Build command:
pip install -r requirements.txt
Start command:
uvicorn main:app --host 0.0.0.0 --port $PORT
Select the Free instance if required.
4. Configure Environment
Set:
APP_PASSWORD
Then deploy.

The application will be available at:
https://<your-app-name>.onrender.com
5. Render Free Instance
The free server may sleep after inactivity.

The first request after sleeping can take approximately one minute.

render.yaml is optional and can be used for Blueprint deployment.
19. Logic Check and Rows Dropdown
The Validate with Mapping panel contains a Rows: dropdown.

Its default value is:
EE RECORD only
Previously, Logic Check only sent visible rows, which meant dependent
rows could be skipped.

The updated Logic Check ignores this dropdown and sends both:
EE RECORD
DEPENDENT RECORD
when available.

The record type is detected from the row content rather than a fixed
column position.

The result reports:
Sent from grid: N EE, M dependent row(s)
20. File Import and Raw 834 Auto-Conversion
The application supports direct file import.
EDI File Import
The user can:
- Click Import File
- Drag and drop an EDI file
- Paste EDI text
Supported encoding detection includes:
- BOM
- UTF-16
- XML encoding
- UTF-8
- Windows-1252
Raw 834 Auto-Conversion
Raw X12 834 data can automatically be converted into the format required
by the mapper.

When the text contains:
INS*Y*
INS*N*
and does not already contain:
EE RECORD
DEPENDENT RECORD
the converter performs:
~ + line break -> |
INS*Y*         -> new EE RECORD
INS*N*         -> new DEPENDENT RECORD
REF*0F*        -> REF*0F*|
Already converted data is not modified again.

The separators are detected from the ISA header.

The /api/process response includes:
converted_from_834
with true or false.
21. Dependent Matching
Dependent matching works under the correct employee.

The dependent row first uses the matched employee row immediately above
it.

This matches the typical EDI structure where dependents appear after
their employee.

The dependent SSN may come from:
NM109
REF*0F*
or the employee SSN when applicable.

Incorrect SSNs generate:
Dependent SSN does not match
Dependents that exist in XML but do not have corresponding grid rows
generate warnings.

If dependent logic references employee-only tags, the system provides a
warning indicating which dependent tag should be used.

For short tag names such as BPT, if multiple XML tags match, the
system uses the tag previously identified by the same logic when
possible. Otherwise, it generates a warning.
Notes
- The application is designed to process EDI, Excel mapping, and XML
  validation workflows.
- The backend does not persist uploaded business data.
- For very large XML files, parsing the entire document in memory can
  become slower and require more RAM.
- For deployment, keep secrets such as APP_PASSWORD in environment
  variables rather than committing t
