---
status: resolved
trigger: "重试步骤6时，Qwen3TTS 音频已经生成，但点击重试当前步骤后又从音频生成开始重试"
created: "2026-05-14"
updated: "2026-05-14"
---

# Debug Session: step6-retry-audio-cache

## Symptoms

- Expected behavior: retry step 6 after RunningHub/数字人渲染失败 should reuse existing `avatar_qwen3tts.wav` when it is present and valid, then retry only avatar render.
- Actual behavior: retry step 6 restarts Qwen3TTS audio synthesis even though logs show `avatar_qwen3tts.wav` was already generated.
- Error messages: RunningHub returned `Request failed with status code 504`; retry then logs Qwen3TTS synthesis again.
- Timeline: observed during material-driven job `material_1778740346024_6bf7ee59` on 2026-05-14.
- Reproduction: run material-driven workflow to step 6, let RunningHub fail after Qwen3TTS completes, click "重试当前步骤".

## Current Focus

- hypothesis: Node-side avatar generation does not check for reusable Qwen3TTS output before invoking `runQwenTts`.
- test: inspect material-driven retry pipeline and avatar generation service; add regression coverage around cached speech audio reuse.
- expecting: retry step 6 can use existing `avatar_qwen3tts.wav` and proceed directly to RunningHub/ComfyUI render.
- next_action: gather initial evidence from `server/services/materialDriven/*` and patch the avatar generation flow.

## Evidence

- timestamp: 2026-05-14
  observation: `server/services/materialDriven/avatarGeneration.js` called `synthesizeQwenTtsSpeech(...)` unconditionally before every avatar render attempt.
- timestamp: 2026-05-14
  observation: `server/services/pipeline/runningHub.js` only returned `taskId` after `waitForOutputs(...)` completed, so timeout/504 during polling lost the recoverable RunningHub task identity at the material-driven layer.
- timestamp: 2026-05-14
  observation: `/api/material-driven/retry/:jobId` retrying step 6 first launched Python step 6, which failed on missing `aiman.mp4` before Node-side auto generation resumed.

## Eliminated

## Resolution

- root_cause: Step 6 treated Qwen3TTS synthesis and RunningHub rendering as one opaque operation. Intermediate artifacts (`avatar_qwen3tts.wav`, RunningHub `taskId`, and completed video URL) were not recorded as resumable checkpoints.
- fix: Added Qwen3TTS audio metadata/cache reuse, persisted RunningHub render state in `avatar_render_state.json`, resumed existing RunningHub tasks by `taskId`, tolerated transient query 504s, reused downloaded `aiman.mp4`, and routed step 6 retry directly into avatar generation when `aiman.mp4` is missing.
- verification: `npx jest server/services/pipeline/__tests__/runningHub.test.js server/services/pipeline/__tests__/avatarRenderer.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/materialDriven/__tests__/retryPlan.test.js server/services/materialDriven/__tests__/qwenTts.test.js --runInBand`; `npm run lint -- --quiet`.
