---
status: complete
completed: 2026-06-03
---

# Summary

Forced avatar motion JSON planning to use DeepSeek V4 Flash only.

## Changes

- Removed avatar motion LLM provider/model parameters from Node config propagation.
- Hardcoded `deepseek` and `deepseek-v4-flash` in the Python motion planner.
- Updated focused tests to assert no provider/model CLI override is passed.

## Verification

- `npm test -- --runInBand server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/materialDriven/__tests__/pipelineProcess.test.js server/services/materialDriven/__tests__/taskState.test.js server/services/pipeline/__tests__/avatarRenderer.test.js server/services/pipeline/__tests__/runningHub.test.js server/services/system/__tests__/schedulerUtils.test.js`
- `python -m unittest python.tests.test_avatar_motion`
- `npx eslint ...`
- Real flow smoke: planner `deepseek/deepseek-v4-flash`, non-empty `avatar_motion_source.mp4`, renderer `posePath` matched the generated reference video.
