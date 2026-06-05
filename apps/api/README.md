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
Phase 2 task endpoints:

- `POST /tasks`
- `GET /tasks`
- `GET /tasks/{task_id}`
- `POST /tasks/{task_id}/cancel`
- `POST /tasks/{task_id}/resume`
- `GET /tasks/{task_id}/steps`
- `GET /tasks/{task_id}/artifacts`

Task changes publish best-effort Redis messages to `trendcut.task-events`.
Phase 3 AI endpoints:

- `GET /ai/prompts`: list prompt registry entries and versions.
- `POST /ai/generate`: execute a governed AI capability and record an `llm_calls` row.

Supported initial capabilities: `title_generation`, `publish_copy`, `script_polish`, `material_score`, `video_review`.