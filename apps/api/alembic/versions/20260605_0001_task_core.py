"""create task core tables

Revision ID: 20260605_0001
Revises:
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa

revision = '20260605_0001'
down_revision = None
branch_labels = None
depends_on = None


def json_type():
    return sa.JSON()


def timestamps(include_finished=True):
    columns = [
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True)
    ]
    if include_finished:
        columns.append(sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True))
    return columns


def upgrade() -> None:
    op.create_table(
        'tasks',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('type', sa.String(length=120), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('input', json_type(), nullable=False),
        sa.Column('output', json_type(), nullable=True),
        sa.Column('error', json_type(), nullable=True),
        sa.Column('metadata', json_type(), nullable=False),
        *timestamps()
    )
    op.create_index('ix_tasks_status', 'tasks', ['status'])
    op.create_index('idx_tasks_type_status', 'tasks', ['type', 'status'])

    op.create_table(
        'task_steps',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('logs', json_type(), nullable=False),
        sa.Column('error', json_type(), nullable=True),
        sa.Column('metadata', json_type(), nullable=False),
        *timestamps()
    )
    op.create_index('ix_task_steps_task_id', 'task_steps', ['task_id'])
    op.create_index('ix_task_steps_status', 'task_steps', ['status'])
    op.create_index('idx_task_steps_task_status', 'task_steps', ['task_id', 'status'])

    op.create_table(
        'artifacts',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_step_id', sa.String(length=64), sa.ForeignKey('task_steps.id', ondelete='SET NULL'), nullable=True),
        sa.Column('type', sa.String(length=80), nullable=False),
        sa.Column('path', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=160), nullable=True),
        sa.Column('metadata', json_type(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False)
    )
    op.create_index('ix_artifacts_task_id', 'artifacts', ['task_id'])
    op.create_index('idx_artifacts_task_type', 'artifacts', ['task_id', 'type'])

    op.create_table(
        'agent_runs',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('graph_name', sa.String(length=160), nullable=False),
        sa.Column('state', json_type(), nullable=False),
        sa.Column('trace_id', sa.String(length=160), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('metadata', json_type(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False)
    )
    op.create_index('ix_agent_runs_task_id', 'agent_runs', ['task_id'])
    op.create_index('ix_agent_runs_trace_id', 'agent_runs', ['trace_id'])

    op.create_table(
        'tool_calls',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('agent_run_id', sa.String(length=64), sa.ForeignKey('agent_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_step_id', sa.String(length=64), sa.ForeignKey('task_steps.id', ondelete='SET NULL'), nullable=True),
        sa.Column('tool_name', sa.String(length=160), nullable=False),
        sa.Column('input', json_type(), nullable=False),
        sa.Column('output', json_type(), nullable=True),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('cost', sa.Numeric(12, 6), nullable=True),
        sa.Column('error', json_type(), nullable=True),
        sa.Column('metadata', json_type(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index('ix_tool_calls_agent_run_id', 'tool_calls', ['agent_run_id'])
    op.create_index('ix_tool_calls_status', 'tool_calls', ['status'])
    op.create_index('idx_tool_calls_tool_status', 'tool_calls', ['tool_name', 'status'])


def downgrade() -> None:
    op.drop_table('tool_calls')
    op.drop_table('agent_runs')
    op.drop_table('artifacts')
    op.drop_table('task_steps')
    op.drop_table('tasks')
