"""
llm_service.py
---------------
Turns a natural-language map query ("buildings over 100 feet") into a
structured FilterSpec the frontend can apply to the buildings it already
has in memory. Two things are deliberately kept out of the LLM's hands:

1. Unit math. The model is asked for the raw {field, op, value, unit} it
   read out of the query text -- never to convert feet to meters or parse
   a dollar string itself. `_convert_units` does that conversion
   deterministically in Python. LLMs are unreliable at silent arithmetic;
   this removes an entire class of wrong-by-a-constant-factor bugs.
2. The dataset. This module never fetches or holds building rows -- it
   only maps text -> filter shape. Filter evaluation happens client-side
   in frontend/src/lib/filterEngine.js against whatever the frontend
   currently has on screen.

Resilience mirrors calgary_client.get_map_data()'s auto/live/mock pattern:
if LLM_API_KEY is unset, the Groq call fails, or the model's response
yields zero usable conditions, `interpret_query` degrades to a small
keyword-based parser rather than erroring out -- and always reports which
path was used via QueryOut.source, so the UI can show it honestly (same
"data honesty" rule as the live/mock badge on /api/buildings).
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

from app.config import (
    LLM_API_KEY,
    LLM_BASE_URL,
    LLM_MODEL,
    HTTP_TIMEOUT_SECONDS,
    FILTERABLE_FIELDS,
    KNOWN_ZONING_CODES,
    COMMERCIAL_ZONING_PREFIXES,
    RESIDENTIAL_ZONING_PREFIXES,
)
from app.schemas import FilterCondition, QueryOut

logger = logging.getLogger("masiv.llm_service")

_VALID_OPS = {"gt", "gte", "lt", "lte", "eq", "neq", "contains", "in"}
_VALID_FIELDS = set(FILTERABLE_FIELDS.keys())

_COMMERCIAL_CODES = [c for c in KNOWN_ZONING_CODES if c.startswith(COMMERCIAL_ZONING_PREFIXES)]
_RESIDENTIAL_CODES = [c for c in KNOWN_ZONING_CODES if c.startswith(RESIDENTIAL_ZONING_PREFIXES)]


class LLMError(Exception):
    """Raised for any failure calling or parsing the LLM response."""


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
def _build_system_prompt() -> str:
    field_lines = "\n".join(
        f'  - "{name}" ({meta["type"]}'
        + (f", unit: {meta['unit']}" if meta["unit"] else "")
        + f"): {meta['description']}"
        for name, meta in FILTERABLE_FIELDS.items()
    )
    return f"""You translate a natural-language query about buildings on a 3D city map into a JSON filter.

Return ONLY a JSON object shaped exactly like:
{{"conditions": [{{"field": "...", "op": "...", "value": ..., "unit": "..."}}], "summary": "..."}}

Filterable fields:
{field_lines}

Known zoning codes in this study area: {json.dumps(KNOWN_ZONING_CODES)}
Commercial-leaning codes: {json.dumps(_COMMERCIAL_CODES)}
Residential-leaning codes: {json.dumps(_RESIDENTIAL_CODES)}

Rules:
- "op" is one of: gt, gte, lt, lte, eq, neq, contains, in.
- IMPORTANT: do NOT convert units yourself (no feet-to-meters or dollar math).
  Return the raw number the user said plus its "unit" (one of "feet", "meters",
  "dollars", "thousand_dollars", "million_dollars", "year", or null for string
  fields) -- a separate step converts it exactly afterward.
- For "commercial buildings" or "residential buildings", use op "in" on the
  "zoning" field with the matching code list above, not a single made-up code.
- Conditions are AND-combined; keep the list as short as possible (usually one).
- "summary" is a short human-readable restatement of the filter.

Examples:
Query: "highlight buildings over 100 feet"
{{"conditions": [{{"field": "height_m", "op": "gt", "value": 100, "unit": "feet"}}], "summary": "buildings over 100 ft"}}

Query: "show commercial buildings"
{{"conditions": [{{"field": "zoning", "op": "in", "value": {json.dumps(_COMMERCIAL_CODES)}, "unit": null}}], "summary": "commercial buildings"}}

Query: "show buildings in RC-G zoning"
{{"conditions": [{{"field": "zoning", "op": "eq", "value": "R-CG", "unit": null}}], "summary": "buildings zoned R-CG"}}

