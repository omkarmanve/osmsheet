# EDI Mapper

EDI data (pipe-separated records) ko Excel jaisi grid me dikhane wala tool. Isme aap:

1. EDI data paste karke har segment ko **sahi column me** arrange kar sakte ho (jahan data nahi hai wahan blank).
2. Column ka **sequence** apne hisaab se set kar sakte ho.
3. Excel se **mapping paste** karke EE (employee) rows ko mapping ke rules se **validate** kar sakte ho (abhi INS segment / Column B).
4. Result ko **Excel (.xlsx)** me export kar sakte ho.

Data kahin save nahi hota. Sab kuch request ke saath jata hai aur wapas aata hai.

---

## 1. Chalane ke steps (Windows PowerShell)

```powershell
cd edi_mapper                    # jis folder me main.py hai
python -m venv venv              # sirf pehli baar
.\venv\Scripts\activate
pip install -r requirements.txt  # sirf pehli baar
python -m uvicorn main:app --reload
```

Phir browser me kholo: **http://127.0.0.1:8000**

> Command hamesha usi folder se chalao jisme `main.py` hai. Zip extract karne par kabhi kabhi `edi_mapper\edi_mapper\` ban jata hai, us case me ek folder andar jao.

---

## 2. Folder structure

```
edi_mapper/
├── main.py                  # FastAPI app: page, static files, /api/process
├── requirements.txt         # fastapi, uvicorn, pydantic
├── README.md                # ye file
│
├── frontend/                # Browser wala hissa (HTML / CSS / JS)
│   ├── index.html           # Page ka layout
│   ├── style.css            # Excel jaisa look
│   ├── script.js            # Grid, process, sequence, zoom, export
│   └── validation.js        # Mapping grid + Validate button + cell colors
│
└── r1/                      # Backend logic (Python package)
    ├── __init__.py          # r1 ko package banata hai (khali file)
    ├── parser.py            # Raw text -> records, separator detect
    ├── mapper.py            # Records -> columns/rows (main logic)
    ├── checks.py            # Basic table checks (empty row, bad format)
    ├── mapping_parser.py    # Pasted mapping text -> rules
    ├── validator.py         # Rules ke hisaab se cells check karna
    └── validate_api.py      # POST /api/validate endpoint
```

---

## 3. Pura flow (ek nazar me)

```
EDI paste  --Process-->  POST /api/process
                              |
                  parser.parse_records()   -> records (list of strings)
                  mapper.map_records()     -> columns + rows (aligned)
                  checks.validate_rows()   -> errors / warnings
                              |
                         Grid me dikhta hai (script.js)
                              |
Mapping paste (Excel grid) + Filter (EE) + Validate click
                              |
                       POST /api/validate
                  mapping_parser.parse_mapping()  -> rules
                  validator.validate_against_mapping()
                              |
            Cell green (pass) / red (error) / yellow (warning)
            + neeche issues ki list (click karo to cell par jump)
```

---

## 4. Backend files ka logic

### `main.py`
- `GET /` -> `frontend/index.html` dikhata hai.
- `/static/...` -> `frontend` folder ki files (CSS, JS) serve karta hai.
- `POST /api/process` -> EDI text leta hai, `parse_records` -> `map_records` -> `validate_rows` chalata hai aur ye wapas deta hai:
  `columns`, `rows`, `record_count`, `employee_count`, `dependent_count`, `errors`, `warnings`.
- `/api/validate` ka router `r1/validate_api.py` se judta hai (`app.include_router`).
- Dropdown ke naam (`pipe`, `tilde`, `tab`, `semicolon`, `comma`) ko asli character (`|`, `~`, `\t`, `;`, `,`) me badalta hai.

### `r1/parser.py`
- `detect_field_separator(data)`: `| ~ TAB ; ,` me se jo sabse zyada baar aaye wahi segment separator maanta hai. Kuch na mile to `|`.
- `parse_records(...)`: raw text ko **records** me todta hai.
  - Record separator default **newline** hai (har line ek record).
  - Custom separator ya dropdown ka option bhi chalta hai.
  - Khali lines hata di jati hain.
- Returns: `records, record_separator, field_separator`.

### `r1/mapper.py` (sabse important)
Har record ko segments me todta hai (`|` se), aur har segment ko ek **key** deta hai. Column position se nahi, **key se** decide hota hai. Isiliye jo segment kisi record me nahi hota, wahan blank cell aata hai aur baaki data apni jagah par rehta hai.

**Key rules (`get_key`):**

| Segment | Key |
|---|---|
| `18*030...`, `01*...` (number + `*`) | `NUMBER` |
| `INS*N*01*...` | `INS` |
| `REF*0F*...` / `REF*1L*...` | `REF*0F` / `REF*1L` |
| `DMG*D8*...` | `DMG*D8` |
| `DTP*348*...` | `DTP*348` |
| `HD*030*...` | `HD*030` |
| sirf number, `*` nahi (`2537463`) | `SSN` |
| baaki (`NM1`, `PER`, `N3`, `N4`...) | pehla tag (`NM1`, `PER`...) |

**Repeated segment:** ek record me same key dobara aaye to alag column milta hai:
`DTP*348` (1st), `DTP*348#2` (2nd), `DTP*348#3` (3rd). Isi tarah `REF*1L`, `REF*1L#2`. Data kabhi merge nahi hota.

