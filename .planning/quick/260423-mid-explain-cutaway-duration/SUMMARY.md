---
status: complete
date: 2026-04-23
---

# Quick Task 260423-mid-explain-cutaway-duration Summary

## Task

把素材剪辑方案改成“中间 `explain` 段优先 6 秒，且遇到更强匹配时允许更长”，不要拖慢 `hook` 开场节奏。

## Changes

- Updated `python/pipeline/skills/editing_style_skill.py` to publish `min_explain_clip_sec = 6.0` across the material-driven style presets.
- Updated `python/pipeline/planner/edit_planner.py` so `evidence_clip` duration selection now treats `hook` and `explain` separately: `hook` keeps the existing floor, while `explain` gets a dedicated 6-second minimum and still preserves longer recommended durations.
- Updated `python/pipeline/run_material_driven.py` to apply the same `explain`-specific floor when translating `edit_plan.json` into `execution_plan.json`, so short matched source windows are expanded to 6 seconds instead of falling back to the old 4-second rule.
- Updated `python/pipeline/planner/schemas.py` default constraints and added focused regression coverage in `python/tests/test_edit_planner.py` and `python/tests/test_material_driven_pipeline.py`.

## Verification

- `python -m unittest python.tests.test_edit_planner -v`
- `python -m unittest python.tests.test_material_driven_pipeline -v`
