# Architecture

**Analysis Date:** 2026-04-17

## Pattern Overview

**Overall:** Layered Node.js orchestration monolith with an embedded Vue SPA and a delegated Python execution layer.

**Key Characteristics:**
- `server.js` is the composition root. It loads environment state, creates shared services, registers route modules, starts the scheduler, and serves static frontend assets.
- `frontend/src/App.vue` is the UI shell. Each major console area is implemented as a workspace component plus a matching composable in `frontend/src/composables/`.
- Long-running media and AI work is delegated to Python scripts under `python/`, while Node translates subprocess output into HTTP responses, SSE progress streams, persisted task state, and runtime files.

## Layers

**Browser Shell And Module Switching:**
- Purpose: Render the console shell, switch between business workspaces, and pass state/actions into each workspace.
- Location: `frontend/src/main.js`, `frontend/src/App.vue`, `frontend/src/components/TopNavigation.vue`
- Contains: App bootstrapping, top navigation, module selection, theme persistence, cross-module routing such as material-driven output into publish or standalone.
- Depends on: Vue runtime plus workspace composables such as `frontend/src/composables/useMaterialDriven.js`, `frontend/src/composables/usePublishCenter.js`, `frontend/src/composables/useStandalone.js`, and `frontend/src/composables/useXaiTop10.js`.
- Used by: The browser entry from `frontend/index.html`, built through `vite.config.mjs` and served from `frontend-dist/`.

**Workspace State And API Orchestration:**
- Purpose: Keep client-side state, talk to backend APIs, attach SSE streams, and persist recoverable UI state in `localStorage`.
- Location: `frontend/src/composables/`
- Contains: Feature-scoped composables such as `useMaterialDriven.js`, `usePublishCenter.js`, `useStandalone.js`, `useVerticalQueue.js`, `useVideoReview.js`, and `useXaiTop10.js`.
- Depends on: `fetch`, `axios`, Vue `ref`/`computed`/`watch`, and backend endpoints under `/api/...`.
- Used by: Workspace components in `frontend/src/components/*.vue`.

**HTTP Composition Root:**
- Purpose: Create the Express app, static file serving, shared dependencies, and feature service instances.
- Location: `server.js`
- Contains: `express()` setup, static mounts for `frontend-dist/`, `public/`, and `projects/`, `TaskStore` initialization, scheduler startup, recovery startup, and feature route registration.
- Depends on: `server/config/paths.js`, `server/config/runtime.js`, `server/config/utils.js`, `server/core/*`, `server/routes/*`, `server/services/*`, and `scripts/utils/env.js`.
- Used by: `npm start` via `package.json`.

**Route Registration Layer:**
- Purpose: Keep URL surfaces declarative and hand real work to handlers/services.
- Location: `server/routes/`
- Contains: Thin registrars such as `server/routes/publish.js`, `server/routes/review.js`, `server/routes/system.js`, `server/routes/standalone.js`, `server/routes/vertical.js`, and `server/routes/xai.js`.
- Depends on: Handler/service objects built in `server.js`.
- Used by: Express at runtime.

**Feature Services And Handlers:**
- Purpose: Hold business logic, persistence access, and external system coordination.
- Location: `server/services/`
- Contains: Service factories and handler builders such as `server/services/xai/service.js`, `server/services/vertical/queue.js`, `server/services/vertical/standalone.js`, `server/services/publish/store.js`, `server/services/publish/handlers.js`, `server/services/review/handlers.js`, `server/services/system/handlers.js`, and `server/services/system/scheduler.js`.
- Depends on: Shared core helpers, path/runtime config, Python runners, and filesystem/SQLite dependencies.
- Used by: `server.js` and route registrars.

**Core Infrastructure:**
- Purpose: Provide reusable primitives for Python execution, task tracking, logging, progress streaming, error envelopes, and recovery.
- Location: `server/core/`
- Contains: `server/core/python.js`, `server/core/taskStore.js`, `server/core/taskProtocol.js`, `server/core/progress.js`, `server/core/recovery.js`, `server/core/http.js`, `server/core/errorCodes.js`, and `server/core/logger.js`.
- Depends on: Node standard library plus `better-sqlite3`.
- Used by: Nearly every service and by `server.js` directly.

**Python Execution Layer:**
- Purpose: Perform media analysis, planning, rendering, review, publishing helpers, and xAI discovery.
- Location: `python/`
- Contains: Active workflow scripts in `python/pipeline/`, review code in `python/review/`, publish/RPA scripts in `python/publish/`, and ranking scripts in `python/xai/`.
- Depends on: Environment configuration loaded through `python/load_env.py` and runtime protocol helpers in `python/script_protocol.py`.
- Used by: Node subprocess helpers in `server/core/python.js` and direct `spawn` usage inside `server/routes/materialDriven.js`.

