# Quick Task 260522-dqg: Speech Narration Normalizer

## Goal

Add a deterministic speech-only narration layer so avatar/TTS generation can read numbers, units, currency, percentages, and dates safely while subtitles and review continue using the original display narration.

## Tasks

1. Extend material-driven avatar narration preparation with rule-based numeric speech normalization.
2. Persist speech-only narration artifacts beside the original narration before Qwen3TTS synthesis.
3. Add focused tests for currency, percentage, date, bill identifier protection, and original narration preservation.

## Verification

- `npm test -- --runInBand server/services/materialDriven/__tests__/avatarWorkflow.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js`
- `npm test -- --runInBand server/services/agent/__tests__/handlers.test.js`
- `npm run lint -- --quiet`
