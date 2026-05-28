---
title: Hot source picker first
status: in_progress
---

# Quick Task 260525-jny: Hot Source Picker First

## Goal

Fix the cockpit source selection UX so the main "choose material" path opens a hot-list picker first, with local file upload as a secondary fallback.

## Tasks

1. Update `AutomationDashboard.vue` source controls so the primary button opens an in-page hot material picker instead of the OS file picker.
2. Keep local upload available, but label it explicitly as local upload and de-emphasize it.
3. Verify build and browser behavior.

## Verification

- `npm run build:front`
- Browser check at `http://127.0.0.1:5174/`
