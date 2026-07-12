"""
calgary_client.py
------------------
Fetches and normalizes data from City of Calgary Open Data (Socrata)
datasets, joining them into a single "enriched building" record.

Field names and geometry shapes below are taken from REAL sample
responses (verified via `curl` against the live API by the user, since
this dev sandbox has no route to data.calgary.ca):

  cchr-krqg (3D Buildings) -- one row per ROOF FACET, not per building:
    {
      "struct_id": "2376084",
      "stage": "CONSTRUCTED",
      "grd_elev_min_z": "1050.91",       # ground elevation, meters ASL
      "rooftop_elev_z": "1055.115...",   # roof elevation, meters ASL
      "polygon": {"type": "Polygon", "coordinates": [[[lon,lat], ...]]}
    }
    There is no direct height column -- height = rooftop_elev_z -
    grd_elev_min_z. A real building can be split across several facet
    rows sharing the same struct_id (e.g. a stepped roofline), so rows
    are grouped by struct_id: height = max(rooftop_elev_z) -
    min(grd_elev_min_z) across the group, and the largest single facet
    ring is used as a practical stand-in footprint (a true polygon union
    would need a GIS library like shapely; noted as a known
    simplification -- see README).

  4bsw-nn7w (Property Assessments) -- one row per parcel:
    {
      "address": "15 DEERMEADE PL SE",
      "assessed_value": "729000.0",
      "land_use_designation": "R-CG",      # this *is* the zoning code
      "year_of_construction": "1981.0",
      "multipolygon": {"type": "MultiPolygon", "coordinates": [[[[lon,lat], ...]]]}
    }
    No lat/lon columns -- joined to buildings via point-in-polygon: each
    building's footprint centroid is tested against each parcel's
    multipolygon boundary.

  c2es-76ed (Building Permits) -- wired into get_map_data() below, but
    field names are still best-guess (see _fetch_permits_raw for why: this
    sandbox cannot reach data.calgary.ca to verify them against a live
    response). Degrades to permits=[] on fetch failure without touching the
    buildings/assessments result, same honesty rule as the assessments join.
"""
import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import (
    SOCRATA_BASE_URL,
    DATASET_BUILDINGS_3D,
    DATASET_PROPERTY_ASSESSMENTS,
    DATASET_BUILDING_PERMITS,
    DATASET_FIRE_HYDRANTS,
    DATASET_TRANSIT_STOPS,
    SOCRATA_APP_TOKEN,
    FIELD_CANDIDATES,
    STUDY_AREA_BBOX,
    STUDY_AREA_CENTER,
    HTTP_TIMEOUT_SECONDS,
    DATA_SOURCE_MODE,
)
from app.services import geo_utils, mock_data

logger = logging.getLogger("masiv.calgary_client")

ORIGIN_LON, ORIGIN_LAT = STUDY_AREA_CENTER

MIN_PLAUSIBLE_HEIGHT_M = 2.5     # facets can be noisy; floor prevents 0/negative heights
MAX_PLAUSIBLE_HEIGHT_M = 250.0   # sanity ceiling in case of a bad elevation outlier


def _headers() -> Dict[str, str]:
    return {"X-App-Token": SOCRATA_APP_TOKEN} if SOCRATA_APP_TOKEN else {}


def _first_present(row: Dict[str, Any], candidates: List[str]) -> Optional[Any]:
    for key in candidates:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _soql_get(dataset_id: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
    url = f"{SOCRATA_BASE_URL}/{dataset_id}.json"
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS) as client:
        resp = client.get(url, params=params, headers=_headers())
        resp.raise_for_status()
        return resp.json()


def _extract_outer_ring(geom: Dict[str, Any]) -> Optional[List[List[float]]]:
    """
    Handles both geometry shapes seen in the wild on Open Calgary:
      - {"type": "Polygon", "coordinates": [ring, hole1, ...]}
      - {"type": "MultiPolygon", "coordinates": [[ring, hole1, ...], ...]}
    Returns the first polygon's outer ring as a list of [lon, lat] pairs.
    """
    if not geom or "coordinates" not in geom:
        return None
    gtype = geom.get("type")
    coords = geom["coordinates"]
    try:
        if gtype == "MultiPolygon":
            return coords[0][0]
        # Default to Polygon behavior (also covers unlabeled geometries).
        return coords[0]
    except (KeyError, IndexError, TypeError):
        return None


