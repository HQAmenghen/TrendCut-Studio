---
status: in_progress
created: 2026-06-01
updated: 2026-06-01
---

# Batch Module Decoupling

## Goal

Perform a broader decoupling pass across the largest modules without changing operator-facing behavior.

## Scope

- Extract stable pure helpers and summary builders from oversized Node services.
- Extract stable Python file/state helpers from large pipeline scripts where the boundary is clear.
- Extract frontend dashboard pure task helpers before splitting Vue presentation blocks.
- Keep public APIs and existing workflow behavior compatible.
- Avoid risky rewrites of LLM prompts, subtitle semantics, RPA flows, or media processing algorithms.

## Verification

- Focused tests for each extracted helper module where practical.
- Full Node test suite.
- Full Python test suite.
- Lint, frontend build, production audit, Python lock check, and diff whitespace check.
