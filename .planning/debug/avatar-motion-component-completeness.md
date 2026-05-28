---
status: resolved
trigger: "Avatar motion source video cuts gesture components before they return to default pose, causing sudden hand-position jumps."
created: 2026-05-28
updated: 2026-05-28
---

# Debug Session: avatar-motion-component-completeness

## Symptoms

- Expected behavior: every action component plays as authored: default pose -> gesture -> default pose.
- Actual behavior: some segments are cut while the hand is still raised, so the next segment starts with a sudden pose jump.
- Reproduction: build avatar motion source video from the provided WAV simulation and inspect gesture transitions.

## Current Focus

- hypothesis: `build_action_segment()` trims each action component to the motion-plan sentence duration, even when the source action component is longer and has not returned to default.
- test: Use each action template's full source duration by default, rerun simulation, inspect manifest and preview frames.
- expecting: Action segment manifest durations match full template durations where needed, and transitions return to default before the next segment.
- next_action: Patch builder and rerun focused tests/simulation.

## Evidence

- 2026-05-28: Action templates include full default -> action -> default motion. `right_hand_emphasis` has `sourceDuration: 3.12`.
- 2026-05-28: Previous builder used `min(sourceDuration, plannedDuration)`, causing first two action segments to cut at 1.65s and 2.681s.
- 2026-05-28: Fixed manifest `data/tmp/avatar_motion_service_sim_20260528_1025_full_components/avatar_motion_manifest.json` shows action segment durations expanded to at least source duration, with `sourceStart: 0.0`.
- 2026-05-28: Verified output video is 1280x720 and 18.52s; duration increased so full action components can return to default.

## Eliminated

## Resolution

- root_cause: The builder treated action components as arbitrary clips and truncated them to sentence/planned durations, which broke the authored default -> action -> default cycle.
- fix: Action segments now play from `0.0s` and use `max(plannedDuration, sourceDuration)`, only holding the final frame if the planned duration is longer than the template.
- verification: `python -m unittest python.tests.test_avatar_motion` passed. Generated `data/tmp/avatar_motion_service_sim_20260528_1025_full_components/avatar_motion_source.mp4` and previewed start/end frames around the first action segment.
- files_changed: `python/pipeline/avatar_motion_source_builder.py`, `python/tests/test_avatar_motion.py`
