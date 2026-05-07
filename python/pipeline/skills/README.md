# Pipeline Skills

这一层是给自动剪辑流程预留的可插拔能力模块。

当前先建骨架，不接入现有主流程。

## 规划中的 skills

- `content_router.py`
  负责判断内容类型、情绪强度、目标时长、模板编号。
- `script_rewriter_skill.py`
  负责用大模型把素材事实重写成数字人口播稿，而不是照抄转写。
- `script_builder.py`
  负责在 LLM 不可用时，把热点内容拆成结构化口播句子作为兜底。
- `clip_selector.py`
  负责给每句口播匹配候选素材片段。
- `music_selector.py`
  负责按视频类型和情绪选择背景音乐。
- `qc_checker.py`
  负责成片质量检查。

## 设计原则

- 每个 skill 只做一件事。
- 每个 skill 只通过结构化输入和输出通信。
- 先做占位和协议，再逐步接到 `run_material_driven.py`。
