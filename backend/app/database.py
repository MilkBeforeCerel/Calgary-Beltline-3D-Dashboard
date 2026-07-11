"""
database.py
------------
SQLite engine/session setup for project persistence (spec step 6). Sync
engine is intentional -- write volume here is a handful of rows per user,
FastAPI already runs sync `def` routes in a threadpool, and pulling in an
async DB stack (aiosqlite, async sessions) would be pure overhead for a
prototype this size. Classic declarative_base()/Column() style is used
(not the newer Mapped[]/mapped_column() typed style) to match the plain,
unfancy type hints used throughout the rest of this backend.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import DATABASE_URL

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a request-scoped Session, always closed after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
