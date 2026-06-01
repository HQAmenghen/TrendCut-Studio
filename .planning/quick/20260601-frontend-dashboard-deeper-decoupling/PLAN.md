---
title: Frontend Dashboard Deeper Decoupling
status: in_progress
created_at: "2026-06-01T13:25:00+08:00"
---

# Frontend Dashboard Deeper Decoupling

## Objective

Continue the frontend structural split because extracting only the live queue panel left `AutomationDashboard.vue` too monolithic.

## Scope

- Move live queue data assembly out of `AutomationDashboard.vue` into a feature composable.
- Extract additional dashboard panels from the large template into focused child components.
- Keep behavior and emitted events compatible with the existing cockpit flow.

## Verification

- `npm run build:front`
- `npm run lint`
- `npm test -- --runInBand`
- `git diff --check`
