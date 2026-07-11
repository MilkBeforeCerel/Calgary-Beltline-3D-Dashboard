# MASIV 3D City Dashboard

A full slice of the spec: fetch Calgary Open Data (buildings, property
assessments, building permits), visualize it in 3D, filter it with
natural-language queries via an LLM, and let users save/load named
"projects" (a saved filter) under a simple username.

```
backend/    FastAPI service -- fetches + processes Calgary Open Data,
            interprets NL queries via Groq, persists projects in SQLite
frontend/   React + Three.js -- extrudes footprints, renders permit pins,
            query bar, and save/load UI
docs/       UML.md -- class + sequence diagrams (spec step 7)
```

## What's implemented

1. **Fetch + process city data (backend)** -- `GET /api/buildings` returns
   footprints + heights for buildings across 4 blocks in Calgary's
   Beltline, joined with property assessment data (address, assessed
   value, zoning) via a point-in-polygon spatial join, plus building
   permits in the same area. Field names for buildings (`cchr-krqg`) and
   property assessments (`4bsw-nn7w`) are confirmed against live `curl`
   responses (see "Verifying against live data" below); building permits
   (`c2es-76ed`) use best-guess field candidates (documented in
   `config.py`/`calgary_client.py`) since this sandbox's egress proxy
   blocks `data.calgary.ca` outright and the shape has never been
   exercised against a real response.

2. **3D visualization (frontend)** -- buildings extrude by height, colored
   by zoning category; building permits render as clickable "pin" markers
   (colored by permit status) with a show/hide toggle. Orbit/zoom camera,
   click-to-select on either buildings or permits, and a detail panel
   showing the relevant fields for whichever is selected.

