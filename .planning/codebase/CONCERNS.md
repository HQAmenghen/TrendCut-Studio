# Codebase Concerns

**Analysis Date:** 2026-04-17

## Tech Debt

**Monolithic orchestration modules:**
- Issue: HTTP routing, subprocess orchestration, filesystem mutation, retry logic, and response shaping are combined inside very large modules instead of isolated services.
- Files: `server/routes/materialDriven.js`, `server/services/vertical/queue.js`, `python/pipeline/run_material_driven.py`, `python/pipeline/smart_video_composer.py`, `frontend/src/composables/usePublishCenter.js`, `frontend/src/composables/useMaterialDriven.js`, `frontend/src/components/AutomationDashboard.vue`
- Impact: a small behavior change can break multiple steps in the same flow, duplicated process-lifecycle code diverges over time, and targeted unit tests are hard to add without refactoring first.
- Fix approach: split route handlers from orchestration services, centralize Python process management in one adapter, and move Vue workflow state machines out of page-sized components into smaller composables/stores.

**Repo contains tracked runtime state and generated media:**
- Issue: runtime databases, generated videos, project outputs, and test artifacts live inside the source tree and many are tracked by git.
- Files: `.gitignore`, `data/ai_review.db`, `data/publish_jobs.db`, `data/tasks.db`, `data/test.db`, `test_publish_jobs.db`, `test_jobs_archive.db`, `projects/`, `public/generated_avatar/`, `public/output_final.mp4`
- Impact: repository size grows continuously, sensitive or business-specific media can leak through source control, local state pollutes code review, and reproducible test/setup becomes harder.
- Fix approach: move mutable runtime data under a single ignored storage root, keep only minimal deterministic fixtures in git, and add cleanup policies for `projects/` and generated public media.

**Unpinned Python dependency graph:**
- Issue: the Python toolchain is declared without exact versions.
- Files: `requirements.txt`, `python/pipeline/requirements.txt`
- Impact: fresh installs can change ASR, browser automation, video rendering, and LLM client behavior without any code change.
- Fix approach: pin exact versions, add a lockfile or compiled requirements output, and gate upgrades behind smoke tests for `python/pipeline/run_asr.py`, `python/pipeline/run_material_driven.py`, and `python/publish/wechat_channels_rpa.py`.

**Silent exception swallowing in pipeline code:**
- Issue: multiple Python flows suppress exceptions with bare `except: pass` or broad fallback branches that return `None` without structured diagnostics.
- Files: `python/pipeline/run_asr.py`, `python/pipeline/run_material_driven.py`, `python/pipeline/smart_video_composer.py`, `python/publish/wechat_channels_rpa.py`
- Impact: stale artifacts, partial cleanup failures, and browser automation errors are harder to diagnose and can produce misleading downstream failures.
- Fix approach: only suppress narrow cleanup errors, log exception context consistently, and convert important failures into protocol errors that `server/core/python.js` can surface.

## Known Bugs

**Publish config masking is bypassed by the raw response payload:**
- Symptoms: `GET /api/publish/config` and `POST /api/publish/config` return both `config` and `maskedConfig`, and the frontend hydrates from the raw `config`.
- Files: `server/services/publish/handlers.js`, `frontend/src/composables/usePublishCenter.js`
- Trigger: opening or saving the publish settings UI.
- Workaround: no safe in-app workaround; only restrict network access until the raw `config` field is removed from responses.

**Material-driven task state leaks in memory after jobs finish:**
- Symptoms: finished and recovered tasks stay in the `activeTasks` map indefinitely, so memory usage and stale task history grow with every run.
- Files: `server/routes/materialDriven.js`
- Trigger: repeated use of `/api/material-driven/start`, `/api/material-driven/retry/:jobId`, or `/api/material-driven/status/:jobId` on a long-lived server process.
- Workaround: restart the Node process to clear in-memory task state.

**Review endpoints can write metadata beside any existing local file path:**
- Symptoms: review and skip handlers accept caller-provided `videoPath`, only check `fs.existsSync(videoPath)`, then create or overwrite `${videoPath}.meta.json`.
- Files: `server/services/review/handlers.js`, `server/routes/review.js`
- Trigger: sending a crafted `videoPath` to `POST /api/review/video` or `POST /api/review/skip`.
- Workaround: none in code; only expose the service to fully trusted local callers.

## Security Considerations

**No authentication or authorization on administrative APIs:**
- Risk: the server binds to `0.0.0.0` by default and exposes config, publish, review, login-status, and pipeline-control routes without auth middleware.
- Files: `server.js`, `server/routes/system.js`, `server/routes/publish.js`, `server/routes/review.js`, `server/routes/loginStatus.js`, `server/routes/materialDriven.js`
- Current mitigation: none in application code; safety depends on network isolation.
- Recommendations: bind to `127.0.0.1` by default, require authentication before every `/api/*` write path, and add role checks for secret/config endpoints.

