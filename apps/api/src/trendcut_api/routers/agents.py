from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from trendcut_api.agent_service import create_agent_run, execute_tool_call, get_agent_run, resume_agent_run
from trendcut_api.database import get_session
from trendcut_api.tool_registry import TOOL_REGISTRY

router = APIRouter(prefix='/agents', tags=['agents'])


class AgentRunCreate(BaseModel):
    task_id: str
    graph_name: str = Field(min_length=1)
    state: dict[str, Any] = Field(default_factory=dict)


class ToolCallCreate(BaseModel):
    tool_name: str
    input: dict[str, Any] = Field(default_factory=dict)
    confirmed: bool = False


def serialize_agent_run(run):
    return {
        'id': run.id,
        'task_id': run.task_id,
        'graph_name': run.graph_name,
        'state': run.state,
        'trace_id': run.trace_id,
        'status': run.status,
        'metadata': run.metadata_,
        'created_at': run.created_at,
        'updated_at': run.updated_at
    }


def serialize_tool_call(call):
    return {
        'id': call.id,
        'agent_run_id': call.agent_run_id,
        'task_step_id': call.task_step_id,
        'tool_name': call.tool_name,
        'input': call.input,
        'output': call.output,
        'status': call.status,
        'cost': float(call.cost or 0),
        'error': call.error,
        'metadata': call.metadata_,
        'created_at': call.created_at,
        'updated_at': call.updated_at,
        'finished_at': call.finished_at
    }


@router.get('/tools')
def list_tools():
    return TOOL_REGISTRY


@router.post('/runs')
def create_run(payload: AgentRunCreate, session: Session = Depends(get_session)):
    try:
        return serialize_agent_run(create_agent_run(session, payload.task_id, payload.graph_name, payload.state))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/runs/{run_id}')
def get_run(run_id: str, session: Session = Depends(get_session)):
    run = get_agent_run(session, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Agent run not found')
    return serialize_agent_run(run)


@router.post('/runs/{run_id}/resume')
def resume_run(run_id: str, session: Session = Depends(get_session)):
    run = get_agent_run(session, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Agent run not found')
    return serialize_agent_run(resume_agent_run(session, run))


@router.post('/runs/{run_id}/tool-calls')
async def create_tool_call(run_id: str, payload: ToolCallCreate, session: Session = Depends(get_session)):
    run = get_agent_run(session, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail='Agent run not found')
    call = await execute_tool_call(session, run, payload.tool_name, payload.input, payload.confirmed)
    return serialize_tool_call(call)
