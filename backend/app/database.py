"""
database.py
------------
SQLite engine/session setup for project persistence. Sync engine is
intentional -- write volume is a handful of rows per user, and FastAPI
already runs sync `def` routes in a threadpool, so an async DB stack
would be pure overhead for a prototype this size.
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
