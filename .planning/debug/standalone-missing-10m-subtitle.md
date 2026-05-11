---
status: resolved
trigger: "standalone_t2fz11f639f 这条视频缺失 1000万美元 字幕，缺失位置在“惊人预测”和“美元走向消亡”之间。"
created: 2026-05-11
updated: 2026-05-11
---

## Symptoms

- Expected behavior: 参考口播稿中的“比特币将达到1000万美元”应完整出现在重新 ASR 对齐后的字幕里。
- Actual behavior: 最终字幕出现“昨晚放出惊人预测：比特币将达到”后，下一条直接变成“美元将走向消亡”，中间的“1000万美元”缺失。
- Error messages: 无运行错误。
- Timeline: 2026-05-11 12:40-12:50 附近生成的 standalone 任务。
- Reproduction: 选择素材驱动任务 `material_1778470786532_3ec90d99` 导入单条竖屏并重新 ASR 对齐原始文本。

## Current Focus

- hypothesis: confirmed. ASR/LLM 精修后的字幕文本丢失了参考口播稿中的关键数字短语；渲染层只是使用已经缺失的 `subtitles.json`。
- test: 对比 `projects/material_1778470786532_3ec90d99/aiman_reference_subtitles.json`、`aiman_subtitles.json` 与 runtime `subtitles.json`。
- expecting: 后处理能用参考口播稿补齐“达到”后面的 `1000万美元`，且不改动后续“美元将走向消亡”字幕。
- next_action: none.

## Evidence

- timestamp: 2026-05-11
  observation: `projects/material_1778470786532_3ec90d99/narration.json` 和 `aiman_reference_subtitles.json` 均包含“比特币将达到1000万美元”。
- timestamp: 2026-05-11
  observation: `data/uploads/runtime_jobs/standalone_1778474834923_d472424e/subtitles.json` 中“昨晚放出惊人预测：比特币将达到”后没有“1000万美元”字幕。

## Eliminated

## Resolution

- root_cause: `aiman_reference_subtitles.json` 和原始口播稿都包含“比特币将达到1000万美元”，但 LLM 精修后的 `aiman_subtitles.json` / runtime `subtitles.json` 变成“比特币将达到”后直接接“美元将走向消亡”。缺失发生在 ASR 对齐/精修产物阶段，渲染层没有再校验参考稿中的数字目标价。
- fix: 在 `run_asr.py` 的 LLM 精修后增加 `repair_subtitles_with_reference_terms()`，用参考口播稿窗口对每条字幕再执行一次关键数字短语补齐；在 `subtitle_terms.py` 中扩展数字短语匹配，让 `1000万美元`、`25万美元`、`0.42美元` 这类含中文数量级和币种的短语作为整体处理。
- verification: `python -m py_compile python\pipeline\subtitle_terms.py python\pipeline\run_asr.py` 通过；`python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video` 通过 40 项；已重写 `standalone_1778474834923_d472424e/subtitles.json` 并重新渲染，3 秒处视频帧显示“比特币将达到1000万美元，”。
- files_changed: `python/pipeline/subtitle_terms.py`, `python/pipeline/run_asr.py`, `python/tests/test_subtitle_terms.py`, `python/tests/test_run_asr_filetrans.py`, runtime subtitles/video artifacts.
