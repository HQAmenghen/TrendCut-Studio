---
status: resolved
trigger: "User reports a new generated runtime job after backend restart has subtitle display corruption around 26s: correct subtitle card flashes briefly, then a later/wrong card appears for several seconds; another card appears too early and too long before returning to normal."
created: "2026-05-14"
updated: "2026-05-14"
---

# Debug Session: subtitle-overlay-regression-after-restart

## Symptoms

- Expected behavior: standalone runtime job subtitles should display in chronological sync with voice, without later cards appearing early or holding through unrelated speech.
- Actual behavior: In `http://localhost:3001/runtime_jobs/standalone_1778746719077_0019ff67/standalone_output_vertical.mp4?t=1778746889241.8193`, around 26s, when the line starting `他接着补充，` begins, the correct subtitle card flashes briefly, then a later/wrong subtitle card appears for several seconds. Later the card `来自美联储...分量不轻` appears too early and stays too long, then returns to normal when the actual voice reaches it.
- Error messages: No runtime exception reported; corruption is visible in rendered subtitle overlay timing/content.
- Timeline: Reported on 2026-05-14 after backend restart and a newly generated runtime job.
- Reproduction: Inspect current code/artifacts in `C:\Users\PC\Desktop\comfy_panel_demo`, especially `runtime_jobs/standalone_1778746719077_0019ff67`, `subtitles.json`, overlay image/card artifacts, and the standalone generation path after backend restart.

## Current Focus

- hypothesis: reference-authority subtitle alignment accepted an LLM index assignment that mapped a long reference sentence onto a 0.37s ASR segment; FFmpeg then rendered exactly that bad timeline.
- test: Add a regression test where index-style LLM output assigns `他接着补充...巨大潜在市场。` to `[25.79, 26.16]`, then require fallback output to use `[25.79, 30.32]` and contain no unreadable subtitle durations.
- expecting: `validate_reference_authority_llm_results` rejects unreadable index assignments, causing the conservative fallback to rebuild readable subtitle windows.
- next_action: monitor future generated `aiman_subtitles.json` artifacts for `has_unreadable_subtitle_duration` issues; existing generated videos must be regenerated to repair their baked subtitle cards.
- reasoning_checkpoint:
- tdd_checkpoint: Regression test first failed with `[25.79, 26.16]`; after the guard it passes and falls back to conservative grouping.

## Evidence

- 2026-05-14: Runtime artifact path is `data/uploads/runtime_jobs/standalone_1778746719077_0019ff67`, served by `server.js` through `/runtime_jobs/:jobId/standalone_output_vertical.mp4`.
- 2026-05-14: `data/uploads/runtime_jobs/standalone_1778746719077_0019ff67/subtitles.json` contains the corrupted timing: entry 8 is `[25.79, 26.16]` with text `他接着补充，早期参与比特币的人，会创造巨大的潜在市场。`; entry 9 starts immediately at `26.16` with the following sentence; entry 10 starts at `30.32` with `来自美联储前主席之口，分量不轻`.
- 2026-05-14: `public/standalone_output_vertical.mp4.meta.json` points to source task `material_1778744559766_760b7977` with `subtitleSource: "aiman_subtitles.json"`, so the runtime standalone render copied an already bad subtitle timeline from the imported material task.
- 2026-05-14: `projects/material_1778744559766_760b7977/aiman_reference_subtitles.json` has the correct broad reference block `[25.79, 36.93]` for `他接着补充...分量不轻`; `projects/material_1778744559766_760b7977/aiman_subtitles.json` has the bad split `[25.79, 26.16]`.
- 2026-05-14: `python/pipeline/make_vertical_video.py` overlays subtitle card images according to each card's `start` and `end`; no evidence of stale card reuse or FFmpeg reordering. The visible flash is consistent with the 0.37s subtitle window in JSON.
- 2026-05-14: Targeted regression before fix failed: `AssertionError: [25.79, 26.16] != [25.79, 30.32]` in `test_reference_text_authority_rejects_index_assignment_with_unreadable_duration`.

## Eliminated

- Stale subtitle card files: generated `subtitle_cards/subtitle_008.png` through `subtitle_010.png` match the bad timeline count/order, and the renderer builds cards from current `subtitles.json`.
- Runtime route alias issue: request URL uses the immutable runtime job route, while metadata confirms the copied runtime job subtitles already contain the bad timing.
- Renderer split-long behavior: `prepare_subtitles_for_render` preserves ASR timing by default; the corrupted timing exists before render.

## Resolution

- Root cause: the reference-authority LLM validator rejected unreadable durations for group/atom outputs, but the legacy index-assignment path in `validate_reference_authority_llm_results` did not call `has_unreadable_subtitle_duration`. That allowed a model response to assign a long reference sentence to the tiny `[25.79, 26.16]` ASR slice. The later balancing step could not expand it enough without violating neighboring minimum-duration constraints, so the bad window survived into `aiman_subtitles.json` and then into the standalone render.
- Fix: after building each index-assignment output entry in `python/pipeline/run_asr.py`, reject the whole LLM result when `has_unreadable_subtitle_duration(output[-1])` is true. This forces fallback to the deterministic authority splitter, which maps the first sentence to `[25.79, 30.32]` and the remainder to `[30.32, 36.93]`.
- Verification:
  - `python -m unittest python.tests.test_run_asr_filetrans.QwenFiletransAsrTest.test_reference_text_authority_rejects_index_assignment_with_unreadable_duration` passes.
  - `python -m unittest python.tests.test_run_asr_filetrans` passes, 47 tests.
  - `python -m unittest python.tests.test_make_vertical_video` passes, 9 tests.
- Files changed:
  - `python/pipeline/run_asr.py`
  - `python/tests/test_run_asr_filetrans.py`
  - `.planning/debug/subtitle-overlay-regression-after-restart.md`
