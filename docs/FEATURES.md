# Features

| Feature | Current owner |
| --- | --- |
| Hotspot discovery | BFF compatibility routes, FastAPI tasks, `xai_worker`, `python/xai/` |
| Material-driven video generation | BFF compatibility routes, FastAPI tasks, `material_driven_worker`, `python/pipeline/` |
| Standalone vertical video | BFF compatibility routes, `render_worker`, `python/pipeline/make_vertical_video.py` |
| AI review | BFF compatibility routes, `review_worker`, `python/review/` |
| Publish center | BFF publish/API compatibility routes, FastAPI publish jobs, `publish_worker` |
| RPA login and publish actions | FastAPI publish control plane, Python workers, Playwright tools |
| Agent / MCP | `mcp-server/` plus BFF `/api/agent/v1/*` compatibility routes |

All browser-facing and MCP-facing features enter through NestJS BFF. FastAPI owns durable control-plane state, and Python workers own execution.
