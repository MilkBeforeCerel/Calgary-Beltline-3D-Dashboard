const EARTH_RADIUS_M = 6378137.0

/**
 * Same equirectangular approximation as backend/app/services/geo_utils.py's
 * lonlat_to_local_xy -- must match exactly (same formula, same origin) so
 * map tiles line up with the buildings/streets/pins the backend already
 * projected into this local coordinate system.
 */
export function lonlatToLocalXY(lon, lat, originLon, originLat) {
  const latRad = (originLat * Math.PI) / 180
  const x = (((lon - originLon) * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(latRad)
  const y = (((lat - originLat) * Math.PI) / 180) * EARTH_RADIUS_M
  return [x, y]
}

/** Inverse of lonlatToLocalXY -- both directions are linear, so this is exact, not approximate. */
export function localXYToLonLat(x, y, originLon, originLat) {
  const latRad = (originLat * Math.PI) / 180
  const lon = originLon + (x / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI)
  const lat = originLat + (y / EARTH_RADIUS_M) * (180 / Math.PI)
  return [lon, lat]
}

/** A [minLon, minLat, maxLon, maxLat] bbox of the given radius (meters) around a center point. */
export function bboxAroundMeters(centerLon, centerLat, radiusMeters) {
  const latRad = (centerLat * Math.PI) / 180
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI)
  const dLon = (radiusMeters / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI)
  return [centerLon - dLon, centerLat - dLat, centerLon + dLon, centerLat + dLat]
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
}

function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180
}

function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** Standard Slippy Map tile bounds, in lon/lat. */
export function tileBoundsLonLat(x, y, zoom) {
  return {
    west: tileXToLon(x, zoom),
    east: tileXToLon(x + 1, zoom),
    north: tileYToLat(y, zoom),
    south: tileYToLat(y + 1, zoom),
  }
}

/** Every {x, y, zoom} tile covering a [minLon, minLat, maxLon, maxLat] bbox. */
export function tilesForBbox(bbox, zoom) {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const xMin = Math.floor(lonToTileX(minLon, zoom))
  const xMax = Math.floor(lonToTileX(maxLon, zoom))
  const yMin = Math.floor(latToTileY(maxLat, zoom)) // higher lat -> smaller tile y
  const yMax = Math.floor(latToTileY(minLat, zoom))
  const tiles = []
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tiles.push({ x, y, zoom })
    }
  }
  return tiles
}
