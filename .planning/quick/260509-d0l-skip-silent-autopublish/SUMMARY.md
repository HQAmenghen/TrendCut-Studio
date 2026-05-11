---
status: complete
completed_at: 2026-05-09
---

# Quick Task 260509-d0l Summary

## Completed

- Added a vertical queue guard that marks no-transcript/no-audio source videos as `skipped` immediately after ASR.
- Prevented skipped AutoPilot queue jobs from continuing into scheduled publish job creation.
- Added regression coverage for silent queue outputs and scheduler handling of skipped jobs.

## Verification

- `npm test -- --runTestsByPath server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/system/__tests__/scheduler.test.js --runInBand`
- `npm run lint`
