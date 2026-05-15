---
status: resolved
trigger: "[16:25:12] 已选择素材驱动任务：Hugging Face在Hub上达到了100万个开放数据集的里程碑 🎉，将重新 ASR 打轴并对齐原始文本\n[16:25:15] 建立竖屏进度流：standalone_pcfb4xct4j在进行字幕改造后，新的这个任务后半段出现了严重的对不齐的现象，排查原因然后修复"
created: "2026-05-13T16:25:15+08:00"
updated: "2026-05-14T11:28:58+08:00"
---

# Debug Session: Vertical Subtitle Misalignment

## Symptoms

- expected_behavior: Selecting an existing material-driven task and re-running ASR text alignment should produce subtitles that stay aligned with the source speech for the full vertical task.
- actual_behavior: Task `standalone_pcfb4xct4j` becomes severely misaligned in the latter half after subtitle modification.
- error_messages: No explicit error message provided. Operator log shows the selected material-driven task title and creation of the vertical progress stream.
- timeline: Observed at 2026-05-13 16:25 Asia/Shanghai during a subtitle modification / re-ASR alignment workflow.
- reproduction: Select the material-driven task titled "Hugging Face在Hub上达到了100万个开放数据集的里程碑 🎉", choose the path that re-runs ASR timing and aligns to original text, then create or inspect vertical task `standalone_pcfb4xct4j`.

## Current Focus

- hypothesis: confirmed. ASR timing can start late or cross a material reference boundary, and the reference-authority path previously trusted those ASR boundaries too much.
- test: Rebuild reported xAI vertical queue artifacts `1778715600080_vx3zw0j` and `1778717700059_oj0du4w`; inspect subtitle boundaries around 29.8s and 26.09s.
- expecting: Reference block boundaries clamp late/crossing ASR segments so no large mid-video gap or cross-boundary subtitle remains.
- next_action: resolved.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-13T17:22:02+08:00
  observation: `public/standalone_output_vertical.mp4.meta.json` points to runtime task `data/uploads/runtime_jobs/standalone_1778660715937_5d3b186e` and source task `projects/material_1778655710639_f423e6f5`.
  implication: This is the concrete persisted run behind the reported standalone progress stream.
- timestamp: 2026-05-13T17:22:02+08:00
  observation: `data/uploads/runtime_jobs/standalone_1778660715937_5d3b186e/subtitles.json` and `projects/material_1778655710639_f423e6f5/aiman_subtitles.json` contain the late sequence `数据不再` `[33.92,34.4]`, `是稀` `[34.64,36.16]`, `缺` `[36.24,37.44]`, `资` `[37.6,38.64]`, `源` `[38.96,40.24]`.
  implication: The bad subtitle timeline was already present before vertical rendering; FFmpeg overlay timing was not the source of this late fragmentation.
- timestamp: 2026-05-13T17:22:02+08:00
  observation: `projects/material_1778655710639_f423e6f5/aiman_reference_subtitles.json` has the coherent source phrase `数据不再是稀缺资源` inside the `[25.18,40.08]` reference block.
  implication: The reference text authority had the correct text, but the post-ASR allocation left orphan fragments unmerged.
- timestamp: 2026-05-13T17:22:02+08:00
  observation: Calling `merge_reference_continuations` on the persisted bad subtitles and reference subtitles merges four fragments, producing `数据不再是稀缺资源` over `[33.92,40.24]`.
  implication: The existing cleanup logic already handled this class of continuation, but the new reference-authority path bypassed it.
- timestamp: 2026-05-13T17:33:49+08:00
  observation: The imported material-task refresh path refreshed subtitles from the selected task before copying `output_final.mp4` into the standalone runtime job; ASR input selection previously preferred `aiman.mp4`/`avatar_qwen3tts.wav`, while the rendered standalone video is the final composed `output_final.mp4`.
  implication: Re-ASR for imported material tasks should use the same final-video timeline that will be rendered vertically, with `execution_plan.json` as the preferred reference text source.