def _fetch_buildings_raw() -> List[Dict[str, Any]]:
    """
    Fetch 3D building roof facets within the study bbox. Limit is high
    because the dataset is one-row-per-facet, so a dense block can have
    several rows per building.
    """
    min_lon, min_lat, max_lon, max_lat = STUDY_AREA_BBOX
    geom_col = FIELD_CANDIDATES["buildings"]["geometry"][0]  # "polygon"
    where = f"within_box({geom_col}, {max_lat}, {min_lon}, {min_lat}, {max_lon})"
    return _soql_get(DATASET_BUILDINGS_3D, {"$where": where, "$limit": "5000"})


def _fetch_assessments_raw() -> List[Dict[str, Any]]:
    min_lon, min_lat, max_lon, max_lat = STUDY_AREA_BBOX
    geom_col = FIELD_CANDIDATES["assessments"]["geometry"][0]  # "multipolygon"
    where = f"within_box({geom_col}, {max_lat}, {min_lon}, {min_lat}, {max_lon})"
    return _soql_get(DATASET_PROPERTY_ASSESSMENTS, {"$where": where, "$limit": "3000"})


def _fetch_permits_raw() -> List[Dict[str, Any]]:
    # NOTE: field candidates for this dataset (c2es-76ed) are best-guess,
    # taken from typical Open Calgary permit dataset conventions -- this
    # sandbox's egress proxy blocks data.calgary.ca outright, so the shape
    # below has never been exercised against a real response the way
    # buildings/assessments were (see README "Verifying against live data").
    # Wired into get_map_data() below with the same resilience pattern as
    # the assessments join: a failure here degrades to permits=[] on an
    # otherwise-live response, it never falls back to mock permits.
    min_lon, min_lat, max_lon, max_lat = STUDY_AREA_BBOX
    fc = FIELD_CANDIDATES["permits"]
    where = (
        f"{fc['lat'][0]} between {min_lat} and {max_lat} AND "
        f"{fc['lon'][0]} between {min_lon} and {max_lon}"
    )
    return _soql_get(DATASET_BUILDING_PERMITS, {"$where": where, "$limit": "200"})


