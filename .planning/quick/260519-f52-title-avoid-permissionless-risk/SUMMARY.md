---
status: complete
quick_id: 260519-f52
completed: 2026-05-19
---

# Quick Task 260519-f52 Summary

已对 3 个现有 Web3/加密任务只运行标题生成脚本，未触发视频渲染。测试发现模型会把 Jack Dorsey 原帖里的 “can't stop you / permissionless” 改写为“拦不住”“无需许可”一类高风险封面话术，因此补充了更明确的硬性禁词规则。

## Changed

- `python/pipeline/prompt_skills/generate_title_skill.md` 新增规则：不要把“无需许可”“不需要他们允许”“拦不住你”“谁也挡不住”“人人都能用”等原话直接改写成封面标题。
- 进一步硬禁“无需许可”“拦不住”“挡不住”“人人都能用”“不需要允许”“不需要许可”等词组，即使原文出现也要换角度。

## Verification

- Ran: `python python\pipeline\generate_title.py --subtitles projects\material_1779059040030_9727e531\subtitles.json --context projects\material_1779059040030_9727e531\source_post.json`
- Ran: `python python\pipeline\generate_title.py --subtitles projects\material_1779145454263_b97629e5\subtitles.json --context projects\material_1779145454263_b97629e5\source_post.json`
- Ran: `python python\pipeline\generate_title.py --subtitles projects\material_1779089933474_10ae3bbb\subtitles.json --context projects\material_1779089933474_10ae3bbb\source_post.json`
- Final sample outputs avoided the newly banned “无需许可 / 拦不住” phrasing while keeping conflict-driven cover wording.
