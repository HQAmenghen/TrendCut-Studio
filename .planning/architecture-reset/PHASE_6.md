# Phase 6: Publish Center and RPA Migration

## Goal

Move publish/RPA control into FastAPI and workers while keeping NestJS as the browser-facing API. High-risk actions must require confirmation and produce audit records.

## Changes

- Added `publish_jobs`, `publish_audit_logs`, and `publish_account_states` tables.
- Added FastAPI `/publish` endpoints for job create/list/read/confirm/dispatch/cancel, worker callbacks, audit logs, account state, and login checks.
- Added publish job dispatch to `rpa_worker` for WeChat/Douyin/Xiaohongshu and `publish_worker` for API-backed platforms.
- Added worker runner callbacks so completed/failed publish/RPA jobs update publish job status and account state.
- Added BFF `/publish` proxy endpoints and SDK `publish-client.ts`.
- Kept legacy Express publish routes as legacy; no new functionality was added there.

## Review Notes

- Dispatch is blocked until risk confirmation is recorded.
- Publish/RPA actions are audited at create, blocked dispatch, confirmation, dispatch, completion, failure, and cancellation.
- Account state is queryable through NestJS via `/publish/accounts`.
- The worker executor still runs in adapter mode for this phase; real Playwright scripts can replace adapter internals without changing FastAPI/BFF contracts.
- Screenshots and recordings are represented as worker artifacts/results today; real browser captures should be emitted by the concrete RPA executor when wired.
- No subagents or autonomous external publish actions were introduced.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI SQLite smoke: unconfirmed dispatch blocked, confirmed dispatch queued RPA worker, worker callback updated publish job, account state, and audit logs.
- Worker runner smoke: temporary FastAPI plus `trendcut_worker.runner --once --queue rpa` completed a WeChat publish job and updated publish/account/audit state.
- FastAPI+BFF publish smoke: BFF created, confirmed, dispatched, and read audit for a publish job.
- Alembic SQLite migration to head: passed through `20260605_0004`.
- `npm run ci`: passed. Existing legacy lint warnings in `server/services/system/schedulerAutoPilot.js` remain warning-only.
