# Quick Task Summary: 精简 RunningHub 前端配置并锁定 QwenTTS 合成音频上传

## Result

RunningHub UI now hides backend-managed workflow configuration. RunningHub renders explicitly receive the QwenTTS synthesized speech audio path through `speechAudioPath`, while the selected/uploaded audio remains only the voice reference for QwenTTS.

## What Changed

- Removed RunningHub API key, base URL, workflow ID, node IDs, field names, output node, instance type, run path, queue, and retention controls from the operator UI.
- Stopped sending RunningHub internal config fields from the frontend request and retry payloads.
- Updated avatar renderer dispatch so RunningHub uploads `speechAudioPath` as `audioPath`.
- Updated material-driven route and AutoStart to pass both `speechAudioPath` and `referenceAudioPath` explicitly.
- Added regression tests for the frontend config surface and RunningHub speech audio routing.

## Verification

- `npm test` passed: 25 suites, 129 tests.
- `npm run lint` passed.
- `npm run build:front` passed.
- `git diff --check` passed for touched files.
