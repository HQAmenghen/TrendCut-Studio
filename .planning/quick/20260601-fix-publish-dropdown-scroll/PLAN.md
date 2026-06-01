---
title: Fix Publish Dropdown Scroll
status: completed
created_at: "2026-06-01T14:45:00+08:00"
---

# Fix Publish Dropdown Scroll

## Objective

Fix the publish composer account dropdown so the full account list can be reached and scrolled inside the modal.

## Scope

- Adjust only dropdown/modal overflow and z-index behavior.
- Preserve existing glass styling.
- Verify frontend build.

## Verification

- `npm run build:front`
- `git diff --check`