**Column order (merge-order):** jab koi naya key mile (jaise Michael ke record me `PER` nahi tha par Sarah me hai), wo us key ke **theek baad** insert hota hai jo us record me uske pehle tha. Isse `PER` hamesha `NM1` aur `N3` ke beech me hi aata hai, chahe pehla record `PER` ke bina ho.

**Aur details:**
- Khali segments (`||`) skip hote hain.
- `EE RECORD` aur `DEPENDENT RECORD` ginti (`employee_count`, `dependent_count`) me count hote hain.
- Output columns ke naam `Column_1`, `Column_2`... hote hain (grid me A, B, C... dikhte hain).

### `r1/checks.py`
`validate_rows(rows)`: data ko badle bina basic check:
- Koi row nahi -> warning.
- Row dict nahi -> error.
- Poori row khali -> warning.

### `r1/mapping_parser.py`
Excel se copy ki hui mapping (`NM101  IL`) ko rules me badalta hai.

- Har line tab / `|` / space se **key** aur **value** me bantti hai.
- Key `NM101` -> segment `NM1` + element `01`. (`N301` -> `N3` + `01`, `INS02` -> `INS` + `02`)
- **Alias:** mapping me INS03 se pehle wale `IEA01`/`IEA02` ko `INS01`/`INS02` maana jata hai (mapping sheet ki galti). Last wale `IEA` rows alag rehte hain.
- Value ka matlab:

| Mapping value | Matlab |
|---|---|
| `01,18,19,53` | In me se koi ek |
| `30` | Exactly `30` (`030` bhi chalega, numeric compare) |
| `NOT USED` | Blank hona chahiye |
| `NULL` (list me) | Blank bhi chalega |
| `(Last Name)`, `<SSN>` | Koi bhi value, par blank nahi (free text) |
| `A - Active` | Sirf `A` compare hota hai |
| `(Addr line 2),NULL` | Free text, blank bhi chalega |

- Pehchani na jaane wali line par warning aati hai.

### `r1/validator.py`
Abhi **INS segment** (Column B) validate hota hai.

- **Cell dhoondhna:** position se nahi, text se. Jo cell `INS*` ya `18*` (number + `*`) se shuru ho wahi INS cell hai. Isse sequence badalne par bhi sahi chalta hai.
- **Elements:** segment `*` se tootta hai, aur position = element number:
  - Dependent: `INS*N*01*030*XN*A***FT` -> INS01=`N`, INS02=`01`, INS03=`030`...
  - EE: `18*030**A***FT` -> pehla value INS02 hai (INS01 nahi hota).
- **INS01 skip** hota hai.
- **Har element ka check (`check_element`):**
  - `NOT USED` -> value hui to error.
  - Blank/missing + `NULL` nahi -> error (`value missing` ya `value blank`).
  - Allowed list me nahi -> error (`invalid value 'XX', expected FT,L1,...`).
  - Mapping me jo element hai hi nahi (INS06, INS07) -> check nahi hota.
- **Output:** `issues` (cell, element, level, message, found, expected), `validated_cells` (pass/fail), `summary` (rows_checked, errors, warnings).
- Row me INS cell na mile to **warning**.

### `r1/validate_api.py`
`POST /api/validate` -> body: `{ mapping: "text", rows: [{row_index, cells: [...]}] }`.
Mapping me INS rules na hon to 400 error. Kuch save nahi hota.

