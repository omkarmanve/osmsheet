from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from r1.logic_runner import run_logic
from r1.xml_parser import parse_xml_users

router = APIRouter()


class LogicRowIn(BaseModel):
    row_index: int
    cells: list[str]


class MappingRowIn(BaseModel):
    line: int = 0
    element: str = ""
    value: str = ""
    logic: str = ""        # employee ka logic
    dep_logic: str = ""    # dependent ka logic


class LogicRunRequest(BaseModel):
    xml: str
    rows: list[LogicRowIn]
    mapping: list[MappingRowIn]


@router.post("/api/logic-run")
def logic_run(request: LogicRunRequest):
    """Mapping ke logic columns (employee / dependent) ke hisaab se check."""
    if not request.rows:
        raise HTTPException(
            status_code=400,
            detail="There are no rows in the grid to check.",
        )

    try:
        users = parse_xml_users(request.xml)
        return run_logic(
            [
                {"row_index": row.row_index, "cells": row.cells}
                for row in request.rows
            ],
            users,
            [m.model_dump() for m in request.mapping],
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
