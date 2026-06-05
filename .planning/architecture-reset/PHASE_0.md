# Phase 0: Freeze and Boundary

## Goal

Freeze the legacy Express surface and establish the target architecture contracts before infrastructure work starts.

## Changes

- Added reset architecture guide.
- Created `apps/bff`, `apps/api`, `apps/worker`, `packages/contracts`, and `packages/sdk` skeletons.
- Defined initial `Task`, `TaskStep`, `Artifact`, `AgentRun`, and `ToolCall` JSON Schema.
- Added a legacy route boundary check.

## Review Notes

- This phase intentionally does not move `server.js` or `server/` to avoid breaking the stable legacy runtime.
- The boundary check is conservative: it blocks new route files, while allowing maintenance edits to existing legacy routes.
- FastAPI is designated as owner of canonical task state; NestJS must consume it through the SDK.
- No runtime code path is changed in this phase.
- Risk accepted: `scripts/install-hooks.js` fails inside a Git worktree because `.git/hooks` is not a directory there. Dependencies were already available after `npm install`; the hook installer itself is not part of this phase.
- Existing lint warnings remain in `server/services/system/schedulerAutoPilot.js`; lint exits 0 and these warnings predate the architecture boundary changes.

## Verification

- `npm run check:legacy-boundary`: passed.
- JSON parse for `packages/contracts/task-core.schema.json` and `contracts/python_protocol.schema.json`: passed.
- `npm test -- --runInBand`: 56 suites, 356 tests passed.
- `npm run lint`: passed with existing `schedulerAutoPilot.js` indentation warnings.