"""
config.py
---------
Central place for every "knob" the app needs. Nothing dataset- or
credential-specific should be hard-coded anywhere else in the backend.

Socrata (data.calgary.ca) column names occasionally drift when the City
republishes a dataset, so `services/calgary_client.py` tries a short list
of CANDIDATE field names per logical attribute (FIELD_CANDIDATES below)
instead of a single hard-coded name.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Roughly 17 Ave SW / 1 St SW, Beltline -- (min_lon, min_lat, max_lon, max_lat).
STUDY_AREA_BBOX = (-114.0745, 51.0370, -114.0670, 51.0420)
STUDY_AREA_CENTER = (
    (STUDY_AREA_BBOX[0] + STUDY_AREA_BBOX[2]) / 2,
    (STUDY_AREA_BBOX[1] + STUDY_AREA_BBOX[3]) / 2,
)

SOCRATA_BASE_URL = "https://data.calgary.ca/resource"

DATASET_BUILDINGS_3D = "cchr-krqg"          # 3D Buildings - Citywide (footprint + height)
DATASET_PROPERTY_ASSESSMENTS = "4bsw-nn7w"  # Property Assessments (address, value, land use)
DATASET_BUILDING_PERMITS = "c2es-76ed"      # Building Permits

# Overridable via env vars in case a dataset id/shape changes.
DATASET_FIRE_HYDRANTS = os.environ.get("DATASET_FIRE_HYDRANTS", "5qgc-b482")
DATASET_TRANSIT_STOPS = os.environ.get("DATASET_TRANSIT_STOPS", "muzh-c9qc")

SOCRATA_APP_TOKEN = os.environ.get("SOCRATA_APP_TOKEN", "")  # optional, avoids throttling

# Candidate column names per logical field, first match wins.
FIELD_CANDIDATES = {
    "buildings": {
        # Geometry is "Polygon" (coordinates[0] is the ring), not "MultiPolygon".
        # No direct height column -- height = rooftop_elev_z - grd_elev_min_z,
        # and each row is one roof facet grouped by struct_id (see
        # calgary_client._aggregate_building_facets).
        "id": ["struct_id", "structid", "bldg_id", "objectid", ":id"],
        "rooftop_elev_z": ["rooftop_elev_z", "rooftop_elev"],
        "grd_elev_min_z": ["grd_elev_min_z", "grd_elev_z", "ground_elev"],
        "geometry": ["polygon", "the_geom", "multipolygon", "shape", "geometry"],
        "stage": ["stage"],
    },
    "assessments": {
        # No lat/lon columns -- join is done via the `multipolygon` parcel geometry.
        "address": ["address", "full_address", "location_address"],
        "assessed_value": ["assessed_value", "assessedvalue", "value"],
        "land_use": ["land_use_designation", "landuse", "assessment_class_description"],
        "year_built": ["year_of_construction", "yr_built", "yearbuilt"],
        "roll_number": ["roll_number", "roll_num", "account_number"],
        "geometry": ["multipolygon", "the_geom", "polygon", "shape"],
    },
    "permits": {
        "id": ["permitnum", "permit_num", "permit_number", ":id"],
        "address": ["originaladdress", "address", "permit_address"],
        "permit_type": ["permittype", "permit_type", "workclassgroup"],
        "status": ["statuscurrent", "status_current", "status"],
        "estimated_cost": ["estprojectcost", "est_project_cost", "estimatedcost"],
        "issued_date": ["issueddate", "issued_date", "applieddate"],
        "lat": ["latitude", "lat"],
        "lon": ["longitude", "lon", "long"],
    },
    "hydrants": {
        # Only a "point" geometry, no lat/lon columns -- see
        # _extract_point_lonlat in calgary_client.py.
        "id": ["globalid", "id", "asset_id"],
        "status": ["status_ind", "status"],
        "hydrant_type": ["owner_cd", "hydrant_type", "type"],
        "lat": [],
        "lon": [],
        "geometry": ["point"],
    },
    "transit": {
        # Only a "point" geometry; no route/mode column, so route_type/routes
        # stay empty for live rows (mock data fills them in for the demo).
        "id": ["teleride_number", "stop_id", "id"],
        "stop_name": ["stop_name", "name"],
        "route_type": ["route_type", "mode"],
        "routes": ["routes", "route_short_names"],
        "lat": [],
        "lon": [],
        "geometry": ["point"],
    },
}

# Single source of truth for zoning, shared by mock_data.py and
# llm_service.py. Scene3D.jsx's colorForBuilding() mirrors the
# COMMERCIAL/RESIDENTIAL prefix split -- keep them in sync by hand.
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

# Groq offers a free-tier OpenAI-compatible chat completions API. Swap in
# any OpenAI-compatible endpoint by changing LLM_BASE_URL / LLM_MODEL.
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.groq.com/openai/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama-3.1-8b-instant")

# Fields the LLM (and the keyword fallback) may filter buildings on. "unit"
# tells llm_service._convert_units what deterministic conversion to apply --
# the LLM is only asked for the raw value + unit, never for unit math.
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

# `.env`/`.env.example` ship with a present-but-empty DATABASE_URL= line, and
# os.environ.get's default only kicks in when the key is absent (not empty),
# so `or` is needed for the "unset -> sqlite default" fallback.
DATABASE_URL = os.environ.get("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'masiv.db'}"

# "live" -> always hit data.calgary.ca, error if unreachable
# "auto" -> try live, fall back to bundled mock data on any failure (default)
# "mock" -> always use bundled mock data (offline dev/demo)
DATA_SOURCE_MODE = os.environ.get("DATA_SOURCE_MODE", "auto")

HTTP_TIMEOUT_SECONDS = 15
