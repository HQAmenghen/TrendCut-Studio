---
status: resolved
trigger: "Fix public main quality gate failures found during objective project evaluation: Node tests fail, Python tests fail, production dependency audit fails, and runtime/source boundaries need stabilization."
created: 2026-06-01
updated: 2026-06-01
---

## Symptoms

- Expected behavior: `npm run ci` should pass on a clean clone of the public repository.
- Actual behavior: `npm test`, `npm run test:py`, and `npm run audit:prod` fail on a clean clone.
- Error messages:
  - Node: `avatarMotion.test.js` expects `DEFAULT_MOTION_IDLE_IMAGE_PATH`, but the default public preset image is absent in a clean clone.
  - Python: `test_run_asr_filetrans.py` has multiple failures/errors around reference authority subtitle alignment.
  - Security: `npm run audit:prod` reports moderate vulnerabilities in production dependencies.
- Timeline: observed during repository evaluation on 2026-06-01 against public `main`.
- Reproduction: clean clone, `npm ci`, then run `npm test -- --runInBand`, `python -m unittest discover -s python/tests -p "test_*.py"`, and `npm run audit:prod`.

## Current Focus

- hypothesis: Public main has drift between tests, committed resources, and current implementation; quality gates need targeted fixes rather than broad refactors.
- test: Re-run Node tests, targeted Python tests, full Python tests if feasible, frontend build, lint, and production audit after fixes.
- expecting: All required quality gates pass or remaining failures are isolated with clear evidence.
- next_action: complete

## Evidence

- 2026-06-01: `npm test -- --runInBand` passed: 48 suites, 311 tests.
- 2026-06-01: `python -m unittest discover -s python/tests -p "test_*.py"` passed: 186 tests.
- 2026-06-01: `npm run lint` passed.
- 2026-06-01: `npm run build:front` passed.
- 2026-06-01: `npm run audit:prod` passed with 0 vulnerabilities.

## Eliminated

## Resolution

- root_cause: The public quality gates were failing for three independent reasons: a Node test depended on an untracked local idle image, production transitive dependencies had known audit findings, and the reference-authority subtitle path had accumulated brittle deterministic repair/fallback rules that conflicted with the desired LLM-owned subtitle workflow.
- fix: Made the avatar-motion test self-contained, updated production dependency lockfile entries through `npm audit fix --omit=dev`, simplified reference-authority subtitles so LLM output is the primary source of grouping/timing, removed rule-heavy fallback/atom/deterministic repair code, and replaced legacy subtitle-rule tests with direct LLM contract tests.
- verification: Node tests, Python tests, lint, frontend build, and production audit all pass.
- files_changed: `server/services/materialDriven/__tests__/avatarMotion.test.js`, `package-lock.json`, `python/pipeline/run_asr.py`, `python/tests/test_run_asr_filetrans.py`, `.planning/debug/project-quality-gates.md`.
