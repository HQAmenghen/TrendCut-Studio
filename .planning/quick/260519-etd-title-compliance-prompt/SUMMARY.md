---
status: complete
quick_id: 260519-etd
completed: 2026-05-19
---

# Quick Task 260519-etd Summary

已将封面标题生成提示词从“财经/科技爆点标题”调整为“财经/科技/海外 Web3 观察类标题”，并要求虚拟货币相关内容优先使用海外观察、监管边界、风险提示和技术争议表达。

## Changed

- `python/pipeline/prompt_skills/generate_title_skill.md` 改为克制、客观的信息钩子，不再鼓励强刺激爆点。
- 增加虚拟货币相关内容的合规约束，禁止“暴涨、抄底、上车、冲十万/百万、谁还拦得住、利好、牛市、起飞”等投资动员或行情鼓动表达。
- 禁止标题暗示购买、兑换、交易、挖矿、空投、收益、价格目标或名人/机构背书。
- 示例标题改为“支付合规怎么变？”“监管边界在哪？”“海外争议怎么看？”等风险观察风格。

## Verification

- Passed: prompt Markdown can still render through `text.format(transcript=...)` with the `{transcript}` placeholder replaced.
