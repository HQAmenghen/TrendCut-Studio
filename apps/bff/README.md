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
