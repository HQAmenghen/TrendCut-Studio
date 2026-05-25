---
status: in-progress
quick_id: 260519-eyt
created: 2026-05-19
---

# Quick Task 260519-eyt: 放宽封面标题生成提示词的流量感同时保留视频号虚拟货币安全边界

## Goal

在上一版合规标题提示词基础上，恢复短视频封面应有的冲突感、悬念和点击欲望，同时继续避开虚拟货币交易引导、收益承诺、价格预测和导流表达。

## Tasks

1. 调整 `python/pipeline/prompt_skills/generate_title_skill.md` 的角色和目标，从“克制观察”改为“有流量感但有安全边界”。
2. 放宽虚拟货币标题中的冲突表达，允许机构博弈、监管难题、金融旧规则等角度。
3. 保留对买卖、收益、价格目标、教程、私信进群等高风险表达的禁止规则。
4. 校验 prompt 模板仍能通过 `.format(transcript=...)` 正常渲染。
