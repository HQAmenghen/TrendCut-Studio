---
status: resolved
trigger: "C:\\Users\\PC\\Desktop\\comfy_panel_demo\\projects\\material_1778489248761_063acea5 latest task has no inserted source-material footage in the generated development/output video; investigate root cause, fix it, and prevent recurrence."
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: latest-material-no-cutaways

## Symptoms

- Expected behavior: material-driven generation should insert source-material/cutaway footage into the generated video when suitable material segments are available.
- Actual behavior: latest task `projects/material_1778489248761_063acea5` produced an output video that appears to have no inserted material footage again.
- Error messages: none reported by user yet; task appears to have completed and produced `output_final.mp4`.
- Timeline: observed on the latest material-driven task on 2026-05-11.
- Reproduction: inspect or rerun material-driven task `material_1778489248761_063acea5` using the current code path.

## Current Focus

- hypothesis: cutaway/material segment selection exists but is being dropped or rendered invisibly during composition.
- test: inspect task artifacts, composition code, and relevant tests.
- expecting: identify the first point where selected material clips disappear from the final output path.
- next_action: resolved
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11 17:36 Asia/Shanghai
  observation: `execution_plan.json` contained two `material_cutaway` segments, but the first block in `edit_plan.json` had `type: avatar_talk` with `visual_layout: cutaway_silent`.
- timestamp: 2026-05-11 17:39 Asia/Shanghai
  observation: Final video frames at 22s and 33s were source material, proving later cutaways were present; user clarified the failure is the opening rule specifically.
- timestamp: 2026-05-11 17:44 Asia/Shanghai
  observation: After code fix, rebuilding the reported task produced first execution segment `type: material_cutaway`, `start_time: 0.0`, `material_cut_start: 4.08`, `duration: 8.0`.
- timestamp: 2026-05-11 17:48 Asia/Shanghai
  observation: Reported task was rerendered successfully; extracted frame at 1s shows source material/Buffett footage, not the avatar.

## Eliminated

- hypothesis: no material cutaways were selected at all.
  reason: `clip_matches.json` and the original execution plan had selected material cutaways later in the timeline.
- hypothesis: MoviePy composition dropped all material clips.
  reason: extracted frames from the original output showed material footage at later timestamps.

## Resolution

- root_cause: `build_execution_plan_from_edit_plan()` routed any `type: avatar_talk` block through the avatar branch before honoring `visual_layout: cutaway_silent`; the opening rule was present but overridden by the block type. A secondary metadata issue also let source account handles act as speaker entities for visible speakers.
- fix: execution-plan generation now treats cutaway layouts as authoritative even when block type is `avatar_talk`; source-handle-only person fallback is no longer applied to visible speaker footage.
- verification: focused material-driven pipeline tests passed; clip selector and score material segment tests passed; the reported task was rebuilt/rerendered and frame extraction verified source material at 1s.
- files_changed: python/pipeline/run_material_driven.py, python/pipeline/score_material_segments.py, python/tests/test_material_driven_pipeline.py, projects/material_1778489248761_063acea5/execution_plan.json, projects/material_1778489248761_063acea5/output_final.mp4
