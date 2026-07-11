"""
config.py
---------
Central place for every "knob" the app needs. Nothing dataset- or
credential-specific should be hard-coded anywhere else in the backend.

NOTE ON CALGARY OPEN DATA SCHEMAS:
Socrata (data.calgary.ca) column names occasionally drift when the City
republishes a dataset. Rather than hard-code a single field name and let
the whole pipeline break, `services/calgary_client.py` tries a short list
of CANDIDATE field names per logical attribute (see FIELD_CANDIDATES
below). If the City renames a column, add the new name to the relevant
list -- no other code changes needed.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# ---------------------------------------------------------------------------
# Study area: 3-4 city blocks in Calgary's Beltline (dense, mixed-use, lots
# of permits + varied building heights -> makes for a good demo).
# Bounding box is (min_lon, min_lat, max_lon, max_lat).
# Roughly 17 Ave SW / 1 St SW area, Beltline.
# ---------------------------------------------------------------------------
STUDY_AREA_BBOX = (-114.0745, 51.0370, -114.0670, 51.0420)
STUDY_AREA_CENTER = (
    (STUDY_AREA_BBOX[0] + STUDY_AREA_BBOX[2]) / 2,
    (STUDY_AREA_BBOX[1] + STUDY_AREA_BBOX[3]) / 2,
)

# ---------------------------------------------------------------------------
# Socrata (Open Calgary) dataset ids -- confirmed via data.calgary.ca
# ---------------------------------------------------------------------------
SOCRATA_BASE_URL = "https://data.calgary.ca/resource"

DATASET_BUILDINGS_3D = "cchr-krqg"          # 3D Buildings - Citywide (footprint + height)
DATASET_PROPERTY_ASSESSMENTS = "4bsw-nn7w"  # Property Assessments (address, value, land use)
DATASET_BUILDING_PERMITS = "c2es-76ed"      # Building Permits
DATASET_LAND_USE_DISTRICTS = "mw9j-jik5"    # Land Use Districts (zoning polygons)

SOCRATA_APP_TOKEN = os.environ.get("SOCRATA_APP_TOKEN", "")  # optional, avoids throttling

# Candidate column names per logical field. First match wins.
#
# UPDATED from real `curl` responses against data.calgary.ca (verified by
# the user, since this dev environment can't reach that host itself):
#
#   cchr-krqg (3D Buildings) sample row:
#     {"grd_elev_min_x":..., "grd_elev_min_z":"1050.91", "rooftop_elev_z":"1055.11...",
#      "stage":"CONSTRUCTED", "struct_id":"2376084",
#      "polygon": {"type":"Polygon","coordinates":[[[lon,lat], ...]]}}
#     NOTE: geometry type is "Polygon" (coordinates[0] is the ring), NOT
#     "MultiPolygon" (coordinates[0][0]) as originally assumed. There is no
#     direct height column -- height must be computed as
#     rooftop_elev_z - grd_elev_min_z. Each row appears to represent one
#     roof facet, grouped by struct_id (a real building can span several
#     rows) -- see calgary_client._aggregate_building_facets.
#
#   4bsw-nn7w (Property Assessments) sample row:
#     {"address":"15 DEERMEADE PL SE", "assessed_value":"729000.0",
#      "land_use_designation":"R-CG", "year_of_construction":"1981.0",
#      "multipolygon": {"type":"MultiPolygon","coordinates":[[[[lon,lat],...]]]}}
#     NOTE: no latitude/longitude columns -- join must be done via the
#     `multipolygon` parcel geometry, not a lat/lon point.
FIELD_CANDIDATES = {
    "buildings": {
        "id": ["struct_id", "structid", "bldg_id", "objectid", ":id"],
        "rooftop_elev_z": ["rooftop_elev_z", "rooftop_elev"],
        "grd_elev_min_z": ["grd_elev_min_z", "grd_elev_z", "ground_elev"],
        "geometry": ["polygon", "the_geom", "multipolygon", "shape", "geometry"],
        "stage": ["stage"],
    },
    "assessments": {
        "address": ["address", "full_address", "location_address"],
        "assessed_value": ["assessed_value", "assessedvalue", "value"],
        "land_use": ["land_use_designation", "landuse", "assessment_class_description"],
        "year_built": ["year_of_construction", "yr_built", "yearbuilt"],
        "roll_number": ["roll_number", "roll_num", "account_number"],
        "geometry": ["multipolygon", "the_geom", "polygon", "shape"],
    },
    "permits": {
        # Not yet verified against a live response (out of scope for the
        # current buildings-only pass) -- candidates are best-guess based
        # on typical Socrata / Open Calgary permit dataset conventions.
        "id": ["permitnum", "permit_num", "permit_number", ":id"],
        "address": ["originaladdress", "address", "permit_address"],
        "permit_type": ["permittype", "permit_type", "workclassgroup"],
        "status": ["statuscurrent", "status_current", "status"],
        "estimated_cost": ["estprojectcost", "est_project_cost", "estimatedcost"],
        "issued_date": ["issueddate", "issued_date", "applieddate"],
        "lat": ["latitude", "lat"],
        "lon": ["longitude", "lon", "long"],
    },
}

# ---------------------------------------------------------------------------
# Zoning reference data -- single source of truth shared by mock_data.py
# (generating realistic demo buildings), llm_service.py (few-shot prompt
# context + fallback keyword parser), and documented here for anyone reading
# the schema. Scene3D.jsx's colorForBuilding() on the frontend mirrors the
# COMMERCIAL/RESIDENTIAL prefix split below -- keep them in sync by hand if
# either changes.
# ---------------------------------------------------------------------------
KNOWN_ZONING_CODES = ["R-CG", "CC-MH", "CC-COR", "DC", "M-C1"]
LAND_USE_BY_ZONE = {
    "R-CG": "Residential - Grade-Oriented Infill",
    "CC-MH": "Centre City Multi-Residential High Rise",
    "CC-COR": "Centre City Commercial Corridor",
    "DC": "Direct Control",
    "M-C1": "Multi-Residential Contextual Low Profile",
}
COMMERCIAL_ZONING_PREFIXES = ("CC", "DC")
RESIDENTIAL_ZONING_PREFIXES = ("R-", "M-")

# ---------------------------------------------------------------------------
# LLM (natural-language query parsing)
# ---------------------------------------------------------------------------
# Groq offers a free-tier OpenAI-compatible chat completions API and is the
# default here because it's fast and has a generous free quota. Swap in any
# OpenAI-compatible endpoint (Hugging Face Inference, OpenAI, etc.) by
# changing LLM_BASE_URL / LLM_MODEL.
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama-3.1-8b-instant")

# Fields the LLM (and the keyword fallback) is allowed to filter buildings
# on. "unit" tells llm_service._convert_units what deterministic conversion
# to apply -- the LLM itself is only asked for the raw value + unit it saw
# in the query text, never for unit math (see llm_service.py docstring).
FILTERABLE_FIELDS = {
    "height_m": {
        "type": "number",
        "unit": "meters",
        "description": "building height above ground; source data is in meters",
    },
    "assessed_value": {
        "type": "number",
        "unit": "dollars",
        "description": "property assessed value in CAD dollars",
    },
    "zoning": {
        "type": "string",
        "unit": None,
        "description": f"land-use zoning code, one of {KNOWN_ZONING_CODES}",
    },
    "land_use": {
        "type": "string",
        "unit": None,
        "description": "free-text land-use description, e.g. " + "; ".join(LAND_USE_BY_ZONE.values()),
    },
    "year_built": {
        "type": "number",
        "unit": "year",
        "description": "year of construction",
    },
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'masiv.db'}")

# ---------------------------------------------------------------------------
# Data source mode
# ---------------------------------------------------------------------------
# "live"  -> always hit data.calgary.ca, error if unreachable
# "auto"  -> try live, fall back to bundled mock data on any failure (default)
# "mock"  -> always use bundled mock data (useful for offline dev/demo)
DATA_SOURCE_MODE = os.environ.get("DATA_SOURCE_MODE", "auto")

HTTP_TIMEOUT_SECONDS = 15