---

## 5. Frontend files ka logic

### `frontend/index.html`
Page ke hisse (upar se neeche): Header + Export button, Ribbon (separator, Auto Fit, Wrap, Reset Widths, Zoom), EDI paste panel, **Column Sequence** panel, (yahan `validation.js` apna **Validate with Mapping** panel inject karta hai), Spreadsheet grid, Validation Messages (errors/warnings), Footer.

Script order zaroori hai: pehle `script.js`, phir `validation.js`.

### `frontend/style.css`
Excel jaisa look: green theme, sticky header, row numbers, selected-cell border, column resize handle.

### `frontend/script.js`
- **Process:** `/api/process` ko call karke `currentColumns/currentRows` (dikhne wala data) aur `originalColumns/originalRows` (asli data, kabhi nahi badalta) set karta hai.
- **Grid:** Excel jaise column letters (A, B, C...), row numbers, cell click par address aur value formula bar me.
- **Tools:** column resize, Auto Fit, Wrap Text, Zoom (50% to 200%), Clear Results.
- **Export:** SheetJS (CDN) se `edi_mapped_data.xlsx` banata hai.
- **Column Sequence:** `DEFAULT_SEQUENCE` me types ki list hoti hai (`EE RECORD`, `18*`, `REF`, `NM1`...). Aap order badal sakte ho, add/delete kar sakte ho. Apply par:
  1. Har segment ka type pehchana jata hai.
  2. Pehla khali matching slot use hota hai.
  3. Slot na mile to `Extra_n` naya column banta hai (data kabhi discard nahi hota).
  Asli data hamesha `original*` se hi liya jata hai, to dobara apply karna safe hai.

### `frontend/validation.js`
- **Mapping grid (Excel jaisa):** 2 columns (A = Element, B = Value). Excel se copy karke kisi bhi cell me Ctrl+V karo, data wahin se bharta hai aur rows apne aap badhti hain. Enter / Up / Down se cell badalte hain.
- **Import Excel file:** `.xlsx` / `.csv` ki pehli sheet ke pehle 2 columns load hote hain (SheetJS CDN chahiye).
- **Clear mapping** aur "kitni mapping rows" ka counter.
- **Rows filter:** `All` / `EE RECORD only` (default) / `DEPENDENT RECORD only`. Dusri rows grid me chhup jati hain aur validate nahi hoti.
- **Validate button:** selected rows + mapping `/api/validate` ko bhejta hai.
- **Result:** green (pass), red (error), yellow (warning) cells. Cell par mouse le jaoge to tooltip me errors dikhte hain. Neeche list me `B1 | INS | INS09 | value missing...`, click karne par us cell par jump.
- Grid dobara bane (Process / Apply Sequence) to purane colors hat jate hain, kyunki data badal chuka hota hai.

---

## 6. Data privacy

- Backend koi data save nahi karta (na file, na database).
- Mapping sirf browser ki memory me rehti hai.
- Sirf Excel export / import ke liye SheetJS library CDN se load hoti hai. Baaki sab local chalta hai.

---

## 7. Abhi ki limits aur aage kya add ho sakta hai

- Validation abhi sirf **INS (Column B)** ka hai. Baaki segments (`REF`, `NM1`, `PER`, `N3`, `N4`, `DMG`, `HD`, `DTP`) ke liye `r1/validator.py` me unke handler add karne honge. Mapping parser pehle se sab segments ke rules bana leta hai.
- Placeholder wale elements (name, SSN, phone, date) par abhi sirf "blank nahi" check hota hai. Format check (jaise phone 10 digit, valid date) aage add ho sakta hai.
- Agar data me EE aur dependents dono hon, to dependents ka `INS*...` aur EE ka `18*...` alag keys (`INS`, `NUMBER`) hone ki wajah se alag columns me aate hain. Validator dono ko text se dhoondh leta hai.
- Cross-check rules (jaise dependent ka `REF*0F` employee se match kare) abhi nahi hain.

---

## 8. Aam errors aur hal

