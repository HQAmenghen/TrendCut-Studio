# Prompt Registry

## 已迁移为 Markdown Skill 资源

- `script_rewriter_skill.md`
  - 主口播重写提示词
- `copywriting_skill.md`
  - 口播后置行为说明（当前不再注入模板话语）
- `clip_selector_skill.md`
  - 静音素材插片决策提示词
- `score_material_segments_skill.md`
  - 素材候选打分提示词
- `run_asr_skill.md`
  - 中文字幕补齐 / 中英双语补齐 / 人物关系分析 / 字幕精修
- `video_vlm_skill.md`
  - 素材视频与音频概述
- `build_bridge_script_skill.md`
  - 数字人补位文案
- `generate_title_skill.md`
  - 封面标题生成
- `optimize_text_skill.md`
  - 口播文本优化
- `publish_description_skill.md`
  - 视频号发布描述
- `ai_video_review_skill.md`
  - 内容 / 字幕 / 标题 / 剪辑审核提示词
- `translate_result_summaries_skill.md`
  - 热点结果英文摘要转中文
- `subtitle_generator_skill.md`
  - Whisper 中文初始提示
- `qwen_client_skill.md`
  - Qwen 原生 ASR 系统提示

## 当前建议

当前项目主业务中与提示词直接相关的模块，已经统一迁入 `prompt_skills` 目录。

若后续继续扩展，建议新增提示词时遵循：
1. 先在 `prompt_skills/` 新建对应 `.md`
2. 再由代码通过 `prompt_skill_loader.py` 读取
3. 尽量避免把长 prompt 重新写回 `.py`
