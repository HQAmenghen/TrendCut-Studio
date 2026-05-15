---
status: complete
completed_at: 2026-05-15
---

# Quick Task 260515-d5l Summary

## Completed

- Added speech-safe bill identifier normalization for avatar narration so `HR 3000,633` is no longer read as a large numeric value by Qwen3TTS.
- Wired avatar generation to use the speech-safe narration text for TTS synthesis and cache signatures.
- Added regression coverage for bill identifiers, ordinary comma-separated numbers, and avatar generation input text.
- Added prompt guardrails to the script rewriter and script polisher prompts so future narration generation avoids comma-merged bill identifiers.
- Tightened prompt guardrails so proprietary numeric identifiers are written for digit-by-digit TTS reading without quantity units such as 千/万/百万.

## Verification

- `npx jest server/services/materialDriven/__tests__/avatarWorkflow.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js --runInBand`
- `npm run lint`
