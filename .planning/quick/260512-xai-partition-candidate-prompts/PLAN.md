# Quick Task 260512-xai-partition-candidate-prompts

## Goal

Make xAI Top10 candidate discovery use partition-specific prompt guidance instead of the fixed crypto-oriented candidate prompt, so AI/finance/tech/custom partitions get better recall and less domain drift.

## Scope

- Add lightweight partition prompt profiles in `python/xai/run_xai_top10.py`.
- Use the active partition metadata when building candidate prompts.
- Keep existing filter guarantees: 24h window, video-only, verified views >= 15000, max candidates per account.
- Add focused Python tests for built-in and custom partition prompt generation.

## Verification

- Run focused Python unit tests for the new prompt helper.
- Run the existing xAI service test if practical.
