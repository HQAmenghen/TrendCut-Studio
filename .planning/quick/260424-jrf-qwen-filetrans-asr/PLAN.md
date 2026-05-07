---
status: in_progress
created: 2026-04-24
quick_id: 260424-jrf
---

# Quick Task 260424-jrf: 接入 Qwen3 ASR Filetrans 句级字幕

Goal: Replace the Qwen ASR path used for news/interview subtitle generation with `qwen3-asr-flash-filetrans` where a public source URL is available, preserving safe fallback for local-only files.

Plan:
1. Add regression tests for Filetrans sentence/word timestamp parsing and queue ASR URL handoff.
2. Implement Filetrans model selection, async task polling, public URL handling, and result normalization in `python/pipeline/run_asr.py`.
3. Pass public source URLs from vertical queue and material-driven workflows into `run_asr.py` where available.
4. Update Qwen ASR default settings to `qwen3-asr-flash-filetrans`.
5. Add optional Aliyun OSS upload support so local extracted audio can receive a signed Filetrans URL.
6. Run focused Python and Jest tests plus lint for touched server files.
