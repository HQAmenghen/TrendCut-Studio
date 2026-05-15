---
status: resolved
trigger: "C:\\Users\\PC\\Desktop\\comfy_panel_demo\\projects\\material_1778543460029_582511b3这个任务和对应的竖屏任务，在一开头的人名就没有对上，竖屏合成的字幕识别翻译错了，大模型也没有参考口播稿进行矫正，排查原因，然后修复，防止后续同类问题发生"
created: 2026-05-12
updated: 2026-05-12
---

# Debug Session: material-vertical-name-mismatch

## Symptoms

- expected_behavior: Material-driven task and corresponding vertical synthesis task should keep the opening person's name consistent with source/script, and subtitle correction should reference the narration/oral script before final vertical synthesis.
- actual_behavior: At the beginning of the generated vertical video, the person's name does not match. Vertical synthesis subtitle recognition/translation is wrong, and the LLM correction step did not use the oral script to fix it.
- error_messages: No explicit runtime error reported.
- timeline: Observed for project `projects/material_1778543460029_582511b3` and its corresponding vertical task.
- reproduction: Inspect that material project, locate the corresponding vertical synthesis task/artifacts, compare opening script/source text against recognized/translated subtitles and correction prompts/results.

## Current Focus

- hypothesis: The vertical queue path omitted material-driven narration/reference subtitles, so `run_asr.py` refined ASR output without the oral script context that standalone/import flows already provide.
- test: Compare material artifacts with corresponding vertical task, inspect queue ASR invocation, add reference-subtitle handoff, and run focused regression plus lint.
- expecting: Material-driven avatar queue jobs pass `--reference-subtitles-json` sourced from material task subtitle/script artifacts.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-12T11:53:42+08:00
  observation: Corresponding vertical task is `1778545440035_5q2u6ja`, found in `data/tasks.db` as `type=vertical_queue`, `sourceType=material_driven_avatar`, `postId=2053883942063980628`, and `videoUrl=http://localhost:3001/projects/material_1778543460029_582511b3/output_final.mp4?v=1778545406661`.
  supports: The reported vertical output is directly linked to the named material task.
- timestamp: 2026-05-12T11:53:42+08:00
  observation: Material narration starts `Vivek4real 刚刚爆料...`; material `avatar_segments.json` and `execution_plan.json` both preserve `Vivek4real` and `凯文·沃什`. Vertical `subtitles.json` starts with `549真实`, then `刚刚爆料`.
  supports: The divergence is introduced during vertical ASR/subtitle generation, not during material narration generation.
- timestamp: 2026-05-12T11:53:42+08:00
  observation: Vertical task log shows `run_asr.py` fell back from Qwen Filetrans to Whisper, then ran LLM subtitle completion/refinement; no `--reference-subtitles-json` or reference source was logged. Standalone material import path already passes reference subtitles.
  supports: Queue ASR lacked oral-script reference context, so the model had no deterministic path to correct `549真实` back to `Vivek4real`.

## Eliminated

- hypothesis: The material-driven narration generated the wrong opening person/name.
  reason: `narration.txt`, `avatar_segments.json`, and `execution_plan.json` all contain `Vivek4real` at the opening.
- hypothesis: The corresponding vertical task could not be located.
  reason: `data/tasks.db` and vertical metadata identify task `1778545440035_5q2u6ja` with matching source post id and material output URL.

## Resolution

- root_cause: `server/services/vertical/queue.js` invoked `run_asr.py` with translation/refinement enabled but did not pass material-driven oral script/reference subtitles for `material_driven_avatar` jobs, unlike the standalone import path. Whisper misrecognized `Vivek4real` as `549真实`, and refinement preserved the bad ASR text because it lacked the source narration as reference.
- fix: Queue jobs now resolve material project references from `sourceTaskDir` or `/projects/material_.../output_final.mp4` URLs, write `reference_subtitles.json` from `aiman_subtitles.json`, `avatar_segments.json`, `execution_plan.json`, or `narration.json`, and pass it to `run_asr.py --reference-subtitles-json`. Autopilot avatar handoff now also records `sourceTaskDir`.
- verification: `npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`; `npm run lint`.
- files_changed: `server/services/vertical/queue.js`, `server/services/vertical/__tests__/queueAsrFileUrl.test.js`, `server/services/system/scheduler.js`, `server.js`.