| Error | Wajah / Hal |
|---|---|
| `Could not import module "main"` | Galat folder se chalaya. Jis folder me `main.py` hai wahan jao (`dir` se check karo). |
| `Attribute "app" not found in module "main"` | `main.py` me galat code paste ho gaya (`app = FastAPI(...)` hona chahiye). |
| `No module named 'r1.validate_api'` | File `r1/` folder me nahi hai ya naam galat hai. |
| `No module named 'fastapi'` | `pip install -r requirements.txt` (venv activate karke). |
| JS badli par change nahi dikha | Browser me **Ctrl+F5** (cache clear). |
| Excel import / export kaam nahi kar raha | Internet check karo (SheetJS CDN). |
| `030` ki jagah `30` aa raha hai | Excel ne leading zero hataya. Validator dono ko barabar maanta hai. |

---

## 9. API reference

**`POST /api/process`**
```json
{ "data": "...", "record_separator": "auto", "field_separator": "auto",
  "custom_record_separator": "", "custom_field_separator": "" }
```
Response: `columns`, `rows`, `record_count`, `employee_count`, `dependent_count`, `errors`, `warnings`.

**`POST /api/validate`**
```json
{ "mapping": "INS02\t01,18,19,53\nINS03\t30",
  "rows": [ { "row_index": 0, "cells": ["EE RECORD", "18*030**A***FT"] } ] }
```
Response: `issues`, `validated_cells`, `summary`, `mapping_warnings`.
---

## 10. Logic Validation (XML) - naya feature

Mapping validation ke baad, XML se logic check karne ke liye.

**Files:** `r1/xml_parser.py`, `r1/logic_engine.py`, `r1/logic_api.py`, `frontend/logic.js`.

**Flow:** EDI process -> filter lagao -> "Logic Validation (XML)" panel me XML paste -> **Logic Check**.

- `xml_parser.py`: har `<Employee>` (ya `<User>`) block alag nikalta hai. `<CoveredDependent>` employee se alag rehta hai.
- `logic_engine.py`:
  - Strict match: SSN + Name (+ DOB agar dono taraf ho). Match na ho to error: "SSN match nahi hua" / "Name match nahi hua" / "SSN aur Name dono match nahi hue", aur us row ka logic nahi chalta.
  - SSN ka XML tag fix nahi hai: employee ke saare tag values me dhoondha jata hai.
  - INS05 rules `compute_ins05()` me hain (naya logic yahin badlo/jodo).
  - XML me `EmploymentStatus` ya `ElevatedCOBRAStatusCode` na ho to us row par error.
  - Dependent rows abhi skip hoti hain.
- `POST /api/logic-validate`: body `{ xml, rows: [{row_index, cells}] }`, response `issues`, `validated_cells`, `summary`.
- `logic.js`: visible rows bhejta hai, cells green (pass) / red (fail) karta hai, tooltip aur issues list (click par cell par jump).


---

## 11. Mapping grid: dynamic columns

- Excel se jitne bhi rows/columns copy karke grid me Ctrl+V karo: columns (A, B, C, D...) apne aap ban jate hain, aur data usi column me aata hai jis me Excel me tha.
- Excel ke multi-line (quoted) cells sahi padhe jate hain; newline space me badal jati hai (input box single-line hai).
- Validation ke liye **Element column** aur **Value column** dropdown se chuno (default A aur B). Baaki columns sirf dikhte hain, validate nahi hote.
- "Clear mapping" par grid wapas 2 columns ka ho jata hai. Import Excel file bhi saare columns load karti hai.

---

## 12. XML to Table

XML (paste ya file upload) ko table me badalta hai. Files: `r1/xml_table.py`, `r1/xml_table_api.py`, `frontend/xml_table.js`.

- Har `<Employee>` (ya `<User>`) = ek row. Root ke attributes ignore hote hain.
- Employee ke andar ka har leaf tag = ek column (tag ka naam header). Khali tag (`<MiddleName/>`) ka column bhi banta hai, cell blank.
- Kisi employee me tag na ho to uska cell blank. Same tag dobara aaye to `Tag`, `Tag#2`.
- Column order: naya tag us tag ke theek baad aata hai jo us employee me uske pehle tha.
- `<CoveredDependent>` alag **Dependents** table me, har dependent ki alag row. Pehle 3 columns link ke liye: `Employee_Row`, `Employee_SSN`, `Employee_Name`.
- Values text rehti hain (leading zeros nahi katte).
- Panel: file upload, **Hide empty columns**, column filter box, Employees/Dependents tabs, 200 rows ke page (Show more rows), **Export Excel** (2 sheets).
- `POST /api/xml-table` body `{ "xml": "..." }`, response `employees`, `dependents` (har ek me `columns`, `rows`), `summary`.

