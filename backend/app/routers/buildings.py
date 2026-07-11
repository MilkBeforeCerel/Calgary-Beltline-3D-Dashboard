"""
routers/buildings.py
---------------------
Step 1 (fetch + process Calgary building data) and the data half of
Step 2 (serve it in a shape the Three.js frontend can extrude directly).
"""
from fastapi import APIRouter

from app.schemas import MapDataOut
from app.services import calgary_client

router = APIRouter(prefix="/api", tags=["buildings"])


@router.get("/buildings", response_model=MapDataOut)
def get_buildings():
    """
    Fetch and process building footprint + height data for the study area
    (3-4 city blocks in Calgary's Beltline), joined with property
    assessment data for address / zoning / assessed value.

    Falls back to deterministic mock data if the live Calgary Open Data
    API is unreachable (see DATA_SOURCE_MODE in config.py) -- the response
    always reports which source was used via `source`.
    """
    data = calgary_client.get_map_data()
    # Step 1/2 only needs buildings; permits are fetched by calgary_client
    # too but simply unused here for now.
    return MapDataOut(
        buildings=data["buildings"],
        permits=[],
        center=data["center"],
        source=data["source"],
    )
