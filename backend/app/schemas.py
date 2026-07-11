"""
schemas.py
----------
Pydantic response models for the buildings API (steps 1-2 scope).
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional, Literal, Union

from pydantic import BaseModel, Field


class BuildingOut(BaseModel):
    id: str
    address: Optional[str] = None
    height_m: float
    footprint: List[List[float]]  # [[x, y], ...] local meters, ground-relative
    centroid: List[float]         # [x, y] local meters
    zoning: Optional[str] = None
    assessed_value: Optional[float] = None
    year_built: Optional[int] = None
    land_use: Optional[str] = None
    lat: float
    lon: float
    source: Literal["live", "mock"] = "mock"


class PermitOut(BaseModel):
    id: str
    address: Optional[str] = None
    permit_type: Optional[str] = None
    status: Optional[str] = None
    estimated_cost: Optional[float] = None
    issued_date: Optional[str] = None
    x: float
    y: float
    lat: float
    lon: float
    source: Literal["live", "mock"] = "mock"


class MapDataOut(BaseModel):
    buildings: List[BuildingOut]
    permits: List[PermitOut]
    center: List[float]  # [lon, lat] of study area, for reference
    source: Literal["live", "mock"]


# ---------------------------------------------------------------------------
# Natural-language query / filter (spec step 5)
# ---------------------------------------------------------------------------
FilterField = Literal["height_m", "zoning", "land_use", "assessed_value", "year_built"]
FilterOp = Literal["gt", "gte", "lt", "lte", "eq", "neq", "contains", "in"]


class FilterCondition(BaseModel):
    """
    One clause of a building filter, e.g. {"field": "height_m", "op": "gt",
    "value": 30.48}. A FilterSpec is a list of these, AND-combined -- see
    frontend/src/lib/filterEngine.js for the matching implementation
    (deliberately kept client-side, since the frontend already holds the
    exact building array on screen; the backend's job is only to turn text
    into this structured shape, not to hold or re-fetch the dataset).
    """
    field: FilterField
    op: FilterOp
    value: Union[float, str, List[str]]


class QueryIn(BaseModel):
    query_text: str = Field(min_length=1, max_length=300)


class QueryOut(BaseModel):
    conditions: List[FilterCondition]
    summary: str
    source: Literal["llm", "fallback"]  # honesty flag, mirrors buildings' live/mock


# ---------------------------------------------------------------------------
# Project persistence (spec step 6)
# ---------------------------------------------------------------------------
class ProjectIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    query_text: Optional[str] = None
    conditions: List[FilterCondition]


class ProjectOut(BaseModel):
    id: int
    name: str
    query_text: Optional[str]
    conditions: List[FilterCondition]
    created_at: datetime
    updated_at: datetime


class ProjectListOut(BaseModel):
    projects: List[ProjectOut]
