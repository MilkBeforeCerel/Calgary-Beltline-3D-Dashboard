"""
mock_data.py
------------
Deterministic, realistic-looking data for the study area, used as a
fallback when the live Calgary Open Data API is unreachable (offline dev,
network restrictions, rate limiting, or a schema change on the City's end)
and for DATA_SOURCE_MODE=mock.

Nothing here is randomized without a fixed seed, so results are stable
across restarts (important for demoing save/load of projects).

The layout approximates 4 city blocks along 17 Ave SW / 1 St SW in the
Beltline, with a mix of building heights, land-use districts, and permit
activity so every required query type in the spec has real matches:
  - "buildings over 100 feet" (~30m)
  - "commercial buildings"
  - "buildings in RC-G zoning"
  - "buildings less than $500,000 in value"
"""
import random
from typing import Dict, List

from app.config import STUDY_AREA_CENTER, KNOWN_ZONING_CODES, LAND_USE_BY_ZONE
from app.services import geo_utils

_RNG = random.Random(42)  # fixed seed -> deterministic mock output

ORIGIN_LON, ORIGIN_LAT = STUDY_AREA_CENTER

STREET_NAMES = ["17 Ave SW", "16 Ave SW", "1 St SW", "2 St SW"]
ZONING_TYPES = KNOWN_ZONING_CODES  # kept as a local alias -- see config.py for the shared definition
PERMIT_TYPES = ["New Building", "Alteration", "Addition", "Demolition", "Tenant Improvement"]
PERMIT_STATUSES = ["Issued", "In Review", "Completed", "Applied"]


def _make_block(block_row: int, block_col: int) -> List[dict]:
    """Generate a small grid of buildings for one city block."""
    buildings = []
    n_buildings = _RNG.randint(4, 6)
    block_origin_x = block_col * 110.0  # meters, ~1 block spacing
    block_origin_y = block_row * 110.0

    for i in range(n_buildings):
        # Lay buildings out along the block edge with some footprint variety.
        w = _RNG.uniform(14, 26)
        d = _RNG.uniform(14, 26)
        bx = block_origin_x + (i % 3) * 32 + _RNG.uniform(-3, 3)
        by = block_origin_y + (i // 3) * 40 + _RNG.uniform(-3, 3)

        footprint = [
            [bx, by],
            [bx + w, by],
            [bx + w, by + d],
            [bx, by + d],
        ]

        zoning = _RNG.choice(ZONING_TYPES)
        # Height correlates loosely with zoning (high-rise zones -> taller).
        if zoning == "CC-MH":
            height_m = _RNG.uniform(45, 110)
        elif zoning in ("CC-COR", "M-C1"):
            height_m = _RNG.uniform(15, 40)
        else:
            height_m = _RNG.uniform(6, 16)

        assessed_value = round(_RNG.uniform(220_000, 3_500_000), -3)
        year_built = _RNG.randint(1955, 2023)
        street = STREET_NAMES[(block_row * 2 + block_col) % len(STREET_NAMES)]
        addr = f"{100 + block_row * 100 + block_col * 10 + i * 2} {street}"

        centroid_x, centroid_y = geo_utils.polygon_centroid(footprint)
        # Rough inverse projection back to lon/lat for popups/markers.
        lat = ORIGIN_LAT + (centroid_y / geo_utils.EARTH_RADIUS_M) * (180 / 3.14159265)
        lon = ORIGIN_LON + (centroid_x / (geo_utils.EARTH_RADIUS_M * 0.62)) * (180 / 3.14159265)

        buildings.append(
            {
                "id": f"MOCK-{block_row}{block_col}-{i}",
                "address": addr,
                "height_m": round(height_m, 1),
                "footprint": footprint,
                "centroid": [centroid_x, centroid_y],
                "zoning": zoning,
                "land_use": LAND_USE_BY_ZONE[zoning],
                "assessed_value": assessed_value,
                "year_built": year_built,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "source": "mock",
            }
        )
    return buildings


def generate_buildings() -> List[dict]:
    buildings = []
    for row in range(2):      # 2 rows
        for col in range(2):  # x 2 cols = 4 blocks
            buildings.extend(_make_block(row, col))
    return buildings


def generate_permits(buildings: List[dict]) -> List[dict]:
    """Scatter a handful of permits near a subset of buildings."""
    permits = []
    sample = _RNG.sample(buildings, k=min(10, len(buildings)))
    for i, b in enumerate(sample):
        cx, cy = b["centroid"]
        jitter_x = cx + _RNG.uniform(-6, 6)
        jitter_y = cy + _RNG.uniform(-6, 6)
        lat = ORIGIN_LAT + (jitter_y / geo_utils.EARTH_RADIUS_M) * (180 / 3.14159265)
        lon = ORIGIN_LON + (jitter_x / (geo_utils.EARTH_RADIUS_M * 0.62)) * (180 / 3.14159265)
        permits.append(
            {
                "id": f"PERMIT-MOCK-{i}",
                "address": b["address"],
                "permit_type": _RNG.choice(PERMIT_TYPES),
                "status": _RNG.choice(PERMIT_STATUSES),
                "estimated_cost": round(_RNG.uniform(15_000, 2_500_000), -2),
                "issued_date": f"2025-{_RNG.randint(1,12):02d}-{_RNG.randint(1,28):02d}",
                "x": jitter_x,
                "y": jitter_y,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "source": "mock",
            }
        )
    return permits
