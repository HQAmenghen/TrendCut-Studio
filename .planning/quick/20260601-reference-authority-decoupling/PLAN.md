---
status: in_progress
created: 2026-06-01
updated: 2026-06-01
---

# Reference Authority Subtitle Decoupling

## Goal

Continue the stabilization-driven decoupling work by extracting the reference-text-authority subtitle logic out of the oversized `python/pipeline/run_asr.py` module.

## Scope

- Move reference-authority subtitle alignment, validation, retry, and debug-event logic into a focused Python module.
- Keep existing `run_asr.py` public function names available so the current workflow and tests remain compatible.
- Preserve the product decision that reference-authority subtitles are handled by the LLM with minimal local validation, not by a growing rule-heavy fallback system.
- Avoid broader workflow rewrites in this task.

## Verification

- Focused Python tests for the extracted module path.
- Existing ASR-related Python tests.
- Full Python unit suite if focused tests pass.
- Node tests/lint/build checks before commit if no Python blocker appears.