Query: "show buildings less than $500,000 in value"
{{"conditions": [{{"field": "assessed_value", "op": "lt", "value": 500000, "unit": "dollars"}}], "summary": "buildings assessed under $500,000"}}
"""


_SYSTEM_PROMPT = _build_system_prompt()


# ---------------------------------------------------------------------------
# Groq call
# ---------------------------------------------------------------------------
def _call_groq(query_text: str) -> Dict[str, Any]:
    if not LLM_API_KEY:
        raise LLMError("LLM_API_KEY not configured")

    payload = {
        "model": LLM_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": query_text},
        ],
    }
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"}

    try:
        with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS) as client:
            resp = client.post(f"{LLM_BASE_URL}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            body = resp.json()
        content = body["choices"][0]["message"]["content"]
        return json.loads(content)
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise LLMError(f"Groq call failed: {e}") from e


# ---------------------------------------------------------------------------
# Deterministic unit conversion + validation (never trusted to the LLM)
# ---------------------------------------------------------------------------
def _coerce_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, str):
        cleaned = re.sub(r"[^0-9.\-]", "", value)
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None
    return None


def _normalize_zoning_code(raw: str) -> str:
    """
    Matches a user-typed zoning code against KNOWN_ZONING_CODES ignoring
    punctuation/case, so e.g. "RC-G" (spec's literal example query) matches
    the dataset's actual "R-CG" code (same characters, different grouping).
    Falls back to the uppercased raw string if nothing matches.
    """
    norm = re.sub(r"[^A-Za-z0-9]", "", raw).upper()
    for code in KNOWN_ZONING_CODES:
        if re.sub(r"[^A-Za-z0-9]", "", code).upper() == norm:
            return code
    return raw.upper()


def _convert_units(raw: Dict[str, Any]) -> Optional[FilterCondition]:
    """Validates one raw {field, op, value, unit} dict and returns a
    FilterCondition in canonical units, or None if it's unusable (dropped
    individually rather than failing the whole request)."""
    field = raw.get("field")
    op = raw.get("op")
    value = raw.get("value")
    unit = raw.get("unit")

    if field not in _VALID_FIELDS or op not in _VALID_OPS:
        return None

    field_type = FILTERABLE_FIELDS[field]["type"]

    try:
        if field_type == "number":
            if op == "in":
                return None  # numeric fields don't support "in"
            num = _coerce_number(value)
            if num is None:
                return None
            if field == "height_m" and unit == "feet":
                num *= 0.3048
            elif field == "assessed_value":
                if unit in ("thousand_dollars", "k", "thousands"):
                    num *= 1_000
                elif unit in ("million_dollars", "millions", "m"):
                    num *= 1_000_000
            return FilterCondition(field=field, op=op, value=round(num, 2))

        # string field: zoning / land_use
        if op == "in":
            raw_values = value if isinstance(value, list) else [value]
            values = [
                _normalize_zoning_code(v) if field == "zoning" else str(v)
                for v in raw_values
                if isinstance(v, str) and v
            ]
            if not values:
                return None
            return FilterCondition(field=field, op="in", value=values)

        if not isinstance(value, str) or not value:
            return None
        v = _normalize_zoning_code(value) if field == "zoning" else value
        return FilterCondition(field=field, op=op, value=v)
    except (TypeError, ValueError):
        return None


def _parse_llm_response(raw_json: Dict[str, Any]) -> List[FilterCondition]:
    raw_conditions = raw_json.get("conditions") or []
    conditions = []
    for rc in raw_conditions:
        if not isinstance(rc, dict):
            continue
        cond = _convert_units(rc)
        if cond is not None:
            conditions.append(cond)
    return conditions


# ---------------------------------------------------------------------------
# Keyword fallback (used when there's no API key, the call fails, or the
# model's response yields zero usable conditions)
# ---------------------------------------------------------------------------
_FEET_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:feet|foot|ft)\b", re.I)
_METERS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:meters|metres|\bm\b)", re.I)
_DOLLAR_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|million)?", re.I)
_UNDER_WORDS = ("under", "below", "less than", "cheaper than", "shorter than", "smaller than")


def _keyword_fallback(query_text: str) -> List[FilterCondition]:
    text = query_text.lower()
    conditions: List[FilterCondition] = []
    op = "lt" if any(w in text for w in _UNDER_WORDS) else "gt"

    feet_match = _FEET_RE.search(text)
    meters_match = _METERS_RE.search(text)
    if feet_match:
        conditions.append(FilterCondition(field="height_m", op=op, value=round(float(feet_match.group(1)) * 0.3048, 2)))
    elif meters_match:
        conditions.append(FilterCondition(field="height_m", op=op, value=float(meters_match.group(1))))

    if any(w in text for w in ("$", "value", "cost", "worth", "assess")):
        dollar_match = _DOLLAR_RE.search(query_text.replace(",", ""))
        if dollar_match and dollar_match.group(1):
            amount = float(dollar_match.group(1))
            suffix = (dollar_match.group(2) or "").lower()
            if suffix in ("k", "thousand"):
                amount *= 1_000
            elif suffix == "million":
                amount *= 1_000_000
            conditions.append(FilterCondition(field="assessed_value", op=op, value=amount))

    if "commercial" in text:
        conditions.append(FilterCondition(field="zoning", op="in", value=_COMMERCIAL_CODES))
    elif "residential" in text:
        conditions.append(FilterCondition(field="zoning", op="in", value=_RESIDENTIAL_CODES))
    else:
        # explicit zoning code mention, longest codes checked first to
        # avoid short-code false positives (e.g. "DC") matching everywhere
        squashed = re.sub(r"[^A-Z0-9]", "", text.upper())
        for code in sorted(KNOWN_ZONING_CODES, key=len, reverse=True):
            squashed_code = re.sub(r"[^A-Z0-9]", "", code.upper())
            if squashed_code and squashed_code in squashed:
                conditions.append(FilterCondition(field="zoning", op="eq", value=code))
                break

    return conditions


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def interpret_query(query_text: str) -> QueryOut:
    try:
        raw_json = _call_groq(query_text)
        conditions = _parse_llm_response(raw_json)
        if conditions:
            summary = str(raw_json.get("summary") or query_text)
            return QueryOut(conditions=conditions, summary=summary, source="llm")
        logger.warning("LLM returned zero usable conditions for %r, falling back", query_text)
    except LLMError as e:
        logger.warning("LLM call failed (%s), falling back to keyword parser", e)

    conditions = _keyword_fallback(query_text)
    summary = query_text if conditions else f'No filterable terms recognized in "{query_text}"'
    return QueryOut(conditions=conditions, summary=summary, source="fallback")
