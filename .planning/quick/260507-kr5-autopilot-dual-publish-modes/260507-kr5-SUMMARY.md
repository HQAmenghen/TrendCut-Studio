---
status: complete
date: 2026-05-07
---

# Quick Task 260507-kr5 Summary

## Completed

- Added `global.autoPilotPipelineModes` so Auto-Pilot can enable `vertical` and `avatar` together while preserving legacy `pipelineMode`.
- Added Publish Center controls for selecting both modes at the same time.
- Updated scheduler queuing, duplicate checks, and created publish job metadata so each mode creates independent scheduled jobs.
- Kept due scheduled jobs in `scheduled_wait` until WeChat RPA actually starts, allowing same-account contention to retry on the next scheduler tick.
- Added scheduler tests for dual-mode job creation and retryable scheduled contention.

## Verification

- `npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js server/services/publish/__tests__/scheduling.test.js`
- `npm run lint`
- `npm run build:front`
