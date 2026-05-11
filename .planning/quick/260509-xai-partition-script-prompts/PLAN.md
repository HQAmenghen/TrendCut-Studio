# Quick Task 260509-xai-partition-script-prompts

## Goal

When AutoPilot creates AI editing + avatar tasks from different xAI Top10 partitions, the narration generation pipeline should automatically adapt its prompt guidance to the source partition instead of always using the same generic vertical-video prompt.

## Scope

- Persist xAI source partition metadata into material-driven task state and `source_post.json`.
- Let Python narration rewriting and polishing skills choose partition-specific prompt addenda.
- Keep unknown/new partitions on the current base prompt with a light adaptive addendum using the partition label.
- Add focused tests for metadata persistence and prompt profile selection.

## Verification

- Run focused Node task-state tests.
- Run focused Python skill tests or direct unittest coverage for the new prompt selection behavior.
- Run lint/build only where touched or where reasonably fast.
