# Mid Explain Cutaway Duration Plan

Goal: Raise the material cutaway floor for mid-section `explain` blocks to 6 seconds while still allowing stronger matches to stay longer than 6 seconds.

Architecture: Keep the existing `hook -> explain -> ending` pacing split. Update both the edit planner defaults and the execution-plan fallback logic so `explain` cutaways enforce a dedicated minimum duration without slowing the opening hook path.

Tech Stack: Python 3, unittest.

## Tasks

1. Add planner and pipeline regression tests that lock the new `explain` pacing rules.
2. Update editing-style / planner constraints to expose an `explain`-specific minimum cutaway duration.
3. Update execution-plan generation to apply the same `explain` floor when expanding matched material windows.
4. Run focused Python verification and capture the result in `SUMMARY.md`.
