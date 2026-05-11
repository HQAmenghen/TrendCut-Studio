---
status: resolved
trigger: "检查最新任务字幕错误：字幕/口播出现 Strategy CEO Phong Le 和 600 亿美元比特币相关旧脚本文案，但原帖简介应为 Stock Market hits 7,400 for first time in history; Tom Lee calls for 7,700+ by year end and one of biggest rallies in 2027 / @BMNRBullz - 股市首次触及7400点；Tom Lee预测年底前将达到7700点以上，并称这是2027年最大涨幅之一。人名错了，需要找到具体错误原因并修复。"
created: "2026-05-09"
updated: "2026-05-09"
---

# Debug Session: latest-subtitle-wrong-person

## Symptoms

- expected_behavior: "最新任务的字幕和口播应基于原帖简介：Stock Market hits 7,400 for first time in history; Tom Lee calls for 7,700+ by year end and one of biggest rallies in 2027 / @BMNRBullz - 股市首次触及7400点；Tom Lee预测年底前将达到7700点以上，并称这是2027年最大涨幅之一。"
- actual_behavior: "最新任务字幕/脚本混入旧文案：Strategy CEO Phong Le最新表态：'我相信数学胜过意识形态'，并提到 600 亿美元比特币。"
- error_messages: "无显式报错；表现为生成内容主题和人名错误。"
- timeline: "用户反馈发生在 2026-05-09 的最新任务。"
- reproduction: "检查最新任务产物，定位字幕/脚本来源，追踪从 Top10/自动化任务到脚本生成、字幕生成、竖屏合成的链路。"

## Current Focus

- hypothesis: "Resolved: wrong source was a likely misclick, and the remaining subtitle defects were caused by weak term protection during ASR/reference alignment."
- test: "Compared latest task artifacts and covered term extraction/reference repair with unit tests."
- expecting: "Future subtitle alignment preserves 'Phong Le' even when English names touch Chinese text, and only repairs '每股' to '美股' in stock-market contexts."
- next_action: "none"
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-09T16:43:06+08:00
  observation: "Latest project directory by mtime is projects/material_1778309787644_d05af314."
  source: "Get-ChildItem projects -Directory sorted by LastWriteTime"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "projects/material_1778309787644_d05af314/source_post.json already contains the Strategy/Phong text, postUrl https://x.com/DocumentingBTC/status/2052896454608330953, and materialUrl https://video.twimg.com/amplify_video/2052822687769108487/vid/avc1/1920x1080/WVBUfka2L3LHukMr.mp4."
  source: "projects/material_1778309787644_d05af314/source_post.json"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "The same Strategy/Phong copy appears downstream in script_units.json, script_polisher_skill.json, execution_plan.json, aiman_audio.json, aiman_reference_subtitles.json, and aiman_subtitles.json, proving the subtitle generator was not the first place the wrong text appeared."
  source: "rg Phong/600亿美元/Strategy in projects/material_1778309787644_d05af314"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "Current python/xai/result.json rank 1 is the expected BMNRBullz item: post_id 2052826049046536201, video_url https://video.twimg.com/amplify_video/2052823809594392577/vid/avc1/1920x1080/vYYc7Ydh59Mhhq0D.mp4, author_summary Stock Market hits 7,400..., author_summary_zh 股市首次触及7400点..."
  source: "node JSON inspection of python/xai/result.json"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "Current python/xai/result.json rank 4 is the actual latest project source: DocumentingBTC post_id 2052896454608330953 with the Strategy/Phong summary and matching video URL."
  source: "node JSON inspection of python/xai/result.json"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "Server log shows the latest material-driven job downloaded the rank-4 DocumentingBTC video URL at 2026-05-09T06:56:27Z; scheduler.log has no matching AutoPilot enqueue at that time, so this path came through the material-driven start route rather than scheduled AutoPilot."
  source: "data/logs/server.log and data/logs/scheduler.log"
