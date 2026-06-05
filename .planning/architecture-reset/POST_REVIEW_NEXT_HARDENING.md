# Post-Review Next Hardening

## Findings Addressed

- BFF auth still accepted caller-supplied actor headers and made `BFF_API_TOKEN` optional.
- AI, Agent, and Worker BFF controllers still forwarded unvalidated `Record<string, unknown>` bodies.
- New architecture surfaces lacked behavior tests under `apps/` and worker executor tests.
- Worker execution was still adapter-only for every job type.

## Changes

- Changed BFF auth to require token-backed principals by default.
- Added `BFF_API_KEYS` support for token-to-actor/roles/tenant mapping, with `BFF_AUTH_DISABLED=true` as the explicit local-only bypass.
- Added role checks to AI, Agent, and Worker controllers.
- Added BFF DTO validation for AI generation, agent runs/tool calls, and worker jobs/runtime callbacks.
- Added high-risk confirmation checks for dangerous tool calls and publish/RPA worker jobs.
- Added Jest behavior tests for BFF token principal resolution, role checks, AI DTO validation, and high-risk confirmation.
- Changed `script_worker` to execute the legacy Python `ScriptRewriterSkill` in-process and record structured output.
- Added Python behavior test proving `script_worker` invokes the legacy skill path.

## Scope Notes

- This is still not final enterprise SSO. The token principal map is a replaceable boundary for later session/RBAC integration.
- Only `script_worker` moved beyond adapter execution in this pass. Review/render/publish/RPA remain behind the worker contract.

## Code Review

- No blocking findings.
- AI capability, Agent graph, Worker type, high-risk tool, and high-risk worker lists are intentionally explicit. Adding a new BFF capability now requires updating the BFF contract instead of falling through as a transparent proxy.
- `BFF_AUTH_DISABLED=true` grants local development access and must not be enabled in shared deployments.

## Verification

- `npm run check:bff`: passed.
- `npx jest apps/bff/src/__tests__/bff-boundary.test.js --runInBand`: passed.
- `python -m unittest python.tests.test_worker_executor`: passed.
- `npm run check:api`: passed.
- `npm run check:legacy-boundary`: passed.
- `npm test -- --runInBand`: passed, 57 suites and 357 tests.
- `npm run test:py`: passed, 210 tests.
- `python -m compileall -q apps/worker`: passed.
- `npm run ci`: passed; legacy scheduler lint warnings remain warning-only and pre-existing.
