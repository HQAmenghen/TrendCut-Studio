from datetime import timedelta
from uuid import uuid4
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from .events import publish_task_event
from .models import Artifact, TaskStep, WorkerJob
from .schemas import TaskStatus, WorkerArtifactCreate, WorkerJobCreate, WorkerJobStatus
from .settings import get_settings
from .task_service import get_task, set_task_status, utcnow
from .worker_registry import get_worker_type

WORKER_QUEUE_PREFIX = 'trendcut.worker'


def _enqueue_redis(job: WorkerJob) -> None:
    try:
        redis = Redis.from_url(get_settings().redis_url, socket_connect_timeout=1, socket_timeout=1)
        redis.lpush(f'{WORKER_QUEUE_PREFIX}.{job.queue_name}', job.id)
    except Exception:
        return


def _step_status_from_job(status: WorkerJobStatus) -> str:
    if status in {WorkerJobStatus.retrying, WorkerJobStatus.queued}:
        return 'queued'
    return status.value


def create_worker_job(session: Session, payload: WorkerJobCreate) -> WorkerJob:
    task = get_task(session, payload.task_id)
    if task is None:
        raise ValueError('Task not found')

    worker_type = get_worker_type(payload.job_type)
    if worker_type is None:
        raise ValueError(f'Unknown worker type: {payload.job_type}')

    now = utcnow()
    queue_name = payload.queue_name or worker_type.get('queue', 'video')
    step = TaskStep(
        id=str(uuid4()),
        task_id=task.id,
        name=payload.job_type,
        status='queued',
        logs=[{'ts': now.isoformat(), 'message': f'Queued {payload.job_type}'}],
        metadata_={'queue_name': queue_name},
        created_at=now,
        updated_at=now
    )
    job = WorkerJob(
        id=str(uuid4()),
        task_id=task.id,
        task_step_id=step.id,
        job_type=payload.job_type,
        queue_name=queue_name,
        status=WorkerJobStatus.queued.value,
        payload=payload.payload,
        attempts=0,
        max_attempts=payload.max_attempts,
        timeout_seconds=payload.timeout_seconds,
        run_after=now,
        metadata_=payload.metadata,
        created_at=now,
        updated_at=now
    )
    session.add(step)
    session.add(job)
    session.commit()
    session.refresh(job)
    set_task_status(session, task, TaskStatus.queued)
    _enqueue_redis(job)
    return job


def get_worker_job(session: Session, job_id: str) -> WorkerJob | None:
    return session.get(WorkerJob, job_id)