def _fetch_point_dataset_raw(
    dataset_id: str, layer_key: str, limit: str = "200", order: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Shared bbox fetch for the point-ish overlay layers (hydrants, transit).
    Both turned out to only carry a "point" Point geometry column live, not
    separate lat/lon fields like permits does -- so this filters by
    whichever the dataset actually has: a lat/lon `between` pair if
    FIELD_CANDIDATES declares them, else `within_box` on the geometry
    column. Raises immediately (caught by the per-layer try/except in
    get_map_data) if the dataset id hasn't been configured -- see config.py.
    """
    if not dataset_id:
        raise ValueError(f"no dataset id configured for '{layer_key}' -- skipping live fetch")
    min_lon, min_lat, max_lon, max_lat = STUDY_AREA_BBOX
    fc = FIELD_CANDIDATES[layer_key]
    if fc.get("lat") and fc.get("lon"):
        where = (
            f"{fc['lat'][0]} between {min_lat} and {max_lat} AND "
            f"{fc['lon'][0]} between {min_lon} and {max_lon}"
        )
    else:
        geom_col = fc["geometry"][0]
        where = f"within_box({geom_col}, {max_lat}, {min_lon}, {min_lat}, {max_lon})"
    params = {"$where": where, "$limit": limit}
    if order:
        params["$order"] = order
    return _soql_get(dataset_id, params)


def _aggregate_building_facets(raw_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Groups roof-facet rows by struct_id and reduces each group to one
    building record: height from the elevation spread across all facets,
    footprint from the single largest facet ring (documented
    simplification -- see module docstring).
    """
    fc = FIELD_CANDIDATES["buildings"]
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for row in raw_rows:
        struct_id = _first_present(row, fc["id"])
        if struct_id is None:
            continue
        groups[str(struct_id)].append(row)

    buildings = []
    for struct_id, rows in groups.items():
        best_ring = None
        best_area = -1.0
        rooftop_zs, ground_zs = [], []

        for row in rows:
            geom = _first_present(row, fc["geometry"])
            ring = _extract_outer_ring(geom) if geom else None
            if ring:
                area = geo_utils.polygon_area(ring)
                if area > best_area:
                    best_area = area
                    best_ring = ring

            rz = _to_float(_first_present(row, fc["rooftop_elev_z"]))
            gz = _to_float(_first_present(row, fc["grd_elev_min_z"]))
            if rz is not None:
                rooftop_zs.append(rz)
            if gz is not None:
                ground_zs.append(gz)

        if not best_ring:
            continue

        if rooftop_zs and ground_zs:
            height_m = max(rooftop_zs) - min(ground_zs)
        else:
            height_m = MIN_PLAUSIBLE_HEIGHT_M
        height_m = max(MIN_PLAUSIBLE_HEIGHT_M, min(height_m, MAX_PLAUSIBLE_HEIGHT_M))

        footprint = geo_utils.project_ring(best_ring, ORIGIN_LON, ORIGIN_LAT)
        centroid = geo_utils.polygon_centroid(footprint)
        lon, lat = best_ring[0][0], best_ring[0][1]

        buildings.append(
            {
                "id": struct_id,
                "address": None,   # filled by _join_assessments
                "height_m": round(height_m, 1),
                "footprint": footprint,
                "centroid": list(centroid),
                "zoning": None,
                "land_use": None,
                "assessed_value": None,
                "year_built": None,
                "lat": lat,
                "lon": lon,
                "source": "live",
            }
        )
    return buildings


def _join_assessments(buildings: List[Dict[str, Any]], assessments_raw: List[Dict[str, Any]]) -> None:
    """
    Point-in-polygon join: for each building, test its footprint centroid
    against every assessment parcel's polygon. First match wins.
    """
    fc = FIELD_CANDIDATES["assessments"]

    parcels = []
    for a in assessments_raw:
        geom = _first_present(a, fc["geometry"])
        ring = _extract_outer_ring(geom) if geom else None
        if not ring:
            continue
        projected_ring = geo_utils.project_ring(ring, ORIGIN_LON, ORIGIN_LAT)
        parcels.append((projected_ring, a))

    for b in buildings:
        cx, cy = b["centroid"]
        for projected_ring, a in parcels:
            if geo_utils.point_in_polygon((cx, cy), projected_ring):
                b["address"] = _first_present(a, fc["address"])
                land_use = _first_present(a, fc["land_use"])
                b["zoning"] = land_use
                b["land_use"] = land_use
                b["assessed_value"] = _to_float(_first_present(a, fc["assessed_value"]))
                yr = _to_float(_first_present(a, fc["year_built"]))
                b["year_built"] = int(yr) if yr else None
                break


def _normalize_permit(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fc = FIELD_CANDIDATES["permits"]
    lat = _to_float(_first_present(raw, fc["lat"]))
    lon = _to_float(_first_present(raw, fc["lon"]))
    if lat is None or lon is None:
        return None
    x, y = geo_utils.lonlat_to_local_xy(lon, lat, ORIGIN_LON, ORIGIN_LAT)
    return {
        "id": str(_first_present(raw, fc["id"]) or f"PERMIT-LIVE-{lat:.5f}-{lon:.5f}"),
        "address": _first_present(raw, fc["address"]),
        "permit_type": _first_present(raw, fc["permit_type"]),
        "status": _first_present(raw, fc["status"]),
        "estimated_cost": _to_float(_first_present(raw, fc["estimated_cost"])),
        "issued_date": _first_present(raw, fc["issued_date"]),
        "x": x,
        "y": y,
        "lat": lat,
        "lon": lon,
        "source": "live",
    }


def _extract_point_lonlat(raw: Dict[str, Any], fc: Dict[str, List[str]]) -> Tuple[Optional[float], Optional[float]]:
    """
    Permits carry separate lat/lon columns; hydrants/transit only carry a
    "point" {"type": "Point", "coordinates": [lon, lat]} geometry -- try
    lat/lon columns first, fall back to the geometry column declared under
    FIELD_CANDIDATES[...]["geometry"].
    """
    lat = _to_float(_first_present(raw, fc.get("lat", [])))
    lon = _to_float(_first_present(raw, fc.get("lon", [])))
    if lat is not None and lon is not None:
        return lon, lat
    geom = _first_present(raw, fc.get("geometry", []))
    if isinstance(geom, dict) and geom.get("type") == "Point":
        coords = geom.get("coordinates")
        if isinstance(coords, list) and len(coords) == 2:
            return _to_float(coords[0]), _to_float(coords[1])
    return None, None


def _normalize_hydrant(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fc = FIELD_CANDIDATES["hydrants"]
    lon, lat = _extract_point_lonlat(raw, fc)
    if lat is None or lon is None:
        return None
    x, y = geo_utils.lonlat_to_local_xy(lon, lat, ORIGIN_LON, ORIGIN_LAT)
    return {
        "id": str(_first_present(raw, fc["id"]) or f"HYDRANT-LIVE-{lat:.5f}-{lon:.5f}"),
        "status": _first_present(raw, fc["status"]),
        "hydrant_type": _first_present(raw, fc["hydrant_type"]),
        "x": x,
        "y": y,
        "lat": lat,
        "lon": lon,
        "source": "live",
    }


def _normalize_transit_stop(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fc = FIELD_CANDIDATES["transit"]
    lon, lat = _extract_point_lonlat(raw, fc)
    if lat is None or lon is None:
        return None
    x, y = geo_utils.lonlat_to_local_xy(lon, lat, ORIGIN_LON, ORIGIN_LAT)
    routes_raw = _first_present(raw, fc["routes"])
    routes = routes_raw if isinstance(routes_raw, list) else ([routes_raw] if routes_raw else [])
    return {
        "id": str(_first_present(raw, fc["id"]) or f"TRANSIT-LIVE-{lat:.5f}-{lon:.5f}"),
        "stop_name": _first_present(raw, fc["stop_name"]),
        "route_type": _first_present(raw, fc["route_type"]),
        "routes": routes,
        "x": x,
        "y": y,
        "lat": lat,
        "lon": lon,
        "source": "live",
    }


def get_map_data() -> Dict[str, Any]:
    """
    Top-level entry point used by the API routers. Returns:
        {"buildings": [...], "permits": [...], "center": [lon, lat], "source": "live"|"mock"}
    """
    if DATA_SOURCE_MODE == "mock":
        return _mock_payload()

    try:
        buildings_raw = _fetch_buildings_raw()
        buildings = _aggregate_building_facets(buildings_raw)
        if not buildings:
            raise ValueError("Live buildings fetch returned zero usable records")

        try:
            assessments_raw = _fetch_assessments_raw()
            _join_assessments(buildings, assessments_raw)
        except Exception as e:  # noqa: BLE001
            logger.warning("Assessment join failed, continuing with footprints only: %s", e)

        try:
            permits_raw = _fetch_permits_raw()
            permits = [p for p in (_normalize_permit(r) for r in permits_raw) if p is not None]
        except Exception as e:  # noqa: BLE001
            logger.warning("Permit fetch failed, continuing with permits=[]: %s", e)
            permits = []

        try:
            hydrants_raw = _fetch_point_dataset_raw(DATASET_FIRE_HYDRANTS, "hydrants", limit="500")
            hydrants = [h for h in (_normalize_hydrant(r) for r in hydrants_raw) if h is not None]
        except Exception as e:  # noqa: BLE001
            logger.warning("Hydrant fetch failed, continuing with hydrants=[]: %s", e)
            hydrants = []

        try:
            transit_raw = _fetch_point_dataset_raw(DATASET_TRANSIT_STOPS, "transit")
            transit_stops = [t for t in (_normalize_transit_stop(r) for r in transit_raw) if t is not None]
        except Exception as e:  # noqa: BLE001
            logger.warning("Transit stop fetch failed, continuing with transit_stops=[]: %s", e)
            transit_stops = []

        return {
            "buildings": buildings,
            "permits": permits,
            "hydrants": hydrants,
            "transit_stops": transit_stops,
            "center": [ORIGIN_LON, ORIGIN_LAT],
            "source": "live",
        }

    except Exception as e:  # noqa: BLE001
        if DATA_SOURCE_MODE == "live":
            raise
        logger.warning("Falling back to mock data: %s", e)
        return _mock_payload()


def _mock_payload() -> Dict[str, Any]:
    buildings = mock_data.generate_buildings()
    permits = mock_data.generate_permits(buildings)
    hydrants = mock_data.generate_fire_hydrants(buildings)
    transit_stops = mock_data.generate_transit_stops(buildings)
    return {
        "buildings": buildings,
        "permits": permits,
        "hydrants": hydrants,
        "transit_stops": transit_stops,
        "center": [ORIGIN_LON, ORIGIN_LAT],
        "source": "mock",
    }
