"""create publish control tables

Revision ID: 20260605_0004
Revises: 20260605_0003
Create Date: 2026-06-05 00:04:00.000000
"""

from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = '20260605_0004'
down_revision: str | None = '20260605_0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'publish_jobs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('task_id', sa.String(length=64), nullable=False),
        sa.Column('worker_job_id', sa.String(length=64), nullable=True),
        sa.Column('platform', sa.String(length=80), nullable=False),
        sa.Column('account_id', sa.String(length=160), nullable=False),
        sa.Column('account_label', sa.String(length=240), nullable=True),
        sa.Column('mode', sa.String(length=40), nullable=False),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('asset', sa.JSON(), nullable=False),
        sa.Column('publish_data', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('error', sa.JSON(), nullable=True),
        sa.Column('risk_confirmed', sa.Boolean(), nullable=False),
        sa.Column('risk_confirmed_by', sa.String(length=160), nullable=True),
        sa.Column('risk_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('dispatched_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['worker_job_id'], ['worker_jobs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_publish_jobs_task_id', 'publish_jobs', ['task_id'])
    op.create_index('ix_publish_jobs_worker_job_id', 'publish_jobs', ['worker_job_id'])
    op.create_index('ix_publish_jobs_platform', 'publish_jobs', ['platform'])
    op.create_index('ix_publish_jobs_account_id', 'publish_jobs', ['account_id'])
    op.create_index('ix_publish_jobs_status', 'publish_jobs', ['status'])
    op.create_index('idx_publish_jobs_platform_status', 'publish_jobs', ['platform', 'status'])
    op.create_index('idx_publish_jobs_account_status', 'publish_jobs', ['platform', 'account_id', 'status'])

    op.create_table(
        'publish_audit_logs',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('publish_job_id', sa.String(length=64), nullable=True),
        sa.Column('action', sa.String(length=120), nullable=False),
        sa.Column('actor', sa.String(length=160), nullable=True),
        sa.Column('status', sa.String(length=40), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['publish_job_id'], ['publish_jobs.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_publish_audit_logs_publish_job_id', 'publish_audit_logs', ['publish_job_id'])
    op.create_index('ix_publish_audit_logs_action', 'publish_audit_logs', ['action'])
    op.create_index('idx_publish_audit_job_created', 'publish_audit_logs', ['publish_job_id', 'created_at'])

    op.create_table(
        'publish_account_states',
        sa.Column('id', sa.String(length=260), nullable=False),
        sa.Column('platform', sa.String(length=80), nullable=False),
        sa.Column('account_id', sa.String(length=160), nullable=False),
        sa.Column('account_label', sa.String(length=240), nullable=True),
        sa.Column('login_status', sa.String(length=40), nullable=False),
        sa.Column('status_message', sa.Text(), nullable=True),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('metadata', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_publish_account_states_platform', 'publish_account_states', ['platform'])
    op.create_index('ix_publish_account_states_account_id', 'publish_account_states', ['account_id'])
    op.create_index('ix_publish_account_states_login_status', 'publish_account_states', ['login_status'])
    op.create_index('idx_publish_account_platform_account', 'publish_account_states', ['platform', 'account_id'])


def downgrade() -> None:
    op.drop_index('idx_publish_account_platform_account', table_name='publish_account_states')
    op.drop_index('ix_publish_account_states_login_status', table_name='publish_account_states')
    op.drop_index('ix_publish_account_states_account_id', table_name='publish_account_states')
    op.drop_index('ix_publish_account_states_platform', table_name='publish_account_states')
    op.drop_table('publish_account_states')
    op.drop_index('idx_publish_audit_job_created', table_name='publish_audit_logs')
    op.drop_index('ix_publish_audit_logs_action', table_name='publish_audit_logs')
    op.drop_index('ix_publish_audit_logs_publish_job_id', table_name='publish_audit_logs')
    op.drop_table('publish_audit_logs')
    op.drop_index('idx_publish_jobs_account_status', table_name='publish_jobs')
    op.drop_index('idx_publish_jobs_platform_status', table_name='publish_jobs')
    op.drop_index('ix_publish_jobs_status', table_name='publish_jobs')
    op.drop_index('ix_publish_jobs_account_id', table_name='publish_jobs')
    op.drop_index('ix_publish_jobs_platform', table_name='publish_jobs')
    op.drop_index('ix_publish_jobs_worker_job_id', table_name='publish_jobs')
    op.drop_index('ix_publish_jobs_task_id', table_name='publish_jobs')
    op.drop_table('publish_jobs')
