---
status: complete
completed: 2026-06-01
---

# Runtime Contracts Hardening Summary

## Completed

- Added a checked-in Node/Python JSONL protocol schema at `contracts/python_protocol.schema.json`.
- Added Node-side protocol event validation and Python-side emit validation.
- Simplified reference-authority subtitles to rely on direct LLM final subtitle JSON with minimal validation and retries.
- Added `requirements.lock.txt` and `npm run check:py-lock`.
- Updated local CI and GitHub CI to check the Python lock and install from the lock file.
- Added external runtime capability checks for Python package imports, OpenCC, Playwright browser availability, and ComfyUI URL configuration.
- Updated setup documentation to prefer the Python lock file and explain expanded self-check behavior.

## Verification

- `npm test -- --runInBand`: 50 suites, 317 tests passed.
- `python -m unittest discover -s python/tests -p "test_*.py"`: 189 tests passed.
- `npm run lint`: passed.
- `npm run build:front`: passed.
- `npm run audit:prod`: 0 vulnerabilities.
- `npm run check:py-lock`: passed.
- `git diff --check`: no whitespace errors.
