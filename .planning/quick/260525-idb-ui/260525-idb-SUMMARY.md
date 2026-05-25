---
title: Simplify UI into automation cockpit
status: complete
completed: 2026-05-25
---

# Quick Task 260525-idb Summary

## Result

Collapsed the frontend default experience into a single foolproof automatic production cockpit. The app shell no longer renders the old module navigation or separate workspace pages; the cockpit now owns source intake, one-click production, recovery, output handoff, publish job creation, autopilot status, publish queue, system health, account login checks, and recent activity.

## Changes

- Simplified `frontend/src/App.vue` to render only `AutomationDashboard` and wire existing composables into cockpit actions.
- Expanded `frontend/src/components/AutomationDashboard.vue` into the primary operating surface with local/hot-source intake, automated production status, delivery, autopilot, account, health, and log panels.
- Removed the now-unused `frontend/src/components/TopNavigation.vue`.
- Kept existing backend API paths and production/publish/vertical composables intact.

## Verification

- `npm run build:front`
- Browser visual QA at `http://127.0.0.1:5174/` for desktop default viewport.
- Browser visual QA at mobile viewport `390x844`.
