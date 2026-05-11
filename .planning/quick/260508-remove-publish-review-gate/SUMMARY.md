---
status: complete
completed_at: 2026-05-08
---

# Quick Task 260508 Remove Publish Review Gate Summary

## Completed

- Removed the Publish Center backend gate that rejected job creation when AI review was pending, missing, or failed.
- Removed the autopilot gate that skipped publish job creation or retried generation only because AI review did not pass.
- Kept review UI/status behavior intact, so operators can still review assets without review being a publishing requirement.
- Updated the skip-review confirmation copy so it no longer implies skipping is needed before creating publish tasks.
- Added regression tests for manual job creation and autopilot job creation with failed AI review metadata.

## Verification

- `npm test -- --runTestsByPath server/services/publish/__tests__/handlers.test.js server/services/system/__tests__/scheduler.test.js`
- `npx eslint server/services/publish server/services/system --ext .js`
- `npm run build:front`
