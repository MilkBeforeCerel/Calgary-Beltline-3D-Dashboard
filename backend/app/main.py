"""
main.py
-------
FastAPI application entrypoint.

Run with:
    uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import buildings, query, projects
import app.models  # noqa: F401 -- import registers User/Project on Base.metadata

app = FastAPI(
    title="MASIV 3D City Dashboard API",
    description="Fetches and serves Calgary Open Data building footprints for 3D visualization.",
    version="0.1.0",
)

Base.metadata.create_all(bind=engine)

# The Vite dev server runs on 5173 by default; allow it (and a couple of
# common alternates) to call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(buildings.router)
app.include_router(query.router)
app.include_router(projects.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
