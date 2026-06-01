---
title: Frontend Dashboard Deeper Decoupling
status: complete
completed_at: "2026-06-01T13:40:00+08:00"
---

# Frontend Dashboard Deeper Decoupling

## Completed

- Moved live task queue data assembly out of `AutomationDashboard.vue` into `frontend/src/components/materialDriven/useLiveTaskQueue.js`.
- Extracted the support area into `DashboardSupportPanels.vue`, including live queue, publish queue, health, and activity cards.
- Extracted side summary cards into `DashboardSidePanels.vue`, including asset library, autopilot summary, and account management cards.
- Reduced `AutomationDashboard.vue` from about 5,337 lines to about 4,854 lines while preserving the existing cockpit behavior.

## Verification

- `npm run build:front`
- `npm test -- --runInBand`
- `npm run lint`
- `git diff --check`
