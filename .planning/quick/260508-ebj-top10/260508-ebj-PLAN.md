# Quick Task 260508-ebj: Top10 分区账号池与自动发布分区接入

## Goal

改进 top10 账号监控模块，支持可扩展分区账号池、按分区抓取榜单，并让自动发布链路可以为不同账号槽选择对应分区榜单。

## Tasks

1. Backend and Python partition model
   - Add backward-compatible xAI account partition config normalization.
   - Persist/read result, partial, log, and error files per partition.
   - Pass selected partition into `python/xai/run_xai_top10.py` and include partition metadata in results.

2. Frontend Top10 partition UX
   - Add partition switcher, partition creation/removal, per-partition account editing, and partition-aware refresh/run/export/queue actions.
   - Keep current single-pool behavior working through the default crypto partition.

3. Auto-publish integration
   - Extend publish config schedules with per-rank `partitionIds`.
   - Let the scheduler fetch/use the right partition result for each automation slot.
   - Surface partition selection and generated job partition labels in the publish center.

## Verification

- Run focused Jest suites for xAI service and scheduler behavior.
- Run lint/build checks where feasible without disturbing unrelated dirty runtime files.
