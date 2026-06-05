from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.orm import Session
from .events import publish_task_event
from .models import Artifact, Task, TaskStep
from .schemas import TaskCreate, TaskStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_task(session: Session, payload: TaskCreate) -> Task:
    now = utcnow()
    task = Task(
        id=str(uuid4()),
        type=payload.type,
        status=payload.status.value,
        input=payload.input,
        metadata_=payload.metadata,
        created_at=now,
        updated_at=now
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    publish_task_event(task)
    return task


def list_tasks(session: Session, task_type: str | None = None, status: TaskStatus | None = None, limit: int = 50) -> list[Task]:
    query = select(Task).order_by(Task.updated_at.desc()).limit(min(max(limit, 1), 200))
    if task_type:
        query = query.where(Task.type == task_type)
    if status:
        query = query.where(Task.status == status.value)
    return list(session.scalars(query).all())


def get_task(session: Session, task_id: str) -> Task | None:
    return session.get(Task, task_id)


def set_task_status(session: Session, task: Task, status: TaskStatus) -> Task:
    now = utcnow()
    task.status = status.value
    task.updated_at = now
    if status == TaskStatus.running and task.started_at is None:
        task.started_at = now
    if status in {TaskStatus.succeeded, TaskStatus.failed, TaskStatus.cancelled}:
        task.finished_at = now
    session.add(task)
    session.commit()
    session.refresh(task)
    publish_task_event(task)
    return task


def list_task_steps(session: Session, task_id: str) -> list[TaskStep]:
    query = select(TaskStep).where(TaskStep.task_id == task_id).order_by(TaskStep.created_at.asc())
    return list(session.scalars(query).all())


def list_artifacts(session: Session, task_id: str) -> list[Artifact]:
    query = select(Artifact).where(Artifact.task_id == task_id).order_by(Artifact.created_at.asc())
    return list(session.scalars(query).all())
