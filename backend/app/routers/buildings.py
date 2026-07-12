from fastapi import APIRouter

from app.schemas import MapDataOut
from app.services import calgary_client

router = APIRouter(prefix="/api", tags=["buildings"])


@router.get("/buildings", response_model=MapDataOut)
def get_buildings():
    """
    Building footprint + height data for the study area, joined with
    property assessment data. Falls back to mock data if the live Calgary
    Open Data API is unreachable (DATA_SOURCE_MODE in config.py) -- the
    response reports which source was used via `source`.
    """
    data = calgary_client.get_map_data()
    return MapDataOut(
        buildings=data["buildings"],
        permits=data["permits"],
        hydrants=data["hydrants"],
        transit_stops=data["transit_stops"],
        center=data["center"],
        source=data["source"],
    )