---

## 13. XML cleaning (r1/xml_clean.py)

XML parse se pehle (XML to Table aur Logic Check dono me) ye saaf hota hai: BOM, control characters, pehle tag se pehle / aakhri tag ke baad ka faltu text, `<?xml ...?>` line, aur bare `&` (`&amp;` banta hai). Line/column numbers original ke barabar rehte hain.
Phir bhi XML galat ho to error me us line ka text dikhta hai: `Invalid XML: ... line 5, column 26 | Near: '<Tag>...'`.

### XML tag repair (r1/xml_clean.py, `repair_tags`)

PDF/Word/email se copy ki hui XML me ye galtiyan aam hain, aur parse se pehle apne aap theek hoti hain (sirf tags, values nahi):
- tag name ke andar spaces (`<Smoker Indicator>`, `</Marital Status>`) -> spaces hat jate hain
- `<<Tag>` -> `<Tag>`, `< Tag>` -> `<Tag>`
- line ke shuru ka `<` gayab (`DependentEthnicity/>`) ya end ka `>` gayab (`<Tag/`)
- aakhir ke band na hue elements (jaise `</Transaction>`) jod diye jate hain
Attributes wale tags (`<Transaction fileId='1'>`) ko chhua nahi jata. XML to Table ka status line batata hai kya-kya repair hua. Sahi XML me koi repair nahi hota.
Behtar yahi hai ki original .xml file hi upload karo.

---

## 14. XML to Table: kisi bhi XML ke liye (update)

Ab XML ka structure koi bhi ho, tool khud rows/columns banata hai (`r1/xml_table.py`).

- **Record pehchan:** `<Employee>`/`<User>` mile to wahi. Nahi to jo element same parent ke andar baar-baar repeat hota hai wahi record. Wrapper elements (Root -> Users -> User) chhod diye jate hain. Repeat na ho to poora document ek row.
- **Columns:** har leaf tag (khali bhi), attributes (`Tag@attr`, record ke apne `@attr`), same tag dobara -> `Tag`, `Tag#2`.
- **Nested repeating elements** (jaise `CoveredDependent`, `Item`, `Election`) alag table/tab, har occurrence ki alag row. Pehle columns: `<Record>_Row`, `<Record>_ID`, `<Record>_Name`.
- Ek se zyada repeating group same level par ho to har ek ka alag tab.
- Excel export: har table ek alag sheet.
- API response: `tables: [{name, columns, rows}]`, `summary: {tables: [...], repairs}`.
- XML poora memory me parse hota hai (bahut bade, 100MB+ files ke liye ye tareeka dhima ho sakta hai).

---

## 15. XML to Table: Issues tab, search aur filters

- **Issues tab:** XML me jo galti mili ya auto-repair hui, wo table ki tarah dikhti hai: `Level` (error / warning), `Type`, `Line`, `Column`, `Message`, `Original`, `Fixed`. Row par click karo to XML box me wahi line select ho jati hai.
- XML parse hi na ho to bhi (HTTP 200, `ok: false`) sirf Issues tab dikhta hai, us line ke saath jahan galti hai.
- **Search bar:** active table ki saari rows me, saare columns me dhoondhta hai.
- **Column filters:** header ke neeche har column ka filter (text). Issues me Level aur Type ke dropdown.
- "Clear search & filters" sab hata deta hai. "Find column..." sirf column ke naam se columns chhota karta hai.
- Export Excel me Issues ki alag sheet bhi jati hai.
- API: `POST /api/xml-table` -> `{ok, tables, issues, summary}`; `issues` ki har row `{level, type, line, column, message, original, fixed}`.

---

## 16. Logic Check ab mapping ke logic column se chalta hai

**Kaise use karein**
1. "Validate with Mapping" grid me Excel se mapping paste karo: A = Element, B = Values, C = Logic (3 columns, jaise `NM103 | (Last Name) | <LastName>`).
2. EDI process karo, filter lagao, "Logic Validation (XML)" me XML paste karo.
3. "Logic column" dropdown me wo column chuno jisme logic hai (3+ columns hon to C apne aap chuna jata hai).
4. **Logic Check** dabao. Har element ka logic XML par chalta hai aur Excel cell se compare hota hai.

