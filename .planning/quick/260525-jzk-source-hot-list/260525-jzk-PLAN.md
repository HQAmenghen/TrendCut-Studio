---
title: Source panel hot list operations
status: in_progress
---

# Quick Task 260525-jzk: Source Panel Hot List Operations

## Goal

Make the cockpit Source panel directly usable for hot-list-driven video creation: show richer ranked items, allow partition switching in place, add direct import-to-production actions, support scrolling for more rows, and expose a detailed item view.

## Tasks

1. Update `AutomationDashboard.vue` Source panel to include a partition select, refresh/fetch controls, scrollable hot-list rows, direct import buttons, and detail buttons.
2. Add a detail modal for selected hot-list items using existing result fields.
3. Verify frontend build and browser behavior.

## Verification

- `npm run build:front`
- Browser check at `http://127.0.0.1:5174/`
