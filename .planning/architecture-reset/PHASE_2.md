# Phase 2: Task System

## Goal

Move the canonical task surface into FastAPI and expose it to the frontend only through NestJS BFF, while leaving legacy Express task behavior intact.

## Changes

- Added FastAPI task endpoints for create, list, get, cancel, resume, steps, and artifacts.
- Added SQLAlchemy task service using the Phase 1 task-core tables.
- Added best-effort Redis task event publishing on task creation and status changes.
- Added `packages/sdk/src/task-client.ts` as the BFF FastAPI task client.
- Added NestJS BFF task proxy endpoints under `/tasks`.
- Added NestJS SSE endpoint `GET /tasks/events`, subscribed to Redis channel `trendcut.task-events`.
- Added BFF `REDIS_URL` wiring to Compose.

## Review Notes

- FastAPI remains the task owner; BFF has no direct database writes.
- Redis publishing is intentionally best-effort: task persistence must not fail if Redis is down.
- Existing Express task store remains untouched for coexistence during migration.
- The new task API currently uses generic JSON payloads; Phase 3+ should add per-task typed DTOs as AI/video domains migrate.
- The BFF SSE stream reports a structured `task.events.unavailable` event if Redis is not reachable.

## Verification

- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI SQLite smoke: create/list/get/cancel/resume/steps/artifacts passed.
- Temporary FastAPI+BFF process smoke: `POST /tasks` returned 201, `POST /tasks/:id/cancel` returned 200.
