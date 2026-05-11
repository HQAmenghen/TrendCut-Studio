---
status: complete
completed_at: 2026-05-08
---

# Quick Task 260508-jiz Summary

## Completed

- Added explicit per-plan `sourceRanks` so a plan can publish a selected partition's Top1/TopN independently from the plan row number.
- Updated the scheduler to use configured partition rank first and then fall forward within that same partition if the selected item is unusable or duplicated.
- Preserved source rank metadata through vertical queue metadata and generated auto-publish jobs.
- Redesigned the publish-center automation plan rows into a unified card layout with account, partition, partition rank, time, and remove controls.
- Changed legacy/missing source-rank schedules to normalize each existing plan to partition Top1.

## Verification

- `npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js --runInBand`
- `npm run lint`
- `npm run build:front`