**Secrets are stored in plaintext and returned to the browser:**
- Risk: model API keys and platform credentials are written to local config files, then sent back to the frontend in raw form.
- Files: `server/services/system/handlers.js`, `server/services/publish/handlers.js`, `server/services/publish/publishStore.config.js`, `scripts/utils/env.js`, `frontend/src/components/AutomationDashboard.vue`, `frontend/src/composables/usePublishCenter.js`
- Current mitigation: `.gitignore` excludes `.env` and `python/publish/platform_config.json`, and publish routes also compute a masked copy, but the raw values are still returned.
- Recommendations: never return stored secrets after save, separate secret storage from user-editable config, and replace read-back with masked placeholders plus explicit rotate/update actions.

**Path traversal and arbitrary file access are possible through user-controlled paths:**
- Risk: `outputDir` from material-driven requests and `videoPath` from review requests reach filesystem operations without a verified root boundary.
- Files: `server/routes/materialDriven.js`, `server/services/review/handlers.js`, `server/config/paths.js`, `frontend/src/composables/useMaterialDriven.js`, `frontend/src/components/AutomationDashboard.vue`
- Current mitigation: existence checks and `path.join()` are used, but there is no `path.resolve()` plus prefix enforcement against `projects/`, `public/`, or managed runtime directories.
- Recommendations: reject absolute paths and `..`, resolve against a fixed root, and persist asset IDs instead of trusting client-supplied file paths.

**Outbound SSRF surface and TLS verification bypass around ComfyUI/material fetches:**
- Risk: callers can submit arbitrary `materialUrl` and `serverUrl`, and outbound HTTPS connections explicitly disable certificate verification.
- Files: `server/routes/materialDriven.js`, `server/services/pipeline/comfy.js`, `frontend/src/composables/useMaterialDriven.js`, `server/config/runtime.js`
- Current mitigation: request timeouts and retry loops only.
- Recommendations: add host allowlists, block private-address SSRF targets where appropriate, require HTTPS with certificate validation, and keep any insecure override behind a dev-only flag.

**Login QR code/session details are reachable without access control:**
- Risk: login status endpoints expose account state, QR code payloads, and refresh actions to any caller that can reach the API.
- Files: `server/routes/loginStatus.js`, `server/services/notification/loginStatus.js`, `server/services/publish/wechatRpa.login.js`
- Current mitigation: login-check sessions are short-lived and auto-cleaned.
- Recommendations: require authentication, return one-time QR tokens instead of raw session payloads, and limit refresh actions to authorized operators.

## Performance Bottlenecks

**Synchronous filesystem operations run on the Node request path:**
- Problem: high-traffic handlers rely on `readFileSync`, `writeFileSync`, `existsSync`, `readdirSync`, `copyFileSync`, `renameSync`, and `statSync`.
- Files: `server/services/system/handlers.js`, `server/routes/materialDriven.js`, `server/services/review/handlers.js`, `server/services/vertical/standalone.js`, `server/config/utils.js`
- Cause: convenience sync APIs are used directly inside HTTP handlers and orchestration code.
- Improvement path: replace hot-path sync I/O with `fs.promises`, cache immutable configs such as `workflow_api.json`, and move directory scans out of request handlers.

**Tracked artifact growth makes file scanning and operator workflows slower over time:**
- Problem: the repo already contains dozens of `projects/` directories and many `data/uploads/xai_vertical_queue/` runtime folders.
- Files: `projects/`, `data/uploads/xai_vertical_queue/`, `server/services/publish/assets.js`, `server/config/utils.js`
- Cause: generated outputs live beside source, some are tracked, and only a subset of artifact trees are covered by cleanup policies.
- Improvement path: store generated outputs outside the repo, add retention for `projects/`, and keep UI asset discovery off large tracked directories.

**Repeated DB open/close patterns add avoidable overhead to review operations:**
- Problem: review storage opens a new SQLite connection per operation instead of reusing a shared process-local handle.
- Files: `server/services/review/store.js`
- Cause: `getReviewDb()` instantiates `better-sqlite3` for each read/write path.
- Improvement path: reuse a single connection, keep WAL enabled, and reserve reconnect logic for process start/stop boundaries.

## Fragile Areas

**Material-driven end-to-end workflow:**
- Files: `server/routes/materialDriven.js`, `python/pipeline/run_material_driven.py`, `frontend/src/composables/useMaterialDriven.js`, `frontend/src/components/AutomationDashboard.vue`
- Why fragile: task recovery mixes disk inspection with in-memory maps, process attach/retry logic is duplicated, user-controlled directory names alter file layout, and active tasks are never evicted.
- Safe modification: change the task schema and protocol events in one pass across Node, Python, and Vue; add regression coverage around start, resume, retry, and rebuild before refactoring.
- Test coverage: no automated tests are present for the material-driven route or its frontend orchestration.

**Publish center configuration and WeChat RPA flow:**
- Files: `server/services/publish/handlers.js`, `server/services/publish/publishStore.config.js`, `server/services/publish/wechatRpa.login.js`, `server/services/publish/wechatRpa.process.js`, `frontend/src/composables/usePublishCenter.js`, `frontend/src/components/AutomationDashboard.vue`
- Why fragile: credentials, browser profiles, RPA runtime, account state, and publish-job persistence are tightly coupled and updated through multiple endpoints.
- Safe modification: split secret handling from publish-job state first, preserve the existing response contract during migration, and validate changes with throwaway credentials and isolated browser profiles.
- Test coverage: `server/services/publish/__tests__/scheduling.test.js` covers scheduling only; config, login, RPA, and secret-handling paths are untested.

