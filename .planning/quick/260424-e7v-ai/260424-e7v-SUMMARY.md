---
status: complete
quick_id: 260424-e7v
date: 2026-04-24
---

# Quick Task 260424-e7v Summary

## Completed

- Added task-aware cleanup for material-driven AI editing projects under `projects/material_*`.
- Added task-aware cleanup for vertical synthesis jobs across `TaskStore`, `data/uploads/xai_vertical_queue/*`, and `public/xai_vertical_queue/*`.
- Preserved active in-memory vertical queue jobs from cleanup.
- Added dry-run support for task workspace cleanup reports.
- Wired the scheduler to pass `taskStore` and `verticalQueueService` into cleanup.
- Documented task cleanup environment variables in `.env.example`.

## Defaults

- Old task workspaces are cleaned after 7 days.
- Incomplete task workspaces without a usable final video are cleaned after 24 hours.
- Task workspace cleanup is enabled by default and can be disabled with `AUTO_CLEANUP_TASK_WORKSPACES_ENABLED=false`.

## Verification

- `npm test -- server/core/__tests__/cleanup.test.js --runInBand`
- `npm test -- server/core/__tests__/cleanup.test.js server/core/__tests__/taskStore.test.js --runInBand`
- `npm test -- --runInBand`
- `npm run lint -- --quiet`
- `node --check server.js`
- `node --check server/core/cleanup.js`
- `node --check server/services/system/scheduler.js`
