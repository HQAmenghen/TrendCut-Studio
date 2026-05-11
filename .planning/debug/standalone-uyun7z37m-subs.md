---
status: awaiting_human_verify
trigger: "After backend restart and a fresh standalone run, task standalone_uyun7z37m still translated spoken English names/proper nouns and produced duplicate subtitles."
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: standalone-uyun7z37m-subs

## Symptoms

- Expected behavior: Fresh standalone reruns should not repeat subtitle text across adjacent entries.
- Actual behavior: Task `standalone_uyun7z37m` produced duplicate subtitle text across adjacent subtitle cards. User clarified translated common names are acceptable.
- Error messages: None reported; semantic subtitle quality regression.
- Timeline: Reproduced after backend restart and a new standalone run completed at 14:52:34.
- Reproduction: Inspect runtime task `standalone_uyun7z37m` subtitles and rendered output.

## Current Focus

- hypothesis: LLM refinement can expand adjacent reference content into neighboring subtitle rows, and existing duplicate cleanup only handled a narrow location-prefix case.
- test: Add regression coverage for generic adjacent visible-text overlap, including Chinese and English subtitle fields.
- expecting: Final subtitle post-processing trims repeated suffix/prefix overlap before writing JSON and rendering.
- next_action: user verifies the original standalone workflow no longer repeats adjacent subtitle text
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11
  observation: Local artifact lookup did not find literal short id `standalone_uyun7z37m`; latest runtime directory matching the new run is `data/uploads/runtime_jobs/standalone_1778486837539_9e063553`.
- timestamp: 2026-05-11
  observation: `projects/material_1778479785187_f513782a/aiman_subtitles.json` and runtime `subtitles.json` already contained repeated adjacent text before rendering, so the renderer was not the cause.
- timestamp: 2026-05-11
  observation: Duplicate examples included `Consensus` repeated between rows 5 and 6, `想当预言家` repeated between rows 9 and 10, and `埃里克预测错了` repeated between rows 20 and 21.
- timestamp: 2026-05-11
  observation: Existing `trim_reference_duplicate_prefix` only handled a narrow pattern like `...上，`; it did not handle ordinary suffix/prefix overlap.

## Eliminated

- hypothesis: The standalone video renderer duplicated subtitle cards.
  evidence: The duplicate text existed in `subtitles.json` before burning subtitle cards into the video.
- hypothesis: Translated common names are part of the required fix.
  evidence: User clarified common translated names are acceptable; the important bug is subtitle repetition.

## Resolution

- root_cause: Adjacent subtitle rows can inherit overlapping text after LLM refinement/reference alignment. The existing cleanup was too narrow, so ordinary repeated suffix/prefix spans survived to JSON and rendering.
- fix: Added generic duplicate-prefix trimming in `python/pipeline/run_asr.py`. It detects the longest visible-text overlap between previous row suffix and current row prefix, trims the current row, and applies analogous word-level trimming for English text. Existing reference-continuation flow now logs the cleanup as adjacent duplicate prefix removal.
- verification: `python -m unittest python.tests.test_run_asr_filetrans python.tests.test_subtitle_terms python.tests.test_make_vertical_video` passed. Applied the repair to the current material/runtime subtitles, rerendered `public/standalone_output_vertical.mp4`, and visually checked frames at 19.3s and 41.8s.
- files_changed: `python/pipeline/run_asr.py`, `python/tests/test_run_asr_filetrans.py`, `.planning/debug/standalone-uyun7z37m-subs.md`
