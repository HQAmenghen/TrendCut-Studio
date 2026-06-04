---
status: in_progress
created: 2026-06-03
---

# Avatar Motion DeepSeek V4 Flash

## Goal

Force the avatar motion JSON decision step to use DeepSeek V4 Flash only.

## Scope

- Remove avatar motion LLM provider/model parameters from Node config propagation.
- Hardcode `deepseek` / `deepseek-v4-flash` in `python/pipeline/avatar_motion_plan.py`.
- Update focused tests and run a real flow smoke test.
