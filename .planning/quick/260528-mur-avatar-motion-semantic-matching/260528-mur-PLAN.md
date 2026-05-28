# Quick Task 260528-mur: 升级数字人动作规划为语义匹配

## Goal

Replace the overly brittle keyword-only avatar motion planner with a semantic action matcher that can use the current action component library more richly without frequent repetition.

## Tasks

1. Extend `python/pipeline/avatar_motion_plan.py` so it can load action component metadata and score sentences against action semantic profiles.
2. Keep deterministic fallback behavior: local sparse semantic matching must work without an LLM or embedding API.
3. Preserve motion pacing constraints: avoid overly frequent gestures, avoid repeating the same action, and fall back to idle when confidence is low.
4. Add tests that verify a realistic narration maps to multiple existing action components.

## Verification

- `python -m unittest python.tests.test_avatar_motion`
- Generate a real task motion plan and confirm multiple action IDs are selected.
