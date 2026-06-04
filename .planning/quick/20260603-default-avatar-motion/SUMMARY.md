---
status: complete
completed: 2026-06-03
---

# Summary

Enabled avatar motion reference generation by default while preserving explicit disable behavior.

## Changes

- Material task defaults now set `avatarMotionEnabled: true`.
- AutoPilot and Agent avatar config paths preserve motion flags and planner fields.
- Publish config defaults and legacy normalization backfill avatar motion enabled.
- Focused tests updated for default motion behavior.

## Verification

- `node -c` on touched server modules
- `npm test -- --runTestsByPath server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/taskState.test.js server/services/system/__tests__/schedulerUtils.test.js --runInBand`
- `npm run lint`
