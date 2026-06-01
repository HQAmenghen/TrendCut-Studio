# Codebase Structure

**Analysis Date:** 2026-04-17

## Directory Layout

```text
trendcut-studio/
├── server.js                 # Node composition root and production HTTP entry
├── package.json              # Root scripts and dependency manifest
├── vite.config.mjs           # Vite config; uses `frontend/` as root and `frontend-dist/` as output
├── frontend/                 # Vue SPA source
│   ├── index.html            # Vite HTML entry
│   └── src/
│       ├── App.vue           # Console shell and dashboard composition
│       ├── components/       # Dashboard UI and presentational panels
│       └── composables/      # Feature state, API calls, SSE wiring, localStorage recovery
├── frontend-dist/            # Built frontend assets served by `server.js`
├── server/                   # Express-side code
│   ├── config/               # Canonical paths and runtime constants
│   ├── core/                 # Logging, errors, Python bridge, task store, recovery, SSE helpers
│   ├── routes/               # URL registrars
│   └── services/             # Feature services and handler factories
├── python/                   # Python execution layer
│   ├── pipeline/             # Media analysis, planning, rendering, vertical video generation
│   ├── publish/              # Publish description and WeChat RPA scripts
│   ├── review/               # AI review script
│   └── xai/                  # Top10 ranking fetch/translate scripts
├── config/                   # Workflow and non-secret JSON configuration
├── public/                   # Publicly served presets and generated media
├── data/                     # Runtime DBs, logs, uploads, queue state
├── projects/                 # Durable material-driven job directories
├── scripts/                  # JS maintenance and CI scripts
├── docs/                     # Reference and historical project documentation
└── .planning/codebase/       # Generated codebase maps
```

## Directory Purposes

**`frontend/`:**
- Purpose: Hold all source code for the Vue console.
- Contains: `frontend/src/App.vue`, dashboard components in `frontend/src/components/`, and composables in `frontend/src/composables/`.
- Key files: `frontend/src/App.vue`, `frontend/src/components/AutomationDashboard.vue`, `frontend/src/components/AppHeader.vue`, `frontend/src/components/ProductionProgressPanel.vue`, `frontend/src/composables/useMaterialDriven.js`, `frontend/src/composables/usePublishCenter.js`

**`server/`:**
- Purpose: Hold the Express application’s route, service, config, and infrastructure code.
- Contains: Route registrars under `server/routes/`, service factories under `server/services/`, and shared primitives under `server/core/`.
- Key files: `server/config/paths.js`, `server/core/python.js`, `server/core/taskStore.js`, `server/routes/materialDriven.js`, `server/services/vertical/queue.js`, `server/services/publish/store.js`

**`python/`:**
- Purpose: Hold Python scripts that perform long-running AI, media, and automation work.
- Contains: Active workflow scripts, helper modules, review logic, publish/RPA logic, and xAI scraping/translation.
- Key files: `python/pipeline/run_material_driven.py`, `python/pipeline/run_asr.py`, `python/pipeline/make_vertical_video.py`, `python/review/ai_video_review.py`, `python/publish/generate_publish_description.py`, `python/xai/run_xai_top10.py`, `python/script_protocol.py`

**`config/`:**
- Purpose: Keep checked-in, non-secret JSON configuration consumed by runtime code.
- Contains: Workflow and media index JSON files.
- Key files: `config/workflow_api.json`, `config/music_index.json`

**`public/`:**
- Purpose: Expose presets and generated artifacts through static file serving.
- Contains: Preset audio/image assets, generated avatar media, and queue/public outputs.
- Key files: `public/presets/audio/`, `public/presets/image/`, `public/generated_avatar/`

**`data/`:**
- Purpose: Hold runtime databases, logs, uploads, and queue-specific working data.
- Contains: `tasks.db`, review DBs, publish DBs, logs, and upload directories such as `data/uploads/runtime_jobs/` and `data/uploads/xai_vertical_queue/`.
- Key files: `data/tasks.db`, `data/ai_review.db`, `data/logs/`

**`projects/`:**
- Purpose: Act as the durable workspace for material-driven jobs.
- Contains: One directory per material-driven run, with staged media, planning files, avatar assets, and final outputs.
- Key files: `projects/<job>/material.mp4`, `projects/<job>/source_post.json`, `projects/<job>/script_units.json`, `projects/<job>/execution_plan.json`, `projects/<job>/output_final.mp4`

**`scripts/`:**
- Purpose: Hold engineering utilities and install/CI helpers.
- Contains: Node scripts invoked from `package.json` and helper modules.
- Key files: `scripts/ci.js`, `scripts/install-hooks.js`, `scripts/smoke_test.js`, `scripts/utils/env.js`

**`docs/`:**
- Purpose: Hold project documentation and historical implementation notes.
- Contains: Operational guides, refactor notes, feature summaries, and workflow docs.
- Key files: `docs/README.md`, `docs/MATERIAL_DRIVEN_WORKFLOW.md`, `docs/PROJECT_STRUCTURE.md`, `docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md`

## Key File Locations

**Entry Points:**
- `server.js`: Production entry, service composition root, and static asset host
- `frontend/index.html`: Vite HTML entry
- `frontend/src/main.js`: SPA bootstrapping entry
- `python/pipeline/run_material_driven.py`: Main material-driven Python workflow entry

