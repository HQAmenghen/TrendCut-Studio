---
status: fixing
trigger: "RunningHub 数字人完成后本地队列不刷新不推进；实时任务队列混入托管计划"
created: 2026-05-27
updated: 2026-05-27
---

# Debug: RunningHub Complete Not Advancing

## Symptoms
- RunningHub 数字人远端已合成完毕，本地队列仍显示数字人合成中。
- 页面没有自动进入下一步混剪/成片。
- 实时任务队列混入托管计划，用户期望这里只显示有运行状态/进度条的任务。

## Current Focus
hypothesis: 磁盘恢复只恢复可见状态，不会触发 RunningHub 查询下载和步骤6续跑；前端 liveTaskItems 把 configured AutoPilot plans 当作 waiting tasks 插入。
test: add explicit resume endpoint/action and remove configured plan items from Live Queue.
expecting: recovered RunningHub task can be resumed without duplicate submission, and Live Queue only shows active/recoverable task work.
next_action: patch frontend queue filter and backend resume route.

## Evidence
- `frontend/src/components/AutomationDashboard.vue` liveTaskItems appends `autoPilotAllPlans` with type `托管计划` when `autoPilotEnabled`.
- `server/services/materialDriven/taskRegistry.js` lists recovered RunningHub avatar state from disk, but active GET is side-effect free and does not resume execution.
- `server/services/materialDriven/avatarGeneration.js` can reuse existing RunningHub taskId when `autoGenerateAvatar` is called.
