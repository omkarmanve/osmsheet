import base64
import os
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from pydantic import BaseModel

# ---------------------------------------------------------------
# R1 imports
# ---------------------------------------------------------------
from r1.checks import validate_rows
from r1.edi_convert import convert_834
from r1.logic_api import router as logic_router
from r1.mapper import map_records
from r1.parser import parse_records
from r1.validate_api import router as validate_router
from r1.xml_table_api import router as xml_table_router

# ---------------------------------------------------------------
# R2 API import
# ---------------------------------------------------------------
from r2.api import router as r2_router


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="EDI Spreadsheet")


# ---------------------------------------------------------------
# Optional login
#
# APP_PASSWORD set ho to har page / API par username + password
# maanga jayega.
#
# APP_USERNAME = username
# APP_PASSWORD = password
#
# APP_PASSWORD empty ho to login disabled rahega.
# ---------------------------------------------------------------
APP_USERNAME = os.environ.get("APP_USERNAME", "admin")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")


class BasicAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):

        # Password configured nahi hai -> login disabled
        if not APP_PASSWORD:
            return await call_next(request)

        header = request.headers.get("authorization", "")

        if header.lower().startswith("basic "):

            try:
                decoded = base64.b64decode(
                    header[6:]
                ).decode("utf-8")

            except Exception:
                decoded = ""

            user, _, password = decoded.partition(":")

            if (
                secrets.compare_digest(
                    user.encode(),
                    APP_USERNAME.encode()
                )
                and
                secrets.compare_digest(
                    password.encode(),
                    APP_PASSWORD.encode()
                )
            ):
                return await call_next(request)

        return Response(
            "Login required",
            status_code=401,
            headers={
                "WWW-Authenticate":
                'Basic realm="OSM Spreadsheet"'
            },
        )


app.add_middleware(BasicAuthMiddleware)


# ===============================================================
# R1 APIs
# ===============================================================

# Mapping validation endpoint
# /api/validate
app.include_router(validate_router)

# Logic validation endpoint
# /api/logic-validate
app.include_router(logic_router)

# XML -> table endpoint
# /api/xml-table
app.include_router(xml_table_router)


# ===============================================================
# R2 API
# ===============================================================

# R2 API endpoints:
#
# POST /api/r2/compare
#
# r2/api.py already contains:
# prefix="/api/r2"
#
# Therefore yahan prefix dobara nahi lagana hai.
app.include_router(r2_router)


# ===============================================================
# Static frontend files
# ===============================================================

app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static",
)


# ===============================================================
# Round 2 frontend
# ===============================================================

@app.get("/round2")
def round2():
    return FileResponse(
        FRONTEND_DIR / "round2" / "index.html"
    )


# ===============================================================
# R1 Process Request
# ===============================================================

class ProcessRequest(BaseModel):
    data: str
    record_separator: str = "auto"
    field_separator: str = "auto"
    custom_record_separator: str = ""
    custom_field_separator: str = ""


# ===============================================================
# R1 Home Page
# ===============================================================

@app.get("/")
def index():
    return FileResponse(
        FRONTEND_DIR / "index.html"
    )


# ===============================================================
# R1 Process API
# ===============================================================

@app.post("/api/process")
def process(request: ProcessRequest):

    # -----------------------------------------------------------
    # Raw 834 (X12) paste/import kiya ho to pehle pipe format
    # me convert karo.
    #
    # Pehle se converted text ko nahi chhedta.
    # -----------------------------------------------------------
    data, converted = convert_834(request.data)

    try:

        records, _, field_separator = parse_records(
            data,
            record_separator=request.record_separator,
            field_separator=request.field_separator,
            custom_record_separator=request.custom_record_separator,
            custom_field_separator=request.custom_field_separator,
        )

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    # -----------------------------------------------------------
    # Dropdown values ko actual separator characters me convert
    # karo.
    # -----------------------------------------------------------
    separator_names = {
        "pipe": "|",
        "tilde": "~",
        "tab": "\t",
        "semicolon": ";",
        "comma": ",",
    }

    field_separator = separator_names.get(
        field_separator,
        field_separator
    )

    # -----------------------------------------------------------
    # Mapping
    # -----------------------------------------------------------
    mapped = map_records(
        records,
        field_separator=field_separator
    )

    # -----------------------------------------------------------
    # Validation
    # -----------------------------------------------------------
    checks = validate_rows(
        mapped["rows"]
    )

    # -----------------------------------------------------------
    # Response
    # -----------------------------------------------------------
    return {
        "columns": mapped["columns"],
        "rows": mapped["rows"],
        "record_count": len(mapped["rows"]),
        "employee_count": mapped["employee_count"],
        "dependent_count": mapped["dependent_count"],
        "converted_from_834": converted,
        "errors": checks["errors"],
        "warnings": checks["warnings"],
    }