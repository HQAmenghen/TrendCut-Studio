---
status: investigating
trigger: "我昨天设置的自动发布任务没有触发，好像是审核模块，出了问题，排查原因并且修复"
created: 2026-04-24
updated: 2026-04-24
---

# Debug Session: auto-publish-review-not-trigger

## Symptoms

- Expected behavior: Scheduled automatic publish tasks created on 2026-04-23 should trigger at their configured time.
- Actual behavior: The automatic publish task did not trigger.
- Error messages: Unknown at session start.
- Timeline: User reports the task was set yesterday and failed to trigger by 2026-04-24.
- Reproduction: Inspect scheduled publish/review workflow state and run targeted tests around the trigger path.

## Current Focus

- hypothesis: Qwen video review uses qwen3-vl-flash for a title-only text request; DashScope rejects that request, so auto review never writes completed aiReview metadata and AutoPilot skips publish task creation.
- test: targeted unit test plus real title/full review smoke on the failed 2026-04-24 asset
- expecting: title stage uses Qwen text model while video stages keep the configured multimodal model
- next_action: run final verification and summarize
- reasoning_checkpoint:
- tdd_checkpoint: python.tests.test_ai_video_review failed before fix and passes after fix

## Evidence

- timestamp: 2026-04-24
  source: data/logs/server.log and data/logs/scheduler.log
  observation: AutoPilot reached the configured 07:30 Asia/Shanghai flow, queued render jobs, then logged "视频尚未完成 AI 审核，跳过创建发布任务" for completed videos.
- timestamp: 2026-04-24
  source: data/ai_review.db
  observation: Recent review records for xai_vertical_queue assets failed with "审核脚本执行失败 (exit code 1): AI_REVIEW|开始分析标题吸引力" and no protocol details.
- timestamp: 2026-04-24
  source: isolated Python reproduction
  observation: Calling analyze_title_appeal with provider=qwen and model=qwen3-vl-flash raised "InvalidParameter: url error, please check url".
- timestamp: 2026-04-24
  source: python -m unittest python.tests.test_ai_video_review
  observation: Regression test reproduced the bad qwen3-vl-flash title call before the fix and passed after routing text-only title review to QWEN_TEXT_MODEL.
- timestamp: 2026-04-24
  source: python/review/ai_video_review.py full script smoke
  observation: Full review of public/xai_vertical_queue/1776987222750_12i82x7/vertical_output.mp4 completed with exit code 0 after the fix.

## Eliminated

- hypothesis: Scheduled publish due-job scanner failed.
  evidence: python/publish/publish_jobs.db had no publish_jobs_v1 rows, so there was no scheduled publish job to trigger.
- hypothesis: xAI/AutoPilot cron did not run.
  evidence: scheduler.log shows the 2026-04-24 07:30 Asia/Shanghai AutoPilot run started and queued render jobs.
- hypothesis: Rendering failed before publish.
  evidence: tasks.db marks the relevant vertical_queue jobs as completed and public output files exist.

## Resolution

- root_cause: Title review is text-only, but the review script reused the configured Qwen VL model qwen3-vl-flash for that call. DashScope rejected the request with InvalidParameter/url error, auto review returned null, and AutoPilot skipped publish task creation because metadata.aiReview remained missing.
- fix: Route Qwen text-only review requests from multimodal review models to QWEN_TEXT_MODEL/default text fallback before calling the provider.
- verification: python -m unittest python.tests.test_ai_video_review; isolated real title call; full review script smoke on the failed asset.
- files_changed: python/review/ai_video_review.py; python/tests/test_ai_video_review.py
