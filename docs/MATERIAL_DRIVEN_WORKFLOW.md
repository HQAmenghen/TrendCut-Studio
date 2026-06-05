# Material Driven Workflow

The material-driven workflow is now controlled by BFF and FastAPI:

```text
Vue / MCP -> BFF `/api/material-driven/*` or `/api/agent/v1/*`
  -> FastAPI Task
  -> FastAPI Worker Job
  -> `material_driven_worker`
  -> `python/pipeline/run_material_driven.py`
  -> artifacts recorded by FastAPI
```

The frontend keeps its existing `/api/material-driven/*` URLs through BFF compatibility. New behavior should be added to `apps/bff`, `apps/api`, `apps/worker`, or `python/`; do not reintroduce a Node Express orchestration layer.
