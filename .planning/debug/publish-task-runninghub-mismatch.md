---
status: resolved
trigger: "用户反馈：现在是否还有运行中的发布任务；设置三个任务成功只有一个，其中一个未知原因没有点击发布按钮；审核中心只有两条成片，但 RunningHub 有三条数字人渲染记录。需要排查原因并给出解决方案。"
created: "2026-05-12"
updated: "2026-05-12"
---

# Debug Session: publish-task-runninghub-mismatch

## Symptoms

- Expected behavior: 三个自动发布任务应各自产生可审核成片，并在到期时完成发布按钮点击或留下明确失败状态。
- Actual behavior: RunningHub 有三条数字人渲染记录，但审核中心只有两条成片；自动发布成功只有一条，另有一条未点击发布按钮，第三条状态不清楚。
- Error messages: 用户未提供具体错误文本；需要从本地数据库、任务产物和日志反查。
- Timeline: 用户当前询问，发生在最近一次设置三个任务后。
- Reproduction: 核对发布任务库、审核库、任务库、RunningHub/调度日志、RPA payload 和产物目录。

## Current Focus

- hypothesis: 自动化链路中数字人渲染、审核入库、发布 RPA 是分离步骤；当前三条 RunningHub 渲染中至少一条未进入审核/发布资产列表，另有发布任务在 WeChat RPA 阶段失败或停留，导致“渲染 3、审核 2、发布成功 1”的数量不一致。
- test: 查询 `python/publish/publish_jobs.db`、`data/ai_review.db`、`data/tasks.db`，并按时间窗口检索 `data/logs/*.log`、`python/publish/wechat_channels_tasks/*.json` 和 `public/`/`projects/` 产物。
- expecting: 找到每个任务的 job id、状态、视频路径、审核记录、RPA 退出/点击日志或缺失点。
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-12T09:11:00+08:00"
  source: `python/publish/publish_jobs.db`
  finding: "Current May 12 publish rows: `1778548215708_b234a7c3` rank 3 is `published`; `1778545930352_ebce7aa2` rank 2 is `published`; `1778544130678_101f1f79` rank 1 is `pending` with WeChat platform status/runtime state `ready_for_manual_publish`, runtime publishMode `draft`, progress 100, lastRunMode `draft`."
- timestamp: "2026-05-12T09:11:00+08:00"
  source: `data/tasks.db`
  finding: "Three May 12 vertical queue jobs all completed: rank 1 `1778543400034_db173kx` completed 2026-05-12T00:01:53Z; rank 2 `1778545440035_5q2u6ja` completed 2026-05-12T00:31:08Z; rank 3 `1778547900021_uidlwvt` completed 2026-05-12T01:09:04Z."
- timestamp: "2026-05-12T09:11:00+08:00"
  source: `public/xai_vertical_queue/*/vertical_output.mp4.meta.json`
  finding: "All three vertical outputs have embedded auto AI review results and passed: rank 1 score 79, rank 2 score 73, rank 3 score 71. No matching rows for these three outputs were found in `data/ai_review.db`, so the review center table is not the source of truth for these autopilot review results."
- timestamp: "2026-05-12T09:11:00+08:00"
  source: `python/publish/wechat_channels_tasks/*.json`
  finding: "Only two old-named WeChat task JSON files were present for the first two created jobs: `1778544130678_101f1f79_wechatChannels.json` and `1778545930352_ebce7aa2_wechatChannels.json`. The rank 1 payload has `publishMode: draft`; rank 2 has `publishMode: publish`."
- timestamp: "2026-05-12T09:11:00+08:00"
  source: `data/logs/server.log` and `data/logs/scheduler.log`
  finding: "Scheduler created and triggered rank 1 at 2026-05-12T00:02:10Z, rank 2 at 2026-05-12T00:32:10Z, and rank 3 at 2026-05-12T01:10:15Z. Rank 2 was auto-archived after publish. Rank 3 reached `published`. Rank 1 later persisted as pending/ready_for_manual_publish."
- timestamp: "2026-05-12T09:11:00+08:00"
  source: `publish_jobs.db` runtime logs inside job `1778544130678_101f1f79`
  finding: "Rank 1 uploaded video, filled description and short title, hid location, completed original declaration flow, then ended with `[ready_for_manual_publish]` and message `操控模式已完成，浏览器将保持打开，等待你手动关闭窗口`; there is no `发表` button click or publish-success verification because the run mode was draft."

## Eliminated

- Runtime rendering failure for the three current items: eliminated. All three vertical queue records are completed and all three MP4/meta files exist.
- AI review rejection for the three current items: eliminated. Embedded auto reviews for all three are `passed`.
- Missing publish task for the third item: eliminated. `1778548215708_b234a7c3` exists and is already `published`; it was created later at 2026-05-12T01:10:15Z after its render/review finished.
- WeChat login failure for the involved accounts as the primary cause: not supported by current evidence. The rank 1 task reached upload/edit/original-declaration completion, so the browser session was usable.

## Resolution

- root_cause: "The mismatch was caused by rank 1 being executed in WeChat `draft` mode, which intentionally stops at `ready_for_manual_publish` after upload/edit/original declaration instead of clicking the final `发表` button; meanwhile the third render finished later and did create/publish a separate publish job, so RunningHub/vertical output count 3 is expected."
- fix: "No code or runtime data changes were applied. Operational fix: manually review and publish job `1778544130678_101f1f79` from the kept-open draft/WeChat assistant state or rerun that job in `publish` mode. Preventive fix direction: make autopilot publish mode explicit and fail/alert when a scheduled autopilot task resolves to `draft`/`ready_for_manual_publish`, and surface embedded auto-review results in the review center or clarify that autopilot reviews live in output metadata."
