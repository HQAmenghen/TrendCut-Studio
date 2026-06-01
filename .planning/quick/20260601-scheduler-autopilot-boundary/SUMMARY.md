---
title: Scheduler AutoPilot Boundary
status: complete
completed_at: "2026-06-01T16:30:00+08:00"
---

# Summary

Completed the scheduler boundary refactor by extracting the remaining AutoPilot scheduling implementation out of the system scheduler composition root.

## Changes

- Added `server/services/system/schedulerAutoPilot.js` for AutoPilot queue state, xAI ranking trigger, avatar fallback, vertical queue recovery, and publish-job bridge logic.
- Reduced `server/services/system/scheduler.js` from 1182 lines to 121 lines so it now mainly wires logger, publish scheduling, AutoPilot scheduling, cleanup, and login checks.
- Preserved the public scheduler return shape: `recoverAutoPilotVerticalJobs` and `triggerAutoPilotNow`.
- Left existing publish, cleanup, and login scheduler modules intact.

## Verification

- `npm test -- server/services/system/__tests__/scheduler.test.js --runInBand`
- `npm run lint`
- `npm test -- --runInBand`
- `git diff --check` (only Windows LF-to-CRLF warnings)
