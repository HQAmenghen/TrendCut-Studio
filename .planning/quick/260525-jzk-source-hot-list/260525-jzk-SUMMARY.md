---
title: Source panel hot list operations
status: complete
completed: 2026-05-25
---

# Quick Task 260525-jzk Summary

## Result

Upgraded the cockpit Source panel into a direct hot-list operating area. Operators can now switch partitions from the panel, see richer ranked item details, scroll through available items, import any row directly into production, and open a detailed item modal.

## Changes

- Added an in-panel hot-list partition dropdown.
- Added fetch/refresh controls directly inside the Source panel.
- Replaced compact clickable rows with richer source cards showing rank, author, publish time, resolution, views, likes, reposts, breakout ratio, and hot score.
- Added per-row `导入制作` and `详情` actions.
- Added a detailed hot item modal with metrics, original summary, Chinese summary, import action, and original post link.

## Verification

- `npm run build:front`
- Browser check at `http://127.0.0.1:5174/`: switched Source panel to `加密`, verified hot-list cards, `导入制作` buttons, and `详情` modal.
