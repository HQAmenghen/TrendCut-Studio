---
status: resolved
trigger: "近期交给自动化的任务，最终竖屏成品视频有些字幕时间轴准确，有些出现漂移；样本任务 http://localhost:3001/xai_vertical_queue/1779063120041_2m166a8/vertical_output.mp4?t=1779063274575.342 在 18 秒到 24 秒中间段漂移；多个任务字幕拆分不符合标准，常把下一句话的一两个字放进上一条字幕或提前断句；要求排查偶发原因并彻底修复，做通用方案而非简单规则匹配。"
created: "2026-05-18"
updated: "2026-05-18"
---

# Debug Session: subtitle-drift-splitting

## Symptoms

- expected_behavior: "竖屏成品字幕应与最终音视频严格对齐；字幕拆分应遵循语义边界，不把下一句的一两个字粘到上一句，也不提前断句。"
- actual_behavior: "部分自动化竖屏任务字幕准确，部分任务在局部时段出现漂移；样本任务在 18s-24s 漂移；多任务存在字幕拆分边界不稳定。"
- error_messages: "未报告显式错误；问题表现为最终视频字幕时间轴和分句质量异常。"
- timeline: "近期交给自动化的任务中偶发出现。"
- reproduction: "检查样本任务 xai_vertical_queue/1779063120041_2m166a8/vertical_output.mp4，重点看 18s-24s；对比同类自动化任务的字幕产物和生成链路。"

## Current Focus

- hypothesis: "字幕漂移和断句问题可能来自竖屏合成链路中字幕源、音频裁剪/拼接、时间缩放或文本重分段之间的契约不一致。"
- test: "追踪样本任务从文案、TTS/ASR、字幕片段到 ffmpeg overlay/ASS/SRT 的全部中间产物，找出首个发生偏差的环节。"
- expecting: "已定位到 reference-text-authority 的 LLM 分配输入被 ASR 边界碎片污染，LLM 结果校验失败后旧链路又沉默转入 deterministic fallback，最终把 ASR 碎片边界渲染成成品字幕。最终修复改为严格 LLM 输入清洗、结构化原子分配、验证失败重试，不允许未验证兜底进入渲染。"
- next_action: "resolved; monitor future ASR reference-authority jobs for strict retry failures"
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "Sample job runtime artifacts exist under data/uploads/xai_vertical_queue/1779063120041_2m166a8. The final render input uses source.mp4 plus subtitles.json; reference_subtitles.json contains four semantic source blocks."
  source: "data/uploads/xai_vertical_queue/1779063120041_2m166a8/task.json; data/uploads/xai_vertical_queue/1779063120041_2m166a8/reference_subtitles.json"
  implication: "The issue can be investigated before final ffmpeg overlay by comparing reference_subtitles.json, audio.json, and subtitles.json."

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "subtitles.json and audio.json already contain mid-phrase boundaries before rendering: e.g. [17.92,20.32] '这意味着比特币正被认真' followed by [20.32,23.42] '考虑作为国家层面的价值储存工具'; earlier blocks also split '美国/政府...' and '可/分割...'."
  source: "data/uploads/xai_vertical_queue/1779063120041_2m166a8/subtitles.json; data/uploads/xai_vertical_queue/1779063120041_2m166a8/audio.json"
  implication: "The subtitle splitting bug is upstream of subtitle card generation and ffmpeg composition."

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "vertical_queue.log shows ASR ran with reference text authority, then logged '参考文本权威分配结果未通过原文校验，使用保守规则兜底。' before writing 13 subtitles."
  source: "data/uploads/xai_vertical_queue/1779063120041_2m166a8/vertical_queue.log"
  implication: "The sample followed the deterministic reference-authority fallback after LLM grouping validation failed."

