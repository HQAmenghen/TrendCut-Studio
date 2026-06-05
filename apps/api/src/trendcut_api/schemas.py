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
    logs: list[Any]
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


class WorkerJobStatus(str, Enum):
    queued = 'queued'
    running = 'running'
    succeeded = 'succeeded'
    failed = 'failed'
    cancelled = 'cancelled'
    retrying = 'retrying'
    waiting_user = 'waiting_user'


class WorkerJobCreate(BaseModel):
    task_id: str = Field(min_length=1, max_length=64)
    job_type: str = Field(min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    queue_name: str | None = Field(default=None, max_length=80)
    max_attempts: int = Field(default=3, ge=1, le=10)
    timeout_seconds: int = Field(default=900, ge=1, le=86400)


class WorkerJobLease(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)
    queue_name: str = Field(default='video', min_length=1, max_length=80)


class WorkerJobHeartbeat(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)


class WorkerArtifactCreate(BaseModel):
    type: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1)
    mime_type: str | None = Field(default=None, max_length=160)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkerJobComplete(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)
    result: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[WorkerArtifactCreate] = Field(default_factory=list)


class WorkerJobFail(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)
    error: dict[str, Any] = Field(default_factory=dict)
    retry: bool = True


class WorkerJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    task_step_id: str | None = None
    job_type: str
    queue_name: str
    status: WorkerJobStatus
    payload: dict[str, Any]
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    attempts: int
    max_attempts: int
    timeout_seconds: int
    locked_by: str | None = None
    heartbeat_at: datetime | None = None
    run_after: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
