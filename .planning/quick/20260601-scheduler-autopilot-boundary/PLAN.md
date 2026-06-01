---
title: Scheduler AutoPilot Boundary
status: in_progress
created_at: "2026-06-01T16:20:00+08:00"
---

# Scheduler AutoPilot Boundary

## Objective

Continue structural optimization by extracting the remaining AutoPilot-heavy scheduling logic out of `server/services/system/scheduler.js`.

## Scope

- Keep `scheduler.js` as the system scheduler composition root.
- Move AutoPilot queue state, ranking trigger, avatar bridge, vertical queue recovery, and publish-job creation monitoring into a dedicated scheduler module.
- Preserve existing cron behavior, public return shape, logs, and tests.

## Verification

- `npm run lint`
- `npm test -- --runInBand`
- Focused `server/services/system/__tests__/scheduler.test.js`
- `git diff --check`
