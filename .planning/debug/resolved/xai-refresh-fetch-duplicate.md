---
status: resolved
trigger: "刷新榜单按钮和抓取榜单按钮功能重复；点击刷新也有抓取的进度条，刷新应该清理缓存拿最新的"
created: 2026-06-03
updated: 2026-06-03
---

## Symptoms

- Expected behavior: 点击“刷新榜单”只清理本地缓存并获取最新已存在榜单数据。
- Actual behavior: 点击“刷新榜单”时 UI 也显示抓取榜单的进度条，和“抓取榜单”行为混在一起。
- Error messages: 未提供。
- Timeline: 当前界面复现。
- Reproduction: 在素材接入区点击“刷新榜单”。

## Current Focus

- hypothesis: 前端将抓取中的 `xaiLoading` 与本地刷新中的 `hotListRefreshing` 合并为同一个 busy/progress 状态，导致刷新复用抓取进度条。
- test: 检查 `useXaiTop10.refresh`、`AutomationDashboard.refreshHotList`、`SourceIntakePanel` 的状态和事件传递。
- expecting: 需要新增“强制刷新缓存/拉取结果”语义，并拆分 refresh 与 fetch 的 UI loading/progress。
- next_action: complete
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- 2026-06-03: `frontend/src/components/AutomationDashboard.vue` 的 `refreshHotList()` 优先读取并调用 `props.xai.run`，导致刷新按钮实际启动 xAI 抓榜任务。
- 2026-06-03: `hotListBusy` 将抓榜 `xaiLoading` 与本地刷新状态合并，刷新与抓榜共用进度条显示。

## Eliminated

## Resolution

- root_cause: 刷新按钮事件处理误调用 `xai.run()`，且 UI 未区分抓榜 loading 与结果同步 refreshing。
- fix: `refreshHotList()` 改为只调用 `xai.refresh(false, { force: true })`；`useXaiTop10.refresh` 增加独立 `refreshing` 状态和 cache-buster 参数；进度条仅在 `xaiLoading` 抓榜时显示。
- verification: `npm run build:front` 通过。
- files_changed: `frontend/src/composables/useXaiTop10.js`, `frontend/src/components/AutomationDashboard.vue`, `frontend/src/components/materialDriven/SourceIntakePanel.vue`
