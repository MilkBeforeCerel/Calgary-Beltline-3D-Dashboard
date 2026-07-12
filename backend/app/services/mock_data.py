"""
mock_data.py
------------
Deterministic, realistic-looking data for the study area, used as a
fallback when the live Calgary Open Data API is unreachable and for
DATA_SOURCE_MODE=mock. Everything uses a fixed random seed so results are
stable across restarts (important for demoing save/load of projects).
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
HYDRANT_STATUSES = ["In Service", "Out of Service", "Needs Repair"]
TRANSIT_ROUTE_TYPES = ["Bus", "LRT"]
BUS_ROUTES = ["3", "10", "17", "route unknown"]
LRT_ROUTES = ["Red Line", "Blue Line"]


def _local_to_lonlat(x: float, y: float) -> tuple:
    lat = ORIGIN_LAT + (y / geo_utils.EARTH_RADIUS_M) * (180 / 3.14159265)
    lon = ORIGIN_LON + (x / (geo_utils.EARTH_RADIUS_M * 0.62)) * (180 / 3.14159265)
    return round(lat, 6), round(lon, 6)


def _make_block(block_row: int, block_col: int) -> List[dict]:
    """Generate a small grid of buildings for one city block."""
    buildings = []
    n_buildings = _RNG.randint(4, 6)
    block_origin_x = block_col * 110.0
    block_origin_y = block_row * 110.0

    for i in range(n_buildings):
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
        lat, lon = _local_to_lonlat(centroid_x, centroid_y)

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
    for row in range(2):
        for col in range(2):
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
        lat, lon = _local_to_lonlat(jitter_x, jitter_y)
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


def generate_fire_hydrants(buildings: List[dict]) -> List[dict]:
    """Scatter fire hydrants at roughly regular intervals along block edges."""
    hydrants = []
    sample = _RNG.sample(buildings, k=min(12, len(buildings)))
    for i, b in enumerate(sample):
        cx, cy = b["centroid"]
        x = cx + _RNG.choice([-1, 1]) * _RNG.uniform(12, 20)
        y = cy + _RNG.choice([-1, 1]) * _RNG.uniform(12, 20)
        lat, lon = _local_to_lonlat(x, y)
        hydrants.append(
            {
                "id": f"HYDRANT-MOCK-{i}",
                "status": _RNG.choices(HYDRANT_STATUSES, weights=[85, 10, 5])[0],
                "hydrant_type": "Standard Dry Barrel",
                "x": x,
                "y": y,
                "lat": lat,
                "lon": lon,
                "source": "mock",
            }
        )
    return hydrants


def generate_transit_stops(buildings: List[dict]) -> List[dict]:
    """Scatter a small number of transit stops (mostly bus, one LRT) along the study area."""
    stops = []
    sample = _RNG.sample(buildings, k=min(5, len(buildings)))
    for i, b in enumerate(sample):
        cx, cy = b["centroid"]
        x = cx + _RNG.choice([-1, 1]) * _RNG.uniform(14, 22)
        y = cy + _RNG.choice([-1, 1]) * _RNG.uniform(14, 22)
        lat, lon = _local_to_lonlat(x, y)
        route_type = "LRT" if i == 0 else "Bus"
        routes = _RNG.sample(LRT_ROUTES, k=1) if route_type == "LRT" else _RNG.sample(BUS_ROUTES[:-1], k=_RNG.randint(1, 2))
        stops.append(
            {
                "id": f"TRANSIT-MOCK-{i}",
                "stop_name": f"{b['address'].split(' ', 1)[-1]} Stop",
                "route_type": route_type,
                "routes": routes,
                "x": x,
                "y": y,
                "lat": lat,
                "lon": lon,
                "source": "mock",
            }
        )
    return stops
