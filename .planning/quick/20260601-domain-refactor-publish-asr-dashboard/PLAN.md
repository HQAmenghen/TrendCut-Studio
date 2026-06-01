---
title: Domain Refactor Publish ASR Dashboard
status: in_progress
created_at: "2026-06-01T16:10:00+08:00"
---

# Domain Refactor Publish ASR Dashboard

## Objective

Continue structural refactoring by domain boundaries, not by superficial line-count reductions.

## Target Boundaries

- Publish Center: extract pure account/autopilot/editor helpers from `usePublishCenter.js` into domain modules.
- ASR: continue isolating subtitle strategy domains where safe and covered by tests.
- Dashboard: keep parent component as wiring shell; extract self-contained UI only when state/event surface is coherent.

## Constraints

- Preserve operator-facing behavior.
- Avoid broad reactive-state rewrites in one step.
- Add focused tests for newly extracted pure logic.
- Keep UI styling and liquid glass classes intact.

## Verification

- `npm run build:front`
- `npm run lint`
- `npm test -- --runInBand`
- Focused Python tests if ASR modules are touched.
