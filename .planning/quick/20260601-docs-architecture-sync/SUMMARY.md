---
title: Docs Architecture Sync
status: complete
completed_at: "2026-06-01T16:55:00+08:00"
---

# Summary

Completed a lightweight documentation update after the recent publish-center and scheduler boundary refactors.

## Changes

- Updated `README.md` with current publish-center domain modules and scheduler module entry points.
- Updated `docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md` with the latest frontend domain and backend scheduler boundaries.
- Updated `docs/MODULE_GUIDE.md` and `docs/PROJECT_STRUCTURE.md` to list the new publish-center and scheduler modules.
- Updated `docs/SETUP_AND_OPERATIONS.md` with first-stop troubleshooting locations and AutoPilot failure checks.
- Updated `docs/README.md` maintenance guidance.

## Verification

- `rg` path sanity check across `README.md` and `docs/`
- `npm run lint`
- `git diff --check` (only Windows LF-to-CRLF warnings)
