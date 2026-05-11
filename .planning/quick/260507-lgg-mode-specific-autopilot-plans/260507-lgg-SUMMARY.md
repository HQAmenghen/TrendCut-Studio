---
status: complete
date: 2026-05-07
---

# Quick Task 260507-lgg Summary

## Completed

- Added `global.autoPilotModeSchedules` so each production mode can keep its own account/time mappings.
- Updated the scheduler to use per-mode schedules when queueing and creating scheduled publish jobs.
- Updated Publish Center so each enabled mode has its own plan editor.
- Updated the automation list to show configured plans before generated publish jobs exist.
- Fixed frontend config updates so object values are preserved instead of stringified.

## Verification

- `npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js`
- `npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js server/services/publish/__tests__/scheduling.test.js`
- `npm run lint`
- `npm run build:front`
