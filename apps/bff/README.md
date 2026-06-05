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