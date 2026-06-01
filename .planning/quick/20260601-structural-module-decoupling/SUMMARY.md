---
title: Structural Module Decoupling
status: complete
completed_at: "2026-06-01T13:15:00+08:00"
---

# Structural Module Decoupling

## Completed

- Extracted the live task queue panel from `AutomationDashboard.vue` into `frontend/src/components/materialDriven/LiveTaskQueuePanel.vue`.
- Moved Agent publish, schedule, account, login, draft, and confirm handlers into `server/services/agent/publishHandlers.js`.
- Moved scheduler publish/archive, cleanup, and login-check ownership into `schedulerPublish.js`, `schedulerCleanup.js`, and `schedulerLoginCheck.js`.
- Moved material pipeline runtime logging, subprocess execution, async script launch, cache checks, and JSON I/O into `python/pipeline/material_runtime.py`.

## Verification

- `npx jest server/services/agent/__tests__/handlers.test.js server/services/agent/__tests__/helpers.test.js server/services/agent/__tests__/summaries.test.js --runInBand`
- `npx jest server/services/system/__tests__/scheduler.test.js server/services/system/__tests__/schedulerUtils.test.js --runInBand`
- `python -m unittest python.tests.test_material_driven_pipeline -v`
- `npm run build:front`
- `npm test -- --runInBand`
- `python -m unittest discover -s python/tests -p "test_*.py"`
- `npm run lint`
- `npm run audit:prod`
- `npm run check:py-lock`
- `git diff --check`
