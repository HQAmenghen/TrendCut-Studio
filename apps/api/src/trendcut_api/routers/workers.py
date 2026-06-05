from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from trendcut_api.database import get_session
from trendcut_api.schemas import (
    WorkerJobComplete,
    WorkerJobCreate,
    WorkerJobFail,
    WorkerJobHeartbeat,
    WorkerJobLease,
    WorkerJobRead
)
from trendcut_api.worker_registry import WORKER_TYPES
from trendcut_api.worker_service import (
    cancel_worker_job,
    complete_worker_job,
    create_worker_job,
    fail_worker_job,
    get_worker_job,
    heartbeat_worker_job,
    lease_worker_job,
    retry_worker_job
)

router = APIRouter(prefix='/workers', tags=['workers'])


@router.get('/types')
def list_worker_types_endpoint():
    return [{'type': key, **value} for key, value in WORKER_TYPES.items()]


@router.post('/jobs', response_model=WorkerJobRead, response_model_by_alias=False)
def create_worker_job_endpoint(payload: WorkerJobCreate, session: Session = Depends(get_session)):
    try:
        return create_worker_job(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/jobs/{job_id}', response_model=WorkerJobRead, response_model_by_alias=False)
def get_worker_job_endpoint(job_id: str, session: Session = Depends(get_session)):
    job = get_worker_job(session, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Worker job not found')
    return job


@router.post('/jobs/lease', response_model=WorkerJobRead | None, response_model_by_alias=False)
def lease_worker_job_endpoint(payload: WorkerJobLease, session: Session = Depends(get_session)):
    return lease_worker_job(session, payload.worker_id, payload.queue_name)


@router.post('/jobs/{job_id}/heartbeat', response_model=WorkerJobRead, response_model_by_alias=False)
def heartbeat_worker_job_endpoint(job_id: str, payload: WorkerJobHeartbeat, session: Session = Depends(get_session)):
    job = _require_job(session, job_id)
    try:
        return heartbeat_worker_job(session, job, payload.worker_id)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post('/jobs/{job_id}/complete', response_model=WorkerJobRead, response_model_by_alias=False)
def complete_worker_job_endpoint(job_id: str, payload: WorkerJobComplete, session: Session = Depends(get_session)):
    job = _require_job(session, job_id)
    try:
        return complete_worker_job(session, job, payload.worker_id, payload.result, payload.artifacts)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post('/jobs/{job_id}/fail', response_model=WorkerJobRead, response_model_by_alias=False)
def fail_worker_job_endpoint(job_id: str, payload: WorkerJobFail, session: Session = Depends(get_session)):
    job = _require_job(session, job_id)
    try:
        return fail_worker_job(session, job, payload.worker_id, payload.error, payload.retry)
    except PermissionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post('/jobs/{job_id}/cancel', response_model=WorkerJobRead, response_model_by_alias=False)
def cancel_worker_job_endpoint(job_id: str, session: Session = Depends(get_session)):
    return cancel_worker_job(session, _require_job(session, job_id))


@router.post('/jobs/{job_id}/retry', response_model=WorkerJobRead, response_model_by_alias=False)
def retry_worker_job_endpoint(job_id: str, session: Session = Depends(get_session)):
    return retry_worker_job(session, _require_job(session, job_id))


def _require_job(session: Session, job_id: str):
    job = get_worker_job(session, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail='Worker job not found')
    return job
