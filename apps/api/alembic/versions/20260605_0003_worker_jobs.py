"""create worker jobs

Revision ID: 20260605_0003
Revises: 20260605_0002
Create Date: 2026-06-05 00:03:00.000000
"""

from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = '20260605_0003'
down_revision: str | None = '20260605_0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'worker_jobs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('task_step_id', sa.String(length=64), nullable=True),
        sa.Column('job_type', sa.String(length=120), nullable=False),
        sa.Column('queue_name', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('error', sa.JSON(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('max_attempts', sa.Integer(), nullable=False),
        sa.Column('timeout_seconds', sa.Integer(), nullable=False),
        sa.Column('locked_by', sa.String(length=160), nullable=True),
        sa.Column('heartbeat_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('run_after', sa.DateTime(timezone=True), nullable=True),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_step_id'], ['task_steps.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_worker_jobs_task_id', 'worker_jobs', ['task_id'])
    op.create_index('ix_worker_jobs_task_step_id', 'worker_jobs', ['task_step_id'])
    op.create_index('ix_worker_jobs_job_type', 'worker_jobs', ['job_type'])
    op.create_index('ix_worker_jobs_queue_name', 'worker_jobs', ['queue_name'])
    op.create_index('ix_worker_jobs_status', 'worker_jobs', ['status'])
    op.create_index('ix_worker_jobs_run_after', 'worker_jobs', ['run_after'])
    op.create_index('idx_worker_jobs_queue_status', 'worker_jobs', ['queue_name', 'status', 'run_after'])
    op.create_index('idx_worker_jobs_task_status', 'worker_jobs', ['task_id', 'status'])


def downgrade() -> None:
    op.drop_index('idx_worker_jobs_task_status', table_name='worker_jobs')
    op.drop_index('idx_worker_jobs_queue_status', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_run_after', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_status', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_queue_name', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_job_type', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_task_step_id', table_name='worker_jobs')
    op.drop_index('ix_worker_jobs_task_id', table_name='worker_jobs')
    op.drop_table('worker_jobs')
