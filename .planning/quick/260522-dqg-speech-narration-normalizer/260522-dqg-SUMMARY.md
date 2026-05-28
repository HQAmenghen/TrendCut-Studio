---
status: complete
date: 2026-05-22
---

# Summary

Implemented a DeepSeek-first speech-only narration path for digital human generation, with the rule-based normalizer kept as a fallback.

## Changed

- Added numeric speech fallback normalization in `server/services/materialDriven/avatarWorkflow.js`.
- Added `python/pipeline/normalize_speech_narration.py` to call DeepSeek for context-aware speech narration conversion.
- Wrote `narration_speech.txt` and `narration_speech.json` before Qwen3TTS synthesis in `server/services/materialDriven/avatarGeneration.js`; successful DeepSeek output is used first, rule output is used on DeepSeek failure.
- Kept `narration.json` as the display/subtitle source.
- Added unit tests covering `60.000美元`, `%`, dates, ranges, contextual shorthand such as `12万5`, fallback behavior, and original narration preservation.

## Live DeepSeek Check

- `material_1779409080034_6680e108`: DeepSeek converted `60,000美元`, `12万5`, `6万附近`, `6万底部`, and `6万是坚实底部`.
- `material_1779406920032_cd51e0c7`: DeepSeek converted `150万枚`, `7%`, `3%到7%`, `1000亿美元`, `20年`, and `30%`.
- `material_1779404692222_ab2f2b5a`: DeepSeek made no changes, as expected.

## Verification

- `npm test -- --runInBand server/services/materialDriven/__tests__/avatarWorkflow.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js` passed.
- `python -m unittest python.tests.test_normalize_speech_narration` passed.
- `npm test -- --runInBand server/services/agent/__tests__/handlers.test.js` passed.
- `npm run lint -- --quiet` passed.
