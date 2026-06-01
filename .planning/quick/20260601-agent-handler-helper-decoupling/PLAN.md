---
status: in_progress
created: 2026-06-01
updated: 2026-06-01
---

# Agent Handler Helper Decoupling

## Goal

Continue decoupling by extracting pure normalization/path/summary helpers from `server/services/agent/handlers.js` into a focused helper module.

## Scope

- Keep the HTTP handler surface and behavior unchanged.
- Move pure helper functions and related constants out of the large handler file.
- Add focused unit tests for helper behavior that is easy to regress.
- Avoid restructuring the entire agent API in this pass.

## Verification

- Focused agent helper tests.
- Existing agent handler tests.
- Full Node test suite, lint, frontend build, audit, Python tests, and Python lock check before commit.
