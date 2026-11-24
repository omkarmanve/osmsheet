# r2/api.py

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    UploadFile,
)

from fastapi.concurrency import run_in_threadpool


# ============================================================
# Router
# ============================================================

router = APIRouter(
    prefix="/api/r2",
    tags=["Round 2"],
)


# ============================================================
# Allowed Excel extensions
# ============================================================

ALLOWED_EXTENSIONS = {
    ".xlsx",
    ".xlsm",
    ".xltx",
    ".xltm",
}


# ============================================================
# Maximum upload size
# ============================================================
#
# 0 = disabled
#
# Isko bahut low mat rakho because large Excel files
# comparison ke liye required ho sakti hain.
#
# Example:
# 100 MB = 100 * 1024 * 1024
#
# Currently disabled so existing behavior break nahi hoga.
# ============================================================

MAX_FILE_SIZE = 0


# ============================================================
# Helpers
# ============================================================

def validate_excel_filename(
    filename: str | None,
) -> None:

    filename = (
        filename or ""
    ).lower().strip()

    if not filename:
        raise HTTPException(
            status_code=400,
            detail="Excel filename is missing.",
        )

    if not any(
        filename.endswith(ext)
        for ext in ALLOWED_EXTENSIONS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Excel files are supported: "
                ".xlsx, .xlsm, .xltx, .xltm"
            ),
        )


async def read_upload(
    upload: UploadFile,
) -> bytes:

    # --------------------------------------------------------
    # Validate filename
    # --------------------------------------------------------

    validate_excel_filename(
        upload.filename
    )

    # --------------------------------------------------------
    # Read file
    #
    # UploadFile.read() is async.
    # Isse event loop directly block nahi hota.
    # --------------------------------------------------------

    data = await upload.read()

    if not data:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Empty Excel file: "
                f"{upload.filename}"
            ),
        )

    # --------------------------------------------------------
    # Optional size validation
    # --------------------------------------------------------

    if (
        MAX_FILE_SIZE > 0
        and len(data) > MAX_FILE_SIZE
    ):
        size_mb = (
            len(data)
            / 1024
            / 1024
        )

        limit_mb = (
            MAX_FILE_SIZE
            / 1024
            / 1024
        )

        raise HTTPException(
            status_code=413,
            detail=(
                f"{upload.filename} is too large. "
                f"Size: {size_mb:.2f} MB, "
                f"Maximum: {limit_mb:.2f} MB."
            ),
        )

    return data


# ============================================================
# Compare API
# ============================================================

@router.post("/compare")
async def compare(
    old_excel: UploadFile = File(...),
    new_excel: UploadFile = File(...),
    scenario_excel: UploadFile = File(...),

    old_sheet: str = Form(...),
    new_sheet: str = Form(...),
    scenario_sheet: str = Form(...),

    header_row: int = Form(0),
):

    # ========================================================
    # Validate header row
    # ========================================================

    header_row = max(
        0,
        int(header_row),
    )


    # ========================================================
    # Read Excel files
    # ========================================================
    #
    # Important:
    #
    # Files are read only once.
    #
    # We DO NOT:
    #
    # - save them to disk
    # - read them again
    # - parse them in browser
    # - convert them unnecessarily
    #
    # ========================================================

    try:

        old_bytes = await read_upload(
            old_excel
        )

        new_bytes = await read_upload(
            new_excel
        )

        scenario_bytes = await read_upload(
            scenario_excel
        )

    except HTTPException:
        raise

    except Exception as exc:

        raise HTTPException(
            status_code=400,
            detail=(
                "Failed to read Excel files: "
                f"{exc}"
            ),
        ) from exc


    # ========================================================
    # Import comparison function
    # ========================================================

    try:

        from .compare import (
            compare_workbooks,
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=(
                "Could not load Excel comparison module: "
                f"{exc}"
            ),
        ) from exc


    # ========================================================
    # CPU-heavy comparison
    # ========================================================
    #
    # VERY IMPORTANT:
    #
    # compare_workbooks() CPU/memory intensive hai.
    #
    # Isko directly:
    #
    #     result = compare_workbooks(...)
    #
    # nahi chalana.
    #
    # Worker thread mein run karna hai.
    #
    # Isse FastAPI event loop block nahi hoga.
    #
    # ========================================================

    try:

        result = await run_in_threadpool(
            compare_workbooks,

            old_bytes,
            old_excel.filename or "old.xlsx",

            new_bytes,
            new_excel.filename or "new.xlsx",

            scenario_bytes,
            scenario_excel.filename or "scenario.xlsx",

            old_sheet,
            new_sheet,
            scenario_sheet,

            header_row,
        )

    except Exception as exc:

        raise HTTPException(
            status_code=400,
            detail=(
                "Excel comparison failed: "
                f"{exc}"
            ),
        ) from exc


    # ========================================================
    # Return result
    # ========================================================

    return result