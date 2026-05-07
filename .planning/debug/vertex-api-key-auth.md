---
status: resolved
trigger: "用户要使用 Agent Platform / Vertex API key 方式，现在运行时报错：进程退出，代码 1；日志只显示 `[gemini_client] Vertex AI 模式: project=yumeato, location=global`。"
created: "2026-05-06T03:29:00Z"
updated: "2026-05-06T03:49:00Z"
---

# Debug Session: vertex-api-key-auth

## Symptoms

- expected_behavior: "配置 API key 后，Vertex / Agent Platform 调用应使用 API key 鉴权并成功发起模型请求。"
- actual_behavior: "当前运行仍进入 `project/location` 初始化分支，随后 Python 进程以退出码 1 失败。"
- error_messages: "进程退出，代码: 1；`[gemini_client] Vertex AI 模式: project=yumeato, location=global`。"
- timeline: "用户在 2026-05-06 11:29 左右切换到 API key 方式后观察到失败。"
- reproduction: "在系统设置或 `.env` 中启用 Vertex 文本处理，运行会触发 `gemini_client.create_gemini_client(vertex_mode=True)` 的文本处理链路。"

## Current Focus

- hypothesis: "代码只支持 Vertex 标准 ADC/project-location 模式；没有 API key / express-mode 分支，所以即使用户想用 API key，也仍然用 `project=yumeato, location=global` 初始化。"
- test: "构造环境变量验证 `create_gemini_client(vertex_mode=True)` 在 API key 模式下应调用 `genai.Client(vertexai=True, api_key=...)`，并且不同时传 project/location。"
- expecting: "新增或确认一个明确的环境变量开关/API key 字段后，Vertex API key 模式不会读取 project/location，也不会触发 mutually exclusive 或 ADC 认证错误。"
- next_action: "gather initial evidence"
- reasoning_checkpoint: ""
- tdd_checkpoint: ""

## Evidence

- timestamp: "2026-05-06T03:40:00Z"
  observation: "`python/gemini_client.py` always called `genai.Client(vertexai=True, project=..., location=...)` whenever `vertex_mode=True`; no API key/auth-mode branch existed."
- timestamp: "2026-05-06T03:41:00Z"
  observation: "`server/services/system/handlers.js` only exposed and persisted `VERTEX_AI_PROJECT`/`VERTEX_AI_LOCATION`; settings could not save an Agent Platform API key."
- timestamp: "2026-05-06T03:43:00Z"
  observation: "RED tests confirmed API key mode still passed project/location and config handlers dropped `authMode`/`apiKey`."

## Eliminated

## Resolution

- root_cause: "The runtime only supported ADC/project-location Vertex auth, while the user was trying to use Agent Platform API-key auth. Because no auth-mode/API-key settings existed, the process kept initializing Vertex with `project=yumeato, location=global`."
- fix: "Added `VERTEX_AI_AUTH_MODE=api_key` support in `gemini_client.py`, using `VERTEX_AI_API_KEY` with `GOOGLE_API_KEY`/`GEMINI_API_KEY` fallback; added system config read/write and UI fields for Vertex auth mode/API key; set the local `.env` to API-key mode."
- verification: "`python -m unittest python.tests.test_gemini_client`; `npx jest server/services/system/__tests__/handlersLlmConfig.test.js --runInBand`; `python -m unittest python.tests.test_text_llm_provider python.tests.test_video_vlm_vertex`; `npm run lint`; `npm run build:front`; `.env` load smoke verified `genai.Client` receives only `vertexai=True, api_key=...`."
- files_changed: "`python/gemini_client.py`, `python/tests/test_gemini_client.py`, `server/services/system/handlers.js`, `server/services/system/__tests__/handlersLlmConfig.test.js`, `frontend/src/components/SystemSettingsWorkspace.vue`, `.env`, `.planning/debug/vertex-api-key-auth.md`"
