---
status: resolved
trigger: "Bottom Chinese subtitle card renders with trailing ellipsis in generated vertical video."
created: 2026-04-24
updated: 2026-04-24
---

## Symptoms

- Expected behavior: Bottom Chinese subtitle text should wrap or resize to show the full sentence when it fits the configured subtitle area.
- Actual behavior: The generated subtitle card contains trailing `...`, for example `就像中本聪把一百万枚比特币留给了宇...`.
- Reproduction: The sentence `就像中本聪把一百万枚比特币留给了宇宙。` passed through `fit_text_adaptive(..., max_lines=2)` renders with `...`.

## Current Focus

- hypothesis: `normalize_wrapped_lines()` merges a short final line back into the previous line and falls back to `fit_single_line()`, which deliberately adds `...`.
- test: Add a focused unit test for Chinese subtitle wrapping with a short tail.
- expecting: The test fails before the fix because the wrapped text contains `...`.
- next_action: resolved

## Evidence

- 2026-04-24: `python/pipeline/make_vertical_video.py` line 110 defines `suffix = "..."`.
- 2026-04-24: Local reproduction shows `fit_text_adaptive()` returns `就像中本聪把一百万枚比特币留给了宇...` for a sentence that fits without content loss across two lines.
- 2026-04-24: Regression test failed before the fix with `就像中本聪把一百万枚比特币留给...`.
- 2026-04-24: After the fix, the same text wraps as two complete lines without `...`.

## Resolution

- root_cause: Short-tail normalization merged the last 1-2 characters back into the previous line and used `fit_single_line()` when the merged line exceeded width, replacing real subtitle content with `...`.
- fix: Preserve the short tail when merging would create an ellipsis, then let two-line rebalancing choose a complete split.
- verification: `python -m unittest python.tests.test_make_vertical_video python.tests.test_material_driven_pipeline python.tests.test_smart_video_composer`
- files_changed: `python/pipeline/make_vertical_video.py`, `python/tests/test_make_vertical_video.py`
