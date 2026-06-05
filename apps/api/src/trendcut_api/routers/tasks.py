from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from trendcut_api.database import get_session
from trendcut_api.schemas import ArtifactRead, TaskCreate, TaskRead, TaskStatus, TaskStepRead
from trendcut_api.task_service import create_task, get_task, list_artifacts, list_task_steps, list_tasks, set_task_status

router = APIRouter(prefix='/tasks', tags=['tasks'])


@router.post('', response_model=TaskRead, response_model_by_alias=False)
def create_task_endpoint(payload: TaskCreate, session: Session = Depends(get_session)):
    return create_task(session, payload)


@router.get('', response_model=list[TaskRead], response_model_by_alias=False)
def list_tasks_endpoint(
    type: str | None = Query(default=None),
    status: TaskStatus | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session)
):
    return list_tasks(session, task_type=type, status=status, limit=limit)


@router.get('/{task_id}', response_model=TaskRead, response_model_by_alias=False)
def get_task_endpoint(task_id: str, session: Session = Depends(get_session)):
    task = get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return task


@router.post('/{task_id}/cancel', response_model=TaskRead, response_model_by_alias=False)
def cancel_task_endpoint(task_id: str, session: Session = Depends(get_session)):
    task = get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return set_task_status(session, task, TaskStatus.cancelled)


@router.post('/{task_id}/resume', response_model=TaskRead, response_model_by_alias=False)
def resume_task_endpoint(task_id: str, session: Session = Depends(get_session)):
    task = get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return set_task_status(session, task, TaskStatus.queued)


@router.get('/{task_id}/steps', response_model=list[TaskStepRead], response_model_by_alias=False)
def list_task_steps_endpoint(task_id: str, session: Session = Depends(get_session)):
    if get_task(session, task_id) is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return list_task_steps(session, task_id)


@router.get('/{task_id}/artifacts', response_model=list[ArtifactRead], response_model_by_alias=False)
def list_artifacts_endpoint(task_id: str, session: Session = Depends(get_session)):
    if get_task(session, task_id) is None:
        raise HTTPException(status_code=404, detail='Task not found')
    return list_artifacts(session, task_id)
