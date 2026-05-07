<!-- GSD:project-start source:PROJECT.md -->
## Project

**Comfy Panel Demo**

Comfy Panel Demo is a local AI video operations console for turning source material into reviewable and publishable short-form videos. It combines material-driven generation, AI review, publishing automation, account monitoring, and system operations in one Node.js + Vue + Python workspace used by operators on a trusted machine.

This initialization is for brownfield stabilization work. The product already exists; the current goal is to harden the existing workflows so operators can run them safely, recover from failures predictably, and maintain the codebase without introducing brittle regressions.

**Core Value:** Operators can reliably take source material through generation, review, and publishing from one console without unsafe failure modes or fragile manual recovery.

### Constraints

- **Architecture**: Keep the existing `Node.js + Vue + Python` local-control-panel architecture — the product already depends on that split
- **Workflow anchor**: Keep the material-driven workflow as the primary production path — it is the current core operator flow
- **Compatibility**: Preserve existing operator-facing capabilities while hardening internals — stabilization must not break the shipped flow set
- **External dependencies**: ComfyUI, LLM providers, FFmpeg, and WeChat RPA remain external runtime dependencies — the system must tolerate their absence or failure cleanly
- **Operational scope**: Prioritize safety, predictability, and maintainability over new features — this cycle is explicitly stabilization work
- **Version control**: Planning documents should be tracked in git, while mutable runtime outputs should move away from source-tracked defaults — the repo needs cleaner boundaries
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- JavaScript (ES2021 syntax) - Express backend in `server.js` and `server/**/*.js`, plus the Vue app entry/composables in `frontend/src/main.js`, `frontend/src/App.vue`, and `frontend/src/composables/*.js`.
- Python 3.x - worker scripts under `python/**/*.py`; `README.md` requires Python 3.10+, while `Dockerfile` installs distro `python3`.
- HTML/CSS - frontend shell and styling in `frontend/index.html` and `frontend/src/styles.css`.
## Runtime
- Node.js 18+ for development per `README.md`; the container standardizes on Node 20 Bookworm in `Dockerfile`; CI exercises Node 18.x, 20.x, and 22.x in `.github/workflows/ci.yml`.
- Python 3 via the system interpreter installed in `Dockerfile`; Node launches workers through `server/core/python.js` and `server/services/review/executor.js`.
- FFmpeg is a runtime dependency for media assembly; it is installed in `Dockerfile` and referenced by self-checks in `server/services/system/selfCheck.js`.
- npm - root JavaScript package manager defined by `package.json`.
- pip - Python dependencies resolved from `requirements.txt` -> `python/pipeline/requirements.txt`.
- Lockfile: JavaScript lockfile present in `package-lock.json` (`lockfileVersion: 3`); no Python lockfile detected.
## Frameworks
- Express 4.19.2 - HTTP server, static asset hosting, and route composition in `server.js`.
- Vue 3.5.30 - single-page UI mounted from `frontend/src/main.js` with components under `frontend/src/components/`.
- Vite 8.0.2 - frontend dev server and build pipeline in `vite.config.mjs`.
- Playwright (Python package) - browser automation for WeChat Channels flows in `python/publish/wechat_channels_rpa.py` and `python/publish/wechat_check_login.py`.
- Jest 30.3.0 - Node test runner configured inline in `package.json`, with suites under `server/**/__tests__/*.test.js`.
- Sinon 21.0.3 - spy/stub support installed in `package.json` for the Jest-based test suite.
- `@vitejs/plugin-vue` 6.0.5 - Vue SFC support enabled in `vite.config.mjs`.
- `@tailwindcss/vite` 4.2.2 and `tailwindcss` 4.2.2 - build-time styling dependencies listed in `package.json`; no standalone `tailwind.config.*` file is detected.
- ESLint 8.57.1 - linting rules in `.eslintrc.js`, invoked by `npm run lint`.
- Docker / Docker Compose - container packaging in `Dockerfile` and local orchestration in `docker-compose.yml`.
## Key Dependencies
- `axios` 1.6.8 - outbound HTTP client for ComfyUI, Feishu, and frontend API calls in `server/services/pipeline/comfy.js`, `server/services/notification/feishu.js`, and `frontend/src/composables/useXaiTop10.js`.
- `better-sqlite3` 12.8.0 - local persistence for tasks, review history, and publish jobs in `server/core/taskStore.js`, `server/services/review/store.js`, and `server/services/publish/publishStore.migrations.js`.
- `ws` 8.19.0 - ComfyUI progress WebSocket client in `server/services/pipeline/comfy.js`.
- `node-cron` 4.2.1 - recurring scheduling for autopilot, archival, login checks, and cleanup in `server/services/system/scheduler.js`.
- `google-genai` - Gemini client implementation in `python/gemini_client.py`, routed through `python/llm_client.py`.
- `dashscope` - Qwen multimodal/text/embedding/rerank client in `python/qwen_client.py`.
- `openai` - transport client for xAI Grok requests in `python/xai/run_xai_top10.py`.
- `faster-whisper`, `moviepy`, `Pillow`, `httpx`, and `requests` - Python media and API tooling declared in `python/pipeline/requirements.txt` and used across `python/pipeline/*.py`, `python/review/ai_video_review.py`, and `python/xai/run_xai_top10.py`.
- `multer` 1.4.5-lts.1 - multipart upload handling in `server.js`.
- `form-data` 4.0.0 - file upload payloads for ComfyUI and Feishu in `server/services/pipeline/comfy.js` and `server/services/notification/feishu.js`.
- `requests-oauthlib` - OAuth1 signing for X API fallbacks in `python/xai/run_xai_top10.py`.
- `sqlite` / `sqlite3` - installed in `package.json`, but the runtime storage code currently uses `better-sqlite3` instead of these packages.
## Configuration
- Node loads project-root `.env` through `scripts/utils/env.js`, which is invoked from `server.js`.
- Python workers load the same `.env` through `python/load_env.py`, used by `python/review/ai_video_review.py`, `python/xai/run_xai_top10.py`, and other scripts.
- System settings endpoints in `server/services/system/handlers.js` read and rewrite `.env` values for Feishu, login checks, and LLM provider settings.
- `.env`, `.env.example`, and `.env.smart_clip` exist at project root; secret contents were not inspected.
- Core startup configuration centers on `COMFYUI_BASE_URL`, one LLM credential set (`GEMINI_API_KEY` / `GOOGLE_API_KEY` or `QWEN_API_KEY` / `DASHSCOPE_API_KEY`), and `XAI_API_KEY`, with additional feature flags in `server/services/notification/loginStatus.js`, `server/services/system/scheduler.js`, and `python/qwen_client.py`.
- Frontend build and dev proxy configuration live in `vite.config.mjs`.
- Runtime path conventions live in `server/config/paths.js`.
- Runtime defaults and editable JSON allowlist live in `server/config/runtime.js`.
- Linting configuration lives in `.eslintrc.js`.
- Container packaging lives in `Dockerfile` and `docker-compose.yml`.
- CI automation lives in `.github/workflows/ci.yml`.
## Platform Requirements
- Node.js 18+ and npm per `README.md`.
- Python 3.10+ and `pip` per `README.md`; the Node server expects `python` to be available on `PATH` in `server/core/python.js`.
- FFmpeg available on `PATH`, as required by media scripts and the self-check service in `server/services/system/selfCheck.js`.
- Playwright browser binaries installed for `python/publish/wechat_channels_rpa.py`.
- A reachable ComfyUI instance, configured by `server/config/runtime.js` and optionally overridden in `docker-compose.yml`.
- The deployable app is a single Node service from `server.js` that serves `frontend-dist/` and spawns local Python workers from the same filesystem.
- The included container target is the `comfy-panel` service in `docker-compose.yml`, exposing port `3001` and mounting `public/presets`, `data/uploads`, `python/publish/browser_profiles`, and `python/publish/publish_jobs.db`.
- ComfyUI, model APIs, Feishu, X, and any publishing credentials remain external services; they are not bundled into the repo.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Use `PascalCase.vue` for Vue components in `frontend/src/components/`, for example `frontend/src/components/TopNavigation.vue` and `frontend/src/components/MaterialDrivenWorkspace.vue`.
- Use `camelCase` with a `use` prefix for Vue composables in `frontend/src/composables/`, for example `frontend/src/composables/usePublishCenter.js` and `frontend/src/composables/useMaterialDriven.js`.
- Use descriptive lowercase or lower-camel filenames for Node modules in `server/`, grouped by role: routes like `server/routes/review.js`, services like `server/services/system/handlers.js`, and core utilities like `server/core/http.js`.
- Use `snake_case.py` for Python modules and scripts, for example `python/llm_client.py`, `python/gemini_client.py`, and `python/pipeline/run_material_driven.py`.
- Use `createXxx...` for Node factory functions that assemble dependencies and return service objects, for example `createSystemHandlers` in `server/services/system/handlers.js`, `createPublishStore` in `server/services/publish/store.js`, and `createRecoveryService` in `server/core/recovery.js`.
- Use `registerXxxRoutes` for Express route registration helpers, for example `registerReviewRoutes` in `server/routes/review.js`.
- Use verb-first `camelCase` for utility helpers in Node, for example `sendError`, `readJsonIfExists`, `slugifyText`, and `sanitizePublishDescriptionText` in `server/core/http.js`, `server/core/runtime.js`, and `server/services/publish/store.js`.
- Use `snake_case` for Python functions and methods, for example `get_llm_provider`, `generate_content`, and `wait_for_file_ready` in `python/llm_client.py`.
- Use `camelCase` for local variables, refs, and object properties in JS and Vue, for example `currentModuleTitle`, `publishCenter`, `errorState`, and `mockVerticalQueueService` in `frontend/src/App.vue`, `frontend/src/composables/usePublishCenter.js`, and `server/core/__tests__/recovery.test.js`.
- Use `UPPER_SNAKE_CASE` for shared constants, for example `LOG_FILE` in `server/core/logger.js`, `ERROR_CODES` in `server/core/errorCodes.js`, and `MATERIAL_DRIVEN_STORAGE_KEY` in `frontend/src/composables/useMaterialDriven.js`.
- Use `snake_case` for Python module-level constants when they behave as configuration, for example `DEFAULT_TIMEOUT_SECONDS` and `RETRYABLE_ERROR_MARKERS` in `python/gemini_client.py`.
- Use literal aliases or lightweight inline typing in Python instead of a dedicated type layer, for example `LLMProvider = Literal["gemini", "qwen"]` in `python/llm_client.py`.
- No TypeScript or shared interface files are present. In JS, shape contracts are expressed by naming, object literals, and helper functions such as `createError` in `server/core/errorCodes.js` and `normalizeApiError` in `frontend/src/composables/usePublishCenter.js`.
## Code Style
- Use ESLint from `.eslintrc.js` as the primary formatting authority for Node files under `server/` and `scripts/`.
- Apply these configured rules in JS:
- `console` is explicitly allowed by `.eslintrc.js` because the server relies on `server/core/logger.js` to persist logs.
- `frontend/` is not included in the `npm run lint` target, but sampled files like `frontend/src/main.js`, `frontend/src/composables/usePublishCenter.js`, and `frontend/src/composables/useMaterialDriven.js` mostly follow the same 2-space / semicolon style. Prefer matching that style when editing frontend code.
- `server.js` contains mixed indentation and quote usage relative to `.eslintrc.js`. Treat the linter config and the smaller modules under `server/` as the preferred style source.
- Use `npm run lint` from `package.json` for server and script files only. It runs `eslint server/ scripts/ --ext .js`.
- Follow `eslint:recommended` plus repo-specific rules from `.eslintrc.js`:
- There is no detected Prettier or Biome config. Formatting is convention-driven and ESLint-backed for Node code.
## Import Organization
- In CommonJS server files, built-ins usually come first, then package imports, then local modules. `server.js` and `server/core/logger.js` show the pattern clearly.
- In Vue files, external imports come first, then local components/composables, then side-effect CSS imports. See `frontend/src/main.js` and `frontend/src/App.vue`.
- Destructured imports are common for local helpers in Node, for example `const { sendError } = require('./server/core/http');` in `server.js`.
- Not detected. Use relative imports such as `./components/TopNavigation.vue`, `../taskStore`, and `./publishStore.config`.
## Error Handling
- Use the centralized JSON error envelope from `server/core/http.js`. Server handlers should call `sendError(res, { status, code, stage, error, details, hint })` instead of hand-building error responses.
- Prefer named error codes from `server/core/errorCodes.js`. The repo uses `createError(code, details, hint)` to attach a stable `code`, `stage`, and human-readable message.
- Wrap Express handlers in local `try/catch` blocks and translate failures into structured responses. `server/services/system/handlers.js` is the clearest example.
- Preserve fallback behavior for user-facing flows. `frontend/src/composables/usePublishCenter.js` normalizes backend failures through `normalizeApiError`, updates reactive error state, and appends the failure to in-memory logs.
- Treat non-critical browser persistence as best-effort. `frontend/src/App.vue` and `frontend/src/composables/useMaterialDriven.js` intentionally swallow `localStorage` read/write failures with `catch (_err) {}` comments.
- In Python, raise explicit exceptions for invalid configuration and return defaults only for optional reads. `python/llm_client.py` raises on unsupported providers, while `python/pipeline/run_material_driven.py` returns default payloads from JSON helpers when files are absent or malformed.
## Logging
- Keep `console.log`, `console.warn`, and `console.error` available in Node code. `server/core/logger.js` overrides the console methods and appends to `data/logs/server.log`.
- Use frontend in-memory log appenders for user-visible activity streams. `frontend/src/composables/usePublishCenter.js` stores recent lines in `recentLogs` and `errorLogs`.
- Use `print(...)` and `print(..., file=sys.stderr)` in Python scripts for runtime diagnostics and retry messages, as seen in `python/gemini_client.py` and `python/pipeline/run_material_driven.py`.
- Prefer short operational messages over structured logging payloads. The repo does not use a JSON logger or tracing library.
## Comments
- Use comments for module intent, workflow steps, and edge-case rationale. Good examples:
- Keep comments concise and task-oriented. The codebase does not use dense explanatory comments for every line.
- Full JSDoc is uncommon in JS modules.
- Python files rely on module docstrings and function docstrings instead, for example `python/llm_client.py` and `python/pipeline/run_material_driven.py`.
## Function Design
- Small utility functions are preferred in `server/core/` and `python/llm_client.py`.
- Larger orchestration functions are acceptable in composables and pipeline scripts when they own workflow state, for example `frontend/src/composables/useMaterialDriven.js` and `python/pipeline/run_material_driven.py`.
- Prefer dependency-object injection for Node services and handlers. `createSystemHandlers(deps)` and `createPublishStore(deps)` receive grouped dependencies instead of pulling everything from globals.
- Prefer options objects for JS helpers with optional behavior. `sendError(res, options = {})` and `generatePublishDescription(sourceText, options = {})` in `server.js` follow this pattern.
- Prefer explicit keyword-like parameters in Python public functions, for example `generate_content(client, *, model, contents, ...)` in `python/llm_client.py`.
- Return plain objects from service factories and utility helpers.
- Return reactive refs and methods from Vue composables, for example `usePublishCenter()` and `useMaterialDriven()`.
- Return booleans or default payloads from Python file helpers when the caller needs simple branching, for example `save_json_file()` and `load_json_file()` in `python/pipeline/run_material_driven.py`.
## Module Design
- Use named object exports in CommonJS modules: `module.exports = { sendError }`, `module.exports = { ERROR_CODES, createError }`, and `module.exports = { registerReviewRoutes }`.
- Use named ESM exports in frontend composables: `export function usePublishCenter()` and `export function useMaterialDriven()`.
- Vue components use `<script setup>` and do not declare explicit export objects.
- Limited use. `server/services/review/index.js` acts as a small barrel that initializes storage and re-exports `createReviewHandlers`.
- Most directories do not use barrel files. Import from the concrete module path directly.
## Practical Guidance
- For new server code under `server/`, match `.eslintrc.js` exactly and prefer the patterns in `server/core/http.js`, `server/core/errorCodes.js`, and `server/services/system/handlers.js`.
- For new frontend code under `frontend/src/`, keep `PascalCase.vue` components and `useXxx.js` composables, and follow the existing Composition API style from `frontend/src/App.vue` and `frontend/src/composables/usePublishCenter.js`.
- For new Python scripts under `python/`, use `snake_case` filenames, docstrings, explicit environment reads, and lightweight typing as seen in `python/llm_client.py` and `python/gemini_client.py`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- `server.js` is the composition root. It loads environment state, creates shared services, registers route modules, starts the scheduler, and serves static frontend assets.
- `frontend/src/App.vue` is the UI shell. Each major console area is implemented as a workspace component plus a matching composable in `frontend/src/composables/`.
- Long-running media and AI work is delegated to Python scripts under `python/`, while Node translates subprocess output into HTTP responses, SSE progress streams, persisted task state, and runtime files.
## Layers
- Purpose: Render the console shell, switch between business workspaces, and pass state/actions into each workspace.
- Location: `frontend/src/main.js`, `frontend/src/App.vue`, `frontend/src/components/TopNavigation.vue`
- Contains: App bootstrapping, top navigation, module selection, theme persistence, cross-module routing such as material-driven output into publish or standalone.
- Depends on: Vue runtime plus workspace composables such as `frontend/src/composables/useMaterialDriven.js`, `frontend/src/composables/usePublishCenter.js`, `frontend/src/composables/useStandalone.js`, and `frontend/src/composables/useXaiTop10.js`.
- Used by: The browser entry from `frontend/index.html`, built through `vite.config.mjs` and served from `frontend-dist/`.
- Purpose: Keep client-side state, talk to backend APIs, attach SSE streams, and persist recoverable UI state in `localStorage`.
- Location: `frontend/src/composables/`
- Contains: Feature-scoped composables such as `useMaterialDriven.js`, `usePublishCenter.js`, `useStandalone.js`, `useVerticalQueue.js`, `useVideoReview.js`, and `useXaiTop10.js`.
- Depends on: `fetch`, `axios`, Vue `ref`/`computed`/`watch`, and backend endpoints under `/api/...`.
- Used by: Workspace components in `frontend/src/components/*.vue`.
- Purpose: Create the Express app, static file serving, shared dependencies, and feature service instances.
- Location: `server.js`
- Contains: `express()` setup, static mounts for `frontend-dist/`, `public/`, and `projects/`, `TaskStore` initialization, scheduler startup, recovery startup, and feature route registration.
- Depends on: `server/config/paths.js`, `server/config/runtime.js`, `server/config/utils.js`, `server/core/*`, `server/routes/*`, `server/services/*`, and `scripts/utils/env.js`.
- Used by: `npm start` via `package.json`.
- Purpose: Keep URL surfaces declarative and hand real work to handlers/services.
- Location: `server/routes/`
- Contains: Thin registrars such as `server/routes/publish.js`, `server/routes/review.js`, `server/routes/system.js`, `server/routes/standalone.js`, `server/routes/vertical.js`, and `server/routes/xai.js`.
- Depends on: Handler/service objects built in `server.js`.
- Used by: Express at runtime.
- Purpose: Hold business logic, persistence access, and external system coordination.
- Location: `server/services/`
- Contains: Service factories and handler builders such as `server/services/xai/service.js`, `server/services/vertical/queue.js`, `server/services/vertical/standalone.js`, `server/services/publish/store.js`, `server/services/publish/handlers.js`, `server/services/review/handlers.js`, `server/services/system/handlers.js`, and `server/services/system/scheduler.js`.
- Depends on: Shared core helpers, path/runtime config, Python runners, and filesystem/SQLite dependencies.
- Used by: `server.js` and route registrars.
- Purpose: Provide reusable primitives for Python execution, task tracking, logging, progress streaming, error envelopes, and recovery.
- Location: `server/core/`
- Contains: `server/core/python.js`, `server/core/taskStore.js`, `server/core/taskProtocol.js`, `server/core/progress.js`, `server/core/recovery.js`, `server/core/http.js`, `server/core/errorCodes.js`, and `server/core/logger.js`.
- Depends on: Node standard library plus `better-sqlite3`.
- Used by: Nearly every service and by `server.js` directly.
- Purpose: Perform media analysis, planning, rendering, review, publishing helpers, and xAI discovery.
- Location: `python/`
- Contains: Active workflow scripts in `python/pipeline/`, review code in `python/review/`, publish/RPA scripts in `python/publish/`, and ranking scripts in `python/xai/`.
- Depends on: Environment configuration loaded through `python/load_env.py` and runtime protocol helpers in `python/script_protocol.py`.
- Used by: Node subprocess helpers in `server/core/python.js` and direct `spawn` usage inside `server/routes/materialDriven.js`.
- Purpose: Store durable job inputs, outputs, logs, metadata, and SQLite databases.
- Location: `projects/`, `data/`, `public/`, `python/publish/`
- Contains: Material-driven project directories under `projects/`, task databases and logs under `data/`, public-facing outputs and presets under `public/`, and publish job storage under `python/publish/publish_jobs.db`.
- Depends on: `server/config/paths.js` and feature services that read/write these directories.
- Used by: Recovery, publish asset discovery, review history, and frontend status restoration.
## Data Flow
- Frontend state is feature-local and ref-based inside `frontend/src/composables/`; long-running workflow recovery uses `localStorage` in `useMaterialDriven.js` and `useStandalone.js`.
- Server ephemeral state uses in-memory `Map` instances in `server/core/progress.js`, `server/routes/materialDriven.js`, and `server/services/vertical/queue.js`.
- Server durable state uses SQLite in `data/tasks.db` through `server/core/taskStore.js`, SQLite in `data/ai_review.db` through `server/services/review/store.js`, and SQLite in `python/publish/publish_jobs.db` through `server/services/publish/store.js` and `publishStore.migrations.js`.
- Large media artifacts and workflow checkpoints live on disk in `projects/`, `data/uploads/`, `public/`, and `python/publish/`.
## Key Abstractions
- Purpose: Keep rendering in `.vue` files and feature state/effects in a single matching composable.
- Examples: `frontend/src/components/MaterialDrivenWorkspace.vue` + `frontend/src/composables/useMaterialDriven.js`, `frontend/src/components/PublishCenterWorkspace.vue` + `frontend/src/composables/usePublishCenter.js`, `frontend/src/components/StandaloneWorkspace.vue` + `frontend/src/composables/useStandalone.js`.
- Pattern: Presentation/state split by feature, not by generic shared store.
- Purpose: Expose HTTP endpoints without embedding composition logic.
- Examples: `server/routes/publish.js`, `server/routes/review.js`, `server/routes/system.js`, `server/routes/xai.js`.
- Pattern: Functions named `register<Feature>Routes(app, handlers)` or `register<Feature>Route(app, handler)`.
- Purpose: Construct business services from filesystem, config, helper, and persistence dependencies passed from `server.js`.
- Examples: `createXaiService` in `server/services/xai/service.js`, `createVerticalQueueService` in `server/services/vertical/queue.js`, `createPublishStore` in `server/services/publish/store.js`, `createSystemHandlers` in `server/services/system/handlers.js`.
- Pattern: Plain-object dependency injection instead of container frameworks.
- Purpose: Turn subprocess output into structured progress, result, and error events.
- Examples: `server/core/python.js`, `server/core/taskProtocol.js`, `python/script_protocol.py`, and the custom parsing in `server/routes/materialDriven.js`.
- Pattern: JSON lines prefixed with `__CODEX_PYTHON__`, optionally paired with `task.json` / `result.json` / `failure.json` workdir contracts.
- Purpose: Make each material-driven run resumable, inspectable, and publishable from disk.
- Examples: `projects/material_<jobId>/material.mp4`, `projects/material_<jobId>/source_post.json`, `projects/material_<jobId>/execution_plan.json`, `projects/material_<jobId>/output_final.mp4`.
- Pattern: Filesystem-first persistence instead of database-backed workflow state.
## Entry Points
- Location: `frontend/index.html`, `frontend/src/main.js`
- Triggers: Vite dev server from `vite.config.mjs` or static serving of `frontend-dist/index.html` from `server.js`
- Responsibilities: Mount the SPA and hand control to `frontend/src/App.vue`
- Location: `server.js`
- Triggers: `npm start` from `package.json`
- Responsibilities: Load env, boot Express, mount static assets, create services, register routes, start scheduler and recovery, and listen on port `3001` by default
- Location: `server/routes/materialDriven.js`, `python/pipeline/run_material_driven.py`
- Triggers: `/api/material-driven/start`, `/continue/:jobId`, `/retry/:jobId`, `/rebuild/:jobId`, `/rerender/:jobId`
- Responsibilities: Create project directories, run or resume the multi-step workflow, stream progress, and recover tasks from disk
- Location: `server/services/system/scheduler.js`
- Triggers: Created in `server.js` at startup
- Responsibilities: Cron-based autopilot fetching, scheduled publish execution, cleanup, login monitoring, and follow-on automation
## Error Handling
- `server/core/http.js` provides `sendError(...)`, which standardizes `{ success, error, code, stage, details, hint }` responses.
- `server/core/errorCodes.js` centralizes stage-aware error codes for route and service code that uses `createError(...)`.
- `server/core/python.js` and `python/script_protocol.py` preserve Python-side `stage`, `code`, `details`, and `hint` information when subprocesses fail.
- Recovery logic in `server/core/recovery.js` inspects stale tasks from `server/core/taskStore.js` and marks them `interrupted`, `pending`, or `failed` instead of silently dropping state.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

## Debug Subagent Authorization

For debugging, incident investigation, failed automation, test failures, and bug-fix tasks, the user explicitly authorizes Codex to use the `$gsd-debug` recommended session-manager subagent flow.

When `$gsd-debug` applies, spawn `gsd-debug-session-manager` rather than doing the whole investigation only in the main context, unless the user explicitly asks not to use subagents.



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
