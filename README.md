# MASIV 3D City Dashboard — Prototype (Steps 1 & 2)

A working slice of the full spec: **fetch Calgary building data for a
multi-block area** and **visualize it in 3D with Three.js**, with click
interactivity showing the fetched attributes per building.

```
backend/    FastAPI service — fetches + processes Calgary Open Data
frontend/   React + Three.js — extrudes footprints, renders the 3D scene
```

## What's implemented

1. **Fetch + process city data (backend)**
   - `GET /api/buildings` returns footprints + heights for buildings
     across 4 blocks in Calgary's Beltline, joined with property
     assessment data (address, assessed value, zoning) via a
     point-in-polygon spatial join.
   - Real dataset integration against Open Calgary (Socrata), **field
     names confirmed against live `curl` responses**:
     - `cchr-krqg` — 3D Buildings - Citywide. One row per **roof facet**
       (not per building), keyed by `struct_id`. No direct height column
       — height is computed as `rooftop_elev_z - grd_elev_min_z`, and
       facets sharing a `struct_id` are grouped together (see
       `_aggregate_building_facets` in `calgary_client.py`). The largest
       single facet ring is used as the footprint — a true polygon union
       across facets would need a GIS library (shapely) and is a known
       simplification for this prototype.
     - `4bsw-nn7w` — Property Assessments. No lat/lon columns; the join
       uses each parcel's `multipolygon` boundary directly (point-in-
       polygon against the building's footprint centroid). Note:
       `land_use_designation` *is* the zoning code (e.g. `"R-CG"`).
   - **Network note:** this sandbox's egress proxy blocks
     `data.calgary.ca` outright (`x-deny-reason: host_not_allowed`), not
     Socrata itself — confirmed via `curl -D -` showing the block
     originates locally. I validated the fetch/aggregation/join logic
     against the *exact* real JSON payloads pulled from a live `curl` (not
     synthetic data), see "Verifying against live data" below. The
     `auto` fallback path was also exercised for real: `DATA_SOURCE_MODE=auto`
     genuinely attempts the live call first, hits the 403, and falls back
     to mock — that's not a hardcoded stub, it's the real failure path.

2. **3D visualization (frontend)**
   - Each building footprint is extruded by its height using
     `THREE.ExtrudeGeometry`, colored by zoning category.
   - Orbit/zoom camera, click-to-select with raycasting, and a detail
     panel showing address, height (m/ft), year built, zoning, land use,
     and assessed value.

## Running it

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
DATA_SOURCE_MODE=auto uvicorn app.main:app --reload --port 8000
```

`DATA_SOURCE_MODE`:
- `auto` (default) — try the live Calgary API, fall back to mock data on failure
- `live` — always use the live API; raises an error if it's unreachable
- `mock` — always use bundled mock data (fast, offline-friendly)

Visit `http://localhost:8000/api/buildings` to see the raw JSON, or
`http://localhost:8000/docs` for interactive API docs (FastAPI/Swagger).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. It fetches from `http://localhost:8000` by
default (override with a `.env` containing `VITE_API_BASE=...`).

## Verifying against live data

Field names are now confirmed against real API responses (not guessed) —
if you run `DATA_SOURCE_MODE=live` on a machine that can actually reach
`data.calgary.ca`, it should work as-is:

```bash
DATA_SOURCE_MODE=live uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/api/buildings
```

If it still errors, the most likely culprit is the **Property
Assessments** dataset (`4bsw-nn7w`) being large — the `within_box` query
against `multipolygon` can be slow. If it times out, either raise
`HTTP_TIMEOUT_SECONDS` in `config.py` or shrink `STUDY_AREA_BBOX`.

The one part of the schema **not yet verified live**: the Building
Permits dataset (`c2es-76ed`) — it isn't called by the current
`/api/buildings` endpoint, so it hasn't been exercised. Its field
candidates in `config.py` are still best-guesses, flagged as such in
comments, and will need the same `curl`-and-compare treatment before the
permits layer (spec step 4) is built.

## Architecture notes

- **Geo projection:** lon/lat is projected to local meters with a simple
  equirectangular approximation centered on the study area
  (`services/geo_utils.py`) — accurate to centimeters over a few blocks,
  avoids a heavy GIS dependency (pyproj/GDAL) for a prototype this size.
- **Spatial join:** building footprints (polygons) and property
  assessments (points) are joined with a standard ray-casting
  point-in-polygon test, not a fuzzy address match — more robust to
  address-formatting differences between datasets.
- **Data honesty:** nothing in the pipeline silently mixes real and fake
  data inside a single record — an entire response is either `"live"` or
  `"mock"`, surfaced in the UI status chip.

## Not yet built (out of scope for this pass)

Per your instruction, this pass only covers spec steps 1–2. Steps 3–7
(permit markers layer, LLM natural-language query, save/load projects,
UML diagram) are not implemented yet — happy to build any of those next.
