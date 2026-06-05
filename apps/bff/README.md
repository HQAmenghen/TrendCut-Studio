# TrendCut BFF

NestJS BFF home.

Responsibilities:

- Browser-facing API surface.
- Auth, permissions, rate limits, and request shaping.
- SSE/WebSocket gateway for task and agent events.
- DTO aggregation for Vue.
- Calls to FastAPI through `packages/sdk`.

Rules:

- Do not call Python workers directly.
- Do not write FastAPI-owned task tables directly.
- Do not expose FastAPI internals to the frontend.
- Validate inbound DTOs and derive audit actors from request context instead of trusting request bodies.

Runtime security baseline:

- API routes require a BFF token by default; set `BFF_AUTH_DISABLED=true` only for local development.
- `BFF_API_KEYS` may map tokens to `{ actor, roles, tenant_id }`; otherwise `BFF_API_TOKEN` maps to `BFF_ACTOR`, `BFF_ROLES`, and `BFF_TENANT_ID`.
- Caller-supplied `x-user-id` / `x-actor` headers are ignored unless `BFF_AUTH_DISABLED=true` and `BFF_TRUSTED_ACTOR_HEADERS=true`.
- AI, Agent, Worker, Task, and Publish controllers validate DTOs before calling FastAPI.
- Controller entrypoints enforce role gates such as `ai:write`, `agent:write`, `worker:write`, and `worker:runtime`; `admin` bypasses role-specific checks.
- `BFF_RATE_LIMIT_PER_MINUTE` defaults to `120`.
- `INTERNAL_API_TOKEN` is forwarded to FastAPI as `x-trendcut-internal-token`.
- If `frontend-dist/` exists, BFF serves it as static frontend assets.

Phase 1 endpoints:

- `GET /health`: BFF process health.
- `GET /internal/health`: BFF plus FastAPI dependency health.

Run locally with `npm run start:bff` after installing root Node dependencies.
Phase 2 task endpoints:

- `POST /tasks`: create a FastAPI-owned task.
- `GET /tasks`: list tasks through FastAPI.
- `GET /tasks/:id`: read one task.
- `POST /tasks/:id/cancel`: cancel task.
- `POST /tasks/:id/resume`: resume task.
- `GET /tasks/:id/steps`: list task steps.
- `GET /tasks/:id/artifacts`: list artifacts.
- `GET /tasks/events`: SSE stream backed by Redis channel `trendcut.task-events`.
Phase 3 AI endpoints:

- `GET /ai/prompts`: proxy FastAPI prompt registry.
- `POST /ai/generate`: proxy governed FastAPI AI generation.
Phase 4 Agent endpoints:

- `GET /agents/tools`
- `POST /agents/runs`
- `GET /agents/runs/:id`
- `POST /agents/runs/:id/resume`
- `POST /agents/runs/:id/tool-calls`
Phase 5 Worker endpoints:

- `GET /workers/types`
- `POST /workers/jobs`
- `GET /workers/jobs/:id`
- `POST /workers/jobs/lease`
- `POST /workers/jobs/:id/heartbeat`
- `POST /workers/jobs/:id/complete`
- `POST /workers/jobs/:id/fail`
- `POST /workers/jobs/:id/cancel`
- `POST /workers/jobs/:id/retry`
Phase 6 Publish endpoints:

- `POST /publish/jobs`
- `GET /publish/jobs`
- `GET /publish/jobs/:id`
- `POST /publish/jobs/:id/confirm`
- `POST /publish/jobs/:id/dispatch`
- `POST /publish/jobs/:id/cancel`
- `GET /publish/jobs/:id/audit`
- `GET /publish/accounts`
- `POST /publish/accounts/:platform/:accountId/login-check`
