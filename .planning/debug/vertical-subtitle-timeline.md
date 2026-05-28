---
status: resolved
trigger: "竖屏合成任务 standalone_output_vertical.mp4 字幕轴对不上，疑似切块过大导致时间轴错位"
created: 2026-05-26
updated: 2026-05-26
---

## Symptoms
- expected_behavior: 竖屏合成后的字幕应与最终视频音频时间轴一致。
- actual_behavior: `data/uploads/runtime_jobs/standalone_1779775191856_788fc555/standalone_output_vertical.mp4` 这类任务字幕轴对不上。
- error_messages: 未提供显式报错，表现为成片字幕错位。
- timeline: 当前稳定化排查。
- reproduction: 使用 standalone 竖屏合成任务，尤其疑似存在较大切块时。

## Current Focus
- hypothesis: 字幕输入时间轴与最终拼接/切块后的视频时间轴没有使用同一基准，或字幕重新分块时过度合并导致跨剪辑显示。
- test: 检查具体 runtime job 产物、standalone 合成服务、Python 竖屏渲染脚本，以及相关单元测试。
- expecting: 找到字幕时间轴写入 ASS/FFmpeg overlay 前的错误转换点，并添加回归测试。
- next_action: gather initial evidence

## Evidence
- timestamp: 2026-05-26T14:58:03+08:00
  observation: Reported job input/output durations both ffprobe to 39.320s, so the container duration is not drifting.
  source: data/uploads/runtime_jobs/standalone_1779775191856_788fc555/standalone_input.mp4 and standalone_output_vertical.mp4
- timestamp: 2026-05-26T14:58:03+08:00
  observation: The ASR timeline in audio.json has 10 timed spans, including adjacent repeated reference text at 10.24-16.24/16.24-18.80 and 18.80-24.68/24.68-28.48.
  source: data/uploads/runtime_jobs/standalone_1779775191856_788fc555/audio.json
- timestamp: 2026-05-26T14:58:03+08:00
  observation: Render-time subtitles.json had already been collapsed to 8 spans, merging adjacent repeated text into 10.24-18.80 and 18.80-28.48 before subtitle card generation.
  source: data/uploads/runtime_jobs/standalone_1779775191856_788fc555/subtitles.json
- timestamp: 2026-05-26T14:58:03+08:00
  observation: make_vertical_video.py deduplicate_subtitles merged same-text entries when next_start <= current_end + 0.15, so boundary-adjacent ASR spans were treated as duplicates.
  source: python/pipeline/make_vertical_video.py
- timestamp: 2026-05-26T14:58:03+08:00
  observation: Regression test confirms adjacent repeated reference text now preserves separate ASR windows, while true overlapping duplicates still merge.
  source: python/tests/test_make_vertical_video.py
- timestamp: 2026-05-26T15:05:00+08:00
  observation: reference_subtitles.json can contain adjacent duplicate long reference text blocks, and reference-text-authority alignment previously processed each block separately, allowing the same long text to be assigned more than once.
  source: data/uploads/runtime_jobs/standalone_1779775191856_788fc555/reference_subtitles.json; python/pipeline/run_asr.py
- timestamp: 2026-05-26T15:05:00+08:00
  observation: Regression test confirms adjacent duplicate reference blocks are collapsed before ASR timing assignment.
  source: python/tests/test_run_asr_filetrans.py
- timestamp: 2026-05-26T15:37:00+08:00
  observation: For short standalone/avatar narration, full `narration.json` text is now preferred as a single global reference window before falling back to execution-plan or avatar-segment subtitles.
  source: server/services/vertical/standalone.js; server/services/vertical/queue.js; server/services/vertical/taskImport.js
- timestamp: 2026-05-26T16:20:00+08:00
  observation: Reference-authority readable atoms were capped near 24 chars, but allowed atom ranges, text validation, reference-timing fallback, and final continuation merging could still produce Chinese/mixed display groups above the two-row subtitle limit.
  source: python/pipeline/run_asr.py
- timestamp: 2026-05-26T16:20:00+08:00
  observation: Regression coverage now rejects overlong LLM atom groups, removes >24 Chinese/mixed groups from allowed ranges, and verifies deterministic fallback output stays within the display cap.
  source: python/tests/test_run_asr_filetrans.py

## Eliminated
- hypothesis: Final MP4 duration mismatch causes subtitles to drift.
  reason: ffprobe reports both source and vertical output are 39.320s.

## Resolution
- root_cause: Two issues combined: earlier timeline fixes handled duplicate reference blocks and adjacent same-text ASR spans, but reference-text-authority grouping still allowed Chinese/mixed LLM, fallback, and post-merge display groups above the two-row subtitle limit.
- fix: Prefer one full narration reference window for short standalone/avatar ASR refreshes; collapse adjacent duplicate reference blocks in `run_asr.py`; tighten `make_vertical_video.py` adjacent duplicate handling; hard-cap reference-authority Chinese/mixed display groups at 24 visible chars across prompt instructions, allowed atom ranges, validation, deterministic/reference fallback, and final output enforcement.
- verification: `python -m unittest python.tests.test_run_asr_filetrans`; prior verification also covered `python -m unittest python.tests.test_make_vertical_video` and the vertical Jest suites.
- files_changed: python/pipeline/run_asr.py; python/pipeline/make_vertical_video.py; python/tests/test_run_asr_filetrans.py; python/tests/test_make_vertical_video.py; server/services/vertical/taskImport.js; server/services/vertical/standalone.js; server/services/vertical/queue.js; server/services/vertical/__tests__/standaloneTaskImport.test.js; server/services/vertical/__tests__/queueAsrFileUrl.test.js