**Configuration:**
- `package.json`: Root npm scripts and dependency manifest
- `vite.config.mjs`: Frontend dev/build routing and proxy setup
- `server/config/paths.js`: Canonical path registry used across backend services
- `server/config/runtime.js`: Runtime constants and editable file allowlists
- `config/workflow_api.json`: Workflow JSON consumed by `server/services/pipeline/workflow.js`
- `.env.example`: Environment template; `.env` is present in the repo root but should be treated as runtime configuration, not source

**Core Logic:**
- `frontend/src/App.vue`: Active console shell
- `frontend/src/components/AutomationDashboard.vue`: Unified operator cockpit
- `server/routes/materialDriven.js`: Material-driven orchestration and SSE
- `server/services/vertical/queue.js`: Batch vertical pipeline service
- `server/services/publish/handlers.js`: Publish API handlers
- `server/services/publish/store.js`: Publish config/job persistence assembly
- `server/services/system/scheduler.js`: Cron/autopilot orchestration
- `server/core/python.js`: Shared Python execution contract

**Testing:**
- `server/core/__tests__/`: Node infrastructure tests
- `server/services/publish/__tests__/`: Publish scheduling tests
- Top-level Python checks: `test_llm_modules.py`, `test_all_keys.py`, `bench_full_llm_test.py`

## Naming Conventions

**Files:**
- Vue dashboard and UI components use `PascalCase.vue`, for example `frontend/src/components/AutomationDashboard.vue` and `frontend/src/components/AppHeader.vue`.
- Vue composables use `use<Feature>.js`, for example `frontend/src/composables/useMaterialDriven.js` and `frontend/src/composables/usePublishCenter.js`.
- Route registrars and service modules use lowercase or lower-camel `.js` names, for example `server/routes/materialDriven.js`, `server/services/vertical/queue.js`, `server/services/system/selfCheck.js`.
- Python scripts and helpers use `snake_case.py`, for example `python/pipeline/run_material_driven.py`, `python/publish/generate_publish_description.py`, and `python/xai/translate_result_summaries.py`.
- Runtime project folders use generated identifiers such as `projects/material_<jobId>` or user-supplied output names passed through `/api/material-driven/start`.

**Directories:**
- Top-level source directories are short lowercase nouns: `frontend/`, `server/`, `python/`, `config/`, `public/`, `data/`, `projects/`, `scripts/`.
- Backend services are grouped first by feature under `server/services/<feature>/...`.
- Python code is grouped first by domain under `python/pipeline/`, `python/publish/`, `python/review/`, and `python/xai/`.

## Where To Add New Code

**New Frontend Feature Module:**
- Primary code: Extend `frontend/src/components/AutomationDashboard.vue` or add a focused supporting component in `frontend/src/components/`.
- State and API logic: Add or extend `frontend/src/composables/use<Feature>.js`.
- Shell wiring: Compose the feature through `frontend/src/App.vue` and the dashboard instead of reviving the old workspace-page pattern.

**New Backend API:**
- Route surface: Add or extend `server/routes/<feature>.js`
- Business logic: Add a service or handler builder under `server/services/<feature>/`
- Composition: Instantiate the service in `server.js` and pass it into the route registrar there

**New Python Workflow Capability:**
- Implementation: Add code under the relevant Python domain, usually `python/pipeline/`, `python/publish/`, `python/review/`, or `python/xai/`
- Node bridge: Call it through `server/core/python.js` or a feature service
- Progress contract: If the frontend needs live stage updates, emit protocol events through `python/script_protocol.py` and parse them in the Node caller

**Shared Utilities:**
- Backend-wide helpers: `server/core/` for generic runtime/task/python helpers, `server/config/` for path/runtime constants
- Project-wide utility scripts: `scripts/`
- Frontend shared behavior: `frontend/src/composables/` if it is feature state, or a component under `frontend/src/components/` if it is UI only

## Special Directories

**`frontend-dist/`:**
- Purpose: Production build output generated by `npm run build:front`
- Generated: Yes
- Committed: No

**`projects/`:**
- Purpose: Durable workflow output for material-driven jobs
- Generated: Yes
- Committed: Yes

**`data/`:**
- Purpose: Runtime databases, logs, and uploads used by active backend services
- Generated: Yes
- Committed: Yes

**`public/presets/`:**
- Purpose: User-selectable preset audio/image assets exposed to the frontend
- Generated: No
- Committed: Yes

**`public/generated_avatar/`:**
- Purpose: Generated avatar outputs exposed as static assets
- Generated: Yes
- Committed: Yes

**`docs/`:**
- Purpose: Human reference material and historical implementation notes
- Generated: No
- Committed: Yes

## Active Vs Inactive Frontend Files

**Active App Shell:**
- The current shell is `frontend/src/App.vue`, which mounts `AppHeader`, `AutomationDashboard`, and supporting modal/progress components.

**Currently Unmounted Files:**
- The old workspace component set has been removed. When adding a new feature, follow the active `AutomationDashboard.vue` composition path.

---

*Structure analysis: 2026-04-17*
