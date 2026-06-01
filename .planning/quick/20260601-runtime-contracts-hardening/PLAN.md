---
status: in_progress
created: 2026-06-01
updated: 2026-06-01
---

# Runtime Contracts Hardening

## Goal

Reduce TrendCut Studio's highest-maintenance runtime risks after the quality-gate repair:

- add a concrete Node/Python protocol contract instead of implicit JSON event shapes;
- make Python dependency installation more reproducible than a floating requirements file;
- improve operator-facing detection of missing external runtime dependencies;
- commit and push the resulting stabilization work.

## Scope

- Keep the current Node + Vue + Python architecture.
- Prefer additive validation and documentation over broad rewrites.
- Do not reintroduce rule-heavy subtitle fallback logic.
- Avoid disruptive decomposition of large Python workflow files until schema boundaries are in place.

## Verification

- Node unit tests.
- Python unit tests.
- Node lint.
- Frontend build.
- Production audit.
- New focused tests for protocol/schema behavior where practical.
