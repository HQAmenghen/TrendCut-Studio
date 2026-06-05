"""create llm call records

Revision ID: 20260605_0002
Revises: 20260605_0001
Create Date: 2026-06-05
"""
from alembic import op
import sqlalchemy as sa

revision = '20260605_0002'
down_revision = '20260605_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'llm_calls',
        sa.Column('id', sa.String(length=64), primary_key=True),
        sa.Column('task_id', sa.String(length=64), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
        sa.Column('capability', sa.String(length=120), nullable=False),
        sa.Column('prompt_version', sa.String(length=160), nullable=False),
        sa.Column('provider', sa.String(length=80), nullable=False),
        sa.Column('model', sa.String(length=160), nullable=False),
        sa.Column('input_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cost', sa.Numeric(12, 6), nullable=False, server_default='0'),
        sa.Column('latency_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('trace_id', sa.String(length=160), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('error', sa.JSON(), nullable=True),
        sa.Column('request', sa.JSON(), nullable=False),
        sa.Column('response', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False)
    )
    op.create_index('ix_llm_calls_task_id', 'llm_calls', ['task_id'])
    op.create_index('ix_llm_calls_capability', 'llm_calls', ['capability'])
    op.create_index('ix_llm_calls_trace_id', 'llm_calls', ['trace_id'])
    op.create_index('ix_llm_calls_status', 'llm_calls', ['status'])
    op.create_index('idx_llm_calls_task_created', 'llm_calls', ['task_id', 'created_at'])
    op.create_index('idx_llm_calls_capability_status', 'llm_calls', ['capability', 'status'])


def downgrade() -> None:
    op.drop_table('llm_calls')
