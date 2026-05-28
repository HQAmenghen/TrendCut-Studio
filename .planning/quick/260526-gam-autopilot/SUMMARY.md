---
status: complete
---

# Quick Task 260526-gam: Improve AutoPilot Success Rate

## Completed

- Added batch-level retries for material segment LLM scoring, defaulting to 5 and configurable with `MATERIAL_SCORING_BATCH_RETRIES`.
- Added AutoPilot avatar slot replacement so failed avatar or avatar-render tasks can try the next ranking item for the same publish slot, defaulting to 5 replacement attempts.
- Added a scheduler regression test that covers a failed avatar source being replaced and still creating a scheduled publish job.

## Verification

- `npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js --runInBand`
- `python -m py_compile python/pipeline/score_material_segments.py`
- `node --check server/services/system/scheduler.js`
- `node --check server/services/system/__tests__/scheduler.test.js`
