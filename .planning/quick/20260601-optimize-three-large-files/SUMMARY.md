---
title: Optimize Three Large Files
status: completed
completed_at: "2026-06-01T15:52:00+08:00"
---

# Optimize Three Large Files

## Summary

对当前三个热点大文件做了有明确职责边界的拆分，避免为了降低行数而制造碎片化抽象。

## Changes

- 从 `AutomationDashboard.vue` 抽出 `PublishComposerModal.vue`，发布信息弹窗的模板、按钮和账号下拉交互归入独立组件，父组件保留发布业务编排。
- 从 `run_asr.py` 抽出 `asr_filetrans.py`，集中管理 Qwen Filetrans、OSS 上传、公网 URL 判定和任务轮询。
- 从 `run_asr.py` 抽出 `asr_filetrans_parse.py`，集中管理 Filetrans payload、句级时间、词级时间和英文 token 拼接解析。
- 从 `run_material_driven.py` 抽出 `material_text.py`，集中管理素材驱动流程的文本清理、句子规范化、口播时长估算和语义分组。
- 为新抽出的 Python 工具模块补充聚焦单元测试。

## Size Impact

- `python/pipeline/run_asr.py`: 2810 行 -> 2566 行
- `python/pipeline/run_material_driven.py`: 1772 行 -> 1727 行
- `frontend/src/components/AutomationDashboard.vue`: 2122 行 -> 2028 行

## Verification

- `python -m unittest python.tests.test_material_text python.tests.test_asr_filetrans_parse python.tests.test_run_asr_filetrans`
- `npm run build:front`
- `npm run lint`
- `npm test -- --runInBand`
- `git diff --check`
