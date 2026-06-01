---
title: Structural Module Decoupling
status: in_progress
created_at: "2026-06-01T10:30:00+08:00"
---

# Structural Module Decoupling

## Objective

Make the current decoupling visibly structural across the four remaining oversized areas:

- Extract the live task queue out of `AutomationDashboard.vue` into a real Vue child component.
- Move Agent publish/account/login handlers out of the monolithic Agent handler module into a domain handler factory.
- Move scheduler publish/archive, cleanup, and login-check timer ownership into scheduler submodules.
- Move material pipeline runtime concerns out of `run_material_driven.py` into a reusable runtime mixin.

## Constraints

- Preserve operator-facing behavior and existing API response envelopes.
- Keep subtitle processing LLM-led; do not add rule-heavy subtitle repair logic.
- Keep all changes narrow to structural separation and related imports/tests.
- Verify with focused tests first, then full lint/build/test checks before commit and push.

## Verification Plan

- `npm test -- --runInBand`
- `python -m unittest discover -s python/tests -p "test_*.py"`
- `npm run lint`
- `npm run build:front`
- `npm run audit:prod`
- `npm run check:py-lock`
- `git diff --check`
