# Architecture Reset Roadmap

## Operating Rules

- Do not start subagents.
- Work only in `C:\Users\PC\Desktop\comfy_panel_demo_architecture_reset`.
- Keep the stable runtime worktree untouched.
- Complete every phase with tests, code review notes, and a git commit.
- Prefer direct, scoped changes over broad rewrites.

## Phases

| Phase | Name | Exit Criteria |
| --- | --- | --- |
| 0 | Freeze and Boundary | New architecture docs, directory skeleton, core schema, legacy route guard. |
| 1 | Infrastructure | NestJS, FastAPI, Postgres, Redis, Docker Compose, health checks, migrations. |
| 2 | Task System | Canonical task model, DB persistence, Redis events, NestJS SSE bridge, coexistence with Express. |
| 3 | AI Migration | Lightweight AI calls in FastAPI, model fallback, prompt versions, trace/cost records. |
| 4 | Agent Layer | LangGraph agents, MCP registry, tool permissions, audit logs, structured output. |
| 5 | Video Pipeline Workers | Worker jobs, artifact registration, cancel/retry/resume, no stdout primary protocol. |
| 6 | Publish and RPA | Publish worker jobs, account state, screenshots/recordings, structured errors, audit log. |
| 7 | Express Shutdown | Frontend cutover, Express proxy removal, legacy route deletion/archive, CI/docs update. |
