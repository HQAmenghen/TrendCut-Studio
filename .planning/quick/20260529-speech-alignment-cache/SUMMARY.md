---
status: complete
completed_at: 2026-05-29
---

# Summary

Implemented reusable final narration ASR alignment artifacts for material-driven avatar generation.

## Completed
- Added cached `speech_alignment.json`, `speech_subtitles.json`, and `speech_alignment_meta.json` generation after Qwen3TTS synthesis.
- Added avatar motion planner support for `speech_alignment.json` and ASR word/phrase anchor timing.
- Preserved existing cutaway-aware action timing and fallback behavior when alignment fails.
- Prioritized `speech_subtitles.json` for vertical task import/reference subtitles so later ASR/subtitle calibration can reuse the same timing authority.
- Added focused Python and Jest coverage.

## Verification
- `python -m py_compile python\pipeline\build_speech_alignment.py python\pipeline\avatar_motion_plan.py`
- `python -m unittest python.tests.test_avatar_motion`
- `npx jest server/services/materialDriven/__tests__/speechAlignment.test.js server/services/materialDriven/__tests__/avatarMotion.test.js server/services/vertical/__tests__/taskImport.test.js --runInBand`
- `npx jest server/services/materialDriven/__tests__/avatarGeneration.test.js --runInBand`
- `npm run lint`
