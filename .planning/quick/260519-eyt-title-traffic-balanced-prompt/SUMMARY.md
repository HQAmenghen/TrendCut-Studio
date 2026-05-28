---
status: complete
quick_id: 260519-eyt
completed: 2026-05-19
---

# Quick Task 260519-eyt Summary

已将封面标题生成提示词从偏保守的合规观察风格，调整为更有短视频流量感的中间档：允许冲突、悬念和反差，但要求虚拟货币相关内容把冲突写在机构博弈、海外监管、技术争议和金融旧规则上。

## Changed

- `python/pipeline/prompt_skills/generate_title_skill.md` 重新强调“有冲突感、有点击欲望”的封面标题目标。
- 虚拟货币相关标题允许“华尔街坐不住了？”“银行这次急了？”“老规则被挑战？”等强悬念表达。
- 保留对买卖、抄底、上车、收益承诺、价格目标、K 线判断、教程、入口、私信、进群等高风险表达的禁止规则。
- 示例从纯风险提示改为更有封面感的“老支付规则难了？”“银行这次急了吗？”“老金融坐不住了？”。

## Verification

- Passed: prompt Markdown can still render through `text.format(transcript=...)` with the `{transcript}` placeholder replaced.
