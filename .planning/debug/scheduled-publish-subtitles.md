---
status: resolved
trigger: "检查日志排查原因，为什么我的任务不对，早上应该是带数字人的任务才对，而且也没有成功发送，只是创建了任务，并且创建的竖屏任务，的中文字幕没有。排查并且解决这3个问题。1.配置的定时任务内容错误2.任务没有发布3.竖屏任务的中文字幕没有翻译。还是原视频的英文"
created: "2026-05-08"
updated: "2026-05-08"
---

# Debug Session: scheduled-publish-subtitles

## Symptoms

- Expected behavior: Morning scheduled publishing should create and send "带数字人" tasks, and generated vertical videos should include translated Chinese subtitles.
- Actual behavior: The configured scheduled task content is wrong, the workflow only creates a task without publishing/sending it, and vertical task subtitles remain in the source video's English instead of Chinese.
- Error messages: User reports no visible send success; logs need inspection.
- Timeline: Reported on 2026-05-08 after morning scheduled tasks.
- Reproduction: Trigger the configured publish automation for the morning schedule and inspect created vertical task output subtitles.

## Current Focus

- hypothesis: confirmed multi-cause failure in AutoPilot avatar preset resolution, scheduled publish task status reconciliation, and vertical ASR translation handoff
- test: scheduler/publish/vertical logs, publish DB rows, subtitle artifacts, preset resolver checks, targeted Jest/unittest suites, ESLint
- expecting: future scheduled jobs remain `scheduled_wait`, vertical queue ASR requests Chinese subtitle backfill, and unattended avatar generation falls back to an available paired image preset
- next_action: monitor next scheduled run; rerun affected jobs if the existing rendered videos need regenerated Chinese subtitle cards
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-08T01:19:22.090Z
  source: data/logs/scheduler.log
  finding: At 2026-05-08 07:30 Asia/Shanghai (`2026-05-07T23:30:00Z`), AutoPilot started with both vertical and avatar schedules; direct vertical jobs were enqueued and completed, while avatar jobs were queued separately.
- timestamp: 2026-05-08T01:19:22.090Z
  source: data/logs/scheduler.log
  finding: The three created WeChat scheduled jobs were logged as `status:"pending"` with `scheduledAt` values for 12:02, 12:03, and 12:05 local time, followed immediately by warnings that jobs with `scheduledAt` but non-`scheduled_wait` status will not be sent.
- timestamp: 2026-05-08T01:19:22.090Z
  source: python/publish/publish_jobs.db
  finding: The affected jobs (`job_1778197205443`, `job_1778197327209`, `job_1778197685303`) were persisted as `status:"pending"` while their WeChat platform tasks remained `status:"rpa_available"`, so due-job selection skipped them.
- timestamp: 2026-05-08T01:19:22.090Z
  source: data/logs/scheduler.log
  finding: Avatar-mode morning jobs failed before publish with `未找到可用人物图片（image preset）`, so the expected "带数字人" morning path never produced publishable videos.
- timestamp: 2026-05-08T01:19:22.090Z
  source: python/publish/platform_config.json and public/presets
  finding: Current avatar config references missing image preset `f031330ba1e17e22843d47b9d4f3cc08.png`; the paired audio preset `毕.mp3` exists and resolves by stem to available image preset `毕.png`.
- timestamp: 2026-05-08T01:40:00.000Z
  source: python/publish/platform_config.json
  finding: Runtime avatar config was updated to use existing image preset `毕.png`; both `毕.mp3` and `毕.png` now exist on disk.
- timestamp: 2026-05-08T01:19:22.090Z
  source: data/logs/vertical_queue.log
  finding: Vertical ASR logged source language `en` and `跳过 LLM 字幕精修与翻译，直接使用 ASR 原始文本`, confirming the translation stage was not requested.
- timestamp: 2026-05-08T01:19:22.090Z
  source: data/uploads/xai_vertical_queue/*/subtitles.json
  finding: Affected subtitle entries had English text duplicated into `zh`, `en`, and `text`, so the renderer treated translation as complete and produced English subtitle cards.

## Eliminated

- The WeChat account sessions for Web4plus, Web3plus, and RWAplus were logged as valid during login checks; this was not a login failure for those three accounts.
- AI review did not block the direct vertical publish tasks; each affected vertical job logged `reviewStatus:"passed"` before publish task creation.

## Resolution

- root_cause: AutoPilot had three independent failure points: stale avatar image preset config broke morning digital-human generation; scheduled publish jobs were reconciled from `scheduled_wait` to `pending` because platform tasks were rebuilt as `rpa_available`; vertical queue ASR never requested Chinese subtitle translation and wrote English into the `zh` field.
- fix: Added scheduled job/task normalization and recovery, made new scheduled jobs write platform tasks as `scheduled_wait`, trimmed trailing blank schedule slots, enabled `--translate-subtitles` for vertical queue ASR, added LLM Chinese subtitle backfill in `run_asr.py`, added unattended avatar preset fallback from related preset stem before first available, and corrected the current runtime avatar image preset to `毕.png`.
- verification: `npm test -- --runTestsByPath server/services/publish/__tests__/scheduling.test.js server/services/vertical/__tests__/queueAsrFileUrl.test.js server/services/system/__tests__/scheduler.test.js` passed (14 tests); `python -m unittest python.tests.test_run_asr_filetrans` passed (6 tests); `npm run lint` passed; `git diff --check` returned no whitespace errors; runtime avatar config was parsed and verified to point to existing `毕.mp3` and `毕.png`.
- files_changed: `server/services/publish/store.js`, `server/services/publish/handlers.js`, `server/services/system/scheduler.js`, `server/services/vertical/queue.js`, `server/services/materialDriven/autoStart.js`, `python/pipeline/run_asr.py`, `python/publish/platform_config.json` (runtime config), `server/services/publish/__tests__/scheduling.test.js`, `server/services/vertical/__tests__/queueAsrFileUrl.test.js`, `python/tests/test_run_asr_filetrans.py`

## Specialist Review

- not_invoked: No matching specialist review tool is callable in this session; targeted tests and lint passed locally.
