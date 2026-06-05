# Phase 8: Business Migration And Legacy Retirement

## Completion Target

Legacy Express can be discarded only after:

- Frontend no longer calls `/api/*` routes that are owned only by `server/routes`.
- BFF exposes the required browser-facing business APIs or explicit compatibility aliases.
- FastAPI owns durable task, worker, publish, review, and AI state.
- Worker jobs invoke real Python business entrypoints instead of returning adapter-only manifests.
- CI prevents `server/routes` from regaining default-runtime ownership.

## Wave 1: Worker Execution Migration

Status: completed in this phase slice.

Changes:

- `asr_worker` invokes `python/pipeline/run_asr.py`.
- `material_score_worker` invokes `python/pipeline/score_material_segments.py`.
- `script_worker` invokes `ScriptRewriterSkill` in-process.
- `clip_plan_worker` invokes `ClipSelectorSkill` in-process.
- `render_worker` invokes `python/pipeline/make_vertical_video.py`.
- `review_worker` invokes `python/review/ai_video_review.py`.
- `publish_worker` invokes `python/publish/social_auto_upload_adapter.py` after confirmation.
- `rpa_worker` invokes `python/publish/browser_platform_rpa.py` after confirmation.
- Worker manifests now wrap real execution output, protocol events, stdout/stderr tails, and output files.

Review:

- No blocking findings.
- High-risk publish/RPA jobs still require `confirmed=true`.
- External runtime dependencies remain required at execution time: FFmpeg, Playwright browsers, LLM keys, platform sessions, and media paths.

Verification:

- `python -m unittest python.tests.test_worker_executor`: passed.
- `python -m compileall -q apps/worker`: passed.

## Wave 2: BFF And Frontend API Migration

Status: completed in this phase slice.

Scope:

- Replace frontend-only legacy calls for material-driven, review, xAI, standalone/vertical, publish, login status, presets, and system self-check.
- Add BFF compatibility routes only where it accelerates frontend cutover without preserving Express ownership.
- Back those routes with FastAPI tasks/workers/publish APIs.

Changes:

- Added a NestJS `/api/*` compatibility controller for the frontend's legacy URL surface.
- Material-driven start/status/active/retry routes now create/read FastAPI tasks and enqueue `material_driven_worker` jobs.
- Standalone vertical generation now creates `standalone_vertical` tasks and `render_worker` jobs.
- xAI run/import routes now enqueue `xai_worker` jobs.
- Review routes now enqueue `review_worker` jobs.
- Publish/login compatibility routes now use the FastAPI publish control plane where possible and return no-op success for archive/config/asset operations that have no durable legacy owner in the new model yet.

Review:

- No blocking findings.
- This compatibility layer is intentionally thin. It removes Express as the browser API owner without recreating Express's in-memory workflow scheduler.
- Some frontend panels may still need UI-level adaptation to understand task/worker status shapes instead of old Express task snapshots.

Verification:

- `npm run check:bff`: passed.
- `npx jest apps/bff/src/__tests__/api-compat.test.js --runInBand`: passed.
- `python -m unittest python.tests.test_worker_executor`: passed.

## Wave 3: Legacy Express Retirement

Status: completed in this phase slice.

Scope:

- Remove default frontend dependency on `/api/*` Express routes.
- Delete or archive legacy route registration from runtime.
- Keep old code only as archived reference or tests until final deletion commit.

Changes:

- Removed `npm run start:legacy`.
- Deleted `scripts/start-legacy-express.js`.
- Removed `legacy-express` from Docker Compose.
- Strengthened `check:legacy-boundary` to reject any reintroduced `start:legacy` script or Compose `legacy-express` service.
- Updated docs to state that `server.js` and `server/` are archived reference/test code, not supported runtime entries.

Review:

- No blocking findings.
- `server/` remains in the repo because the current test suite still uses it heavily as reference coverage. Runtime ownership is removed; physical deletion can happen after equivalent tests are ported to `apps/`.

Verification:

- `npm run check:legacy-boundary`: passed.
- `npm run check:bff`: passed.
- `npm run check:api`: passed.
- `package.json` parse check: passed.
- `npm run ci`: passed, including BFF/FastAPI checks, Jest 58 suites / 358 tests, Python 216 tests, frontend build, production audit, and Python lock check. Existing legacy scheduler lint warnings remain warning-only and are outside this runtime-retirement change.

## Wave 4: Legacy Tree Removal And Agent Cutover

Status: completed.

Scope:

- Remove the former Express runtime tree instead of keeping it as archived code.
- Move MCP `/api/agent/v1/*` compatibility to the NestJS BFF.
- Point MCP bridge defaults and local launch scripts at BFF.
- Stop default JS test/lint entrypoints from treating the removed Express tree as maintained code.

Changes:

- Added `apps/bff/src/agent-compat.controller.ts` for MCP Agent API compatibility over FastAPI task, worker, and publish clients.
- Registered the Agent compatibility controller in the BFF module.
- Updated `mcp-server/src/tools.js` to default to BFF port `3002` and prefer `BFF_API_TOKEN`.
- Updated `一键启动.bat` to start FastAPI and BFF, then open the BFF port.
- Updated `package.json` JS test and lint scopes to the BFF compatibility tests, scripts, and MCP bridge.
- Removed direct root dependencies that belonged to the deleted Express service stack; kept `redis` because the BFF SSE event service still imports it.
- Deleted `server.js` and `server/`.
- Strengthened `check:legacy-boundary` to reject restored `server.js` or `server/`.
- Rewrote stale docs that still described Express as the current API owner.

Review:

- No blocking findings.
- Key residual risk is semantic depth of BFF Agent compatibility: it preserves the old MCP URL surface and `success` / `jobId` response style, but deeper tool-specific payload richness should be hardened as real users exercise MCP workflows. Execution ownership is correct: BFF routes to FastAPI task, worker, and publish clients instead of calling deleted Express handlers.
- Deleting the Express tree removes a large legacy Jest suite from default `npm test`. Python worker tests still cover media/AI execution paths, and BFF smoke tests now cover the compatibility translation layer.

Verification:

- `npm run check:legacy-boundary`: passed.
- `npm run check:bff`: passed.
- `npx jest apps/bff/src/__tests__/agent-compat.test.js --runInBand`: passed.
- Residual scan for old current-implementation paths: passed; `server/` and `server.js` no longer exist, remaining matches are boundary-ban text or `mcp-server/src/server.js`.
- Root dependency scan: passed; deleted direct legacy service dependencies are gone and `redis` remains for BFF events.
- `npm run ci`: passed after dependency cleanup, including BFF/FastAPI checks, Jest 3 suites / 3 tests, Python 216 tests, frontend build, lint, production audit, and Python lock check.
