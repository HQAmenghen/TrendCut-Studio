from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy.orm import Session
from .llm_service import generate_ai
from .models import AgentRun, ToolCall
from .task_service import get_task
from .tool_registry import get_tool


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_agent_run(session: Session, task_id: str, graph_name: str, state: dict) -> AgentRun:
    if get_task(session, task_id) is None:
        raise LookupError('Task not found')
    now = utcnow()
    run = AgentRun(
        id=str(uuid4()),
        task_id=task_id,
        graph_name=graph_name,
        state=state,
        trace_id=str(uuid4()),
        status='created',
        metadata_={},
        created_at=now,
        updated_at=now
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def get_agent_run(session: Session, run_id: str) -> AgentRun | None:
    return session.get(AgentRun, run_id)


def resume_agent_run(session: Session, run: AgentRun) -> AgentRun:
    run.status = 'running'
    run.updated_at = utcnow()
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


async def execute_tool_call(session: Session, run: AgentRun, tool_name: str, input_payload: dict, confirmed: bool = False) -> ToolCall:
    tool = get_tool(tool_name)
    now = utcnow()
    if tool is None:
        call = ToolCall(
            id=str(uuid4()), agent_run_id=run.id, task_step_id=None, tool_name=tool_name,
            input=input_payload, output=None, status='failed', cost=0,
            error={'message': 'Unknown tool'}, metadata_={}, created_at=now, updated_at=now, finished_at=now
        )
        session.add(call); session.commit(); session.refresh(call); return call

    if tool.get('requires_confirmation') and not confirmed:
        call = ToolCall(
            id=str(uuid4()), agent_run_id=run.id, task_step_id=None, tool_name=tool_name,
            input=input_payload, output=None, status='blocked', cost=0,
            error={'message': 'Tool requires confirmation', 'risk': tool.get('risk')},
            metadata_={'permission': tool}, created_at=now, updated_at=now, finished_at=now
        )
        session.add(call); session.commit(); session.refresh(call); return call

    output = None
    status = 'succeeded'
    error = None
    try:
        if tool_name == 'ai.generate':
            output = await generate_ai(
                session=session,
                capability=str(input_payload.get('capability')),
                payload=dict(input_payload.get('input') or {}),
                task_id=run.task_id,
                preferred_models=input_payload.get('preferred_models')
            )
        elif tool_name == 'task.read':
            task = get_task(session, run.task_id)
            output = {'task_id': task.id, 'type': task.type, 'status': task.status} if task else None
        else:
            output = {'accepted': True, 'message': 'Tool execution is deferred to a later worker phase.'}
    except Exception as exc:
        status = 'failed'
        error = {'message': str(exc)}

    call = ToolCall(
        id=str(uuid4()), agent_run_id=run.id, task_step_id=None, tool_name=tool_name,
        input=input_payload, output=output, status=status, cost=0, error=error,
        metadata_={'permission': tool}, created_at=now, updated_at=utcnow(), finished_at=utcnow()
    )
    session.add(call)
    session.commit()
    session.refresh(call)
    return call
