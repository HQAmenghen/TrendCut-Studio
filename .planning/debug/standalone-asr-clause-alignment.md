---
status: resolved
trigger: "素材驱动任务导入单条竖屏后重新 ASR 打轴，字幕没有按逗号/小句拆分对齐，最新运行 standalone_z805a17e5k / standalone_1778465425444_6abf0744 只有一条 36.96s 字幕。"
created: 2026-05-11
updated: 2026-05-11
---

## Symptoms

- Expected behavior: 有原始口播文本/参考字幕的素材驱动导入链路，重新 ASR 后应保留 ASR 时间轴，并按小句/逗号拆成可读字幕。
- Actual behavior: `data/uploads/runtime_jobs/standalone_1778465425444_6abf0744/subtitles.json` 只有一条 `[0.08, 36.96]` 字幕，整段口播合在一起。
- Error messages: 无运行错误，视频成功渲染，但字幕节奏错误。
- Timeline: 2026-05-11 10:00 选择素材驱动任务后，10:10 建立 `standalone_z805a17e5k` 进度流。
- Reproduction: 从素材驱动任务 `material_1778462863141_bf267634` 选择“重新 ASR 打轴并对齐原始文本”生成单条竖屏。

## Current Focus

- hypothesis: Filetrans 句级结果没有进入小句切分；同时参考连续合并的数字判断过宽，导致前文出现 `0.42` 后把后续字幕持续合并回一条。
- test: 重新跑 `material_1778462863141_bf267634` 的数字人口播 ASR，并检查 standalone 运行目录字幕条数和渲染结果。
- expecting: 同一 36.96s 文本拆成多个短字幕，按 ASR 词级时间戳和参考文本校正，渲染时生成对应数量的字幕卡。
- next_action: monitor next imported material task for expected subtitle cadence.

## Evidence

- timestamp: 2026-05-11
  observation: runtime `subtitles.json` has exactly 1 entry `[0.08, 36.96]` with the full narration.
- timestamp: 2026-05-11
  observation: source project `aiman_reference_subtitles.json` has 3 broad reference ranges, while `aiman_subtitles.json` also has 1 broad entry, so the issue is upstream of standalone rendering.
- timestamp: 2026-05-11
  observation: standalone handler copies `taskImport.subtitles` when imported task already has subtitles; it does not re-split during render.
- timestamp: 2026-05-11
  observation: patched run produced Filetrans `句子数: 6，字幕段数: 20`; old merge logic then merged 19 segments because `forms_split_data_token` searched for any decimal inside the accumulated previous text.
- timestamp: 2026-05-11
  observation: after boundary-only numeric merge fix, rerun produced 20 subtitle entries and standalone render generated 20 subtitle cards.

## Eliminated

- hypothesis: Final `make_vertical_video.py` render caused timing collapse.
  reason: Render input `subtitles.json` was already collapsed before render.

## Resolution

- root_cause: Filetrans ASR sentence output was not passed through the existing clause splitter before reference alignment, so a long ASR sentence could become one target. Then the reference-continuation merge guard treated any earlier decimal token such as `0.42` as a split-data boundary forever, merging valid later clauses back into one subtitle.
- fix: Call `split_filetrans_segments` from the Filetrans path, split no-word fallback segments by clause boundaries, narrow reference context to the best matching small clause window before LLM alignment, make split-data merge checks boundary-only, and add reference-based numeric truncation repair.
- verification: `python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video` passed; `npm test -- --runInBand server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/__tests__/queueAsrFileUrl.test.js` passed; current standalone job rerendered with 20 subtitle cards.
- files_changed: `python/pipeline/run_asr.py`, `python/pipeline/subtitle_terms.py`, `python/pipeline/prompt_skills/run_asr_skill.md`, `python/tests/test_run_asr_filetrans.py`, `python/tests/test_subtitle_terms.py`, current runtime/project subtitle artifacts for `material_1778462863141_bf267634` and `standalone_1778465425444_6abf0744`.
