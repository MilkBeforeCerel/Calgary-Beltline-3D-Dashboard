"""
geo_utils.py
------------
Small, dependency-light geo helpers. We deliberately avoid pulling in a
heavy GIS stack (pyproj/GDAL) for a prototype -- an equirectangular
projection around the study area's center is accurate to a few centimeters
over a 3-4 block span, which is more than enough for a Three.js scene.
"""
import math
from typing import Iterable, List, Sequence, Tuple

EARTH_RADIUS_M = 6_378_137.0


def lonlat_to_local_xy(lon: float, lat: float, origin_lon: float, origin_lat: float) -> Tuple[float, float]:
    """
    Project a (lon, lat) pair to local meters relative to an origin point,
    using an equirectangular approximation. Good enough for a few-block
    study area; x = east, y = north.
    """
    lat_rad = math.radians(origin_lat)
    x = math.radians(lon - origin_lon) * EARTH_RADIUS_M * math.cos(lat_rad)
    y = math.radians(lat - origin_lat) * EARTH_RADIUS_M
    return x, y


def project_ring(ring: Iterable[Sequence[float]], origin_lon: float, origin_lat: float) -> List[List[float]]:
    """Project a ring of [lon, lat] pairs to local [x, y] meters."""
    return [list(lonlat_to_local_xy(pt[0], pt[1], origin_lon, origin_lat)) for pt in ring]


def polygon_centroid(ring: Sequence[Sequence[float]]) -> Tuple[float, float]:
    """Simple average-of-vertices centroid (fine for near-convex building footprints)."""
    if not ring:
        return (0.0, 0.0)
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def point_in_polygon(point: Tuple[float, float], ring: Sequence[Sequence[float]]) -> bool:
    """
    Standard ray-casting point-in-polygon test. Used to spatially join
    property assessment points to building footprints without a full GIS
    dependency.
    """
    x, y = point
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def bbox_contains(lon: float, lat: float, bbox: Tuple[float, float, float, float]) -> bool:
    min_lon, min_lat, max_lon, max_lat = bbox
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def polygon_area(ring: Sequence[Sequence[float]]) -> float:
    """
    Shoelace formula. Works on raw lon/lat OR projected local meters -- only
    used for *relative* comparison (e.g. "which facet is the biggest"), so
    the degenerate area-in-degrees units are fine.
    """
    if len(ring) < 3:
        return 0.0
    area = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0
