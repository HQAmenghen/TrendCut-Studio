---
title: Simplify UI into automation cockpit
status: in_progress
---

# Quick Task 260525-idb: Simplify UI Into Automation Cockpit

## Goal

Turn the current multi-page refactor into one simple Chinese automatic production cockpit. Remove redundant top-level page switching from the default experience and keep the operator's necessary actions in a single foolproof flow.

## Tasks

1. Simplify `frontend/src/App.vue` so the app shell renders the cockpit as the primary UI and removes redundant workspace navigation/imports from the first screen.
2. Expand `frontend/src/components/AutomationDashboard.vue` into a complete single-page operating surface: source intake, one-click production, recover/continue, output handoff, autopilot publishing, health, account/publish/review shortcuts, and advanced fallback actions.
3. Tighten responsive styling and verify with `npm run build:front` plus browser screenshots.

## Verification

- `npm run build:front`
- Browser visual check at the local Vite URL for desktop and mobile widths.
