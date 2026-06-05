# Architecture Reset Plan

This document freezes the architecture boundary for the NestJS + FastAPI reset. It is the source of truth for new work after the legacy Express runtime has been retired from this branch.

## Target Shape

```text
Vue 3 frontend
  -> NestJS BFF
  -> FastAPI AI backend
  -> PostgreSQL / Redis / pgvector
  -> Python workers / LangGraph / LlamaIndex / MCP tools
  -> FFmpeg / Playwright / ComfyUI / RunningHub / LLM providers
```

## Repository Boundaries

```text
apps/
  bff/              NestJS BFF. Frontend-facing API, auth, rate limits, SSE/WebSocket gateway.
  api/              FastAPI service. Task control plane, AI calls, agent orchestration, worker dispatch.
  worker/           Python workers. Long-running media, RPA, AI pipeline, and tool jobs.
packages/
  contracts/        OpenAPI specs, JSON Schema, and generated/shared contract inputs.
  sdk/              Clients used by NestJS to call FastAPI. Frontend must not use this directly.
```

The former `server.js` and `server/` Express tree has been removed from this branch. The default and only supported runtime entry is NestJS BFF plus FastAPI and workers; `start:legacy`, root launch scripts that call `node server.js`, and the Compose `legacy-express` service are forbidden.

## Access Rules

- The Vue frontend calls NestJS only.
- NestJS may call FastAPI through `packages/sdk`.
- FastAPI is not exposed directly to browser clients. Docker Compose keeps `api:8000` on the internal Compose network and NestJS/worker calls must include `x-trendcut-internal-token`.
- FastAPI owns task state, task steps, artifacts, agent runs, tool calls, LLM calls, and worker dispatch.
- NestJS may read task state through FastAPI APIs. It must not double-write the same task tables.
- Python capabilities run through FastAPI services or Python workers.
- Dangerous tools such as publishing, deletion, RPA login, and account mutation require a permission/audit layer.
- The current BFF requires token-backed principals by default, maps tokens to actor/roles/tenant context, applies rate limits, validates DTOs, and enforces role gates at controller entrypoints. Full enterprise SSO/session integration remains a later security hardening step.

## Legacy Ban

Not allowed:

- Restoring `server.js` or `server/`.
- Restoring `start:legacy`.
- Restoring a Compose `legacy-express` service.
- New user-facing API domains.
- New task orchestration logic.
- New Node-managed Python subprocess protocols as the primary integration style.
- New AI provider integrations.
- New publish/RPA capability surfaces.

The boundary is enforced by `npm run check:legacy-boundary`. That check fails if `server.js` or `server/` are restored, if `npm start` points back at Express, if launch scripts call `node server.js`, or if `start:legacy` / Compose `legacy-express` are reintroduced.

## Core Protocols

The reset standardizes five protocol objects:

- `Task`: durable unit of work and lifecycle state.
- `TaskStep`: ordered execution step for visibility, retry, and resume.
- `Artifact`: produced file, URL, structured output, screenshot, recording, or metadata bundle.
- `AgentRun`: resumable agent graph execution tied to one task.
- `ToolCall`: audited tool invocation attached to an agent run or task step.

The initial schema is in `packages/contracts/task-core.schema.json`.

## Phase Gates

Each phase must end with:

- Updated planning notes under `.planning/architecture-reset/`.
- Local tests relevant to the changed surface.
- A focused code review note.
- A git commit on `codex/architecture-reset`.

## Migration Phases

### Phase 0: Freeze and Boundary

Define architecture rules, create the new directory skeleton, add core protocol schema, and prevent Express route sprawl.

### Phase 1: Infrastructure

Bring up NestJS, FastAPI, PostgreSQL, and Redis with repeatable local commands, Docker Compose, health checks, and migrations.

### Phase 2: Task System

Migrate task creation, listing, status, logs, cancel, resume, Redis events, and NestJS SSE bridging.

### Phase 3: AI Capabilities

Move lightweight AI calls to FastAPI with prompt versions, model selection, fallback, tracing, token/cost records, and provider governance.

### Phase 4: Agent Layer

Introduce LangGraph-centered agents, MCP tool registry, permissions, audit logs, structured outputs, and resumable state.

### Phase 5: Video Pipeline and Workers

Split media work into worker jobs, register artifacts consistently, and remove Node stdout parsing as the primary protocol. Worker jobs call Python skills or CLI entrypoints through the Python worker runtime and record structured manifests around real execution results.

### Phase 6: Publish Center and RPA

Move publish jobs and Playwright RPA control to workers with structured errors, account state, screenshot/recording artifact slots, and audit logs. Publish/RPA worker jobs invoke Python adapters behind confirmation gates; account-state hardening and platform-specific artifact enrichment remain the next hardening layer.

### Phase 7: Express Shutdown

Switch default startup and frontend API prefixes to NestJS, remove the Express runtime tree, update CI and docs, and enforce the ban with boundary checks.
