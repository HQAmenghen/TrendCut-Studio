---
status: root_cause_found
trigger: "AI账号分区榜单抓取最后只抓到一个，查看日志排查原因"
created: 2026-05-12
updated: 2026-05-12T11:08:53+08:00
---

# Debug Session: ai-account-rank-one

## Symptoms

- expected_behavior: AI账号分区榜单抓取应返回配置的榜单数量或候选账号数量。
- actual_behavior: 最近一次运行最后只抓到一个结果。
- error_messages: 用户未提供前端错误；需要从本地日志确认。
- timeline: 用户刚运行一次后发现。
- reproduction: 在控制台运行 AI账号分区的榜单抓取。

## Current Focus

- hypothesis: 已确认不是前端/后端传参把数量限制为 1，也不是 AI 分区账号池只剩 1 个；最近一次运行的候选扫描阶段在严格过滤下只产出 1 个可进入 enrich 的候选。
- test: 已检查最近一次 AI 分区运行日志、错误日志、结果 JSON、候选缓存、账号配置、Python 候选/最终截断逻辑、后端启动参数和前端触发参数。
- expecting: 最新运行窗口中 20 个 AI 账号均被扫描，19 个账号候选为空，只有 `Aravind` 有 1 条候选；脚本最终 Top10 截断不会把多条候选压成 1 条。
- next_action: diagnosis complete; decide whether product behavior should relax eligibility filters, widen the time window, or improve empty-result UI messaging.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-12T11:00:00+08:00
  observation: `python/xai/run_log.ai.txt` shows the AI partition scanned 20 accounts and completed normally with `1 raw candidates, 1 selected for enrich`; no errors were written to `run_error.ai.log`.
  source: `python/xai/run_log.ai.txt`
- timestamp: 2026-05-12T11:00:00+08:00
  observation: `python/xai/result.ai.json` contains one item, `@Aravind` / `https://x.com/Aravind/status/2053719870798541135`, with `views: 570348`; time range is `2026-05-11T10:57:00+08:00` to `2026-05-12T10:57:00+08:00`.
  source: `python/xai/result.ai.json`
- timestamp: 2026-05-12T11:00:00+08:00
  observation: `python/xai/xai_top10_cache.json` has cached candidate arrays for all 20 AI accounts in this run window; 19 are empty and `Aravind` has exactly one candidate.
  source: `python/xai/xai_top10_cache.json`
- timestamp: 2026-05-12T11:00:00+08:00
  observation: `python/xai/run_xai_top10.py` only requests up to 10 enrich candidates and final top 10, but no code path limits the AI partition to 1. Candidate prompt excludes posts unless they are within 24 hours, clearly contain video, and have verified views >= 15000.
  source: `python/xai/run_xai_top10.py`
- timestamp: 2026-05-12T11:00:00+08:00
  observation: `server/services/xai/service.js` passes only `--partition-id ai` plus partition-specific result/log paths; it does not pass a rank/limit value that would force a single result.
  source: `server/services/xai/service.js`
- timestamp: 2026-05-12T11:08:53+08:00
  observation: `python/xai/xai_accounts.json` has `activePartitionId: "ai"` and 20 configured AI accounts. The latest `run_log.ai.txt` reports `Starting candidate scan for 20 accounts in partition ai`, matching that config.
  source: `python/xai/xai_accounts.json`, `python/xai/run_log.ai.txt`
- timestamp: 2026-05-12T11:08:53+08:00
  observation: For cache keys in the latest AI window `2026-05-11T10:57:00+08:00` to `2026-05-12T10:57:00+08:00`, 19 AI accounts have `0` cached candidates and `Aravind` has `1`.
  source: `python/xai/xai_top10_cache.json`
- timestamp: 2026-05-12T11:08:53+08:00
  observation: `run_xai_top10.py` candidate scan dedupes and selects `[:ENRICH_LIMIT]`, then final output sorts eligible items and takes `[:10]`; there is no `[:1]` or user rank parameter in this path.
  source: `python/xai/run_xai_top10.py:1322`, `python/xai/run_xai_top10.py:1388`
- timestamp: 2026-05-12T11:08:53+08:00
  observation: Frontend `useXaiTop10.run()` posts only `{ clientId, partitionId }` to `/api/xai-top10/run`. Backend `createXaiService.run()` passes only `--partition-id`, `--result`, `--partial`, `--log`, and `--error-log` to Python. No frontend/backend request parameter can force result count to one.
  source: `frontend/src/composables/useXaiTop10.js:275`, `server/services/xai/service.js:345`

## Eliminated

- hypothesis: AI 分区账号池只配置了 1 个账号。
  reason: `xai_accounts.json` contains 20 AI accounts and the run log confirms all 20 were scanned.
- hypothesis: 前端运行按钮传了 rank/limit=1。
  reason: `useXaiTop10.run()` sends only `clientId` and `partitionId`.
- hypothesis: 后端服务向 Python 传了 limit/rank 参数导致只取 1 条。
  reason: backend invokes Python with partition and file path arguments only.
- hypothesis: Python 最终排序阶段把多条结果硬截断为 1 条。
  reason: candidate enrich limit is `ENRICH_LIMIT` and final ranking uses `[:10]`; the single output follows from only one eligible candidate entering/enriching.
- hypothesis: 最近一次运行因为错误提前退出导致结果不完整。
  reason: `run_error.ai.log` is empty and `run_log.ai.txt` shows a normal finish with saved result.

## Resolution

- root_cause: The run completed successfully, but the candidate scan stage produced only one eligible candidate. The AI partition had 20 configured accounts and all 20 were scanned; for the latest 24-hour window, cached xAI candidate arrays are empty for 19 accounts and contain exactly one `Aravind` candidate. The Python prompt/filter requires last-24-hour posts that clearly contain video media and have verified views >= 15000, so the final Top10 list legitimately had only one eligible input item.
- fix: Diagnosis only; no code fix applied.
- verification: Cross-checked run log, empty error log, result JSON, per-account cache entries, AI account config, Python selection/final ranking code, backend script arguments, and frontend trigger payload.
- files_changed: `.planning/debug/ai-account-rank-one.md`