3. **Natural-language query (LLM)** -- a query bar sends free text (e.g.
   *"buildings over 100 feet"*, *"show commercial buildings"*, *"show
   buildings in RC-G zoning"*, *"show buildings less than $500,000 in
   value"*) to `POST /api/query`. Groq's OpenAI-compatible chat API
   (JSON mode, `llama-3.1-8b-instant`) interprets the query into a
   structured filter -- notably, the LLM is only asked for the raw
   number + unit it read in the text (e.g. `100 feet`), never to do the
   unit math itself; conversion to canonical units (meters, dollars)
   happens deterministically in Python (`llm_service._convert_units`).
   If `LLM_API_KEY` is unset, the Groq call fails, or the model's
   response yields zero usable conditions, a small keyword-based parser
   is used instead -- the response always reports which path was used
   (`source: "llm" | "fallback"`), same honesty convention as the
   buildings endpoint's `live`/`mock` flag. Matching buildings are
   highlighted client-side (`frontend/src/lib/filterEngine.js`), which
   also lets a *loaded* saved project reproduce the same highlight
   without another LLM call.

4. **Project persistence (SQLite)** -- a username field (find-or-create,
   no password) identifies the user. "Save Project" stores the active
   filter's conditions + the query text that produced them under a
   project name (`POST /api/projects`, upserts on repeat saves under the
   same name). A projects panel lists everything saved for the current
   username (`GET /api/projects?username=...`); clicking a row re-applies
   its filter to the current buildings without re-querying the LLM.

5. **UML** -- see [`docs/UML.md`](docs/UML.md): a class diagram (User,
   Project, FilterCondition, plus the transient Building/Permit/QueryOut
   DTOs) and a sequence diagram covering query → highlight → save → load.

## Running it

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # then fill in LLM_API_KEY (see below)
uvicorn app.main:app --reload --port 8000
```

`.env` (gitignored) holds:

- `LLM_API_KEY` -- a [Groq](https://console.groq.com) API key (free tier).
  Leave blank to run the keyword-fallback query parser instead of real LLM
  calls -- the app degrades gracefully either way.
- `LLM_BASE_URL` / `LLM_MODEL` -- defaults target Groq; point at any other
  OpenAI-compatible chat completions endpoint (Hugging Face Inference,
  OpenAI, etc.) by changing these.
- `DATA_SOURCE_MODE` -- `auto` (default, try live Calgary Open Data and
  fall back to bundled mock data on failure), `live`, or `mock`.
- `DATABASE_URL` -- defaults to `sqlite:///backend/masiv.db` if unset; the
  file is created automatically on first run (`Base.metadata.create_all`).

Visit `http://localhost:8000/api/buildings` for raw JSON, or
`http://localhost:8000/docs` for interactive API docs (FastAPI/Swagger).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit `http://localhost:5173`. It fetches from `http://localhost:8000` by
default (override with a `.env` containing `VITE_API_BASE=...`).

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/buildings` | GET | Buildings + permits for the study area, joined with assessments |
| `/api/query` | POST | `{query_text}` -> `{conditions, summary, source}` |
| `/api/projects` | POST | `{username, name, query_text, conditions}` -> saved/updated project |
| `/api/projects?username=` | GET | `{projects: [...]}` for that username |
| `/api/health` | GET | Liveness check |

## Verifying against live data

Buildings + assessments field names are confirmed against real API
responses (not guessed) -- `DATA_SOURCE_MODE=live` should work as-is on a
machine that can reach `data.calgary.ca`:

```bash
DATA_SOURCE_MODE=live uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/api/buildings
```

If it errors, the most likely culprit is the **Property Assessments**
dataset (`4bsw-nn7w`) being large -- the `within_box` query against
`multipolygon` can be slow; raise `HTTP_TIMEOUT_SECONDS` in `config.py` or
shrink `STUDY_AREA_BBOX` if it times out.

The **Building Permits** dataset (`c2es-76ed`) is wired into the same live
path with the same resilience pattern (a fetch failure degrades to
`permits: []` on an otherwise-live response, never silently substituting
mock permits) but its field candidates in `config.py` remain best-guesses
-- this sandbox cannot reach `data.calgary.ca` to verify them the way
buildings/assessments were. Real Groq LLM calls are similarly unexercised
from this sandbox (no outbound network) but were verified against all
four of the spec's example queries by the person running this locally
with a real `LLM_API_KEY`.

## Architecture notes

- **Geo projection:** lon/lat is projected to local meters with a simple
  equirectangular approximation centered on the study area
  (`services/geo_utils.py`) -- accurate to centimeters over a few blocks,
  avoids a heavy GIS dependency (pyproj/GDAL) for a prototype this size.
- **Spatial join:** building footprints (polygons) and property
  assessments (points) are joined with a standard ray-casting
  point-in-polygon test, not a fuzzy address match -- more robust to
  address-formatting differences between datasets.
- **Data honesty:** nothing in the pipeline silently mixes real and fake
  data inside a single record -- an entire `/api/buildings` response is
  either `"live"` or `"mock"`, and an entire `/api/query` response is
  either `"llm"` or `"fallback"`, both surfaced in the UI.
- **LLM never does unit math:** `llm_service.py` asks Groq only for the
  raw `{field, op, value, unit}` it read out of the query text; feet-to-
  meters and dollar-string conversion happen deterministically in Python
  afterward. This removes an entire class of silently-wrong-by-a-constant
  bugs that come from trusting an LLM's arithmetic.
- **Filter evaluation is client-side:** `POST /api/query` only maps text
  to a structured filter -- it never fetches or holds the buildings
  dataset. The frontend (`lib/filterEngine.js`) evaluates conditions
  against whichever buildings array it already has on screen, and reuses
  the exact same code path whether the filter came from a fresh query or
  a loaded saved project.
- **No ORM-model leakage:** only `User` and `Project` are persisted
  (SQLite via SQLAlchemy, `backend/app/models.py`). Buildings/permits are
  always fetched fresh per request and never written to the database --
  see `docs/UML.md` for why the class diagram marks them as transient DTOs.
