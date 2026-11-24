
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from r1.mapping_parser import parse_mapping
from r1.validator import validate_against_mapping

router = APIRouter()


class RowIn(BaseModel):
    row_index: int
    cells: list[str]


class ValidateRequest(BaseModel):
    mapping: str
    rows: list[RowIn]


@router.post("/api/validate")
def validate(request: ValidateRequest):
    # Parse mapping
    parsed = parse_mapping(request.mapping)

    # Check INS rules
    if "INS" not in parsed["rules"]:
        raise HTTPException(
            status_code=400,
            detail="Mapping me INS rules nahi mile (INS02, INS03...).",
        )

    # Pass the complete parsed mapping so sequence and repeated
    # segment occurrences can be preserved.
    result = validate_against_mapping(
        [
            {
                "row_index": row.row_index,
                "cells": row.cells,
            }
            for row in request.rows
        ],
        parsed,
    )

    # Include mapping warnings
    result["mapping_warnings"] = parsed.get("warnings", [])

    return result
