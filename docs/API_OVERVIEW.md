# API Overview

TrendCut Studio exposes browser and MCP traffic through the NestJS BFF. FastAPI is an internal backend and must not be called by browser clients directly.

## Public Entry

- Browser and frontend compatibility APIs: `apps/bff/src/api-compat.controller.ts`
- MCP/Agent compatibility APIs: `apps/bff/src/agent-compat.controller.ts`
- First-class BFF APIs: `apps/bff/src/*controller.ts`

## Internal Entry

- Task control plane: `apps/api/src/trendcut_api/task_service.py`
- Worker control plane: `apps/api/src/trendcut_api/worker_service.py`
- AI and Agent records: `apps/api/src/trendcut_api/*`
- Publish/RPA control plane: `apps/api/src/trendcut_api/publish_service.py`

## Compatibility Surface

The BFF owns legacy `/api/*` URL compatibility for the Vue frontend:

- `/api/material-driven/*`
- `/api/xai-top10/*`
- `/api/generate-vertical-standalone`
- `/api/vertical/*`
- `/api/review/*`
- `/api/publish/*`
- `/api/login-status/*`
- `/api/system/*`
- `/api/agent/v1/*`

These routes create or read FastAPI tasks, worker jobs, publish jobs, artifacts, and health records. New APIs must be added to `apps/bff` and `apps/api`, not to an Express service.