- timestamp: 2026-05-09T16:43:06+08:00
  observation: "The source provenance path was weak: material-driven task state and recovered frontend state did not persist/rehydrate the exact xAI source author, post id, post URL, and video URL, so stale or crossed client source state could enter the start request without durable identity checks."
  source: "frontend/src/composables/useMaterialDriven.js, server/routes/materialDriven.js, server/services/materialDriven/taskState.js, server/services/materialDriven/autoStart.js"
- timestamp: 2026-05-09T17:03:00+08:00
  observation: "Added focused registry coverage proving recovered legacy tasks expose source_post.json identity when task_state.json lacks source metadata."
  source: "server/services/materialDriven/__tests__/taskRegistry.test.js"
- timestamp: 2026-05-09T17:03:19+08:00
  observation: "aiman_reference_subtitles.json had correct 'Phong Le', while aiman_subtitles.json and aiman_audio.json had 'Phong在'/'Phong说'. The term extractor previously failed on Latin names adjacent to CJK text, so placeholders did not protect 'Phong Le' during LLM reference alignment."
  source: "projects/material_1778309787644_d05af314/aiman_reference_subtitles.json; projects/material_1778309787644_d05af314/aiman_subtitles.json; python/pipeline/subtitle_terms.py"
- timestamp: 2026-05-09T17:03:19+08:00
  observation: "Patched latest standalone runtime subtitles and re-rendered standalone_1778314112341_c38c683a/standalone_output_vertical.mp4 from corrected subtitle JSON."
  source: "data/uploads/runtime_jobs/standalone_1778314112341_c38c683a/subtitles.json; make_vertical_video.py rerender"

## Eliminated

## Resolution

- root_cause: "The latest task was seeded from the DocumentingBTC Strategy/Phong xAI item (current rank 4), not the expected BMNRBullz/Tom Lee item (current rank 1); the wrong source copy was already present in source_post.json before script/subtitle generation. Separately, subtitle alignment failed to preserve 'Phong Le' because English proper-noun extraction used word-boundary logic that did not handle Latin names adjacent to CJK characters, and there was no context-aware repair for stock-market homophones like '每股首次' -> '美股首次'."
- fix: "Persist and rehydrate full xAI source identity through material-driven state/start/recovery, add source/video mismatch guarding, make subtitle term extraction ASCII-boundary aware, repair truncated reference terms after LLM alignment, add context-aware '每股' -> '美股' correction only for stock-market contexts, patch the latest task subtitle JSON caches, and re-render the latest standalone vertical video."
- verification: "Passed: npm test -- --runTestsByPath server/services/materialDriven/__tests__/taskState.test.js server/services/materialDriven/__tests__/taskRegistry.test.js; npm test -- --runTestsByPath server/services/system/__tests__/scheduler.test.js; npx eslint server/routes/materialDriven.js server/services/materialDriven/taskState.js server/services/materialDriven/taskRegistry.js server/services/materialDriven/autoStart.js server/services/materialDriven/__tests__/taskState.test.js server/services/materialDriven/__tests__/taskRegistry.test.js; npm run build:front; python -m unittest python.tests.test_subtitle_terms python.tests.test_run_asr_filetrans python.tests.test_make_vertical_video; manual rerender of data/uploads/runtime_jobs/standalone_1778314112341_c38c683a/standalone_output_vertical.mp4."
- files_changed: "frontend/src/composables/useMaterialDriven.js; server/routes/materialDriven.js; server/services/materialDriven/autoStart.js; server/services/materialDriven/taskRegistry.js; server/services/materialDriven/taskState.js; server/services/materialDriven/__tests__/taskRegistry.test.js; server/services/materialDriven/__tests__/taskState.test.js; python/pipeline/subtitle_terms.py; python/pipeline/run_asr.py; python/pipeline/make_vertical_video.py; python/tests/test_subtitle_terms.py; python/tests/test_run_asr_filetrans.py; python/tests/test_make_vertical_video.py; latest runtime subtitle artifacts"
- specialist_hint: "general"
