---
title: Fix Dashboard Glass Style Regression
status: complete
completed_at: "2026-06-01T14:35:00+08:00"
---

# Fix Dashboard Glass Style Regression

## Completed

- Removed hard-coded gray local styles from extracted dashboard child components.
- Pointed `LiveTaskQueuePanel`, `DashboardSupportPanels`, and `DashboardSidePanels` back to the shared `AutomationDashboard.css` style system.
- Restored task queue styles into `AutomationDashboard.css` so extracted live queue rows use the original glass variables and gradients.

## Verification

- `npm run build:front`
- `npm test -- --runInBand`
- `git diff --check`
