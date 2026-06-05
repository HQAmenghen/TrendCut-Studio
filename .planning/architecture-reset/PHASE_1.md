# Phase 1: Infrastructure

## Goal

Bring up the new NestJS BFF, FastAPI service, PostgreSQL, Redis, and repeatable migrations without changing the legacy Express runtime path.

## Changes

- Added a minimal NestJS BFF in `apps/bff` with `GET /health` and `GET /internal/health`.
- Added a FastAPI service in `apps/api` with `GET /health`, `GET /internal/health`, and generated OpenAPI.
- Added SQLAlchemy models and an Alembic migration for `tasks`, `task_steps`, `artifacts`, `agent_runs`, and `tool_calls`.
- Added Postgres, Redis, FastAPI, and BFF services to `docker-compose.yml` while keeping the legacy Express service as `trendcut-studio`.
- Added BFF/API compile checks to local CI.
- Added FastAPI dependency range and lock files.
- Upgraded NestJS packages to `11.1.24` and direct `multer` to `2.1.1` to keep production audit clean.

## Review Notes

- The legacy Express runtime path is unchanged; new services are isolated under `apps/`.
- FastAPI owns the first durable schema for the task core tables; NestJS only proxies health in this phase.
- `GET /internal/health` returns dependency details; without local Postgres/Redis it reports FastAPI as `degraded`, while Compose should report `ok` once dependencies are healthy.
- Docker is not installed on this machine, so `docker compose up` could not be executed locally. The Compose YAML was parsed, service names were verified, and Alembic SQL generation was validated offline.
- Existing lint warnings remain in `server/services/system/schedulerAutoPilot.js`; lint exits 0.

## Verification

- `pip install -r apps/api/requirements.lock.txt`: passed.
- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- FastAPI TestClient: `/health` 200, `/openapi.json` 200, `/internal/health` 200 degraded without local DB/Redis.
- Temporary process test: BFF `/health` 200 and BFF `/internal/health` 200 with FastAPI dependency response.
- Compose YAML parse: services `api`, `bff`, `postgres`, `redis`, `trendcut-studio` present.
- Alembic offline SQL generation: 115 SQL lines generated for revision `20260605_0001`.
- `npm run ci`: passed all 9 steps.
