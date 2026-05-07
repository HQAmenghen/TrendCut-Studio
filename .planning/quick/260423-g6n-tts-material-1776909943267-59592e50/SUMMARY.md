---
status: complete
completed: "2026-04-23T11:46:30+08:00"
---

# Quick Task Summary: 调高 TTS 均衡后的 BGM 比例

## Changes

- Tuned `SMART_CLIP_VOICE_BGM_GAP_DB` default from `15.0` to `11.0` so BGM remains audible after quiet TTS is boosted.
- Added a regression test that verifies default voice/BGM mixing keeps BGM within an audible bed range.
- Rerendered `projects/material_1776909943267_59592e50/output_final.mp4` from step 7.

## Verification

- `python -m unittest python.tests.test_smart_video_composer` → OK, 7 tests.
- `python -m unittest discover -s python/tests` → OK, 38 tests.
- Rerender command exited `0`.
- `ffprobe` confirmed new `output_final.mp4` has H.264 video and AAC stereo audio, duration `38.99s`.
- FFmpeg loudnorm reported integrated input loudness `-16.10 LUFS`.
