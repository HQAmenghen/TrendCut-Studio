---
title: Docs Architecture Sync
status: in_progress
created_at: "2026-06-01T16:45:00+08:00"
---

# Docs Architecture Sync

## Objective

Lightly update project documentation after the recent publish-center and scheduler boundary refactors.

## Scope

- Keep README stable and concise.
- Synchronize architecture/module docs with new publish-center domain modules and scheduler submodules.
- Add operator-oriented troubleshooting pointers for external dependency failures and logs.

## Verification

- Markdown link/path sanity by local file inspection.
- `npm run lint`
- Commit hook full test run.
