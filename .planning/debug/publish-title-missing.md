---
status: resolved
trigger: "发布页没有标题字段；标题应从前面产物文件读取默认填入，导致小红书等需要标题字段的发布任务点击发布后没有反应。"
created: "2026-06-01T09:11:05+08:00"
updated: "2026-06-01T09:26:00+08:00"
---

# Debug Session: publish-title-missing

## Symptoms

- Expected behavior: 发布弹窗/发布任务创建时应带有从前序产物读取的默认标题；小红书等需要标题的平台点击发布后应创建并启动任务，或显示明确错误。
- Actual behavior: 发布页没有标题字段，发布任务缺少标题；点击发布没有可见反应。
- Error messages: 无可见错误。
- Timeline: 当前分支修复发布链路时发现。
- Reproduction: 从前序产物进入发布页，选择小红书等需要标题的平台，点击发布。

## Current Focus

- hypothesis: 前端发布 composer 未读取或未传递前序产物标题，后端平台校验缺少标题时失败；错误反馈路径不够明显。
- test: 检查发布 composer 初始值、任务创建 payload、后端 publish job/config 校验，以及前序产物标题文件读取路径。
- expecting: 发布任务创建 payload 默认包含标题；需要标题的平台可正常创建任务，缺失时展示明确错误。
- next_action: debug complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-06-01T09:13:00+08:00"
  source: "frontend/src/composables/usePublishCenter.js"
  observation: "发布编辑器默认标题原先只取 metadata.suggestedTitle / compactLabel / label，容易忽略前序产物保存的 metadata.title。"
- timestamp: "2026-06-01T09:14:00+08:00"
  source: "server/services/publish/handlers.js"
  observation: "createJob 需要 title，但应在找到 asset 后按前序产物元数据回退；否则空 title 会在创建任务前直接失败。"
- timestamp: "2026-06-01T09:15:00+08:00"
  source: "server/services/publish/platformRpa.js, server/services/publish/publishStore.config.js"
  observation: "小红书自动化启动路径缺少显式标题预检；旧任务或异常 payload 缺标题时需要返回明确错误。"
- timestamp: "2026-06-01T09:24:00+08:00"
  source: "frontend/src/components/AutomationDashboard.vue"
  observation: "发布弹窗已新增可编辑标题输入，并在从成品库或成片交付入口打开时写入默认标题，便于操作者确认小红书必填标题。"
- timestamp: "2026-06-01T09:25:00+08:00"
  source: "server/services/vertical/queue.js"
  observation: "完整 Node 测试暴露参考字幕 ASR 失败后未重试的既有回归；已补齐重试一次并降级普通 ASR 的恢复逻辑。"

## Eliminated

## Resolution

- root_cause: 发布标题默认值链路不一致：前端发布编辑器没有统一读取前序产物 metadata.title，后端 createJob 在尝试 asset 元数据兜底前就可能拒绝空标题，小红书启动路径也缺少标题预检。
- fix: 统一前端/后端标题 fallback 顺序为请求标题、suggestedTitle、metadata.title、suggestedShortTitle、asset label；发布弹窗新增可编辑标题输入；createJob 缺标题时返回带 hint 的 PUBLISH_TITLE_MISSING；小红书任务校验和 RPA 启动前增加标题必填检查。
- verification: "npm test -- --runTestsByPath server/services/publish/__tests__/handlers.test.js; npm test -- --runTestsByPath server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/publish/__tests__/handlers.test.js; npm test; npm run lint; npm run build:front; python -m unittest python.tests.test_avatar_motion python.tests.test_xai_top10_prompts"
- files_changed: "frontend/src/components/AutomationDashboard.vue; frontend/src/composables/usePublishCenter.js; server/services/publish/handlers.js; server/services/publish/platformRpa.js; server/services/publish/publishStore.config.js; server/services/publish/__tests__/handlers.test.js; server/services/publish/__tests__/platformRpa.test.js; server/services/publish/__tests__/publishStore.config.test.js; server/services/vertical/queue.js"
