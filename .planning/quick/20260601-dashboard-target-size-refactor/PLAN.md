---
title: Dashboard Target Size Refactor
status: in_progress
created_at: "2026-06-01T13:55:00+08:00"
---

# Dashboard Target Size Refactor

## Objective

Continue splitting `AutomationDashboard.vue` until it is close to the agreed target:

- total: 800-1200 lines
- template: 200-350 lines
- script: 400-700 lines
- main style: layout-only or external/local CSS

## Strategy

- Externalize the remaining scoped dashboard stylesheet.
- Extract large remaining panels and modal-heavy template regions.
- Move orchestration/helper clusters into feature composables where safe.

## Verification

- line-count check for template/script/style sections
- `npm run build:front`
- `npm test -- --runInBand`
- `npm run lint`
- `git diff --check`
