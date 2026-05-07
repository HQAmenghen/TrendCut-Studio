---
status: complete
completed: 2026-04-23
---

# Summary

Implemented local Qwen3TTS voice cloning plus speech synthesis for the material-driven avatar path.

## Changes

- Added Python Qwen3TTS script for voice enrollment, non-streaming synthesis, and returned audio URL download.
- Added Node wrapper service for invoking the script and validating the generated audio artifact.
- Updated material-driven auto avatar generation to synthesize speech locally before submitting ComfyUI.
- Rewired `config/workflow_api.json` to consume uploaded speech audio directly from node `6`.
- Removed embedded CosyVoice, prompt-list, text, and audio-combine nodes from the active workflow.
- Added focused tests for workflow rewiring, Qwen3TTS service invocation, and active workflow shape.

## Verification

- `npm test` passed: 14 suites, 96 tests.
- `npm run lint` exited 0; repository still has pre-existing warnings.
- `python -m py_compile python/tts/qwen3_tts.py` passed.
- Live Qwen3TTS smoke test generated `data/uploads/qwen3tts_smoke.wav` from a 20-second trimmed reference.
