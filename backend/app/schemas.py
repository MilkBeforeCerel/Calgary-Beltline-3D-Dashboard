"""
schemas.py
----------
Pydantic response models for the buildings API (steps 1-2 scope).
"""
from __future__ import annotations

from typing import List, Optional, Literal

from pydantic import BaseModel


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
    """Reserved for the permits layer (spec step 4) -- not populated yet."""
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
