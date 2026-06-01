---
status: awaiting_human_verify
trigger: "用户尝试抓取新的 xaitop10 加密榜单，预期运行较久，但任务一下子结束且没有任何反馈信息"
created: 2026-05-29
updated: 2026-05-29
---

# Debug Session: xai-top10-instant-exit-no-feedback

## Symptoms

- expected_behavior: 抓取新的 xAI Top10 加密榜单应持续运行一段时间，并在前端显示进度、状态或错误反馈。
- actual_behavior: 任务很快结束，界面没有明显反馈信息。
- error_messages: 用户未看到错误信息。
- timeline: 当前会话报告，未知是否曾正常工作。
- reproduction: 在控制台触发抓取新的 xAI Top10 加密榜单。

## Current Focus

- hypothesis: 前端/后端在失败或快速返回路径上没有把错误、日志或状态充分展示出来；也可能是 Python runner 早退但返回被吞掉。
- test: 检查 xAI 前端 run/refresh 逻辑、后端 run 逻辑、Python 脚本早退路径和本地日志。
- expecting: 找到某个早退条件、错误响应展示缺口，或日志/status 文件显示实际失败原因。
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-29T10:15:27+08:00
  observation: `python/xai/run_log.txt` shows the crypto partition scanned 34 accounts, collected 0 candidates, then wrote `result.json` successfully.
- timestamp: 2026-05-29T10:15:27+08:00
  observation: `python/xai/run_error.log` shows repeated xAI 403 errors: the team has used all credits or reached the monthly spending limit.
- timestamp: 2026-05-29T10:15:27+08:00
  observation: `python/xai/result.json` contains an empty successful榜单 with `total_items: 0`, so the Node service treated the run as successful and the frontend had no failure to show.

## Eliminated

- hypothesis: 分区账号池为空
  reason: `python/xai/xai_accounts.json` has 34 configured crypto accounts.
- hypothesis: xAI脚本没有启动
  reason: `run_log.txt` shows the script started, used proxy `http://127.0.0.1:7892`, and scanned all accounts.

## Resolution

- root_cause: xAI API returned 403 for every candidate scan because the configured team exhausted credits or hit its monthly spending limit. The script caught each account-level failure, produced an empty successful result, and hid the operational failure from the UI.
- fix: `python/xai/run_xai_top10.py` now aborts when every candidate scan fails before collecting any candidates, preserving legitimate empty results when there are no failures.
- verification: `python -m unittest python.tests.test_xai_top10_prompts`
- files_changed: `python/xai/run_xai_top10.py`, `python/tests/test_xai_top10_prompts.py`
