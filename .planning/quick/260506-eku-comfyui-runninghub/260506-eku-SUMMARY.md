# Quick Task Summary: 验证原生 ComfyUI 与 RunningHub 两条渲染链路并补齐前端

## Result

RunningHub workflow rendering was verified end to end. The native ComfyUI path remains implemented but could not be verified against the current configured endpoints because the local `.env` ComfyUI URL is a placeholder and the old frontend default endpoint returns 404 for native ComfyUI API probes.

## Test Results

- RunningHub API key presence: configured.
- RunningHub upload: audio and image uploads returned platform file names.
- RunningHub workflow render: task `2051852467053993985` completed with `SUCCESS` and returned an MP4 URL after about 380 seconds.
- Native ComfyUI `.env` endpoint: blocked because `COMFYUI_BASE_URL` points to a placeholder host.
- Native ComfyUI old frontend default endpoint: `/system_stats`, `/queue`, and `/history` returned 404.

## What Changed

- Frontend RunningHub config now exposes the backend-supported fields: audio/image field names, output node ID, instance type, run path, personal queue, and retention seconds.
- RunningHub config test now submits the complete config payload, not only API key/base URL/workflow ID.

## Verification

- `npm test` passed: 24 suites, 126 tests.
- `npm run lint` passed.
- `npm run build:front` passed.
- `git diff --check` passed for touched files.
