---
status: in_progress
date: 2026-05-07
branch: codex/directory-boundary-cleanup
---

# Directory Boundary Cleanup

## Goal

Clean repository directory boundaries without changing operator workflows or deleting local runtime data that may still be useful on this machine.

## Scope

- Remove tracked runtime artifacts from git index while leaving local files in place where they still exist.
- Keep source modules under `server/`, `frontend/`, `python/`, `config/`, `scripts/`, `docs/`, and `.planning/`.
- Keep published presets under `public/presets/`.
- Remove local-only IDE and machine settings from version control.
- Keep existing branch/worktree changes intact and avoid unrelated refactors.

## Verification

- Confirm tracked runtime artifact patterns are cleared from `git ls-files`.
- Run the existing lint/test/build checks used by the current stabilization branch.
