---
status: resolved
trigger: "字幕复发：素材驱动任务重新 ASR 打轴并对齐原始文本后，把 Claude AI / Code with Claude 这类专有名词翻译或改写了"
created: "2026-05-13T10:43:33+08:00"
updated: "2026-05-13T11:54:00+08:00"
---

# Debug Session: Claude AI Subtitle Preserve

## Symptoms

- expected: 重新 ASR 打轴和字幕对齐时，应保留原始文案里的专有名词，例如 `Claude AI`、`Code with Claude`，不得翻译成中文或变成 `Claudeai` 等错误形态。
- actual: 任务 `standalone_a1hqf45eh8q` 在重新 ASR 打轴并对齐原始文本后，专有名词又被翻译/改写，说明之前的字幕保护只覆盖了数字金额类问题，未彻底覆盖专有名词。
- error_messages: 无明确异常；问题体现为视频字幕内容错误。
- timeline: 2026-05-13 10:43 左右复现，发生在素材驱动任务导入竖屏并重新 ASR 打轴的流程中。
- reproduction: 从素材驱动任务“我们在 Code with Claude 给人们发了微型电脑，以下是他们做出的一些小巧有趣的东西。”进入竖屏流程，建立进度流 `standalone_a1hqf45eh8q`，执行重新 ASR 打轴并对齐原始文本。

## Current Focus

- hypothesis: ASR 对齐/LLM 精修链路只在提示词层面要求保留专有名词，缺少确定性的 reference/source 专有词修复；因此 LLM 可能把 `Claude AI`、`Code with Claude` 翻译或规范化错误。
- test: 检查当前 runtime job 字幕产物与 `run_asr.py` 的 reference subtitle 传入路径，构造专有名词被翻译的回归用例。
- expecting: 找到字幕文本在 `run_asr.py` 精修/对齐后丢失专有名词，并能用确定性修复函数从参考文本恢复。
- next_action: inspect runtime subtitles and ASR alignment code
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-13T11:38:30+08:00"
  observation: Runtime subtitles for `data/uploads/runtime_jobs/standalone_1778640214866_b07f5141/subtitles.json` contained `云端AI` and `在 Code with Cloud`, while `projects/material_1778638308043_441cc334/aiman_reference_subtitles.json` contained `Claude AI 在 Code with Claude ...`.
- timestamp: "2026-05-13T11:38:30+08:00"
  observation: `select_reference_context_for_asr()` could select a later generic `AI` clause for the first short ASR segment, so `repair_subtitles_with_reference_terms()` never saw the overlapping `Claude AI` reference text for that fragment.
- timestamp: "2026-05-13T11:38:30+08:00"
  observation: Proper-noun repair existed in the working tree but needed a full-overlap fallback for final reference repair and a guard so pure numeric tokens from English secondary sources were not canonicalized as proper nouns.
- timestamp: "2026-05-13T11:38:30+08:00"
  observation: Direct replay of the bad runtime subtitles through `repair_subtitles_with_reference_terms()` now produces `Claude AI` and `在 Code with Claude`.
- timestamp: "2026-05-13T11:54:00+08:00"
  observation: Current runtime job `data/uploads/runtime_jobs/standalone_1778640214866_b07f5141` was repaired and re-rendered; old bad strings no longer appear in its subtitles or in the imported material task subtitles.

## Eliminated

- LLM prompt-only failure as the only cause. The durable gap was deterministic: final repair used the selected reference window only, and that window could point at the wrong repeated `AI` context.
- Vertical renderer/card generation. The bad strings were already present in ASR/materialized subtitle JSON before rendering.

## Resolution

- root_cause: The ASR reference-alignment path relied on the narrowed reference window for final deterministic repair; for short fragments like `云端AI`, context selection matched a later `AI` clause instead of the overlapping `Claude AI` clause, so proper nouns from the source/reference text were not restored.
- fix: Added deterministic proper-noun preservation for reference terms, included present reference terms in protected ASR alignment payloads, and made final reference repair fall back from the narrowed window to the full overlapping reference context when the narrowed repair makes no change.
- verification: `python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans` passed; `python -m unittest discover -s python/tests -p "test_*.py"` passed 115 tests; targeted Claude regression tests passed; direct replay of the observed runtime subtitles repaired `云端AI` -> `Claude AI` and `在 Code with Cloud` -> `在 Code with Claude`; the existing runtime video was re-rendered at `data/uploads/runtime_jobs/standalone_1778640214866_b07f5141/standalone_output_vertical.mp4`.
- files_changed: `python/pipeline/subtitle_terms.py`, `python/pipeline/run_asr.py`, `python/tests/test_subtitle_terms.py`, `python/tests/test_run_asr_filetrans.py`