**Runtime Artifact Layer:**
- Purpose: Store durable job inputs, outputs, logs, metadata, and SQLite databases.
- Location: `projects/`, `data/`, `public/`, `python/publish/`
- Contains: Material-driven project directories under `projects/`, task databases and logs under `data/`, public-facing outputs and presets under `public/`, and publish job storage under `python/publish/publish_jobs.db`.
- Depends on: `server/config/paths.js` and feature services that read/write these directories.
- Used by: Recovery, publish asset discovery, review history, and frontend status restoration.

## Data Flow

**Material-Driven Production Flow:**

1. `frontend/src/components/AutomationDashboard.vue` invokes actions from `frontend/src/composables/useMaterialDriven.js`.
2. `useMaterialDriven.js` uploads a multipart request to `/api/material-driven/start` and then opens an `EventSource` on `/api/material-driven/progress/:jobId`.
3. `server/routes/materialDriven.js` creates a durable project directory under `projects/`, saves `source_post.json`, stages `material.mp4`, and spawns `python/pipeline/run_material_driven.py` with `--end-at 5`.
4. `python/pipeline/run_material_driven.py` runs the seven-step workflow, emitting structured stage/result events through `python/script_protocol.py`.
5. `server/routes/materialDriven.js` parses protocol lines, updates the in-memory task map, emits SSE events (`step`, `progress`, `status`, `plan_summary`, `narration_summary`), and optionally auto-generates `aiman.mp4` through `server/services/pipeline/comfy.js`.
6. The same route resumes Python from step 6 or 7, writes outputs like `script_units.json`, `edit_plan.json`, `execution_plan.json`, `avatar_segments.json`, and `output_final.mp4`, and exposes the final media via `/projects/<outputDir>/output_final.mp4`.
7. On reload, `useMaterialDriven.js` calls `/api/material-driven/status/:jobId`; `server/routes/materialDriven.js` rebuilds the snapshot from disk so the UI can reconnect or continue.

**Discovery To Vertical Queue To Publish Flow:**

1. `frontend/src/composables/useXaiTop10.js` uses `/api/progress?clientId=...` plus `/api/xai-top10/run` to trigger `server/services/xai/service.js`.
2. `createXaiService` runs `python/xai/run_xai_top10.py`, translates the result if needed with `python/xai/translate_result_summaries.py`, and exposes the latest result and status through `server/routes/xai.js`.
3. Selected xAI items are posted to `/api/xai-top10/vertical-jobs`; `server/services/vertical/queue.js` enqueues jobs, downloads source media, runs `python/pipeline/run_asr.py` and `python/pipeline/make_vertical_video.py`, and writes outputs into `data/uploads/xai_vertical_queue/` and `public/xai_vertical_queue/`.
4. `server/services/publish/assets.js` scans outputs from `projects/`, `public/`, and vertical queue directories so `frontend/src/composables/usePublishCenter.js` can create publish jobs against concrete generated assets.
5. Publish jobs are validated and persisted by `server/services/publish/store.js`, and platform execution is coordinated by `server/services/publish/handlers.js` plus `server/services/publish/wechatRpa.js`.

**Single-Video Vertical Flow:**

1. `frontend/src/composables/useStandalone.js` creates a generic SSE client on `/api/progress?clientId=...`.
2. It posts form data to `/api/generate-vertical-standalone`.
3. `server/services/vertical/standalone.js` creates a runtime work directory, optionally runs `python/pipeline/run_asr.py` or `python/pipeline/convert_srt_to_json.py`, then renders with `python/pipeline/make_vertical_video.py`.
4. The final file is copied to `public/standalone_output_vertical.mp4`, metadata is written beside it, and the frontend refreshes queue/status views.

**State Management:**
- Frontend state is feature-local and ref-based inside `frontend/src/composables/`; long-running workflow recovery uses `localStorage` in `useMaterialDriven.js` and `useStandalone.js`.
- Server ephemeral state uses in-memory `Map` instances in `server/core/progress.js`, `server/routes/materialDriven.js`, and `server/services/vertical/queue.js`.
- Server durable state uses SQLite in `data/tasks.db` through `server/core/taskStore.js`, SQLite in `data/ai_review.db` through `server/services/review/store.js`, and SQLite in `python/publish/publish_jobs.db` through `server/services/publish/store.js` and `publishStore.migrations.js`.
- Large media artifacts and workflow checkpoints live on disk in `projects/`, `data/uploads/`, `public/`, and `python/publish/`.

## Key Abstractions

**Workspace + Composable Pair:**
- Purpose: Keep rendering in `.vue` files and feature state/effects in a single matching composable.
- Examples: `frontend/src/components/AutomationDashboard.vue` composed with `frontend/src/composables/useMaterialDriven.js`, `frontend/src/composables/usePublishCenter.js`, `frontend/src/composables/useStandalone.js`, and `frontend/src/composables/useXaiTop10.js`.
- Pattern: Presentation/state split by feature, not by generic shared store.