def lease_worker_job(session: Session, worker_id: str, queue_name: str) -> WorkerJob | None:
    now = utcnow()
    query = (
        select(WorkerJob)
        .where(WorkerJob.queue_name == queue_name)
        .where(WorkerJob.status.in_([WorkerJobStatus.queued.value, WorkerJobStatus.retrying.value]))
        .where((WorkerJob.run_after == None) | (WorkerJob.run_after <= now))  # noqa: E711
        .order_by(WorkerJob.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    job = session.scalars(query).first()
    if job is None:
        return None

    step = session.get(TaskStep, job.task_step_id) if job.task_step_id else None
    task = get_task(session, job.task_id)
    job.status = WorkerJobStatus.running.value
    job.locked_by = worker_id
    job.heartbeat_at = now
    job.started_at = job.started_at or now
    job.updated_at = now
    job.attempts += 1
    if step is not None:
        step.status = 'running'
        step.started_at = step.started_at or now
        step.updated_at = now
        step.logs = [*step.logs, {'ts': now.isoformat(), 'message': f'Leased by {worker_id}'}]
        session.add(step)
    if task is not None:
        task.status = TaskStatus.running.value
        task.started_at = task.started_at or now
        task.updated_at = now
        session.add(task)
    session.add(job)
    session.commit()
    session.refresh(job)
    if task is not None:
        publish_task_event(task)
    return job


def heartbeat_worker_job(session: Session, job: WorkerJob, worker_id: str) -> WorkerJob:
    _assert_running_worker_lock(job, worker_id)
    job.heartbeat_at = utcnow()
    job.updated_at = job.heartbeat_at
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def complete_worker_job(session: Session, job: WorkerJob, worker_id: str, result: dict, artifacts: list[WorkerArtifactCreate]) -> WorkerJob:
    _assert_running_worker_lock(job, worker_id)
    now = utcnow()
    step = session.get(TaskStep, job.task_step_id) if job.task_step_id else None
    task = get_task(session, job.task_id)

    job.status = WorkerJobStatus.succeeded.value
    job.result = result
    job.error = None
    job.finished_at = now
    job.updated_at = now
    if step is not None:
        step.status = 'succeeded'
        step.finished_at = now
        step.updated_at = now
        step.logs = [*step.logs, {'ts': now.isoformat(), 'message': f'Completed {job.job_type}'}]
        session.add(step)
    for artifact_payload in artifacts:
        session.add(Artifact(
            id=str(uuid4()),
            task_id=job.task_id,
            task_step_id=job.task_step_id,
            type=artifact_payload.type,
            path=artifact_payload.path,
            mime_type=artifact_payload.mime_type,
            metadata_=artifact_payload.metadata,
            created_at=now
        ))
    session.add(job)
    session.commit()

    if task is not None and _task_has_no_open_jobs(session, task.id):
        task.output = result if result else task.output
        set_task_status(session, task, TaskStatus.succeeded)
    session.refresh(job)
    return job


def fail_worker_job(session: Session, job: WorkerJob, worker_id: str, error: dict, retry: bool = True) -> WorkerJob:
    _assert_running_worker_lock(job, worker_id)
    now = utcnow()
    step = session.get(TaskStep, job.task_step_id) if job.task_step_id else None
    task = get_task(session, job.task_id)
    can_retry = retry and job.attempts < job.max_attempts

    job.error = error
    job.status = WorkerJobStatus.retrying.value if can_retry else WorkerJobStatus.failed.value
    job.locked_by = None if can_retry else job.locked_by
    job.run_after = now + timedelta(seconds=min(60 * job.attempts, 300)) if can_retry else job.run_after
    job.finished_at = None if can_retry else now
    job.updated_at = now
    if step is not None:
        step.status = _step_status_from_job(WorkerJobStatus.retrying if can_retry else WorkerJobStatus.failed)
        step.error = error
        step.finished_at = None if can_retry else now
        step.updated_at = now
        step.logs = [*step.logs, {'ts': now.isoformat(), 'message': f'Failed {job.job_type}', 'error': error}]
        session.add(step)
    session.add(job)
    session.commit()

    if can_retry:
        session.refresh(job)
        _enqueue_redis(job)
        if task is not None:
            set_task_status(session, task, TaskStatus.retrying)
    elif task is not None:
        task.error = error
        set_task_status(session, task, TaskStatus.failed)
    session.refresh(job)
    return job


def cancel_worker_job(session: Session, job: WorkerJob) -> WorkerJob:
    now = utcnow()
    step = session.get(TaskStep, job.task_step_id) if job.task_step_id else None
    job.status = WorkerJobStatus.cancelled.value
    job.locked_by = None
    job.finished_at = now
    job.updated_at = now
    if step is not None:
        step.status = 'cancelled'
        step.finished_at = now
        step.updated_at = now
        step.logs = [*step.logs, {'ts': now.isoformat(), 'message': f'Cancelled {job.job_type}'}]
        session.add(step)
    session.add(job)
    session.commit()
    task = get_task(session, job.task_id)
    if task is not None and _task_has_no_open_jobs(session, task.id):
        set_task_status(session, task, TaskStatus.cancelled)
    session.refresh(job)
    return job


def retry_worker_job(session: Session, job: WorkerJob) -> WorkerJob:
    now = utcnow()
    step = session.get(TaskStep, job.task_step_id) if job.task_step_id else None
    job.status = WorkerJobStatus.queued.value
    job.error = None
    job.result = None
    job.locked_by = None
    job.attempts = 0
    job.run_after = now
    job.finished_at = None
    job.updated_at = now
    if step is not None:
        step.status = 'queued'
        step.error = None
        step.finished_at = None
        step.updated_at = now
        step.logs = [*step.logs, {'ts': now.isoformat(), 'message': f'Requeued {job.job_type}'}]
        session.add(step)
    session.add(job)
    session.commit()
    session.refresh(job)
    _enqueue_redis(job)
    return job


def cancel_open_worker_jobs_for_task(session: Session, task_id: str) -> None:
    jobs = session.scalars(select(WorkerJob).where(WorkerJob.task_id == task_id).where(WorkerJob.status.in_([
        WorkerJobStatus.queued.value,
        WorkerJobStatus.running.value,
        WorkerJobStatus.retrying.value,
        WorkerJobStatus.waiting_user.value
    ]))).all()
    for job in jobs:
        cancel_worker_job(session, job)


def retry_recoverable_worker_jobs_for_task(session: Session, task_id: str) -> None:
    jobs = session.scalars(select(WorkerJob).where(WorkerJob.task_id == task_id).where(WorkerJob.status.in_([
        WorkerJobStatus.failed.value,
        WorkerJobStatus.cancelled.value,
        WorkerJobStatus.retrying.value
    ]))).all()
    for job in jobs:
        retry_worker_job(session, job)


def _task_has_no_open_jobs(session: Session, task_id: str) -> bool:
    query = select(WorkerJob.id).where(WorkerJob.task_id == task_id).where(WorkerJob.status.in_([
        WorkerJobStatus.queued.value,
        WorkerJobStatus.running.value,
        WorkerJobStatus.retrying.value,
        WorkerJobStatus.waiting_user.value
    ])).limit(1)
    return session.scalars(query).first() is None


def _assert_running_worker_lock(job: WorkerJob, worker_id: str) -> None:
    if job.locked_by != worker_id:
        raise PermissionError('Worker does not hold this job lease')
    if job.status != WorkerJobStatus.running.value:
        raise PermissionError(f'Worker job is not running: {job.status}')
