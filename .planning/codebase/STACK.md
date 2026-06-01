# Technology Stack

**Analysis Date:** 2026-04-17

## Languages

**Primary:**
- JavaScript (ES2021 syntax) - Express backend in `server.js` and `server/**/*.js`, plus the Vue app entry/composables in `frontend/src/main.js`, `frontend/src/App.vue`, and `frontend/src/composables/*.js`.

**Secondary:**
- Python 3.x - worker scripts under `python/**/*.py`; `README.md` requires Python 3.10+, while `Dockerfile` installs distro `python3`.
- HTML/CSS - frontend shell and styling in `frontend/index.html` and `frontend/src/styles.css`.

## Runtime

**Environment:**
- Node.js 18+ for development per `README.md`; the container standardizes on Node 20 Bookworm in `Dockerfile`; CI exercises Node 18.x, 20.x, and 22.x in `.github/workflows/ci.yml`.
- Python 3 via the system interpreter installed in `Dockerfile`; Node launches workers through `server/core/python.js` and `server/services/review/executor.js`.
- FFmpeg is a runtime dependency for media assembly; it is installed in `Dockerfile` and referenced by self-checks in `server/services/system/selfCheck.js`.

**Package Manager:**
- npm - root JavaScript package manager defined by `package.json`.
- pip - Python dependencies resolved from `requirements.txt` -> `python/pipeline/requirements.txt`.
- Lockfile: JavaScript lockfile present in `package-lock.json` (`lockfileVersion: 3`); no Python lockfile detected.

## Frameworks

**Core:**
- Express 4.19.2 - HTTP server, static asset hosting, and route composition in `server.js`.
- Vue 3.5.30 - single-page UI mounted from `frontend/src/main.js` with components under `frontend/src/components/`.
- Vite 8.0.2 - frontend dev server and build pipeline in `vite.config.mjs`.
- Playwright (Python package) - browser automation for WeChat Channels flows in `python/publish/wechat_channels_rpa.py` and `python/publish/wechat_check_login.py`.

**Testing:**
- Jest 30.3.0 - Node test runner configured inline in `package.json`, with suites under `server/**/__tests__/*.test.js`.
- Sinon 21.0.3 - spy/stub support installed in `package.json` for the Jest-based test suite.

**Build/Dev:**
- `@vitejs/plugin-vue` 6.0.5 - Vue SFC support enabled in `vite.config.mjs`.
- `@tailwindcss/vite` 4.2.2 and `tailwindcss` 4.2.2 - build-time styling dependencies listed in `package.json`; no standalone `tailwind.config.*` file is detected.
- ESLint 8.57.1 - linting rules in `.eslintrc.js`, invoked by `npm run lint`.
- Docker / Docker Compose - container packaging in `Dockerfile` and local orchestration in `docker-compose.yml`.

## Key Dependencies

**Critical:**
- `axios` 1.6.8 - outbound HTTP client for ComfyUI, Feishu, and frontend API calls in `server/services/pipeline/comfy.js`, `server/services/notification/feishu.js`, and `frontend/src/composables/useXaiTop10.js`.
- `better-sqlite3` 12.8.0 - local persistence for tasks, review history, and publish jobs in `server/core/taskStore.js`, `server/services/review/store.js`, and `server/services/publish/publishStore.migrations.js`.
- `ws` 8.19.0 - ComfyUI progress WebSocket client in `server/services/pipeline/comfy.js`.
- `node-cron` 4.2.1 - recurring scheduling for autopilot, archival, login checks, and cleanup in `server/services/system/scheduler.js`.
- `google-genai` - Gemini client implementation in `python/gemini_client.py`, routed through `python/llm_client.py`.
- `dashscope` - Qwen multimodal/text/embedding/rerank client in `python/qwen_client.py`.
- `openai` - transport client for xAI Grok requests in `python/xai/run_xai_top10.py`.
- `faster-whisper`, `moviepy`, `Pillow`, `httpx`, and `requests` - Python media and API tooling declared in `python/pipeline/requirements.txt` and used across `python/pipeline/*.py`, `python/review/ai_video_review.py`, and `python/xai/run_xai_top10.py`.

**Infrastructure:**
- `multer` 1.4.5-lts.1 - multipart upload handling in `server.js`.
- `form-data` 4.0.0 - file upload payloads for ComfyUI and Feishu in `server/services/pipeline/comfy.js` and `server/services/notification/feishu.js`.
- `requests-oauthlib` - OAuth1 signing for X API fallbacks in `python/xai/run_xai_top10.py`.
- `sqlite` / `sqlite3` - installed in `package.json`, but the runtime storage code currently uses `better-sqlite3` instead of these packages.

## Configuration

**Environment:**
- Node loads project-root `.env` through `scripts/utils/env.js`, which is invoked from `server.js`.
- Python workers load the same `.env` through `python/load_env.py`, used by `python/review/ai_video_review.py`, `python/xai/run_xai_top10.py`, and other scripts.
- System settings endpoints in `server/services/system/handlers.js` read and rewrite `.env` values for Feishu, login checks, and LLM provider settings.
- `.env`, `.env.example`, and `.env.smart_clip` exist at project root; secret contents were not inspected.
- Core startup configuration centers on `COMFYUI_BASE_URL`, one LLM credential set (`GEMINI_API_KEY` / `GOOGLE_API_KEY` or `QWEN_API_KEY` / `DASHSCOPE_API_KEY`), and `XAI_API_KEY`, with additional feature flags in `server/services/notification/loginStatus.js`, `server/services/system/scheduler.js`, and `python/qwen_client.py`.

**Build:**
- Frontend build and dev proxy configuration live in `vite.config.mjs`.
- Runtime path conventions live in `server/config/paths.js`.
- Runtime defaults and editable JSON allowlist live in `server/config/runtime.js`.
- Linting configuration lives in `.eslintrc.js`.
- Container packaging lives in `Dockerfile` and `docker-compose.yml`.
- CI automation lives in `.github/workflows/ci.yml`.

## Platform Requirements

**Development:**
- Node.js 18+ and npm per `README.md`.
- Python 3.10+ and `pip` per `README.md`; the Node server expects `python` to be available on `PATH` in `server/core/python.js`.
- FFmpeg available on `PATH`, as required by media scripts and the self-check service in `server/services/system/selfCheck.js`.
- Playwright browser binaries installed for `python/publish/wechat_channels_rpa.py`.
- A reachable ComfyUI instance, configured by `server/config/runtime.js` and optionally overridden in `docker-compose.yml`.

**Production:**
- The deployable app is a single Node service from `server.js` that serves `frontend-dist/` and spawns local Python workers from the same filesystem.
- The included container target is the `trendcut-studio` service in `docker-compose.yml`, exposing port `3001` and mounting `public/presets`, `data/uploads`, `python/publish/browser_profiles`, and `python/publish/publish_jobs.db`.
- ComfyUI, model APIs, Feishu, X, and any publishing credentials remain external services; they are not bundled into the repo.

---

*Stack analysis: 2026-04-17*
