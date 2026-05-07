# Prompt Skills

这组 markdown 文件是项目里的“提示词 skill 资源”。

目标：
- 把主生产链里真正生效的提示词和模板，从 `.py` 代码里剥离出来
- 以后维护提示词时，优先改这里的 `.md`
- Python 代码只负责读取、填充变量和执行，不再长期持有大段提示词

当前已迁移：
- `script_rewriter_skill.md`
- `copywriting_skill.md`
- `clip_selector_skill.md`
- `score_material_segments_skill.md`

约定：
- 每个文件至少包含一个 `## Prompt Template`
- 结构化配置放在独立 section，并使用 fenced code block 包裹
- JSON 资源一律放在 ` ```json ` 代码块中
