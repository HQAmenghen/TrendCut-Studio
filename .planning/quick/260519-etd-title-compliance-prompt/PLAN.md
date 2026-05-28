---
status: in-progress
quick_id: 260519-etd
created: 2026-05-19
---

# Quick Task 260519-etd: 修改封面标题生成提示词以降低视频号虚拟货币违规风险

## Goal

将自动封面标题生成从强刺激爆点表达调整为更适合视频号的海外 Web3 新闻观察、风险提示和监管边界表达，降低虚拟货币内容被判定为宣传、交易炒作或投资引导的风险。

## Tasks

1. 更新 `python/pipeline/prompt_skills/generate_title_skill.md` 的角色、硬性规则和示例标题。
2. 对虚拟货币相关内容增加禁止投资动员、交易暗示、价格目标和机构背书的生成约束。
3. 校验 prompt 模板仍能通过 `generate_title.py` 的 `.format(transcript=...)` 正常渲染。