**Files:** `r1/logic_dsl.py` (logic text samajhna + chalana), `r1/logic_mapping.py` (mapping -> segment occurrences; `INS2` jaisa 1-digit key bhi), `r1/logic_runner.py` (rows ko XML se match + har element compare), `r1/logic_api.py` (`POST /api/logic-run`), `frontend/logic.js`.

**Jo logic samajh aata hai**
- `Hardcoded to "Y"`, `030 - Audit or Compare` (code - description), `[Blank]`, `NOT USED`
- `<EmployeeSSN>` (XML tag ki value), `Middle Initial`
- `<CurrentEffectiveDate> of 10/01/2026 or thereafter` (date us se pehle ho to error)
- `If X is not null then set to X`
- `IF <A> starts with "S" THEN set INS05 = "S" ELSE IF <B> = "C" THEN "C" ELSE "A"`; `if BPTier=3 set IND` (abbreviation BPTier = BenefitPlanTier)
- Conditions: `=`, `equals`, `not equals`, `!=`, `starts with`, `ends with`, `contains`, `is null`, `is not null`, `AND`, `OR`
- `remove spaces from <Tag>`, `(Note: If the A is prior to the B, use the B ...)`
- Lookup/LUT/"Mapping from table" -> warning "cannot verify" (table available nahi hai)
- Jo samajh nahi aata -> warning "Logic not understood" (chup-chaap pass nahi hota)

**Semantics:** ek element ke kai IF statements ho to sach hone wali branch value set karti hai aur baad ka statement use override kar sakta hai; statement ka akhri ELSE tabhi chalta hai jab ab tak koi branch fire na hui ho; kuch fire na ho to value blank.
**Matching:** SSN + Name (+ DOB) strict. Compare case-insensitive; `030` aur `30` barabar. Tag ka naam fuzzy (case/space/abbreviation). XML me tag na ho to blank + warning. Dependent rows skip.
**Colors:** green = pass, red = error, yellow = warning. Neeche issues ki table me Level / Element ke filter, har column ka filter aur search bar.


---

## 17. Employee aur Dependent logic (kuch bhi hard-coded nahi)

Purana built-in INS05 / COBRA check hata diya gaya hai. Ab har check sirf mapping ke logic aur XML ke tags se chalta hai.

**Mapping grid (Validate with Mapping): 4 columns**

| Column | Kya paste karna hai |
|---|---|
| A | Element code (`NM103`, `INS05` ...) |
| B | Valid values (`Validate` button isi se value check karta hai) |
| C | **Employee logic** (XML ke employees ke tags se) |
| D | **Dependent logic** (XML ke dependents ke tags se) |

Logic Validation panel me "Employee logic column" (default C) aur "Dependent logic column" (default D) dropdown se column badal sakte ho.

**Kaun si rows check hongi (apne aap)**
- XML me sirf employees hain -> sirf EE rows check (Employee logic). Dependent rows skip, result me note: "N dependent row(s) skipped: the XML has no dependent data."
- XML me employees + dependents hain aur mapping me dono logic hain -> EE rows Employee logic se, DEPENDENT rows Dependent logic se.
- Mapping me Dependent logic nahi hai -> dependent rows skip (note ke saath). Employee logic nahi hai -> EE rows skip.
- Koi logic nahi / sirf Dependent logic par XML me dependents nahi -> error message.

**Matching**
- Employee row: XML employee se SSN + Name (+ DOB) strict.
- Dependent row: XML ke dependent se Name (+ DOB, + dependent SSN agar dono taraf ho) aur row ka employee SSN (REF / alag SSN cell) us dependent ke employee se milna chahiye. Galti par error: "Dependent name does not match", "Dependent DOB does not match", "Dependent ... under a different employee" etc.
- Dependent logic me tags pehle dependent block se dhunde jate hain, na milen to employee ke tags se (jaise `<EmployeeSSN>`, `BPTier`).
- XML me "dependent" naam wala koi bhi block (CoveredDependent, Dependent ...) dependent maana jata hai; employee ke fields me mix nahi hota.

**Issues table:** Level, **Record** (employee / dependent), Row, Cell, Element, Message, Found, Expected; Level / Record / Element ke dropdown filter, har column ka filter, aur search bar. Note rows (info) neeli dikhti hain.

`POST /api/logic-run` body: `{xml, rows, mapping: [{line, element, value, logic, dep_logic}]}`. `/api/logic-validate` hata diya gaya hai.

