---
status: resolved
trigger: "Avatar motion source simulation used the wrong idle image and initially produced the wrong aspect ratio."
created: 2026-05-27
updated: 2026-05-27
---

# Debug Session: avatar-motion-landscape-idle-image

## Symptoms

- Expected behavior: idle/static segments use `public/presets/image/毕（保守）.png`.
- Expected behavior: generated motion source video should be horizontal, matching the landscape final composition.
- Actual behavior: the first simulation used `public/presets/image/毕.png`; a follow-up attempt incorrectly forced portrait output.
- Reproduction: run avatar motion simulation with `C:/Users/PC/Downloads/cd33f05bd1b61ea948ffff25592525e5a86a98611548c8a08dfac0701f44537f.wav`.

## Current Focus

- hypothesis: Motion source output dimensions must match the horizontal action templates and final composition: 1280x720.
- test: Set the builder default to 1280x720, rerun with the conservative idle image, and verify manifest plus ffprobe dimensions.
- expecting: Output is 1280x720, using `毕（保守）.png` for idle segments.
- next_action: Hand off the corrected output path.

## Evidence

- 2026-05-27: `right_hand_emphasis/source.mp4` is 1280x720, and avatar preset images are 1672x941.
- 2026-05-27: Corrected run manifest uses `width: 1280`, `height: 720`, `fitMode: cover`, and idle segment source `public/presets/image/毕（保守）.png`.
- 2026-05-27: Verified output `data/tmp/avatar_motion_service_sim_20260527_1750_landscape/avatar_motion_source.mp4` is 1280x720, 25fps, 16.600s.

## Eliminated

## Resolution

- root_cause: Motion source builder defaulted to portrait dimensions while this workflow expects a horizontal motion reference video; the initial simulation also supplied the wrong idle image path.
- fix: Default source builder dimensions now match horizontal output, 1280x720. The builder still uses scale-to-cover for requested target dimensions, and retains optional `--fit-mode contain` for compatibility. Re-ran the simulation with `毕（保守）.png`.
- verification: `python -m unittest python.tests.test_avatar_motion` passed. Preview frames show 16:9 action and idle segments.
- files_changed: `python/pipeline/avatar_motion_source_builder.py`, `python/tests/test_avatar_motion.py`
