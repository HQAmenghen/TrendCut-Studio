# External Integrations

**Analysis Date:** 2026-04-17

## APIs & External Services

**AI & Media Generation:**
- ComfyUI - external workflow execution and progress streaming for generation tasks.
  - SDK/Client: `axios`, `ws`, and `form-data` in `server/services/pipeline/comfy.js`.
  - Auth: `COMFYUI_BASE_URL`; no token-based auth flow is implemented in `server/services/pipeline/comfy.js`.
- Google Gemini - text and multimodal generation, file upload, review, and copywriting workloads.
  - SDK/Client: `google-genai` in `python/gemini_client.py`, routed through `python/llm_client.py`.
  - Auth: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, with optional `GEMINI_API_BASE_URL` / `GOOGLE_API_BASE_URL`.
- Qwen / DashScope - text generation, multimodal analysis, ASR, embeddings, and reranking.
  - SDK/Client: `dashscope` in `python/qwen_client.py`.
  - Auth: `QWEN_API_KEY` or `DASHSCOPE_API_KEY`, with optional `QWEN_API_BASE_URL`.
- xAI Grok - ranking enrichment and summarization for the Top10 workflow.
  - SDK/Client: `openai.OpenAI` pointed at `https://api.x.ai/v1` in `python/xai/run_xai_top10.py`.
  - Auth: `XAI_API_KEY`, with optional proxy support via `XAI_PROXY`.

**Social & Content Sources:**
- X API - author lookup, tweet/video lookup, and ranking inputs for `xai` jobs.
  - SDK/Client: `requests` plus `requests_oauthlib.OAuth1` in `python/xai/run_xai_top10.py`.
  - Auth: `X_BEARER_TOKEN` for bearer flows, plus `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET` for OAuth1 fallbacks.
- Jina AI mirror endpoints - fallback page/text fetches for X content when direct data is incomplete.
  - SDK/Client: `requests` in `python/xai/run_xai_top10.py`.
  - Auth: None detected.
- Pexels - optional stock-video discovery.
  - SDK/Client: `requests` in `python/pipeline/material_search.py`.
  - Auth: `--pexels-key` / config key `pexels_api_key` handled by `python/pipeline/material_search.py`.
- Pixabay - optional stock-video discovery.
  - SDK/Client: `requests` in `python/pipeline/material_search.py`.
  - Auth: `--pixabay-key` / config key `pixabay_api_key` handled by `python/pipeline/material_search.py`.

**Notifications & Publishing:**
- Feishu/Lark Open Platform - chat notifications, cards, and QR image delivery.
  - SDK/Client: `axios` and `form-data` in `server/services/notification/feishu.js`.
  - Auth: `FEISHU_WEBHOOK_URL` for webhook mode, or `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_RECEIVE_ID`, and `FEISHU_RECEIVE_ID_TYPE` for app mode.
- WeChat Channels web console - automated upload and login polling through browser automation.
  - SDK/Client: `playwright` in `python/publish/wechat_channels_rpa.py`, `python/publish/wechat_check_login.py`, and `python/publish/wechat_check_login_remote.py`.
  - Auth: persisted browser session state under `python/publish/browser_profiles/`; no official API token flow is detected.
- Planned publish adapters - credential schemas exist for `douyin`, `xiaohongshu`, `x`, and `youtube` in `server.js` (`buildPublishTask`) and `python/publish/platform_config.json`, but only the WeChat Channels automation path is implemented.

## Data Storage

**Databases:**
- Local SQLite only.
  - Connection: filesystem-backed `.db` files; no network DSN or hosted database is detected.
  - Client: `better-sqlite3` in `server/core/taskStore.js`, `server/services/review/store.js`, and `server/services/publish/publishStore.migrations.js`.
  - Runtime files: `data/tasks.db`, `data/ai_review.db`, and `python/publish/publish_jobs.db`.
- JSON sidecar state remains part of the runtime contract.
  - `python/xai/result.json`, `python/xai/result.partial.json`, and `python/xai/xai_top10_cache.json` hold ranking state.
  - `config/workflow_api.json` plus the JSON allowlist in `server/config/runtime.js` hold editable workflow/system inputs.

**File Storage:**
- Local filesystem only.
  - Uploads and runtime artifacts: `data/uploads/` and `projects/` via `server/config/paths.js`.
  - Public queue/preset assets: `public/xai_vertical_queue/`, `public/presets/audio/`, and `public/presets/image/`.
  - Frontend build output: `frontend-dist/`.
  - WeChat browser automation state: `python/publish/browser_profiles/`.

**Caching:**
- None external.
  - In-memory cache: publish-description memoization in `server.js`.
  - On-disk cache: `python/xai/xai_top10_cache.json`.
  - Active-task memory cache: `TaskStore.memoryCache` in `server/core/taskStore.js`.

## Authentication & Identity

**Auth Provider:**
- No end-user auth provider is detected for the panel itself.
  - Implementation: `server.js` mounts routes directly without session, JWT, or OAuth middleware; access is assumed to be local/network controlled.

