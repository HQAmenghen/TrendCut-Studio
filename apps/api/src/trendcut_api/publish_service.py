from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import PublishAccountState, PublishAuditLog, PublishJob
from .schemas import PublishJobCreate, PublishJobStatus, TaskCreate, WorkerJobCreate
from .task_service import create_task, utcnow
from .worker_service import cancel_worker_job, create_worker_job, get_worker_job


def create_publish_job(session: Session, payload: PublishJobCreate) -> PublishJob:
    task = create_task(session, TaskCreate(
        type=f'publish.{payload.platform}',
        input={'asset': payload.asset, 'publish_data': payload.publish_data, 'mode': payload.mode},
        metadata={'source': 'publish_control'}
    ))
    now = utcnow()
    job = PublishJob(
        id=str(uuid4()),
        task_id=task.id,
        platform=payload.platform,
        account_id=payload.account_id,
        account_label=payload.account_label,
        mode=payload.mode,
        status=PublishJobStatus.pending_confirmation.value,
        asset=payload.asset,
        publish_data=payload.publish_data,
        risk_confirmed=False,
        metadata_=payload.metadata,
        created_at=now,
        updated_at=now
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.job.created', 'system', 'ok', 'Publish job created', {
        'platform': job.platform,
        'account_id': job.account_id,
        'mode': job.mode
    })
    return job


def list_publish_jobs(session: Session, platform: str | None = None, status: str | None = None, limit: int = 50) -> list[PublishJob]:
    query = select(PublishJob).order_by(PublishJob.updated_at.desc()).limit(min(max(limit, 1), 200))
    if platform:
        query = query.where(PublishJob.platform == platform)
    if status:
        query = query.where(PublishJob.status == status)
    return list(session.scalars(query).all())


def get_publish_job(session: Session, publish_job_id: str) -> PublishJob | None:
    return session.get(PublishJob, publish_job_id)


def confirm_publish_job(session: Session, job: PublishJob, actor: str, reason: str | None = None) -> PublishJob:
    now = utcnow()
    job.risk_confirmed = True
    job.risk_confirmed_by = actor
    job.risk_confirmed_at = now
    if job.status == PublishJobStatus.pending_confirmation.value:
        job.status = PublishJobStatus.pending.value
    job.updated_at = now
    session.add(job)
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.job.confirmed', actor, 'ok', reason or 'Risk action confirmed', {})
    return job


def dispatch_publish_job(session: Session, job: PublishJob, actor: str, mode: str | None = None, job_type: str | None = None) -> PublishJob:
    if not job.risk_confirmed:
        append_publish_audit(session, job.id, 'publish.job.dispatch.blocked', actor, 'blocked', 'Risk confirmation required', {})
        raise PermissionError('Risk confirmation required before dispatch')

    now = utcnow()
    dispatch_mode = mode or job.mode
    worker_type = job_type or _worker_type_for_publish_job(job)
    worker_job = create_worker_job(session, WorkerJobCreate(
        task_id=job.task_id,
        job_type=worker_type,
        payload={
            'publish_job_id': job.id,
            'platform': job.platform,
            'account_id': job.account_id,
            'account_label': job.account_label,
            'mode': dispatch_mode,
            'asset': job.asset,
            'publish_data': job.publish_data,
            'confirmed': True
        },
        metadata={'source': 'publish_control', 'actor': actor}
    ))
    job.worker_job_id = worker_job.id
    job.mode = dispatch_mode
    job.status = PublishJobStatus.queued.value
    job.dispatched_at = now
    job.updated_at = now
    session.add(job)
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.job.dispatched', actor, 'ok', 'Worker job dispatched', {
        'worker_job_id': worker_job.id,
        'worker_type': worker_type,
        'mode': dispatch_mode
    })
    return job


def cancel_publish_job(session: Session, job: PublishJob, actor: str) -> PublishJob:
    if job.worker_job_id:
        worker_job = get_worker_job(session, job.worker_job_id)
        if worker_job is not None:
            cancel_worker_job(session, worker_job)
    now = utcnow()
    job.status = PublishJobStatus.cancelled.value
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.job.cancelled', actor, 'ok', 'Publish job cancelled', {})
    return job


def record_publish_worker_success(session: Session, job: PublishJob, worker_id: str, result: dict) -> PublishJob:
    now = utcnow()
    job.status = _status_from_worker_result(result)
    job.result = result
    job.error = None
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    _upsert_account_state_from_publish_result(session, job, result)
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.worker.completed', worker_id, 'ok', 'Worker reported publish result', result)
    return job


