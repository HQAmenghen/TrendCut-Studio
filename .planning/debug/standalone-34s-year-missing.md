---
status: resolved
trigger: "Newly rendered standalone video omits the spoken/reference year around 34s: narration says 2026年, subtitle disappears there."
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: standalone-34s-year-missing

## Symptoms

- Expected behavior: The subtitle around 34s should include the spoken/reference year term `2026年`.
- Actual behavior: The rendered subtitle at about 34.08s reads `所以，加密世界，`, omitting `2026年`.
- Error messages: None observed; this is a semantic subtitle alignment omission.
- Timeline: Observed in the latest rerender after the prior subtitle term-protection fix.
- Reproduction: Inspect `projects/material_1778479785187_f513782a/aiman_subtitles.json` and the rerendered standalone task `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d` around 34s.

## Current Focus

- hypothesis: ASR missed the numeric/year phrase and the reference-alignment repair only protects prefix/suffix cases, not a numeric term omitted from the middle of an otherwise aligned Chinese sentence.
- test: Add a regression test for repairing `所以，加密世界，` against reference `所以，2026年的加密世界，`.
- expecting: The generic numeric reference repair restores `2026年` with the necessary connector when the surrounding context is high-confidence.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11
  observation: Current subtitle artifact contains `[34.08, 35.92]` with `zh` equal to `所以，加密世界，`, while the reference/narration includes `所以，2026年的加密世界，一句玩笑比十份研报还具传播力。`.
- timestamp: 2026-05-11
  observation: The same missing-year subtitle is present in both `projects/material_1778479785187_f513782a/aiman_subtitles.json` index 17 and `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d/subtitles.json` index 17, so the omission happened before/during subtitle JSON generation rather than in video rendering.
- timestamp: 2026-05-11
  observation: Direct validation against current code returns the input unchanged: `repair_reference_subtitle_text("所以，加密世界，", "所以，2026年的加密世界，一句玩笑比十份研报还具传播力。")` => `所以，加密世界，`.
- timestamp: 2026-05-11
  observation: `repair_numeric_reference_terms` only replaces an already-present shorter numeric token, and `repair_missing_numeric_reference_terms` only appends a missing numeric term when the subtitle visible text is immediately before the term in the reference. The observed subtitle has anchors on both sides of the missing numeric span (`所以` and `加密世界`), so neither path can repair it.
- timestamp: 2026-05-11
  observation: Added generic regression coverage for both a missing year phrase inside a reference clause and a missing money amount inside a reference clause, so the protection is not tied to this task ID or to `2026年`.
- timestamp: 2026-05-11
  observation: Rerunning `run_asr.py` for `projects/material_1778479785187_f513782a` logs `已按参考文本补齐关键数字字幕: 1 条`, and the 34.08-35.92 subtitle becomes `所以，2026年的加密世界，`.

## Eliminated

- hypothesis: The renderer dropped `2026年` while burning subtitles into the standalone video.
  evidence: The runtime `subtitles.json` already omits the year before rendering.

## Resolution

- root_cause: The reference-term repair logic handles truncated numeric values and missing numeric suffix/prefix cases, but not a missing numeric/year span in the middle of an otherwise aligned Chinese subtitle. In this case ASR/alignment produced `所以，加密世界，` while the reference window contains `所以，2026年的加密世界，`.
- fix: Added generic high-confidence numeric span insertion in `python/pipeline/subtitle_terms.py`. It scans numeric reference terms, matches surrounding visible anchors in the current subtitle, and inserts only the missing reference numeric span plus small connector text such as `的` when the surrounding text is contiguous. This runs after LLM/reference alignment and does not special-case a video, task ID, or the literal year.
- verification: `python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video` passed. Rerendered `public/standalone_output_vertical.mp4`, refreshed `public/standalone_output_vertical.mp4.meta.json`, and visually checked frame 34.5s showing `所以，2026年的加密世界，`.
- files_changed: `python/pipeline/subtitle_terms.py`, `python/tests/test_subtitle_terms.py`, `.planning/debug/standalone-34s-year-missing.md`
