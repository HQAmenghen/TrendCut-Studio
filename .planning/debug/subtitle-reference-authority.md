---
status: resolved
trigger: "按照“ASR 只提供时间轴、原口播稿/参考字幕提供唯一字幕文本”的路线修复素材驱动导入竖屏队列字幕反复误译问题"
created: "2026-05-13"
updated: "2026-05-13"
---

# Debug Session: subtitle-reference-authority

## Symptoms

- expected: 素材驱动数字人口播导入竖屏队列时，重新 ASR 只能用于打轴，最终字幕文本必须来自原口播稿/参考字幕，数字和专有名词不能被 ASR 或大模型覆盖。
- actual: `standalone_pzlorqfrwi` 对应任务中，正确参考文案 `支持5000万加密持有者...` 被输出为 `支持50 million00万`。
- error_messages: 无运行时异常，属于字幕内容错误。
- timeline: 多个视频反复出现，包括 `$200 million` 被截断、`Fed` 被混淆、`Claude AI` 专有名词被翻译，以及本次 `50 million/5000万` 混合。
- reproduction: 从素材驱动任务导入竖屏队列，日志显示“将重新 ASR 打轴并对齐原始文本”后，`refreshImportedAvatarSubtitles()` 调用 `run_asr.py --refine-subtitles --reference-subtitles-json`，生成错误的 `aiman_subtitles.json`。

## Current Focus

- hypothesis: confirmed. 当前实现把参考字幕当成 reference 而非 source of truth，LLM/修复函数仍可改写最终字幕文本。
- test: `run_asr.py` 增加 reference-authority 行为回归，并为 `standalone.js` / `queue.js` 断言素材驱动导入时启用该模式。
- expecting: 导入素材驱动数字人口播后，输出字幕文本来自参考口播稿，ASR 只决定时间轴，不会产生 `50 million00万`。
- next_action: resolved.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-13; source: `projects/material_1778652443633_35b18f4f/aiman_reference_subtitles.json`; observation: 正确文本为 `特朗普公开承诺：支持5000万加密持有者自我托管权...`
- timestamp: 2026-05-13; source: `projects/material_1778652443633_35b18f4f/aiman_subtitles.json`; observation: 错误文本为 `特朗普公开承诺：支持50 million00万`
- timestamp: 2026-05-13; source: `server/services/vertical/standalone.js`; observation: `refreshImportedAvatarSubtitles()` 调用 `run_asr.py` 时使用 `--refine-subtitles` 和 `--reference-subtitles-json`。

## Eliminated

- hypothesis: 竖屏渲染阶段把字幕画错。
  reason: 坏文本在 `aiman_subtitles.json` 和 `aiman_audio.json` 已经出现，早于 runtime copy/render。

## Resolution

- root_cause: 素材驱动数字人口播导入竖屏时，`refreshImportedAvatarSubtitles()` / 队列 ASR 路径调用 `run_asr.py --reference-subtitles-json --refine-subtitles`。参考字幕只作为 LLM 对齐/精修提示，最终 `zh/text` 仍由 LLM/ASR 修复链生成，导致 `50 million` 与参考 `5000万` 被混合为 `50 million00万`。
- fix: 新增 `run_asr.py --reference-text-authority` 模式。该模式仍使用新 ASR 句段时间轴，但最终字幕文本必须来自参考字幕/口播稿。LLM 只允许返回参考稿连续子串分配，校验要求所有输出逐字来自 `reference_text` 且拼接后覆盖原文；校验失败则回退保守规则，且跳过后续 LLM 精修和术语修补。素材驱动 standalone 导入和 vertical queue 有参考口播稿时均启用该模式。
- verification: `python -m unittest python.tests.test_run_asr_filetrans python.tests.test_subtitle_terms`; `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`; `npx eslint server/services/vertical/standalone.js server/services/vertical/queue.js`; `python -m unittest discover -s python/tests -p "test_*.py"` all passed.
- files_changed: `python/pipeline/run_asr.py`, `server/services/vertical/standalone.js`, `server/services/vertical/queue.js`, `python/tests/test_run_asr_filetrans.py`, `server/services/vertical/__tests__/standaloneTaskImport.test.js`, `server/services/vertical/__tests__/queueAsrFileUrl.test.js`, `.planning/debug/subtitle-reference-authority.md`.
