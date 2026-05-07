---
quick_id: 260427-e6i
status: complete
completed: 2026-04-27
---

# Quick Task 260427-e6i Summary

## Outcome

Configured the workspace so non-text chains remain on Qwen while text-processing chains can use Vertex AI Gemini via `TEXT_LLM_PROVIDER=vertex`.

## Current Model Routing

- Global/non-text provider: `LLM_PROVIDER=qwen`
- Text provider: `TEXT_LLM_PROVIDER=vertex`
- Legacy script-text provider: `SCRIPT_LLM_PROVIDER=vertex`
- Vertex AI project/location are read from `VERTEX_AI_PROJECT` and `VERTEX_AI_LOCATION`.

## Changed

- Added `get_text_llm_provider()` in `python/llm_client.py`.
- Routed text tasks through the text provider:
  - title generation
  - text optimization
  - bridge script generation
  - ASR subtitle translation/refinement backfills
  - vertical subtitle translation backfill
  - publish description generation
  - xAI summary translation
  - script rewrite/polish provider fallback
- Kept VLM provider selection tied to global `LLM_PROVIDER`.
- Extended system settings API/UI for `textProvider` and Vertex AI project/location.
- Added regression tests for split routing.

## Verification

- `npm test -- server/services/system/__tests__/handlersLlmConfig.test.js --runInBand`
- `python -m unittest python.tests.test_text_llm_provider python.tests.test_video_vlm_vertex python.tests.test_gemini_client`
- `python -m py_compile ...`
- `npm run lint` (0 errors; existing warnings remain)
- `npm run build:front`
