"""
routers/query.py
-----------------
Step 5: natural-language map query. Interprets free text into a structured
FilterSpec (see llm_service.py); never touches the buildings dataset
itself -- the frontend applies the returned conditions to whatever
buildings it already has on screen (frontend/src/lib/filterEngine.js).
"""
from fastapi import APIRouter

from app.schemas import QueryIn, QueryOut
from app.services import llm_service

router = APIRouter(prefix="/api", tags=["query"])


@router.post("/query", response_model=QueryOut)
def post_query(payload: QueryIn):
    return llm_service.interpret_query(payload.query_text)
