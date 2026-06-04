---
status: resolved
trigger: "必须强制进行生成参考视频然后输入"
created: 2026-06-03
updated: 2026-06-03
---

# Force Avatar Motion Reference

## Symptoms

- Latest material-driven tasks can have `avatarMotionEnabled: true` while no `avatar_motion_source.mp4` is generated.
- RunningHub render state can contain only audio/image node inputs, with empty `remotePoseName`.
- Existing `aiman.mp4` can let the pipeline continue without regenerating a pose-controlled avatar.

## Current Focus

- hypothesis: Motion generation is optional and existing avatar outputs can bypass motion enforcement.
- test: Make enabled motion required, force avatar regeneration when a cached avatar lacks pose input, and add regression coverage.
- expecting: Future enabled-motion tasks either submit a pose input or fail visibly.
- next_action: complete

## Resolution

- Enabled motion is now required by execution logic.
- New normalized task/config state writes `avatarMotionRequired: true` whenever motion is enabled.
- Step 6 continuation now rejects cached RunningHub avatar output that lacks `avatar_motion_source.mp4` or a pose/video node input, and regenerates the avatar before mixing.
- Verified with targeted Jest tests and ESLint.