**Route Registrar:**
- Purpose: Expose HTTP endpoints without embedding composition logic.
- Examples: `server/routes/publish.js`, `server/routes/review.js`, `server/routes/system.js`, `server/routes/xai.js`.
- Pattern: Functions named `register<Feature>Routes(app, handlers)` or `register<Feature>Route(app, handler)`.

**Service Factory With Explicit Dependency Injection:**
- Purpose: Construct business services from filesystem, config, helper, and persistence dependencies passed from `server.js`.
- Examples: `createXaiService` in `server/services/xai/service.js`, `createVerticalQueueService` in `server/services/vertical/queue.js`, `createPublishStore` in `server/services/publish/store.js`, `createSystemHandlers` in `server/services/system/handlers.js`.
- Pattern: Plain-object dependency injection instead of container frameworks.

**Python Protocol Bridge:**
- Purpose: Turn subprocess output into structured progress, result, and error events.
- Examples: `server/core/python.js`, `server/core/taskProtocol.js`, `python/script_protocol.py`, and the custom parsing in `server/routes/materialDriven.js`.
- Pattern: JSON lines prefixed with `__CODEX_PYTHON__`, optionally paired with `task.json` / `result.json` / `failure.json` workdir contracts.

**Project Directory As Job Boundary:**
- Purpose: Make each material-driven run resumable, inspectable, and publishable from disk.
- Examples: `projects/material_<jobId>/material.mp4`, `projects/material_<jobId>/source_post.json`, `projects/material_<jobId>/execution_plan.json`, `projects/material_<jobId>/output_final.mp4`.
- Pattern: Filesystem-first persistence instead of database-backed workflow state.

## Entry Points

**Browser App:**
- Location: `frontend/index.html`, `frontend/src/main.js`
- Triggers: Vite dev server from `vite.config.mjs` or static serving of `frontend-dist/index.html` from `server.js`
- Responsibilities: Mount the SPA and hand control to `frontend/src/App.vue`

**Node Runtime:**
- Location: `server.js`
- Triggers: `npm start` from `package.json`
- Responsibilities: Load env, boot Express, mount static assets, create services, register routes, start scheduler and recovery, and listen on port `3001` by default

**Material-Driven Workflow:**
- Location: `server/routes/materialDriven.js`, `python/pipeline/run_material_driven.py`
- Triggers: `/api/material-driven/start`, `/continue/:jobId`, `/retry/:jobId`, `/rebuild/:jobId`, `/rerender/:jobId`
- Responsibilities: Create project directories, run or resume the multi-step workflow, stream progress, and recover tasks from disk

**Background Scheduler:**
- Location: `server/services/system/scheduler.js`
- Triggers: Created in `server.js` at startup
- Responsibilities: Cron-based autopilot fetching, scheduled publish execution, cleanup, login monitoring, and follow-on automation

## Error Handling

**Strategy:** Request handlers catch locally, normalize API failures into a shared JSON envelope, and preserve long-running task failures in memory plus on-disk artifacts.

**Patterns:**
- `server/core/http.js` provides `sendError(...)`, which standardizes `{ success, error, code, stage, details, hint }` responses.
- `server/core/errorCodes.js` centralizes stage-aware error codes for route and service code that uses `createError(...)`.
- `server/core/python.js` and `python/script_protocol.py` preserve Python-side `stage`, `code`, `details`, and `hint` information when subprocesses fail.
- Recovery logic in `server/core/recovery.js` inspects stale tasks from `server/core/taskStore.js` and marks them `interrupted`, `pending`, or `failed` instead of silently dropping state.

## Cross-Cutting Concerns

**Logging:** `server/core/logger.js` rewrites `console.*` into `data/logs/server.log`, while feature-specific appenders write additional logs such as `data/logs/scheduler.log` in `server/services/system/scheduler.js` and `data/logs/vertical_queue.log` in `server/services/vertical/queue.js`.

**Validation:** Input validation is mostly explicit and local to handlers and services, for example multipart checks in `server/routes/materialDriven.js`, publish config/job validation in `server/services/publish/handlers.js` and `server/services/publish/publishStore.config.js`, and self-checks in `server/services/system/selfCheck.js`.

**Authentication:** There is no application-level auth wall around the console routes. Identity is handled per integration: publish platform credentials are stored through `server/services/publish/publishStore.config.js`, WeChat login state is checked through `server/services/publish/wechatRpa.js` and `server/services/notification/loginStatus.js`, and external AI/API credentials are loaded from the project `.env` via `scripts/utils/env.js` and `python/load_env.py`.

---

*Architecture analysis: 2026-04-17*
