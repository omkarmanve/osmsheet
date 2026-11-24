from fastapi import APIRouter
from pydantic import BaseModel

from r1.xml_table import XmlProblem, build_tables

router = APIRouter()


class XmlTableRequest(BaseModel):
    xml: str


@router.post("/api/xml-table")
def xml_table(request: XmlTableRequest):
    try:
        return build_tables(request.xml)
    except XmlProblem as problem:
        # XML parse nahi hui: error ko "issues" rows ke roop me wapas bhejo
        return {
            "ok": False,
            "message": str(problem),
            "tables": [],
            "issues": problem.issues,
            "summary": {"tables": [], "repairs": {}},
        }
