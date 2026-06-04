---
status: fixed
trigger: "Two full-flow concurrent tasks ran, but the first task did not enter vertical synthesis while the second did"
created: 2026-06-03
updated: 2026-06-03
---

## Symptoms

- Expected behavior: Every completed full-flow material task should enqueue/start vertical synthesis.
- Actual behavior: With two concurrent full-flow tasks, only the second task entered vertical synthesis.
- Constraint: Do not use subagents.

## Current Focus

- hypothesis: Completion handoff from material workflow to vertical queue is not triggered for one of the concurrent tasks, or dedupe/keying treats the first handoff as already handled.
- test: Inspect active tasks, taskStore records, queue records, and code paths from material completion to vertical queue enqueue.
- expecting: Identify missing callback/queue insert condition and add regression coverage.
- next_action: done

## Evidence

- `/api/material-driven/active` showed two completed material tasks:
  - `1780449808085_c400d071`, `outputPath=material_1780449808085_c400d071`, completed at `2026-06-03T01:50:27.512Z`.
  - `1780449792821_0be91961`, `outputPath=material_1780449792821_0be91961`, completed at `2026-06-03T02:11:47.834Z`.
- `data/tasks.db` showed `standalone_vertical` only for `material_1780449792821_0be91961`; there was no `standalone_vertical` or `vertical_queue` task for `material_1780449808085_c400d071`.
- The automatic standalone vertical handoff in `frontend/src/App.vue` watched only `[materialDriven.finalVideoUrl, materialDriven.outputPath]`, which represents the current cockpit task, not every concurrently completed background task.
- `materialDriven.activeTasks` already contains completed background tasks from `/api/material-driven/active`, so it can be used as the source for a per-task automatic vertical queue.

## Resolution

- root_cause: Automatic vertical synthesis was keyed to the single current material-driven state. With two full-flow tasks completing independently, one completed task could be visible in `activeTasks` but never become the current `finalVideoUrl/outputPath` handoff target, so no `standalone_vertical` job was created for it.
- fix: Added a frontend auto-vertical queue that scans completed material tasks, deduplicates by `taskDir|videoUrl`, checks existing standalone records/assets, and drains tasks sequentially through `handleMakeVertical`.
- verification:
  - `npm run build:front`
  - `npm test -- server/services/materialDriven/__tests__/workflowScheduler.test.js server/services/materialDriven/__tests__/taskRegistry.test.js server/services/materialDriven/__tests__/taskStoreBridge.test.js --runInBand`
  - `npm run lint -- --quiet`
  - `Invoke-WebRequest http://127.0.0.1:5173/` returned `200`
  - `Invoke-WebRequest http://127.0.0.1:3001/api/material-driven/active` returned `200`
- files_changed:
  - `frontend/src/App.vue`
