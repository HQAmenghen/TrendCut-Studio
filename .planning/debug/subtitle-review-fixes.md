---
status: resolved
trigger: "用户报告指定竖屏视频第4.12s-7.12s字幕将 '$200 million' 误译为 '200'，并指出审核中心多条字幕修复建议（如 Fed 被误成 United Nations）没有被系统性回修，要求排查原因并修复，防止后续复发。"
created: "2026-05-13"
updated: "2026-05-13"
---

# Debug Session: subtitle-review-fixes

## Symptoms

- Expected behavior: 竖屏视频字幕应保留英文原文中的金额、单位、机构、法案、年份等关键事实，审核中心发现字幕错误时应能形成可执行修复依据，避免同类错误持续进入发布候选。
- Actual behavior: 指定视频第 4.12s-7.12s 将 `$200 million` 显示成 `200`，丢失美元符号与 million 单位；多个视频审核中心给出字幕错误建议，包括 `Fed`/政策主体被误成 `United Nations` 等关键事实错误。
- Error messages: 无明确异常栈；问题体现为生成字幕和审核建议之间事实不一致。
- Timeline: 用户在 2026-05-13 报告，样例来自当日审核中心视频。
- Reproduction: 检查 `data/uploads/xai_vertical_queue/1778633520027_0gv70qj` 产物、审核记录、字幕生成/翻译/渲染链路，确认关键事实丢失发生在哪一步。

## Current Focus

- hypothesis: confirmed; ASR/reference repair did not preserve hybrid English-scale monetary amounts such as `200 million美元`, and invalid zero-duration ASR fragments could survive into persisted subtitles/review metadata.
- test: `python -m unittest discover -s python/tests -p "test_*.py"` and `npm test -- server/services/vertical/__tests__/queueAsrFileUrl.test.js`
- expecting: `$200 million` / `200 million美元` scale units are restored from source/reference text, and zero-duration hallucinated fragments such as `the United Nations who understands` are dropped before `audio.json`/`subtitles.json` are written.
- next_action: none; fix applied and verified.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-13T09:52:10+08:00
  observation: `data/uploads/xai_vertical_queue/1778633520027_0gv70qj/subtitles.json` already contained the bad 4.12s-7.12s row before render: `zh/text = 他们每小时买入200的比特币`, while `en = They buy $200 million worth of Bitcoin every hour`.
- timestamp: 2026-05-13T09:52:10+08:00
  observation: `data/uploads/xai_vertical_queue/1778633520027_0gv70qj/reference_subtitles.json` preserved the source fact as `他们每小时买入200 million美元的比特币`, proving the loss happened in ASR/reference subtitle repair before `make_vertical_video.py` burned subtitles into the video.
- timestamp: 2026-05-13T09:52:10+08:00
  observation: Direct probe reproduced the deterministic guard gap: `repair_reference_subtitle_text("他们每小时买入200的比特币", "...200 million美元...")` returned the unchanged bad subtitle before the fix.
- timestamp: 2026-05-13T09:52:10+08:00
  observation: The Fed/UN sample in `data/uploads/xai_vertical_queue/1778631000067_guriep2/subtitles.json` had a correct 5.56s-8.46s Chinese subtitle plus an invalid zero-duration 7.82s row `the United Nations who understands`; the zero-duration row was persisted and later surfaced in review metadata as a subtitle issue.
- timestamp: 2026-05-13T09:52:10+08:00
  observation: `python/pipeline/make_vertical_video.py` already skips zero-duration subtitle cards at render time, but `run_asr.py` still wrote those invalid rows to `audio.json`/`subtitles.json`, so Review Center could analyze and display stale hallucinated fragments even if the renderer skipped them.
- timestamp: 2026-05-13T09:52:10+08:00
  observation: Review suggestions in `public/xai_vertical_queue/1778633520027_0gv70qj/vertical_output.mp4.meta.json` and `public/xai_vertical_queue/1778631000067_guriep2/vertical_output.mp4.meta.json` correctly identified the subtitle factual errors, but they were downstream review metadata, not a pre-publication repair gate for the persisted subtitle artifacts.

## Eliminated

- Renderer-only failure: eliminated because the bad `$200 million` line is already wrong in `subtitles.json`/`audio.json`; rendering only consumes those files.
- Missing source/reference fact: eliminated because the reference subtitle artifact retained `200 million美元`.
- Review model as the root cause: eliminated because Review Center identified the errors; the production gap was that the upstream subtitle output allowed the errors to persist.

## Specialist Review

- Not invoked: `specialist_dispatch_enabled=true` mapped `python` to `python-expert-best-practices-code-review`, but that skill is not installed under the configured local skill roots in this environment.

## Resolution

- root_cause: The subtitle repair pipeline had deterministic guards for plain Chinese numeric amounts but not hybrid English-scale monetary amounts (`200 million美元`, `$200 million`), and it persisted invalid zero-duration ASR fragments that Review Center later treated as real subtitles.
- fix: Extended numeric term preservation/repair in `python/pipeline/subtitle_terms.py` for English-scale units and currency suffixes, added final subtitle normalization in `python/pipeline/run_asr.py` to drop invalid/zero-duration rows before writing `audio.json` and `subtitles.json`, and added regressions for the reported `$200 million` and Fed/UN fragment cases.
- verification: `python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video` passed; `python -m unittest discover -s python/tests -p "test_*.py"` passed 112 tests; `npm test -- server/services/vertical/__tests__/queueAsrFileUrl.test.js` passed 3 tests.
- files_changed: `python/pipeline/subtitle_terms.py`, `python/pipeline/run_asr.py`, `python/tests/test_subtitle_terms.py`, `python/tests/test_run_asr_filetrans.py`, `.planning/debug/subtitle-review-fixes.md`
