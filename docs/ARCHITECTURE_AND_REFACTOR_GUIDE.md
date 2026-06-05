# Architecture And Refactor Guide

Current target architecture:

```text
Vue 3 frontend
  -> NestJS BFF
  -> FastAPI AI/backend control plane
  -> PostgreSQL / Redis
  -> Python workers
  -> FFmpeg / Playwright / ComfyUI / RunningHub / LLMs
```

Rules:

- Browser clients call the BFF only.
- FastAPI is internal to BFF and workers.
- Long tasks run as worker jobs.
- Python capabilities are services or workers, not Node-managed child-process protocols.
- New APIs go into `apps/bff` and `apps/api`.
- New execution code goes into `apps/worker` or `python/`.
- The removed Express tree must not be reintroduced.

Refactor work should preserve these contracts:

- `Task`
- `TaskStep`
- `Artifact`
- `AgentRun`
- `ToolCall`
- `PublishJob`
