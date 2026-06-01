---
status: in-progress
created: 2026-05-29
---

# XAI Error Modal

Add a clear animated frontend error dialog for xAI Top10 runs, distinguishing account quota/permission failures from network timeout/connection failures, while preserving existing inline logs.

## Scope

- Extend `useXaiTop10` with classified alert state and dismissal.
- Render one app-level modal so both dashboard and xAI workflows show the same failure.
- Keep the change frontend-focused and reuse existing modal styling patterns.