**Service Credential Pattern:**
- Environment variables are the primary credential channel for model APIs, Feishu, X API, scheduler toggles, and public base URLs in `server/services/system/handlers.js`, `server/services/notification/loginStatus.js`, `python/gemini_client.py`, `python/qwen_client.py`, and `python/xai/run_xai_top10.py`.
- Per-platform publish metadata is stored in local config/state through `server/services/publish/store.js` and `python/publish/platform_config.json`.
- WeChat Channels auth is browser-session based and persisted under `python/publish/browser_profiles/`.

## Monitoring & Observability

**Error Tracking:**
- None external.
  - Errors are returned through HTTP responses in `server/core/http.js`, Python protocol payloads in `server/core/python.js` and `python/script_protocol.py`, and local DB/log files.

**Logs:**
- Console and filesystem logging only.
  - Node bootstrap logger: `server/core/logger.js`.
  - Scheduler log: `data/logs/scheduler.log` from `server/services/system/scheduler.js`.
  - xAI logs: `python/xai/run_log.txt` and `python/xai/run_error.log`.
  - Review/task history persists operational detail in `data/ai_review.db` and `data/tasks.db`.

## CI/CD & Deployment

**Hosting:**
- Direct Node hosting or Docker.
  - Process entry: `npm start` -> `server.js`.
  - Container entry: `Dockerfile` and `docker-compose.yml` service `trendcut-studio`.
  - ComfyUI remains a separately hosted dependency configured by `COMFYUI_BASE_URL`.

**CI Pipeline:**
- GitHub Actions in `.github/workflows/ci.yml`.
  - Runs `npm ci`, `npm test`, and `npm run build:front` across Node 18.x/20.x/22.x.
  - Runs a separate lint job with `npm run lint`.
  - Coverage is uploaded through Codecov on the Node 20.x job.

## Environment Configuration

**Required env vars:**
- Core runtime: `PORT`, `HOST`, `COMFYUI_BASE_URL`, `LLM_PROVIDER`.
- Gemini: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, optional `GEMINI_API_BASE_URL`, `GOOGLE_API_BASE_URL`, `GEMINI_MODEL`, `AI_REVIEW_GEMINI_MODEL`, `PUBLISH_DESCRIPTION_GEMINI_MODEL`.
- Qwen/DashScope: `QWEN_API_KEY` or `DASHSCOPE_API_KEY`, optional `QWEN_API_BASE_URL`, `QWEN_VL_MODEL`, `QWEN_ASR_MODEL`, `QWEN_TEXT_MODEL`, `QWEN_EMBEDDING_MODEL`, `QWEN_RERANK_MODEL`.
- xAI/X pipeline: `XAI_API_KEY`, optional `XAI_MODEL`, `XAI_PROXY`, plus `X_BEARER_TOKEN`, `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, and `X_ACCESS_TOKEN_SECRET`.
- Feishu and login checks: `FEISHU_WEBHOOK_URL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_RECEIVE_ID`, `FEISHU_RECEIVE_ID_TYPE`, `FEISHU_NOTIFY_LOGIN_STATUS`, `FEISHU_NOTIFY_AUTOPILOT`, `FEISHU_NOTIFY_REVIEW`, `LOGIN_CHECK_ENABLED`, `LOGIN_CHECK_INTERVAL_MINUTES`, `LOGIN_CHECK_RETRY_TIMES`, and `LOGIN_STATUS_PUBLIC_BASE_URL`.
- Scheduler/cleanup: `AUTO_ARCHIVE_PUBLISHED`, `AUTO_ARCHIVE_DELAY_MINUTES`, `AUTO_CLEANUP_ENABLED`, `AUTO_CLEANUP_DRY_RUN`, and `AUTO_CLEANUP_SCHEDULE`.
- Additional feature-tuning vars exist throughout `python/pipeline/*.py` and `python/qwen_client.py` for request timeouts, scoring concurrency, embeddings, rerank, and smart-clip behavior.

**Secrets location:**
- Secrets are expected in project-root `.env`, loaded by `scripts/utils/env.js` and `python/load_env.py`.
- The system settings API in `server/services/system/handlers.js` writes updated operational secrets back into `.env`.
- Browser-session secrets/state for WeChat automation live under `python/publish/browser_profiles/`.
- No external secret manager integration is detected.

## Webhooks & Callbacks

**Incoming:**
- No public external webhook receiver route is detected in `server/routes/*.js`.
- Real-time UI updates use SSE at `/api/progress` from `server/core/progress.js` and `server/routes/materialDriven.js`; this is internal streaming, not third-party webhook intake.

**Outgoing:**
- Feishu webhook posts originate from `server/services/notification/feishu.js` when `FEISHU_WEBHOOK_URL` is configured.
- Feishu REST API calls for app-mode messaging and image upload originate from `server/services/notification/feishu.js`.
- The remote WeChat login helper can also push QR alerts to Feishu via `python/publish/wechat_check_login_remote.py`.
- ComfyUI progress is consumed through an outbound WebSocket client in `server/services/pipeline/comfy.js`.

---

*Integration audit: 2026-04-17*
