---
status: complete
---

# Quick Task 260520: API Key Failover - Summary

## Completed

- Added key-level failover to Qwen and DeepSeek clients for balance, quota, auth, payment, and rate-limit style failures.
- Updated direct Qwen ASR and Qwen3TTS call paths so they no longer pin only the first configured key.
- Added DeepSeek read/write support in system LLM config, plus frontend controls for global/text provider selection.
- Documented semicolon/comma separated fallback keys in `.env.example`.
- Added focused tests for Qwen and DeepSeek failover behavior.

## Verification

- `python -m unittest discover -s python/tests -p "test_llm_key_failover.py"`
- `python -m py_compile python/qwen_client.py python/deepseek_client.py python/pipeline/run_asr.py python/tts/qwen3_tts.py python/tests/test_llm_key_failover.py`
- `npx jest server/services/system/__tests__/handlersLlmConfig.test.js --runInBand`
- `npm run build:front`

## Notes

- `npm run build` is not defined in this repo; the frontend build script is `npm run build:front`.
- `pytest` is not installed in the active Python environment, so Python verification used `unittest`.