def record_publish_worker_failure(session: Session, job: PublishJob, worker_id: str, error: dict) -> PublishJob:
    now = utcnow()
    job.status = PublishJobStatus.failed.value
    job.error = error
    job.finished_at = now
    job.updated_at = now
    session.add(job)
    _upsert_account_state(session, job.platform, job.account_id, job.account_label, 'unknown', str(error.get('message') or error), {
        'last_error': error,
        'publish_job_id': job.id
    })
    session.commit()
    session.refresh(job)
    append_publish_audit(session, job.id, 'publish.worker.failed', worker_id, 'failed', str(error.get('message') or 'Worker failed'), error)
    return job


def create_login_check_job(session: Session, platform: str, account_id: str, account_label: str | None, actor: str) -> PublishJob:
    job = create_publish_job(session, PublishJobCreate(
        platform=platform,
        account_id=account_id,
        account_label=account_label,
        mode='login_check',
        asset={},
        publish_data={},
        metadata={'source': 'account_login_check'}
    ))
    confirm_publish_job(session, job, actor, 'Login check requested')
    return dispatch_publish_job(session, job, actor, mode='login_check', job_type='rpa_worker')


def list_account_states(session: Session, platform: str | None = None) -> list[PublishAccountState]:
    query = select(PublishAccountState).order_by(PublishAccountState.updated_at.desc())
    if platform:
        query = query.where(PublishAccountState.platform == platform)
    return list(session.scalars(query).all())


def list_publish_audit(session: Session, publish_job_id: str) -> list[PublishAuditLog]:
    return list(session.scalars(
        select(PublishAuditLog)
        .where(PublishAuditLog.publish_job_id == publish_job_id)
        .order_by(PublishAuditLog.created_at.asc())
    ).all())


def append_publish_audit(session: Session, publish_job_id: str | None, action: str, actor: str | None, status: str, message: str | None, payload: dict) -> PublishAuditLog:
    audit = PublishAuditLog(
        id=str(uuid4()),
        publish_job_id=publish_job_id,
        action=action,
        actor=actor,
        status=status,
        message=message,
        payload=payload,
        created_at=utcnow()
    )
    session.add(audit)
    session.commit()
    session.refresh(audit)
    return audit


def _worker_type_for_publish_job(job: PublishJob) -> str:
    if job.platform in {'wechatChannels', 'douyin', 'xiaohongshu'}:
        return 'rpa_worker'
    return 'publish_worker'


def _status_from_worker_result(result: dict) -> str:
    structured = result.get('structured_output') if isinstance(result, dict) else {}
    status = str((structured or {}).get('publish_status') or (structured or {}).get('rpa_status') or '').strip()
    if status == 'ready_for_manual_publish':
        return PublishJobStatus.waiting_user.value
    return PublishJobStatus.succeeded.value


def _account_state_id(platform: str, account_id: str) -> str:
    return f'{platform}:{account_id}'


def _upsert_account_state_from_publish_result(session: Session, job: PublishJob, result: dict) -> None:
    structured = result.get('structured_output') if isinstance(result, dict) else {}
    login_status = 'logged_in' if job.status in {PublishJobStatus.succeeded.value, PublishJobStatus.waiting_user.value} else 'unknown'
    message = str((structured or {}).get('message') or result.get('status') or job.status)
    _upsert_account_state(session, job.platform, job.account_id, job.account_label, login_status, message, {
        'publish_job_id': job.id,
        'worker_job_id': job.worker_job_id,
        'mode': job.mode
    })


def _upsert_account_state(session: Session, platform: str, account_id: str, account_label: str | None, login_status: str, message: str | None, metadata: dict) -> PublishAccountState:
    now = utcnow()
    state_id = _account_state_id(platform, account_id)
    state = session.get(PublishAccountState, state_id)
    if state is None:
        state = PublishAccountState(
            id=state_id,
            platform=platform,
            account_id=account_id,
            account_label=account_label,
            login_status=login_status,
            status_message=message,
            last_checked_at=now,
            metadata_=metadata,
            created_at=now,
            updated_at=now
        )
    else:
        state.account_label = account_label or state.account_label
        state.login_status = login_status
        state.status_message = message
        state.last_checked_at = now
        state.metadata_ = {**(state.metadata_ or {}), **metadata}
        state.updated_at = now
    session.add(state)
    return state
