---
status: complete
created: 2026-06-02
updated: 2026-06-02
---

# Summary

Implemented complete material-driven workflow concurrency with a global limit of 2.

## Completed

- Added `createMaterialWorkflowScheduler` for full-workflow queueing.
- Routed UI material-driven start, continue, retry, rebuild, and rerender actions through the scheduler.
- Routed Agent and scheduler material-driven continuation/render actions through the scheduler.
- Updated AutoPilot `autoStart` to submit full workflows through the same scheduler.
- Kept queued tasks visible as `queued` / waiting in Live Queue and allowed queued material tasks to be deleted.
- Released scheduler slots on completion, failure, or manual-wait states.
- Added unit tests for scheduler queue/release/remove behavior.

## Verification

- `npm test -- server/services/materialDriven/__tests__/workflowScheduler.test.js server/services/materialDriven/__tests__/pipelineProcess.test.js server/services/materialDriven/__tests__/taskRegistry.test.js server/routes/__tests__/system.test.js server/services/vertical/__tests__/queueRemoval.test.js --runInBand`
- `npm run lint -- --quiet`
- `npm run build:front`
