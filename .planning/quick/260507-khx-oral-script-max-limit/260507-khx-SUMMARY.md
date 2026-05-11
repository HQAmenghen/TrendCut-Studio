---
status: complete
date: 2026-05-07
---

# Quick Task 260507-khx Summary

## Completed

- Added explicit narration character-limit validation in `python/pipeline/skills/script_polisher_skill.py`.
- Over-limit polish outputs now fail validation, forcing the LLM repair loop to retry with a compression prompt until a compliant script is returned.
- Added `SCRIPT_POLISH_MAX_ATTEMPTS` with a default of 12 attempts as a remote-call safety cap.
- When `SCRIPT_POLISH_ENABLED=0`, over-limit drafts are no longer allowed through; they still force an LLM compression rewrite.
- Updated the repair prompt in `python/pipeline/prompt_skills/script_polisher_skill.md` to make over-limit repair a compression rewrite.
- Added tests in `python/tests/test_script_polisher_skill.py` for over-limit retry and disabled-polish forced compression.

## Verification

- Passed: `python -m unittest python.tests.test_script_polisher_skill`
