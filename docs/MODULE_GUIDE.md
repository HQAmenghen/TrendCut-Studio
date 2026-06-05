# Module Guide

## Frontend

- `frontend/src/components/AutomationDashboard.vue`
- `frontend/src/composables/`

The frontend calls `/api/*` on the BFF only.

## BFF

- `apps/bff/src/api-compat.controller.ts`: Vue compatibility routes.
- `apps/bff/src/agent-compat.controller.ts`: MCP Agent API compatibility routes.
- `apps/bff/src/tasks.controller.ts`: task reads and writes.
- `apps/bff/src/workers.controller.ts`: worker job control.
- `apps/bff/src/publish.controller.ts`: publish control.
- `apps/bff/src/bff-request.guard.ts`: token principal and rate limiting.

## FastAPI

- `apps/api/src/trendcut_api/task_service.py`
- `apps/api/src/trendcut_api/worker_service.py`
- `apps/api/src/trendcut_api/publish_service.py`
- `apps/api/src/trendcut_api/ai_service.py`
- `apps/api/src/trendcut_api/agent_service.py`

## Workers and Python

- `apps/worker/src/trendcut_worker/executor.py`
- `python/pipeline/`
- `python/review/`
- `python/publish/`
- `python/xai/`

Worker jobs are the only supported path for long-running media, AI, and RPA execution.
