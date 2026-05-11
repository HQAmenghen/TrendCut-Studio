---
status: complete
created_at: 2026-05-08
---

# Quick Task: Remove Publish Review Gate

## Goal

Allow operators to create manual and automatic publish jobs from Publish Center regardless of AI review status.

## Scope

- Remove backend create-job rejection for unreviewed, reviewing, or failed AI review states.
- Remove autopilot publish-job creation skips/regeneration caused only by failed or missing review status.
- Keep review status display and manual review actions available.
- Update copy that implied skipping review was required before publishing.
- Add regression coverage for manual Publish Center creation and autopilot job creation when review did not pass.

## Verification

- `npm test -- --runTestsByPath server/services/publish/__tests__/handlers.test.js server/services/system/__tests__/scheduler.test.js`
- `npx eslint server/services/publish server/services/system --ext .js`
- `npm run build:front`
