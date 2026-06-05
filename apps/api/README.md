# TrendCut API

FastAPI service home.

Responsibilities:

- Task control plane.
- AI calls and provider selection.
- Agent orchestration.
- Worker dispatch.
- Tool execution API boundaries.
- Durable records for tasks, task steps, artifacts, agent runs, tool calls, and LLM calls.

Rules:

- This service owns the canonical task lifecycle.
- Browser clients must reach it through the NestJS BFF.
- Long-running work must be delegated to workers once Phase 2 starts.

Phase 1 endpoints:

- `GET /health`: FastAPI process health.
- `GET /internal/health`: database and Redis dependency health.
- `GET /openapi.json`: generated FastAPI OpenAPI document.

Local commands:

- `pip install -r apps/api/requirements.lock.txt`
- `npm run migrate:api`
- `npm run start:api`