---

## 18. Internet par live karna (Render, free)

1. **Login lagana:** `main.py` me optional password login hai. Render ke Environment me `APP_PASSWORD` (aur chaho to `APP_USERNAME`, default `admin`) set karo. Set na ho (apne PC par) to login nahi lagta.
2. Project ke **andar ki files** (main.py, requirements.txt, frontend/, r1/ ...) GitHub repo me daalo (folder `edi_mapper` khud nahi, uske andar ki cheezein). `venv/` mat daalo (`.gitignore` ye sambhalta hai).
3. render.com -> New -> Web Service -> repo chuno. Build: `pip install -r requirements.txt`. Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`. Instance type: Free.
4. Environment me `APP_PASSWORD` daalo, Deploy karo. Link: `https://<naam>.onrender.com`.
5. Free server 15 min idle rehne par so jata hai; pehli baar khulne me ~1 minute lag sakta hai.
`render.yaml` optional hai (Blueprint se ek click deploy).

---

## 19. Logic Check aur "Rows:" dropdown (fix)

"Validate with Mapping" ke "Rows:" dropdown ka default **EE RECORD only** hai, jo grid me DEPENDENT rows chhupa deta hai. Pehle Logic Check sirf dikhti hui rows bhejta tha, isliye dependent rows kabhi check hi nahi hoti thi.

Ab Logic Check us dropdown ko **ignore** karta hai aur grid ki saari `EE RECORD` aur `DEPENDENT RECORD` rows bhejta hai (agar grid me ye label na mile to purana tareeka: sirf dikhti rows).
- Row ka type kisi bhi column me likhe `EE RECORD` / `DEPENDENT RECORD` se pehchana jata hai (column sequence badalne par bhi).
- Result me "Sent from grid: N EE, M dependent row(s)" dikhta hai. Dependent logic on ho par grid me dependent row na ho to note aata hai.

---

## 20. File import (paste bhi chalta hai) + raw 834 auto-convert

- **Paste EDI Data:** "Import file" button (ya file ko text box par drag & drop). Text / EDI / 834 file seedha text box me aa jati hai; paste pehle jaisa chalta hai. (`frontend/import.js`)
- **Logic Validation:** "Import XML file" button ya XML file text box par drop. XML to Table me file upload pehle se tha.
- File ki encoding apne aap pehchani jati hai (BOM, UTF-16, XML ka `encoding="ISO-8859-1"`, warna UTF-8 / Windows-1252).
- **Raw 834 (X12) automatic convert** (`r1/edi_convert.py`, UltraEdit macro `834toSingleLine` jaisa), jab text me `INS*Y*` / `INS*N*` ho aur `EE RECORD` / `DEPENDENT RECORD` na ho:
  1. `~` (+ line break) -> `|`
  2. `INS*Y*` -> nayi line + `|EE RECORD|`
  3. `INS*N*` -> nayi line + `|DEPENDENT RECORD|`
  4. `REF*0F*` -> `REF*0F*|`
  Pehle se converted text (macro chal chuka ho) ko ye nahi chhedta. Separator ISA header se liye jate hain (default `*` aur `~`). `/api/process` response me `converted_from_834` true/false aata hai.
- XML ko macro jaisa line-by-line karne ki zaroorat nahi: parser single-line XML bhi padh leta hai.

---

## 21. Dependent matching (update)

- Dependent row ab **apne employee ke neeche** match hoti hai: grid me us row ke upar wali matched EE row ka XML employee pehle dekha jata hai (EDI me dependents employee ke baad aate hain).
- Row me SSN dependent ka apna ho (NM109 / `REF*0F*`) ya employee ka - dono chalte hain. Galat SSN par error: "Dependent SSN does not match".
- XML me jo dependents hain par grid me unki row nahi, unke liye warning aati hai (jaise bina SSN wala bachcha).
- Dependent logic me agar employee wala tag likha ho (`<FirstName>`, `<EmployeeSSN>`) aur dependent ka apna tag ho (`<DependentFirstName>`, `<DependentSSN>`), to warning batati hai ki kaun sa tag badalna hai.
- `BPT` jaisa chhota naam agar kai tags se match ho (BenefitPlanTier / BenefitPlanType) to wo tag liya jata hai jo isi logic me pehle poore naam se aa chuka ho; warna "matches several tags" warning.
