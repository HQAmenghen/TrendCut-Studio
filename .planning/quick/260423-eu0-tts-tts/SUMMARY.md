---
status: complete
completed: "2026-04-23T10:44:30+08:00"
---

# Quick Task Summary: TTS 与 BGM 音量均衡

## Changes

- Updated `python/pipeline/smart_video_composer.py` so automatic BGM mixing boosts quiet main voice audio toward a target LUFS before computing BGM ducking.
- Allowed negative LUFS environment overrides for mix settings:
  - `SMART_CLIP_BGM_MIN_LUFS`
  - `SMART_CLIP_BGM_MAX_LUFS`
  - `SMART_CLIP_VOICE_TARGET_LUFS`
- Added `SMART_CLIP_VOICE_MAX_BOOST_DB` to cap automatic voice boost, defaulting to `14.0`.
- Relaxed the default BGM floor from `-27.0` to `-34.0` LUFS so weak TTS can still force BGM lower.

## Verification

- `python -m unittest python.tests.test_smart_video_composer` → OK, 6 tests.
- `python -m unittest discover -s python/tests` → OK, 37 tests.
