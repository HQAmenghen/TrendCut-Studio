# Quick Task 260507-div: Material-Driven API And UI Split

**Goal:** Split the material-driven backend route and frontend workspace into smaller responsibility-focused modules without changing existing operator-facing API paths or LAN accessibility.

**Scope:**
- Keep `HOST=0.0.0.0` behavior unchanged.
- Keep `/api/material-driven/*` request/response shapes compatible.
- Move backend responsibilities out of `server/routes/materialDriven.js` into service modules for material download, task events/state, Python process orchestration, and avatar generation.
- Split `frontend/src/components/MaterialDrivenWorkspace.vue` into presentational child components while keeping `useMaterialDriven.js` as the state/API owner.

**Tasks:**
1. Add backend service modules and unit tests for isolated helpers where practical.
2. Refactor `server/routes/materialDriven.js` to compose those services and preserve route behavior.
3. Add frontend child components for upload/config, workflow progress, plan preview, timeline preview, and result actions.
4. Refactor `MaterialDrivenWorkspace.vue` to use the child components.
5. Verify with `npm run lint`, `npm test -- --runInBand`, and `npm run build:front`.

**Notes:**
- Do not address unrelated P0 security changes in this refactor.
- Do not revert existing dirty worktree changes.

**Result:**
- Backend route reduced to HTTP composition while download, task state/SSE, Python process orchestration, event parsing, and avatar generation moved under `server/services/materialDriven/`.
- Frontend workspace now composes child components for hero/status, upload config, render-node config, plan preview, timeline, and result actions.
- `executionPlan` rendering now accepts both array payloads and `{ segments: [] }` payloads.
- Vite dev server host is `0.0.0.0` for LAN access; backend `HOST` default remains `0.0.0.0`.

**Verification:**
- `npm run lint`
- `npm test -- --runInBand`
- `npm run build:front`