- timestamp: 2026-05-13T17:45:30+08:00
  observation: User reran the task at 17:38 and reported captions still mismatch audio from 23s to 40s. The new runtime artifact is `data/uploads/runtime_jobs/standalone_1778665134580_388759df`; its `subtitles.json` has 24 entries and no longer contains the previous `数据不再 / 是稀 / 缺 / 资 / 源` single-character fragments.
  implication: The remaining defect is not just orphan-fragment merging; it is likely reference text assignment across ASR segments or reference block boundaries.
- timestamp: 2026-05-14T11:28:58+08:00
  observation: Follow-up readability review showed the ASR/reference output was now aligned, but renderer `make_vertical_video.py` still called `split_long_subtitles(..., max_chars=24)` by default and logged `Splitting long segment` during sample re-renders.
  implication: Final rendering could still mutate otherwise authoritative ASR subtitle count and time ranges, so the robust fix must make render-time splitting opt-in and keep readable grouping in the ASR/reference-authority layer.

## Eliminated

- hypothesis: Vertical renderer subtitle overlay offsets caused the late-half drift.
  reason: The runtime `subtitles.json` already contains the broken late subtitle entries before `make_vertical_video.py` generates subtitle cards and FFmpeg overlays them.
- hypothesis: The selected material task lacked reference text.
  reason: `aiman_reference_subtitles.json` and `avatar_segments.json` both contain coherent original narration text covering the affected phrase.

## Resolution

- root_cause: The generated `subtitles.json` was already wrong before final FFmpeg rendering. For local material-driven videos, the queue sent `localhost` URLs to cloud Filetrans, which cannot fetch them, then fell back to local ASR. Local ASR sometimes detected speech late or assigned a sentence across the known material reference boundary, producing mid-video gaps or cross-boundary subtitles.
- fix: Local/private URLs are no longer treated as public Filetrans URLs. Material-driven vertical jobs now write reference subtitles from the material task and run ASR with `--reference-text-authority`, where ASR supplies sentence timing but the material script/reference subtitles remain the text authority. The reference-authority allocator clamps the first/last generated subtitle to the known reference block boundaries when ASR starts late, ends early, or crosses into the next block. It also polishes readable display groups inside each reference block by moving leading punctuation backward, merging low-information/proper-noun fragments, and conservatively splitting long entries without crossing block boundaries. Material task imports now prefer final `execution_plan.json` timing before `avatar_segments.json`. The vertical renderer now preserves ASR-provided subtitle timings by default; its old long-subtitle splitting behavior is only available through explicit `--split-long-subtitles`.
- verification: `python -m py_compile python\pipeline\run_asr.py python\pipeline\make_vertical_video.py`; `python -m unittest python.tests.test_run_asr_filetrans`; `python -m unittest python.tests.test_make_vertical_video`; `npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`; `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand`; `npx jest server/services/vertical/__tests__/taskImport.test.js --runInBand`; `npm run lint -- --quiet`. Re-rendered and copied repaired videos to `public/xai_vertical_queue/1778715600080_vx3zw0j/vertical_output.mp4` and `public/xai_vertical_queue/1778717700059_oj0du4w/vertical_output.mp4`; public metadata subtitles now match runtime `subtitles.json`. Health check: first sample has 16 subtitles, no leading punctuation, no low-information fragments, max gap 0.52s, source/output duration 39.24s; second sample has 19 subtitles, no leading punctuation, no low-information fragments, max gap 0.48s, source/output duration 44.79s.
- files_changed: `python/pipeline/run_asr.py`, `python/pipeline/make_vertical_video.py`, `server/services/vertical/queue.js`, `server/services/vertical/standalone.js`, `server/services/vertical/taskImport.js`, `python/tests/test_run_asr_filetrans.py`, `python/tests/test_make_vertical_video.py`, `server/services/vertical/__tests__/queueAsrFileUrl.test.js`, `server/services/vertical/__tests__/standaloneTaskImport.test.js`, `server/services/vertical/__tests__/taskImport.test.js`, `.planning/debug/vertical-subtitle-misalignment.md`.
