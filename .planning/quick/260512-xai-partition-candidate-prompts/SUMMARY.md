# Quick Task Summary: xAI Partition Candidate Prompts

## Completed

- Added built-in xAI candidate prompt profiles for `crypto`, `finance`, `tech`, and `ai`.
- Changed candidate discovery to build prompts from the active partition instead of the fixed crypto-oriented wording.
- Added fallback prompt guidance for custom partitions using the partition label and description.
- Added focused Python unit tests covering AI, finance, and custom partition prompt generation.

## Verification

- `python -m unittest python.tests.test_xai_top10_prompts`
- `npm test -- --runTestsByPath server/services/xai/__tests__/service.test.js --runInBand`
