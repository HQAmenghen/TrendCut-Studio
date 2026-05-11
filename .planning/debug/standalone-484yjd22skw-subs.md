---
status: resolved
trigger: "[14:46:35] 已选择素材驱动任务：Don Jr在Consensus 2026上表示：“关于加密货币价格预测，很乐意让Eric背锅。”，将重新 ASR 打轴并对齐原始文本\n[14:46:37] 建立竖屏进度流：standalone_484yjd22skw这个最新的任务又出现了字幕问题，口播就是念的英文名词，可是中文字幕给翻译了，还有一些字幕重复的现象，排查这个任务字幕错误的地方，找到出错原因然后修复"
created: "2026-05-11"
updated: "2026-05-11"
---

# Debug Session: standalone-484yjd22skw-subs

## Symptoms

- expected_behavior: 竖屏任务 `standalone_484yjd22skw` 重新 ASR 打轴并对齐原始文本后，字幕应保留口播中的英文专有名词/英文人名，不应把英语名词错误翻译成中文；字幕不应重复。
- actual_behavior: 最新任务字幕把口播中的英文名词翻译成中文字幕，并出现部分字幕重复。
- error_messages: 未报告显式错误；前端日志显示已选择素材驱动任务并建立 `standalone_484yjd22skw` 竖屏进度流。
- timeline: 2026-05-11 14:46 左右复现，用户称“又出现了字幕问题”，说明类似字幕异常曾出现过。
- reproduction: 从素材驱动任务“Don Jr在Consensus 2026上表示：‘关于加密货币价格预测，很乐意让Eric背锅。’”发起竖屏合成，任务 ID 为 `standalone_484yjd22skw`，走重新 ASR 打轴并对齐原始文本路径。

## Current Focus

- hypothesis: ASR/reference alignment preserved timing but allowed the LLM to translate protected event/person terms, and duplicate-prefix cleanup missed an adjacent-clause case.
- test: Inspect `standalone_1778481997075_cab9905d` runtime artifacts, source material task subtitles, rerun ASR/reference alignment, and run targeted ASR/render tests.
- expecting: Final subtitles should keep English proper nouns from the current ASR slice, such as event names and person names, and should not show duplicated location prefixes across adjacent subtitle fragments.
- next_action: complete; fixes applied and verified.
- reasoning_checkpoint: Runtime `public/standalone_output_vertical.mp4.meta.json` and `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d/subtitles.json` showed `Consensus` translated to `共识大会`; upstream `projects/material_1778479785187_f513782a/aiman_reference_subtitles.json` preserved `Consensus 2026`, `Don Jr`, and `Eric`, while `aiman_subtitles.json` already contained the wrong aligned text.
- tdd_checkpoint: Added/updated regression coverage for reference-term repair, ASR protected-term retry, and standalone task import handoff.

## Evidence

- timestamp: 2026-05-11 15:00
  observation: "Latest runtime output metadata points at `sourceTaskDir: material_1778479785187_f513782a`, `subtitleSource: aiman_subtitles.json`, and contains bad subtitles such as zh=`在2026共识大会` / en=`At Consensus 2026` plus zh=`共识大会` / en=`Consensus`."
  source: "`public/standalone_output_vertical.mp4.meta.json`; `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d/subtitles.json`"
- timestamp: 2026-05-11 15:02
  observation: "The trustworthy reference subtitles generated from avatar/script segments kept the intended mixed Chinese/English copy: `在Consensus 2026大会上...Don Jr...Eric...`; the refreshed ASR-aligned subtitles had already translated `Consensus` to Chinese before vertical rendering."
  source: "`projects/material_1778479785187_f513782a/aiman_reference_subtitles.json`; `projects/material_1778479785187_f513782a/aiman_subtitles.json`; `projects/material_1778479785187_f513782a/narration.json`"
- timestamp: 2026-05-11 15:06
  observation: "The standalone import path intentionally reruns `run_asr.py` with `--reference-subtitles-json aiman_reference_subtitles.json`, then imports `aiman_subtitles.json`, so the bug is in ASR/reference alignment and post-alignment repair rather than FFmpeg card rendering."
  source: "`server/services/vertical/standalone.js`; `server/services/vertical/taskImport.js`; `python/pipeline/run_asr.py`"
- timestamp: 2026-05-11 15:18
  observation: "Focused tests now cover the generic protected-term LLM retry path and duplicate-prefix cleanup. Production code does not contain a `Consensus`/`共识大会` special case; the concrete task appears only as a regression sample."
  source: "`python/pipeline/run_asr.py`; `python/tests/test_run_asr_filetrans.py`"
- timestamp: 2026-05-11 15:39
  observation: "Rerunning `run_asr.py` for `projects/material_1778479785187_f513782a/aiman.mp4` with `aiman_reference_subtitles.json` generated 22 aligned subtitle blocks. The refreshed subtitles keep `Consensus 2026`, `Consensus`, `Don Jr`, and `Eric` in zh text where spoken."
  source: "`projects/material_1778479785187_f513782a/aiman_subtitles.json`; `projects/material_1778479785187_f513782a/aiman_audio.json`"

## Eliminated

- hypothesis: The vertical renderer translated subtitles while drawing cards.
  reason: `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d/subtitles.json` already contained the bad `zh` values before `make_vertical_video.py` generated subtitle cards.
- hypothesis: The source script/narration incorrectly translated the proper nouns.
  reason: `narration.json`, `avatar_segments.json`, and `aiman_reference_subtitles.json` preserve `Consensus 2026`, `Don Jr`, and `Eric`.
- hypothesis: The duplicate subtitle came from duplicated source segments.
  reason: The duplicate was a fragment-boundary artifact: first aligned item ended with `Consensus 2026大会`, while the next item began `大会上，...`; merge cleanup did not account for `上` belonging between previous and trimmed fragments.

## Resolution

- root_cause: `run_asr.py` used ASR timings plus LLM reference alignment, but the alignment prompt alone could still translate English proper nouns in the current spoken slice. The post-alignment checks only repaired numeric/person-name truncation and did not detect that a protected English term had disappeared from zh. Duplicate-prefix cleanup also missed a general adjacent-fragment case where the previous subtitle plus `上` plus the trimmed current subtitle matched the reference.
- fix: Kept LLM as the semantic authority, but added generic `protected_terms` extraction from the current ASR slice, a post-alignment missing-term check, and an LLM-only repair retry for affected rows. Also generalized duplicate-prefix cleanup to validate trimmed adjacent fragments against reference text, without hardcoding any event or brand names.
- verification: Passed `python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video`; reran ASR/reference alignment for `material_1778479785187_f513782a`; rerendered `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d/standalone_output_vertical.mp4` and copied it to `public/standalone_output_vertical.mp4`.
- files_changed: `python/pipeline/run_asr.py`, `python/tests/test_run_asr_filetrans.py`, `.planning/debug/standalone-484yjd22skw-subs.md`, and regenerated current task artifacts under `projects/material_1778479785187_f513782a`, `data/uploads/runtime_jobs/standalone_1778481997075_cab9905d`, and `public/standalone_output_vertical.mp4`.
