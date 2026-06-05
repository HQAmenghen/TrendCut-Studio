# Phase 5: Video Pipeline and Worker Migration

## Goal

Move long-running video work onto a FastAPI-owned worker job protocol with structured task steps, artifacts, retries, cancellation, and resumability.

## Changes

- Added `worker_jobs` database table and Alembic migration.
- Added FastAPI worker registry for `asr_worker`, `material_score_worker`, `script_worker`, `clip_plan_worker`, `render_worker`, `review_worker`, `publish_worker`, and `rpa_worker`.
- Added FastAPI `/workers` endpoints for type discovery, enqueue, lease, heartbeat, complete, fail, cancel, and retry.
- Added task cancel/resume integration so worker jobs are cancelled or requeued with the parent task.
- Added BFF `/workers` proxy endpoints and SDK `worker-client.ts`.
- Added `apps/worker` Python runner that leases jobs from FastAPI and reports structured completion/failure.
- Added worker Dockerfile and `docker-compose.yml` service.

## Review Notes

- Database is authoritative; Redis remains best-effort wakeup/event transport.
- Node no longer needs to parse Python stdout for worker state.
- The first worker executor is an adapter that records manifests and legacy entrypoint metadata. Replacing adapter internals with real FFmpeg/ComfyUI/RunningHub calls does not require a BFF/API contract change.
- Publish/RPA job types are present for sequencing but remain high risk; Phase 6 owns account state, screenshots, and action audit hardening.
- No subagents or multi-agent runtime were introduced.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI SQLite smoke: enqueue, lease, complete, artifact registration, task cancel, and task resume passed.
- Worker runner `--once` smoke against a temporary FastAPI process: passed; worker leased and completed `render_worker`, task succeeded, artifact recorded.
- FastAPI+BFF worker proxy smoke: passed; BFF created, leased, and completed `review_worker` through NestJS.
- Cancel race smoke: passed; a cancelled leased job rejects stale worker completion with 409.
- Alembic SQLite migration to head: passed through `20260605_0003`.
- `npm run ci`: passed. Existing legacy lint warnings in `server/services/system/schedulerAutoPilot.js` remain warning-only.
