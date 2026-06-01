---
status: complete
completed: 2026-06-01
---

# Reference Authority Subtitle Decoupling Summary

## Completed

- Extracted reference-text-authority subtitle alignment, validation, retry, and debug-event behavior from `python/pipeline/run_asr.py` into `python/pipeline/reference_authority.py`.
- Added `ReferenceAuthorityDeps` so the extracted module receives subtitle helpers and LLM transport through an explicit dependency contract instead of importing the large ASR workflow.
- Kept backward-compatible `run_asr.py` wrapper functions for existing workflow and tests.
- Added focused unit tests for the extracted module covering direct LLM JSON validation, mismatch rejection, and no-LLM normalized reference output.

## Verification

- `python -m unittest python.tests.test_reference_authority python.tests.test_run_asr_filetrans -v`: 40 tests passed.
- `python -m unittest discover -s python/tests -p "test_*.py"`: 192 tests passed.
- `npm test -- --runInBand`: 50 suites, 317 tests passed.
- `npm run lint`: passed.
- `npm run build:front`: passed.
- `npm run audit:prod`: 0 vulnerabilities.
- `npm run check:py-lock`: passed.
- `git diff --check`: no whitespace errors; Windows line-ending warnings only.
