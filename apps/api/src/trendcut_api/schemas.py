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


class PublishJobStatus(str, Enum):
    pending_confirmation = 'pending_confirmation'
    pending = 'pending'
    queued = 'queued'
    running = 'running'
    waiting_user = 'waiting_user'
    succeeded = 'succeeded'
    failed = 'failed'
    cancelled = 'cancelled'


class PublishJobCreate(BaseModel):
    platform: str = Field(min_length=1, max_length=80)
    account_id: str = Field(min_length=1, max_length=160)
    account_label: str | None = Field(default=None, max_length=240)
    mode: str = Field(default='draft', max_length=40)
    asset: dict[str, Any] = Field(default_factory=dict)
    publish_data: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PublishJobConfirm(BaseModel):
    actor: str = Field(default='system', max_length=160)
    reason: str | None = Field(default=None, max_length=500)


class PublishJobDispatch(BaseModel):
    actor: str = Field(default='system', max_length=160)
    mode: str | None = Field(default=None, max_length=40)
    job_type: str | None = Field(default=None, max_length=120)


class PublishWorkerResult(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)
    result: dict[str, Any] = Field(default_factory=dict)


class PublishWorkerFailure(BaseModel):
    worker_id: str = Field(min_length=1, max_length=160)
    error: dict[str, Any] = Field(default_factory=dict)


class PublishAccountLoginCheck(BaseModel):
    account_label: str | None = Field(default=None, max_length=240)
    actor: str = Field(default='system', max_length=160)


class PublishJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    task_id: str
    worker_job_id: str | None = None
    platform: str
    account_id: str
    account_label: str | None = None
    mode: str
    status: PublishJobStatus
    asset: dict[str, Any]
    publish_data: dict[str, Any]
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    risk_confirmed: bool
    risk_confirmed_by: str | None = None
    risk_confirmed_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime
    updated_at: datetime
    dispatched_at: datetime | None = None
    finished_at: datetime | None = None


class PublishAuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    publish_job_id: str | None = None
    action: str
    actor: str | None = None
    status: str
    message: str | None = None
    payload: dict[str, Any]
    created_at: datetime


class PublishAccountStateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    platform: str
    account_id: str
    account_label: str | None = None
    login_status: str
    status_message: str | None = None
    last_checked_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, alias='metadata_')
    created_at: datetime
    updated_at: datetime
