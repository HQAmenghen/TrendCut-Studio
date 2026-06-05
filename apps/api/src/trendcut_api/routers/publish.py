from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from trendcut_api.database import get_session
from trendcut_api.publish_service import (
    cancel_publish_job,
    confirm_publish_job,
    create_login_check_job,
    create_publish_job,
    dispatch_publish_job,
    get_publish_job,
    list_account_states,
    list_publish_audit,
    list_publish_jobs,
    record_publish_worker_failure,
    record_publish_worker_success
)
from trendcut_api.schemas import (
    PublishAccountLoginCheck,
    PublishAccountStateRead,
    PublishAuditRead,
    PublishJobConfirm,
    PublishJobCreate,
    PublishJobDispatch,
    PublishJobRead,
    PublishWorkerFailure,
    PublishWorkerResult
)

router = APIRouter(prefix='/publish', tags=['publish'])


@router.post('/jobs', response_model=PublishJobRead, response_model_by_alias=False)
def create_publish_job_endpoint(payload: PublishJobCreate, session: Session = Depends(get_session)):
    return create_publish_job(session, payload)


@router.get('/jobs', response_model=list[PublishJobRead], response_model_by_alias=False)
def list_publish_jobs_endpoint(
    platform: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session)
):
    return list_publish_jobs(session, platform=platform, status=status, limit=limit)


@router.get('/jobs/{publish_job_id}', response_model=PublishJobRead, response_model_by_alias=False)
def get_publish_job_endpoint(publish_job_id: str, session: Session = Depends(get_session)):
    return _require_publish_job(session, publish_job_id)


@router.post('/jobs/{publish_job_id}/confirm', response_model=PublishJobRead, response_model_by_alias=False)
def confirm_publish_job_endpoint(publish_job_id: str, payload: PublishJobConfirm, session: Session = Depends(get_session)):
    return confirm_publish_job(session, _require_publish_job(session, publish_job_id), payload.actor, payload.reason)


@router.post('/jobs/{publish_job_id}/dispatch', response_model=PublishJobRead, response_model_by_alias=False)
def dispatch_publish_job_endpoint(publish_job_id: str, payload: PublishJobDispatch, session: Session = Depends(get_session)):
    try:
        return dispatch_publish_job(session, _require_publish_job(session, publish_job_id), payload.actor, payload.mode, payload.job_type)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post('/jobs/{publish_job_id}/cancel', response_model=PublishJobRead, response_model_by_alias=False)
def cancel_publish_job_endpoint(publish_job_id: str, payload: PublishJobConfirm, session: Session = Depends(get_session)):
    return cancel_publish_job(session, _require_publish_job(session, publish_job_id), payload.actor)


@router.post('/jobs/{publish_job_id}/worker-complete', response_model=PublishJobRead, response_model_by_alias=False)
def publish_worker_complete_endpoint(publish_job_id: str, payload: PublishWorkerResult, session: Session = Depends(get_session)):
    return record_publish_worker_success(session, _require_publish_job(session, publish_job_id), payload.worker_id, payload.result)


@router.post('/jobs/{publish_job_id}/worker-fail', response_model=PublishJobRead, response_model_by_alias=False)
def publish_worker_fail_endpoint(publish_job_id: str, payload: PublishWorkerFailure, session: Session = Depends(get_session)):
    return record_publish_worker_failure(session, _require_publish_job(session, publish_job_id), payload.worker_id, payload.error)


@router.get('/jobs/{publish_job_id}/audit', response_model=list[PublishAuditRead], response_model_by_alias=False)
def list_publish_audit_endpoint(publish_job_id: str, session: Session = Depends(get_session)):
    _require_publish_job(session, publish_job_id)
    return list_publish_audit(session, publish_job_id)


@router.get('/accounts', response_model=list[PublishAccountStateRead], response_model_by_alias=False)
def list_publish_accounts_endpoint(platform: str | None = Query(default=None), session: Session = Depends(get_session)):
    return list_account_states(session, platform=platform)


@router.post('/accounts/{platform}/{account_id}/login-check', response_model=PublishJobRead, response_model_by_alias=False)
def create_account_login_check_endpoint(platform: str, account_id: str, payload: PublishAccountLoginCheck, session: Session = Depends(get_session)):
    return create_login_check_job(session, platform, account_id, payload.account_label, payload.actor)


def _require_publish_job(session: Session, publish_job_id: str):
    job = get_publish_job(session, publish_job_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Publish job not found')
    return job
