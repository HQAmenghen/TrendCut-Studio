---
status: resolved
trigger: "在最新的直接竖屏合成任务里面，出现了原视频就是英文的，但是对应的中文字幕没有翻译是什么情况？"
created: "2026-05-09"
updated: "2026-05-09"
---

# Debug Session: Direct Vertical English Subtitles

## Symptoms

- expected_behavior: "直接竖屏合成任务遇到英文原视频时，应生成可读的中文字幕或翻译后的字幕。"
- actual_behavior: "最新任务中原视频是英文，但对应的中文字幕没有被翻译。"
- error_messages: "用户未报告明确报错；需要从最近任务产物和日志中确认。"
- timeline: "最新的直接竖屏合成任务。"
- reproduction: "运行直接竖屏合成，输入英文原视频，检查输出字幕/中文字幕。"

## Current Focus

- hypothesis: "Qwen Filetrans word reconstruction removed spaces from English, then subtitle term preservation masked the no-space English chunks as terms, forcing the LLM translation result to preserve English in zh."
- test: "Inspect latest xai_vertical_queue job artifacts, reproduce subtitle_terms masking, patch reconstruction/masking, and run targeted regression tests."
- expecting: "Filetrans English words reconstruct with spaces, CJK remains compact, no-space English sentence chunks are not masked as terms, and targeted tests pass."
- next_action: "complete"
- reasoning_checkpoint: ""
- tdd_checkpoint: ""

## Evidence

- timestamp: "2026-05-09"
  source: "data/uploads/xai_vertical_queue/1778317724619_0523dt4/vertical_queue.log"
  observation: "Latest direct vertical queue job detected source language en, invoked LLM Chinese subtitle backfill, and reported success: 已补全中文字幕: 5/5."
- timestamp: "2026-05-09"
  source: "data/uploads/xai_vertical_queue/1778317724619_0523dt4/subtitles.json"
  observation: "zh contains mixed no-space English plus Chinese, e.g. Whensomebodyisusingtheinternet，是互联网在犯罪还是人在犯罪？"
- timestamp: "2026-05-09"
  source: "python/pipeline/run_asr.py:211"
  observation: "sentence_text reconstructs Filetrans words with ''.join(reconstructed_parts), removing spaces between English words before translation."
- timestamp: "2026-05-09"
  source: "python/pipeline/subtitle_terms.py:65"
  observation: "SINGLE_CAPITALIZED_PATTERN treats long CapitalizedLowercase tokens as preserved terms. Repro: mask_preserved_terms('Sotechnologyisjustatoolthathumansuse.') -> [[TERM_1]]."
- timestamp: "2026-05-09"
  source: "python/pipeline/run_asr.py:1295"
  observation: "Chinese backfill prompt explicitly tells the model to preserve [[TERM_n]] placeholders unchanged, so restored output keeps the protected English chunks."
- timestamp: "2026-05-09"
  source: "python -m unittest python.tests.test_run_asr_filetrans python.tests.test_subtitle_terms"
  observation: "Added regression coverage for Filetrans English word spacing, compact Chinese reconstruction, no-space English sentence term masking, and mixed-case joined sentence prefixes; 23 tests passed."

## Eliminated

- hypothesis: "The vertical renderer ignored translated zh subtitles."
  reason: "Renderer loaded subtitles.json and generated subtitle cards from the already-bad zh payload."
- hypothesis: "The translate-subtitles flag was not enabled."
  reason: "server/services/vertical/queue.js passes --translate-subtitles by default; log confirms the step ran."

## Resolution

- root_cause: "ASR/translation preprocessing regression: Filetrans English word reconstruction removed spaces, then term preservation masked the resulting no-space English chunks as placeholders, causing Chinese backfill to preserve English in zh."
- fix: "Implemented Filetrans token joining that inserts spaces between adjacent ASCII words while preserving compact CJK text and decimal separators. Added a subtitle term guard so long joined English sentence-like tokens are not preserved as terms."
- verification: "Manual artifact inspection, mask_preserved_terms reproduction, and `python -m unittest python.tests.test_run_asr_filetrans python.tests.test_subtitle_terms` completed with 23 tests passing."
- files_changed: "python/pipeline/run_asr.py; python/pipeline/subtitle_terms.py; python/tests/test_run_asr_filetrans.py; python/tests/test_subtitle_terms.py; .planning/debug/direct-vertical-english-subs.md"
