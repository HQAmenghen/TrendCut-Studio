from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base


class Task(Base):
    __tablename__ = 'tasks'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    input: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[dict | None] = mapped_column(JSON)
    metadata_: Mapped[dict] = mapped_column('metadata', JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskStep(Base):
    __tablename__ = 'task_steps'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    logs: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    error: Mapped[dict | None] = mapped_column(JSON)
    metadata_: Mapped[dict] = mapped_column('metadata', JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Artifact(Base):
    __tablename__ = 'artifacts'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True)
    task_step_id: Mapped[str | None] = mapped_column(ForeignKey('task_steps.id', ondelete='SET NULL'))
    type: Mapped[str] = mapped_column(String(80), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(160))
    metadata_: Mapped[dict] = mapped_column('metadata', JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AgentRun(Base):
    __tablename__ = 'agent_runs'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str] = mapped_column(ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True)
    graph_name: Mapped[str] = mapped_column(String(160), nullable=False)
    state: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    trace_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    metadata_: Mapped[dict] = mapped_column('metadata', JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ToolCall(Base):
    __tablename__ = 'tool_calls'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agent_run_id: Mapped[str] = mapped_column(ForeignKey('agent_runs.id', ondelete='CASCADE'), nullable=False, index=True)
    task_step_id: Mapped[str | None] = mapped_column(ForeignKey('task_steps.id', ondelete='SET NULL'))
    tool_name: Mapped[str] = mapped_column(String(160), nullable=False)
    input: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    cost: Mapped[float | None] = mapped_column(Numeric(12, 6))
    error: Mapped[dict | None] = mapped_column(JSON)
    metadata_: Mapped[dict] = mapped_column('metadata', JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


Index('idx_tasks_type_status', Task.type, Task.status)
Index('idx_task_steps_task_status', TaskStep.task_id, TaskStep.status)
Index('idx_artifacts_task_type', Artifact.task_id, Artifact.type)
Index('idx_tool_calls_tool_status', ToolCall.tool_name, ToolCall.status)


class LlmCall(Base):
    __tablename__ = 'llm_calls'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey('tasks.id', ondelete='SET NULL'), index=True)
    capability: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    prompt_version: Mapped[str] = mapped_column(String(160), nullable=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    input_tokens: Mapped[int] = mapped_column(default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(default=0, nullable=False)
    cost: Mapped[float] = mapped_column(Numeric(12, 6), default=0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(default=0, nullable=False)
    trace_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    error: Mapped[dict | None] = mapped_column(JSON)
    request: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    response: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


Index('idx_llm_calls_task_created', LlmCall.task_id, LlmCall.created_at)
Index('idx_llm_calls_capability_status', LlmCall.capability, LlmCall.status)