- timestamp: "2026-05-18T10:00:00+08:00"
  observation: "The concrete LLM failure was bad input segmentation, not a generic provider outage. The reference block starting at 13.3s could receive a short orphan ASR fragment from the previous block such as '产。'. That fragment is not part of the current reference text, so the generated atom timing became too short and validation rejected the LLM output with reasons such as duration_too_short_for_atom_span."
  source: "python/pipeline/run_asr.py collect_asr_entries_for_reference(); sample replay in data/uploads/xai_vertical_queue/1779063120041_2m166a8"
  implication: "LLM quality depends on sending only the ASR segments that belong to the current reference block. The fix trims boundary orphan fragments before building the LLM prompt, then retries LLM grouping with the exact validation reason when output still fails."

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "Replaying build_reference_authority_subtitles(..., use_llm=False) with the sample audio.json and reference_subtitles.json reproduces the bad final text boundaries, including '但长期看比例会逐步上升。这意味着比特币正被认真' / '考虑作为国家层面的价值储存工具'."
  source: "python/pipeline/run_asr.py deterministic fallback; local reproduction script using saved sample artifacts"
  implication: "Root cause is in deterministic fallback splitting, not nondeterministic render timing."

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "build_reference_authority_entries() joins reference chunks, then calls split_reference_text_by_asr_segments(), assigning reference text to ASR segment boundaries. That preserves ASR/filetrans mid-phrase segmentation when LLM grouping is unavailable or rejected."
  source: "python/pipeline/run_asr.py"
  implication: "Fallback must derive display subtitle chunks from reference readability/semantic atoms first, then map those chunks onto ASR timing, instead of treating ASR segment boundaries as display boundaries."

- timestamp: "2026-05-18T00:00:00+08:00"
  observation: "Final implementation does not rely on deterministic boundary repair. In production reference-text-authority mode, run_asr.py requires strict LLM/reference_atoms grouping, retries failed grouping, rejects ASR-index grouping when readable atoms are available, and raises REFERENCE_AUTHORITY_ALIGNMENT_FAILED if validation still fails. The vertical queue catches that code and retries the full ASR stage once before failing."
  source: "python/pipeline/run_asr.py; python/script_protocol.py; server/services/vertical/queue.js"
  implication: "Automation now retries toward a verified high-quality subtitle product instead of silently rendering unverified fallback subtitles."

- timestamp: "2026-05-18T10:02:00+08:00"
  observation: "After strict ASR rerun and render replay, the sample produces 14 verified subtitles. The previously bad segments are now [8.0,11.4] '他直言比特币比黄金更便携、可分割，' and [19.84,23.42] '这意味着比特币正被认真考虑作为国家层面的价值储存工具'."
  source: "data/uploads/xai_vertical_queue/1779063120041_2m166a8/subtitles.json; public/xai_vertical_queue/1779063120041_2m166a8/vertical_output.mp4"
  implication: "The public sample video has been rerendered from strict, verified subtitles rather than from fallback subtitles."

## Eliminated

- hypothesis: "Final ffmpeg subtitle-card overlay causes 18s-24s drift."
  reason: "The same bad boundaries are already present in subtitles.json/audio.json before make_vertical_video.py renders subtitle cards. ffmpeg only overlays those cards on the supplied timestamps."

- hypothesis: "The issue is only caused by a one-off LLM rewrite."
  reason: "The saved log shows the LLM allocation failed validation and the bad output is exactly reproducible with use_llm=False deterministic fallback."

## Resolution

- root_cause: "The LLM failed because its reference-authority input could include ASR fragments that did not belong to the current reference block, for example a short previous-block orphan like '产。'. That polluted atom timing and made the LLM grouping fail strict validation. The old production path then projected reference text onto ASR segment boundaries as a fallback, so Filetrans mid-phrase splits became final subtitle boundaries such as '这意味着比特币正被认真' / '考虑作为...' and '可' / '分割'. These bad subtitles existed before rendering; ffmpeg only displayed them."
- fix: "Production reference-text-authority mode now trims boundary orphan ASR fragments before building the LLM prompt, uses strict structured reference_atoms grouping, records exact validation reasons, retries LLM grouping, rejects ASR-index grouping in strict mode, raises REFERENCE_AUTHORITY_ALIGNMENT_FAILED if strict verification still fails, and lets the vertical queue retry the full ASR stage before failing. The old deterministic fallback remains only as a non-strict library path for legacy/unit coverage, not for run_asr.py automation."
- verification: "Strict sample ASR rerun and make_vertical_video rerun succeeded, then public/xai_vertical_queue/1779063120041_2m166a8/vertical_output.mp4 and its meta subtitles were updated. Final regressions passed: python -m unittest python.tests.test_run_asr_filetrans (52 tests), python -m unittest python.tests.test_make_vertical_video (10 tests), npm test -- server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand (5 tests), npm run lint -- --quiet."
- files_changed: "python/pipeline/run_asr.py; python/script_protocol.py; python/tests/test_run_asr_filetrans.py; server/services/vertical/queue.js; server/services/vertical/__tests__/queueAsrFileUrl.test.js; .planning/debug/subtitle-drift-splitting.md"
