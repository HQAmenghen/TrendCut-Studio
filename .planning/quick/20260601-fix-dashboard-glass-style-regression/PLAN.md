---
title: Fix Dashboard Glass Style Regression
status: in_progress
created_at: "2026-06-01T14:25:00+08:00"
---

# Fix Dashboard Glass Style Regression

## Objective

Fix the visual regression introduced during dashboard component extraction: extracted panels lost the existing liquid-glass styling and rendered as flat gray blocks.

## Scope

- Remove low-fidelity local styles from extracted dashboard child components.
- Reuse the original `AutomationDashboard.css` style system for extracted panels.
- Verify frontend build and inspect changed style boundaries.

## Verification

- `npm run build:front`
- `npm test -- --runInBand`
- `git diff --check`
