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

Status: pending.

Scope:

- Remove default frontend dependency on `/api/*` Express routes.
- Delete or archive legacy route registration from runtime.
- Keep old code only as archived reference or tests until final deletion commit.
