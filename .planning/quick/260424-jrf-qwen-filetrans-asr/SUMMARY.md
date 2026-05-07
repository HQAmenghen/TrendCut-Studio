---
status: complete
completed: 2026-04-24
quick_id: 260424-jrf
---

# Summary

接入 `qwen3-asr-flash-filetrans` 作为新闻/访谈类 ASR 优先路径，并保留本地文件降级能力。补充 Aliyun OSS 临时上传支持后，本地抽取的音频也可以生成签名 URL 进入 Filetrans。

## Changes

- Added DashScope Filetrans submit/poll/result parsing in `python/pipeline/run_asr.py`.
- Parsed Filetrans `transcripts[].sentences[]` millisecond timestamps into subtitle segments instead of estimating times by character ratio.
- Enabled `enable_words=true` for Filetrans requests so sentence segmentation can use VAD plus punctuation.
- Added `--file-url` to `run_asr.py`; vertical queue and material-driven URL imports now pass public source URLs when available.
- Added optional OSS upload for local-only audio using `ALIYUN_OSS_*` settings, then signed URL handoff to Filetrans.
- Fixed Filetrans result download so DashScope authorization headers are not forwarded to the signed OSS result URL.
- Kept safe fallback to legacy `qwen3-asr-flash` for local-only files without public URLs or usable OSS settings.
- Updated Qwen ASR defaults in backend settings and frontend settings UI to `qwen3-asr-flash-filetrans`.
- Added `oss2` to Python pipeline requirements.

## Verification

- `python -m unittest python.tests.test_run_asr_filetrans python.tests.test_material_driven_pipeline`
- `npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/__tests__/taskImport.test.js --runInBand`
- `python -m py_compile python/pipeline/run_asr.py python/pipeline/run_material_driven.py python/tests/test_run_asr_filetrans.py python/tests/test_material_driven_pipeline.py`
- `npx eslint server/services/vertical/queue.js server/services/system/handlers.js server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js --ext .js`
- `python -c "import oss2; print('oss2 installed')"`
- `npm run build:front`
