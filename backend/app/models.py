"""
models.py
---------
SQLAlchemy ORM models for project persistence (spec step 6). Two tables:
a User identified only by a username (no password -- the spec explicitly
doesn't require real auth), and a Project owned by a User that stores the
active filter (a list of FilterCondition, as JSON) under a name.

Buildings/permits are NOT modeled here -- they're fetched fresh per
request from Calgary Open Data (or mock) and never persisted; only the
*filter a user built* is worth saving. See docs/UML.md for the full
picture, including the transient (non-persisted) DTOs.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_user_project_name"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(128), nullable=False)
    query_text = Column(String(300), nullable=True)
    # List[FilterCondition] serialized as JSON (SQLAlchemy's JSON type maps
    # to TEXT + json.dumps/loads on SQLite -- no extra dependency needed).
    filter_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="projects")
