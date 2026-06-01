---
status: resolved
trigger: "发布信息弹窗中选择小红书账号后，点击创建草稿或创建并发布没有反应。"
created: "2026-05-29T16:15:42+08:00"
updated: "2026-05-29T16:21:01+08:00"
---

# Debug Session: xhs-publish-click-no-response

## Symptoms

- Expected behavior: 在发布信息弹窗选择小红书账号后，点击创建草稿或创建并发布应创建发布任务并启动小红书发布流程，至少给出创建/失败反馈。
- Actual behavior: 点击按钮没有可见反应。
- Error messages: 无可见错误。
- Timeline: 用户在账号管理/小红书登录修复后尝试发布小红书时发现。
- Reproduction: 打开发布信息弹窗，选择小红书账号，点击“创建草稿”或“创建并发布”。

## Current Focus

- hypothesis: 发布弹窗创建/运行链路将失败写入发布中心状态，但弹窗没有渲染这些状态，且 `runPlatform` 不返回启动成功/失败，导致小红书创建或启动失败时表现为按钮无反应。
- test: 检查 `AutomationDashboard.vue` 发布弹窗按钮、`usePublishCenter.createJob/runPlatform` 返回值和后端 job 创建验证。
- expecting: 点击发布按钮能创建任务并运行小红书任务；失败时在弹窗/日志中显示明确错误。
- next_action: complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-29T16:18:00+08:00"
  observation: `AutomationDashboard.vue` 的发布弹窗按钮调用 `createPublishFromComposer()`，该函数只在 `job` 存在时关闭弹窗，但弹窗未显示 `publishCenter.errorState` 或 `creatingStatusMessage`。
- timestamp: "2026-05-29T16:18:30+08:00"
  observation: `usePublishCenter.createJob()` 在后端验证失败时捕获异常并返回 `null`；`runPlatform()` 捕获异常后不返回状态，调用方无法判断小红书 RPA 是否启动成功。
- timestamp: "2026-05-29T16:19:00+08:00"
  observation: 后端 `/api/publish/jobs/:jobId/platforms/:platformKey/start` 已路由到 `startPlatformRpa`，小红书任务创建依赖 `platformSelections.xiaohongshu.accountId` 和 `validateSauTaskConfig`。
- timestamp: "2026-05-29T16:20:30+08:00"
  observation: 增加了小红书 job 创建和 runPlatform 后端测试，确认选择小红书账号会创建 xiaohongshu platform task，并调用 `startPlatformRpa(jobId, 'xiaohongshu', 'draft')`。

## Eliminated

- 发布路由缺失：已确认 `/api/publish/jobs` 与 `/api/publish/jobs/:jobId/platforms/:platformKey/start` 存在。
- 后端不支持小红书启动：已确认 `startPlatformRpa` 处理 `xiaohongshu` 并进入浏览器/RPA 启动路径。

## Resolution

- root_cause: 发布弹窗没有展示 `createJob`/`runPlatform` 写入的错误和等待状态，并且 `runPlatform` 不返回成功/失败，导致小红书创建或启动失败时用户只能看到按钮回到原状，像是无响应。
- fix: 在发布弹窗中显示创建等待提示和错误详情；让 `createJob` 明确返回 `null`、`runPlatform` 返回布尔状态并记录启动成功日志；弹窗在平台启动失败时保持打开，便于用户看到错误。
- verification: `npm test -- --runTestsByPath server/services/publish/__tests__/handlers.test.js`; `npm run build:front`
- files_changed: `frontend/src/components/AutomationDashboard.vue`, `frontend/src/composables/usePublishCenter.js`, `server/services/publish/__tests__/handlers.test.js`, `.planning/debug/xhs-publish-click-no-response.md`
