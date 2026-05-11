---
status: resolved
trigger: "Qwen 审核流程中前几步已完成，但标题吸引力阶段发生网络重试后，被 Node 上层提示「审核超时，终止进程」。"
created: 2026-05-08
updated: 2026-05-08
---

# Debug Session: Review Timeout Qwen

## Symptoms
- Expected behavior: Qwen 审核在偶发网络重试后继续完成或返回结构化失败，不应被过早杀掉。
- Actual behavior: 日志显示内容质量、字幕准确性已完成，标题吸引力阶段首次重试后，上层输出「审核超时，终止进程」。
- Evidence: 用户日志中 Python Qwen 单次调用 timeout 为 420s/300s，但进程整体在多阶段审核中超时。
- Reproduction: 使用 Qwen 提供商审核 8.50 MB 本地视频，DashScope 出现 SSL EOF/连接重置/RemoteDisconnected 重试。

## Current Focus
- hypothesis: Node 审核 executor 使用单一 `gemini_timeout` 作为整个 Python 子进程超时，短于 Qwen 多阶段审核和内部重试所需时间。
- test: 检查 `server/services/review/executor.js`、`python/review/ai_video_review.py`、`python/qwen_client.py` 对超时的配置和默认值。
- expecting: 找到上层杀进程的固定 timeout，并改为 provider-aware 的总超时或单独 `review_process_timeout`。
- next_action: targeted tests and lint passed
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence
- 2026-05-08: `server/services/review/executor.js` 使用写死的 `TIMEOUT_MS = 5 * 60 * 1000` 作为整个 Python 审核子进程超时。
- 2026-05-08: Qwen 审核脚本串行执行内容、字幕、标题、剪辑四个模型调用；用户日志中单次 Qwen 调用 timeout 已达 300-420 秒，且支持内部重试。
- 2026-05-08: 上层 5 分钟总超时短于 Qwen 多阶段审核的正常慢网预算，因此在标题阶段网络重试后误杀进程。

## Eliminated

## Resolution
- root_cause: Node 审核 executor 的固定 5 分钟总超时与 Qwen 多阶段、多重试审核流程不匹配。
- fix: 新增 provider-aware 超时解析；Qwen 默认总超时提升到 45 分钟，并按 Qwen text/multimodal 请求预算自动扩展，支持 `AI_REVIEW_QWEN_TIMEOUT_SECONDS` / `AI_REVIEW_TIMEOUT_SECONDS` 显式覆盖。
- verification: `npm test -- --runTestsByPath server/services/review/__tests__/executorTimeout.test.js server/services/review/__tests__/handlersPersistence.test.js`; `npm run lint`
- files_changed: `server/services/review/executor.js`, `server/services/review/__tests__/executorTimeout.test.js`, `.planning/debug/review-timeout-qwen.md`
