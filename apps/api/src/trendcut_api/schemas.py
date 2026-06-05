from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class TaskStatus(str, Enum):
    created = 'created'
    queued = 'queued'
    running = 'running'
    waiting_user = 'waiting_user'
    succeeded = 'succeeded'
    failed = 'failed'
    cancelled = 'cancelled'
    retrying = 'retrying'


class TaskCreate(BaseModel):
    type: str = Field(min_length=1, max_length=120)
    input: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    status: TaskStatus = TaskStatus.created


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    status: TaskStatus
    input: dict[str, Any]
    output: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class TaskStepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    name: str
    status: str
    logs: list[str]
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ArtifactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    task_step_id: str | None = None
    type: str
    path: str
    mime_type: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime


class TaskEvent(BaseModel):
    type: str = 'task.updated'
    task_id: str
    status: TaskStatus
    task: TaskRead
