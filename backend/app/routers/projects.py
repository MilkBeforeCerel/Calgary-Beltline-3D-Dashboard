"""
routers/projects.py
--------------------
Step 6: username-based project persistence. No real auth -- a username is
just a find-or-create identifier, no password, as the spec allows.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Project, User
from app.schemas import FilterCondition, ProjectIn, ProjectListOut, ProjectOut

router = APIRouter(prefix="/api", tags=["projects"])


def _get_or_create_user(db: Session, username: str) -> User:
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        user = User(username=username)
        db.add(user)
        db.flush()  # assigns user.id without committing yet
    return user


def _to_project_out(project: Project) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        query_text=project.query_text,
        conditions=[FilterCondition(**c) for c in project.filter_json],
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("/projects", response_model=ProjectOut)
def save_project(payload: ProjectIn, db: Session = Depends(get_db)):
    """
    Saves the currently active filter under a project name for this
    username. Re-saving under a name that already exists for this user
    updates it in place (upsert on (user_id, name)) rather than creating
    a duplicate.
    """
    user = _get_or_create_user(db, payload.username)

    project = (
        db.query(Project)
        .filter(Project.user_id == user.id, Project.name == payload.name)
        .first()
    )
    filter_json = [c.model_dump() for c in payload.conditions]

    if project is None:
        project = Project(
            user_id=user.id,
            name=payload.name,
            query_text=payload.query_text,
            filter_json=filter_json,
        )
        db.add(project)
    else:
        project.query_text = payload.query_text
        project.filter_json = filter_json

    db.commit()
    db.refresh(project)
    return _to_project_out(project)


@router.get("/projects", response_model=ProjectListOut)
def list_projects(username: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """
    Lists all saved projects for a username, most-recently-updated first.
    An unknown username is a valid, expected state (no projects saved
    yet) -- returns an empty list, not a 404.
    """
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        return ProjectListOut(projects=[])

    projects = (
        db.query(Project)
        .filter(Project.user_id == user.id)
        .order_by(Project.updated_at.desc())
        .all()
    )
    return ProjectListOut(projects=[_to_project_out(p) for p in projects])
