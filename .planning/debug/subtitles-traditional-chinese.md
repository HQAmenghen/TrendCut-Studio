---
status: resolved
trigger: "在近期的几个人任务中，中文字幕的样式，频繁出现繁体中文，找到原因然后修复，确保返回的是简体中文"
created: "2026-05-11"
updated: "2026-05-11"
---

# Debug Session: subtitles-traditional-chinese

## Symptoms

- expected_behavior: "近期任务生成的中文字幕字段和最终字幕卡应统一为简体中文。"
- actual_behavior: "多个近期竖屏队列任务的 subtitles.json 中 zh/text 字段出现繁体中文，例如 比特幣、當下、機構、資產、關鍵、這個。"
- error_messages: "无显式异常；表现为生成字幕文本字形错误。"
- timeline: "用户在 2026-05-11 反馈，近期多个任务频繁出现。"
- reproduction: "检查近期 data/uploads/xai_vertical_queue/*/subtitles.json，追踪 run_asr.py 和 make_vertical_video.py 的字幕生成/渲染链路。"

## Current Focus

- hypothesis: "Qwen Filetrans/ASR 对中文音频偶发返回繁体文本，run_asr.py 在中文源语言下直接信任 ASR zh/text，参考对齐和渲染入口也缺少 deterministic 简体归一化兜底。"
- test: "python -m py_compile python/pipeline/subtitle_terms.py python/pipeline/run_asr.py python/pipeline/make_vertical_video.py; python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video"
- expecting: "未来 subtitles.json 中 zh/text 字段以及字幕卡输入中的中文都被归一化为简体。"
- next_action: "none"
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11T00:00:00+08:00
  observation: "data/uploads/xai_vertical_queue/1778459340042_rpffphj/subtitles.json contains Traditional Chinese in zh/text, e.g. 比特幣, 當下, 多數人還在門外, 關鍵, 這個."
  source: "rg Traditional-character pattern over data/uploads/xai_vertical_queue"
- timestamp: 2026-05-11T00:00:00+08:00
  observation: "data/uploads/xai_vertical_queue/1778370480044_f2n0v29/subtitles.json contains Traditional Chinese in zh/text, e.g. 覆蓋穩定幣, 通過後數百家公司, 機構資金, 資產."
  source: "rg Traditional-character pattern over data/uploads/xai_vertical_queue"
- timestamp: 2026-05-11T00:00:00+08:00
  observation: "Corresponding material-driven project script/narration artifacts for similar jobs are Simplified Chinese, so the issue appears after script generation, in ASR/vertical subtitle handoff."
  source: "projects/material_*/script_units.json and narration.json spot checks"
- timestamp: 2026-05-11T00:00:00+08:00
  observation: "run_asr.py build_raw_subtitles() writes ASR text directly to zh/text, and backfill_chinese_subtitles() skips entries that already contain CJK text."
  source: "python/pipeline/run_asr.py"
- timestamp: 2026-05-11T00:00:00+08:00
  observation: "The previous LLM subtitle layer still existed as Refine Translate Prompt / Reference Align Prompt, but direct Chinese ASR paths did not invoke it by default, so recent Chinese-source subtitles bypassed that model pass."
  source: "python/pipeline/prompt_skills/run_asr_skill.md; python/pipeline/run_asr.py; server/services/vertical/queue.js; server/services/vertical/standalone.js"

## Eliminated

- hypothesis: "Frontend subtitle style settings convert Simplified Chinese to Traditional."
  reason: "The persisted subtitles.json already contains Traditional Chinese before rendering/UI display."
- hypothesis: "Material-driven script generation is the first source of Traditional Chinese."
  reason: "Recent script/narration artifacts inspected are Simplified Chinese while downstream vertical subtitles are Traditional."

## Resolution

- root_cause: "Qwen Filetrans/ASR 对中文口播会偶发返回繁体中文；run_asr.py 将 ASR 文本直接写入 zh/text，且 backfill_chinese_subtitles 会跳过已含 CJK 的中文源字幕，因此提示词里的“简体中文”要求没有覆盖这条路径。之前的大模型字幕层仍存在，但只在参考字幕对齐/英文补中文等路径生效，近期直接中文 ASR 路径没有默认调用。make_vertical_video.py 渲染入口也没有最终简体化兜底。"
- fix: "在 subtitle_terms.py 中加入简体中文归一化工具，优先使用 OpenCC t2s，缺失时使用内置金融/字幕常见简繁映射；run_asr.py 的 domain correction、参考字幕读取、最终 subtitles.json 写出前统一转简体；新增 refine_subtitles_with_llm()，通过 --refine-subtitles 调用既有 Refine Translate Prompt，严格保留字幕条数和 time，只精修 zh/en/text；竖屏队列、独立 ASR、导入数字人刷新默认传入 --refine-subtitles；make_vertical_video.py 在字幕卡渲染前再次归一化，并把归一化后的字幕 JSON 写回文件。"
- verification: "Passed: python -m py_compile python/pipeline/subtitle_terms.py python/pipeline/run_asr.py python/pipeline/make_vertical_video.py; python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video (34 tests); npm test -- --runInBand server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js (7 tests); npx eslint server/services/vertical/queue.js server/services/vertical/standalone.js server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js."
- files_changed: "python/pipeline/subtitle_terms.py; python/pipeline/run_asr.py; python/pipeline/make_vertical_video.py; python/pipeline/requirements.txt; python/tests/test_subtitle_terms.py; python/tests/test_run_asr_filetrans.py; python/tests/test_make_vertical_video.py; server/services/vertical/queue.js; server/services/vertical/standalone.js; server/services/vertical/__tests__/queueAsrFileUrl.test.js; server/services/vertical/__tests__/standaloneTaskImport.test.js"
- specialist_hint: "python"
