---
status: in-progress
quick_id: 260519-f52
created: 2026-05-19
---

# Quick Task 260519-f52: 修正标题提示词避免生成无需许可和拦不住等高风险使用引导表达

## Goal

在仅测试标题生成时发现模型仍会把 Jack Dorsey 原帖里的“permissionless / can't stop you”改写成高风险封面表达，需要保留标题冲突感，同时明确禁止“无需许可”“拦不住”等容易被平台理解为鼓励使用虚拟货币的话术。

## Tasks

1. 对 3 个现有 Web3/加密任务仅运行 `generate_title.py`，不触发完整视频渲染。
2. 根据测试结果补充 `generate_title_skill.md` 的虚拟货币标题硬性禁词。
3. 重新运行同样 3 个标题生成样本，确认输出避开高风险使用引导表达。
