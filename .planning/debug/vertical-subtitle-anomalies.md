---
status: resolved
trigger: "用户报告竖屏合成任务字幕异常：同音错字、英文专有名词被翻译、数字小数等数据块被错误拆分，要求定位原因并修复。"
created: "2026-05-09"
updated: "2026-05-09"
---

# Debug Session: vertical-subtitle-anomalies

## Symptoms

- Expected behavior: 竖屏合成任务列表中的中英文字幕应忠实反映口播内容，英文专有名词不应被误译，数值、小数和紧密数据块不应被拆开。
- Actual behavior: 近期任务出现字幕同音错字、口播英文专有名词被中文字幕翻译、字幕块切分不合理（例如 `xx.xxx` 被拆成两部分）。
- Error messages: 未报告明确异常栈；问题体现在生成字幕文本和字幕块切分结果。
- Timeline: Reported on 2026-05-09.
- Reproduction: Inspect recent vertical synthesis queue tasks and their generated subtitle artifacts, then trace ASR/LLM subtitle refinement and rendering handoff.

## Current Focus

- hypothesis: subtitle text is being produced by ASR plus optional LLM translation/refinement without enough preservation rules for homophones, proper nouns, decimals, and token grouping
- test:
- expecting:
- next_action: inspect vertical queue task artifacts and subtitle generation/refinement code paths
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- Recent `vertical_queue` jobs showed ASR-produced `subtitles.json` with homophone errors and awkward breaks.
- Imported material/avatar tasks already had cleaner script-aligned sources in `avatar_segments.json` and `execution_plan.json`, but the standalone import path was not consistently using them as reference text for a second ASR pass.
- The subtitle translation/backfill path sent raw text to the LLM without protecting English names, tickers, or decimals, so placeholders could be translated away.
- `split_long_subtitles()` still used comma-based and midpoint splitting, which could separate data-like tokens such as decimals when a long line had no natural sentence boundary.

## Eliminated

- The issue is not a missing frontend render state or a queue persistence bug.
- The standalone importer already had enough metadata to reconstruct better subtitles when structured artifacts exist.

## Resolution

- root_cause: subtitle generation trusted raw ASR text too early, translation did not preserve protected terms, and imported material paths were not combining accurate reference text with the ASR time axis.
- fix: preserve proper nouns / acronyms / numbers with placeholders before LLM translation, restore them afterward, stop splitting on commas or arbitrary midpoints, feed `avatar_segments.json` / `execution_plan.json` and standalone `subtitlesPayload` back into a reference-alignment ASR pass, and keep `subtitles.json` as the final aligned output.
- verification: `python -m unittest discover -s python/tests -p "test_subtitle_terms.py"`, `python -m unittest discover -s python/tests -p "test_make_vertical_video.py"`, `python -m unittest discover -s python/tests -p "test_run_asr_filetrans.py"`, `npm test -- --runInBand server/services/vertical/__tests__/taskImport.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js`, `npx eslint server/services/vertical/taskImport.js server/services/vertical/standalone.js server/services/vertical/queue.js`
- files_changed: `python/pipeline/subtitle_terms.py`, `python/pipeline/run_asr.py`, `python/pipeline/make_vertical_video.py`, `python/tests/test_subtitle_terms.py`, `python/tests/test_make_vertical_video.py`, `server/services/vertical/taskImport.js`, `server/services/vertical/standalone.js`, `server/services/vertical/__tests__/taskImport.test.js`, `server/services/vertical/__tests__/standaloneTaskImport.test.js`, `server/services/vertical/queue.js`

## Rerun Comparison

- sample: `data/uploads/xai_vertical_queue/1778285640063_xyyk7lq`, reference source `projects/material_1778283780066_2b9d9a28/avatar_segments.json`
- before: 25 subtitle blocks with obvious errors including `陶锡`, `美国将密市场结构法案`, `标志69%`, `压注`, `持持不敢入场`, `真量资金`, and split `立法会落` / `地`.
- after: rerun output at `data/uploads/xai_vertical_queue/1778285640063_xyyk7lq/rerun_after_fix_20260509_v2/subtitles.json`; 9 aligned ASR subtitle blocks, with `Kalshi`, `美国加密市场结构法案`, `飙至69%`, `押注`, `迟迟不敢入场`, `增量资金`, and `立法会落地` corrected.
- rendered artifact: `data/uploads/xai_vertical_queue/1778285640063_xyyk7lq/rerun_after_fix_20260509_v2/vertical_output_after_fix.mp4`; ffprobe confirmed 44.19s, 1080x1920 video plus audio.
- follow-up fix from rerun: added deterministic reference-continuation merging after LLM alignment so very short orphan subtitle fragments and split decimal/percent tokens can be merged only when supported by reference text.
- clarification: Qwen Filetrans is the sentence/word timestamp anchor, not the final display splitter; the final subtitle path now keeps Filetrans sentence blocks as the base and only uses reference text to correct content and timing, which matches the intended sentence-level alignment.
- render cadence follow-up: `subtitles.json` keeps 9 Filetrans sentence-aligned blocks, while `make_vertical_video.py` now applies a display-only safe clause splitter for long cards. It splits on natural Chinese pause punctuation including commas, but protects numeric separators such as `12.345`. The sample render `rerun_after_fix_20260509_v4_sentence_base/vertical_output_after_fix_clause_split.mp4` produced 13 subtitle cards with max display duration 4.96s.
