---
status: investigating
trigger: "当前项目是否支持 2 任务并发；并发合成感觉有问题；实时任务队列 UI 需要删除任务功能；一个任务进程退出后卡住且不能操作"
created: 2026-06-02
updated: 2026-06-02
---

## Symptoms

- Expected behavior: Operators can understand whether synthesis supports two concurrent jobs, and stuck/exited queue tasks can be removed or recovered from the UI.
- Actual behavior: Concurrent synthesis appears unreliable; one task reports process exit and remains stuck in the live queue with no available operation.
- Error messages: Screenshot shows one material/digital-human task marked "需处理" with message "进程退出，代码: 1".
- Timeline: Reported during current stabilization session.
- Reproduction: Start multiple synthesis/material tasks concurrently; observe live queue entries after a subprocess exits.

## Current Focus

- hypothesis: Full material-driven workflow has no global two-job scheduler; only vertical queue has explicit concurrency=2. Failed/interrupted items stayed visible because Live Queue had no cleanup action and vertical queue deletion did not remove taskStore records.
- test: Inspect server queue/progress/task persistence plus frontend live queue rendering and actions; add cleanup endpoints/actions and run focused tests/build.
- expecting: Failed/interrupted terminal records can be removed from the UI without deleting active running work.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-02T00:00:00.000Z
  finding: `server/services/vertical/queue.js` defaults `verticalJobConcurrency = 2`, but `server/routes/materialDriven.js` starts material-driven workflows directly with `pipelineRunner.startInitialPipeline(...)` and stores them in `activeTasks`; no whole-workflow global concurrency queue exists.
- timestamp: 2026-06-02T00:00:00.000Z
  finding: Live Queue items are composed in `frontend/src/components/materialDriven/useLiveTaskQueue.js` from material-driven active tasks, standalone DB tasks, vertical queue jobs, and unified task records.
- timestamp: 2026-06-02T00:00:00.000Z
  finding: `verticalQueueService.remove()` previously deleted memory job/directories only; unified DB task records could make deleted queue jobs reappear.

## Eliminated

## Resolution

- root_cause: Full workflow concurrency was assumed from vertical queue concurrency, but only the vertical queue is explicitly capped at 2. Failed queue entries had no Live Queue delete affordance, and some delete paths did not clear persisted task records.
- fix: Added delete actions for Live Queue terminal/error items, material-driven task removal endpoint, unified task deletion endpoint, and taskStore cleanup for vertical queue removal.
- verification: `npm test -- server/routes/__tests__/system.test.js server/services/vertical/__tests__/queueRemoval.test.js server/services/materialDriven/__tests__/taskRegistry.test.js --runInBand`; `npm run lint -- --quiet`; `npm run build:front`.
- files_changed: server/routes/materialDriven.js, server/routes/system.js, server/services/system/handlers.js, server/services/vertical/queue.js, server.js, frontend/src/components/materialDriven/useLiveTaskQueue.js, frontend/src/components/materialDriven/LiveTaskQueuePanel.vue, frontend/src/components/materialDriven/DashboardSupportPanels.vue, frontend/src/components/AutomationDashboard.vue, frontend/src/components/AutomationDashboard.css, server/routes/__tests__/system.test.js, server/services/vertical/__tests__/queueRemoval.test.js