**AI review and regeneration flow:**
- Files: `server/services/review/handlers.js`, `server/services/review/executor.js`, `server/services/review/regenerate.js`, `server/services/vertical/queue.js`, `frontend/src/components/AutomationDashboard.vue`
- Why fragile: request payloads carry file paths, temporary files are written under OS temp, review results mutate media metadata, and regeneration immediately enqueues new work.
- Safe modification: normalize everything to managed asset IDs before touching disk, keep metadata schema changes backward-compatible, and test success, failure, skip, and regenerate branches together.
- Test coverage: no automated tests are present for review handlers, review executor, or regeneration.

**Python LLM and media composition layer:**
- Files: `python/pipeline/smart_video_composer.py`, `python/pipeline/skills/script_rewriter_skill.py`, `python/xai/run_xai_top10.py`, `python/publish/wechat_channels_rpa.py`
- Why fragile: large files mix fallback imports, model calls, heuristics, and file I/O with many broad exception branches.
- Safe modification: isolate pure transformations from side effects, replace fallback globals with explicit dependency injection, and require script-level smoke coverage before changing prompt or media logic.
- Test coverage: no Python test suite is wired into `scripts/ci.js`.

## Scaling Limits

**Material-driven state retention is unbounded inside the Node process:**
- Current capacity: every started or recovered job remains in `activeTasks` until process restart.
- Limit: a busy or long-lived service accumulates logs, status snapshots, and stale output references in memory.
- Scaling path: persist task state in `TaskStore`, keep only recent active jobs in memory, and evict completed/failed tasks by TTL.

**Vertical queue throughput is hard-capped and still coordinated by one Node process:**
- Current capacity: `server/services/vertical/queue.js` clamps concurrency to 4 and all coordination still runs inside the main server process.
- Limit: more jobs only increase queue depth while the same process handles sync file I/O, logging, and HTTP traffic.
- Scaling path: move rendering orchestration to worker processes or a real job queue, keep the API process stateless, and enforce resource quotas per job.

**Git-tracked media and databases create a repository-size ceiling:**
- Current capacity: the repo already stores many generated projects and public videos under `projects/`, `public/`, and `data/`.
- Limit: clone time, review time, backup size, and merge noise all scale with production activity instead of source size.
- Scaling path: treat media and runtime DBs as external state, not source-controlled assets, and prune tracked artifacts from the repository history.

## Dependencies at Risk

**Floating Python AI/media dependencies:**
- Risk: `faster-whisper`, `dashscope`, `google-genai`, `openai`, `playwright`, and `moviepy` are installed without pinned versions.
- Impact: ASR quality, browser automation selectors, LLM client APIs, and video rendering behavior can drift between machines or after reinstall.
- Migration plan: pin exact versions in `python/pipeline/requirements.txt`, add an upgrade checklist, and smoke test `python/pipeline/run_asr.py`, `python/review/ai_video_review.py`, and `python/publish/wechat_channels_rpa.py` on every dependency bump.

## Missing Critical Features

**Authentication, authorization, and safe secret management:**
- Problem: the app behaves like a trusted local control panel but ships remote-control endpoints for secrets, publish jobs, login checks, and file-backed pipelines.
- Blocks: safe deployment on a shared LAN, safe reverse-proxy exposure, and safe collaboration across multiple operators.

## Test Coverage Gaps

**High-risk HTTP write paths:**
- What's not tested: material-driven start/retry/rebuild/rerender flows, review execution, login-status actions, system config writes, and publish-config exposure behavior.
- Files: `server/routes/materialDriven.js`, `server/services/review/handlers.js`, `server/routes/loginStatus.js`, `server/services/system/handlers.js`, `server/services/publish/handlers.js`
- Risk: auth, path-validation, and serialization regressions can ship without any failing test.
- Priority: High

**Frontend orchestration and settings UIs:**
- What's not tested: large Vue components and composables that own publish, review, material-driven, and system-settings state transitions.
- Files: `frontend/src/composables/usePublishCenter.js`, `frontend/src/composables/useMaterialDriven.js`, `frontend/src/components/AutomationDashboard.vue`
- Risk: response contract changes or edge cases can break the operator workflow while Node tests still pass.
- Priority: High

**Python pipeline, review, and RPA entry points:**
- What's not tested: the major Python entry scripts and their integration with Node.
- Files: `python/pipeline/run_material_driven.py`, `python/pipeline/run_asr.py`, `python/review/ai_video_review.py`, `python/publish/wechat_channels_rpa.py`, `scripts/ci.js`, `scripts/smoke_test.js`
- Risk: dependency drift and subprocess failures are only caught manually.
- Priority: High

---

*Concerns audit: 2026-04-17*
