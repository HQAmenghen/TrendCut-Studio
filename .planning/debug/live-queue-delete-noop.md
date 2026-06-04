---
status: fixed
trigger: "Live Queue 点击删除没有效果；截图中失败的数字人任务和竖屏任务仍留在实时任务队列"
created: 2026-06-03
updated: 2026-06-03
---

## Symptoms

- Expected behavior: Clicking the trash button on failed/queued Live Queue items removes them from the queue.
- Actual behavior: Trash button appears but the item remains visible.
- Error messages: UI shows failed digital-human tasks with "进程退出，代码: 1" and Live Queue badge "2 个需处理".
- Reproduction: Click trash icon on failed Live Queue task.

## Current Focus

- hypothesis: The frontend cleanup payload or backend removal path is incomplete for material-driven active tasks, especially when refreshed tasks are rebuilt from project files or when App-level material activeTasks are not refreshed after deletion.
- test: Inspect cleanup payload creation, deleteLiveTask refresh behavior, material task registry removal, and active material task refresh ownership.
- expecting: Add missing refresh/removal path so deleted items disappear immediately and do not rehydrate from stale source.
- next_action: verify tests/build

## Evidence

- `/api/material-driven/active` returned `1780364987963_0ff59a0f` with `status: "recovered"` and `error: "进程退出，代码: 1"`.
- `/api/system/tasks` still had the matching `material_driven` record `1780364990109_ebzw1i9` as `status: "running"`, with `metadata.error: "进程退出，代码: 1"`.
- The Live Queue UI showed the item as `需处理` because it checks `task.error`, but `taskRegistry.removeTask()` rejected the delete because `recovered` was not considered removable.
- After a successful delete, `AutomationDashboard.vue` refreshed standalone/unified/material lists but did not refresh `materialDriven.refreshActiveTasks()`, leaving the live queue able to render stale active-task state.

## Resolution

- root_cause: Failed recovered material tasks could be rendered as removable by the UI while backend deletion still treated them as non-removable active tasks; taskStore sync also kept errored material records as `running`.
- fix: Treat material tasks with an error signal as failed for deletion, allow recovered records to be cleared, kill stale process handles during removal, sync errored material tasks as `failed`, allow unified cleanup when `metadata.error` exists, and refresh material activeTasks after deletion.
- verification:
  - `npm test -- server/services/materialDriven/__tests__/taskRegistry.test.js server/services/materialDriven/__tests__/taskStoreBridge.test.js --runInBand`
  - `npm run build:front`
  - `npm run lint -- --quiet`
- files_changed:
  - `server/services/materialDriven/taskRegistry.js`
  - `server/services/materialDriven/taskStoreBridge.js`
  - `server/services/system/handlers.js`
  - `frontend/src/components/AutomationDashboard.vue`
  - `server/services/materialDriven/__tests__/taskRegistry.test.js`
  - `server/services/materialDriven/__tests__/taskStoreBridge.test.js`
