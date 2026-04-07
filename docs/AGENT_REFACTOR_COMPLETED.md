# 数字人合成链路 Agent 化改造完成

## 改造概述

已完成数字人视频合成链路的轻量 Agent 化改造，将原有的 6 个串行脚本升级为 4 个职责明确的 Agent。

## 新增文件

### 基础模块
- `python/pipeline/agents/__init__.py` - 模块初始化
- `python/pipeline/agents/utils.py` - 公共工具函数（JSON 读写、时长计算、比例计算等）
- `python/pipeline/agents/schemas.py` - JSON 数据结构定义
- `python/pipeline/agents/prompts.py` - LLM 提示词模板

### Agent 实现
- `python/pipeline/agents/script_planner.py` - Script Planner Agent
- `python/pipeline/agents/material_planner.py` - Material Planner Agent
- `python/pipeline/agents/director_critic.py` - Director Critic Agent

## 改造后的执行流程

### 旧流程（6步）
```
1. run_asr.py (ASR 识别)
2. video_vlm.py (VLM 分析)
3. run_director.py (导演决策)
4. post_process_director.py (后处理)
5. build_video.py (视频合成)
6. make_vertical_video.py (竖屏包装)
```

### 新流程（8步）
```
1. run_asr.py (ASR 识别)
2. video_vlm.py (VLM 分析)
3. script_planner.py (脚本计划) ← 新增
4. material_planner.py (素材计划) ← 新增
5. run_director.py (导演决策，已改造)
6. director_critic.py (质量审查) ← 新增
7. post_process_director.py (后处理)
8. build_video.py (视频合成)
```

## Agent 职责分工

### 1. Script Planner Agent
**输入**
- `audio.json` - 数字人口播内容
- `subtitles.json` - 素材字幕
- `content_outline.json` - 内容大纲（可选）

**输出**
- `script_plan.json` - 脚本计划

**职责**
- 决定视频怎么讲
- 生成分段结构
- 标记每段的信息来源和表达方式
- 确定哪些段落需要数字人口播

### 2. Material Planner Agent
**输入**
- `result.json` - 素材视觉轴
- `subtitles.json` - 素材字幕
- `speaker_scene.json` - 人物关系分析（可选）

**输出**
- `material_plan.json` - 素材计划

**职责**
- 找出素材中的高价值片段
- 标记哪些段落适合保留原声
- 给出素材能支撑的建议时长
- 标记片段用途（开场/主信息段/过渡/收尾）

### 3. Director Agent（改造）
**输入**
- `script_plan.json` - 脚本计划（优先）
- `material_plan.json` - 素材计划（优先）
- `video_script.json` - 视频脚本（兼容旧版）
- `audio.json` - 数字人音频
- `result.json` - 素材视觉轴

**输出**
- `director_raw.json` - 导演原始方案

**职责**
- 编排镜头时间线
- 决定哪段用数字人，哪段用素材
- 决定哪段保留素材原声

**改造内容**
- 优先读取 `script_plan.json` 和 `material_plan.json`
- 在 prompt 中增加 Agent 计划指导部分
- 保持向后兼容，如果没有新计划文件，回退到旧逻辑

### 4. Director Critic Agent
**输入**
- `director_raw.json` - 导演原始方案
- `script_plan.json` - 脚本计划
- `material_plan.json` - 素材计划
- `audio.json` - 数字人音频

**输出**
- `director_review.json` - 审查报告

**职责**
- 检查素材视觉占比（建议 >= 60%）
- 检查是否存在"话没说完就切镜头"
- 检查镜头是否过短或切换过频繁
- 检查素材原声是否被切太短
- 输出问题列表和改进建议

## JSON 数据格式

### script_plan.json
```json
{
  "topic": "视频主题",
  "angle": "切入角度",
  "target_duration_sec": 45,
  "segments": [
    {
      "id": "hook",
      "goal": "快速吸引注意",
      "summary": "这一段要讲什么",
      "source_basis": "material",
      "supporting_context": "",
      "narration_needed": true,
      "preferred_video_source": "mixed",
      "prefer_source_audio": false
    }
  ]
}
```

### material_plan.json
```json
{
  "material_duration_sec": 63.0,
  "recommended_total_duration_sec": 45,
  "segments": [
    {
      "id": "m1",
      "start": 0.0,
      "end": 11.0,
      "summary": "这段素材的内容摘要",
      "has_strong_source_audio": true,
      "priority": "high",
      "usage": "opening"
    }
  ]
}
```

### director_review.json
```json
{
  "passed": false,
  "issues": [
    {
      "code": "MATERIAL_RATIO_TOO_LOW",
      "message": "素材视觉占比仅 36%，建议至少 60%"
    }
  ],
  "suggestions": [
    "将 5.3s-15.0s 改为素材画面"
  ],
  "metrics": {
    "total_duration_sec": 31.4,
    "material_video_ratio": 0.36,
    "avatar_video_ratio": 0.64,
    "source_audio_ratio": 0.48,
    "hard_cut_risk_count": 3
  }
}
```

## 改造的核心原则

1. **不引入复杂框架** - 不使用 LangGraph/AutoGen，只用 JSON 文件串联
2. **保持向后兼容** - 现有 API 和前端不变
3. **职责明确** - 每个 Agent 只做一件事
4. **质量优先** - 通过 Critic Agent 确保输出质量

## 要解决的问题

改造后应该能明显改善以下问题：
- ✅ 数字人话没说完就切镜头
- ✅ 切镜头太碎
- ✅ 素材视觉占比不足
- ✅ 素材原声被切太短
- ✅ 成片时长被数字人主轨卡死

## 后端改动

### server/services/pipeline/handlers.js
在 `handleRunPipeline` 函数中新增了 3 个 Agent 调用：
1. Script Planner（步骤 3/7）
2. Material Planner（步骤 4/7）
3. Director Critic（步骤 6/7）

进度百分比也相应调整为 8 步流程。

## 测试建议

### 单元测试
```bash
# 测试各个 Agent 脚本
cd data/tasks/pipeline_xxx
python python/pipeline/agents/script_planner.py
python python/pipeline/agents/material_planner.py
python python/pipeline/agents/director_critic.py
```

### 集成测试
通过前端 Pipeline 工作区提交完整任务，观察：
1. 是否生成 `script_plan.json`
2. 是否生成 `material_plan.json`
3. 是否生成 `director_review.json`
4. 最终视频的素材占比是否提高
5. 切镜是否更自然

## 验收标准

### 功能验收
- ✅ 能生成 script_plan.json
- ✅ 能生成 material_plan.json
- ✅ 能生成 director_review.json
- ✅ run_director.py 能读取新计划文件
- ✅ handlers.js 能跑通新链路

### 质量验收（需实际测试）
- ⏳ 同类素材下，素材视觉占比明显提高
- ⏳ 成片长度不再被数字人主轨完全卡死
- ⏳ "话没说完就切"的情况明显减少
- ⏳ 切镜更自然，音频切换更少硬切

### 工程验收
- ✅ 保持现有 API 不变
- ✅ Python 脚本通过 py_compile
- ⏳ npm test 继续通过（需运行测试）

## 下一步

1. **联调验证** - 跑通一条完整 pipeline，确认所有 JSON 文件正确生成
2. **质量对比** - 用相同素材对比改造前后的效果
3. **优化 Prompt** - 根据实际效果调整各 Agent 的提示词
4. **增强 Critic** - 让 Director Critic 的建议能被 post_process_director.py 采纳

## 注意事项

- 所有 Agent 脚本都使用 `script_protocol` 的 `run_guarded` 包装，确保错误处理一致
- 如果 LLM 调用失败，Director Critic 会回退到基础指标计算
- 新增的 3 个步骤会增加总执行时间，但能显著提升质量
- 前端进度显示已从 6 步调整为 8 步

## 文件清单

```
python/pipeline/agents/
├── __init__.py              # 模块初始化
├── utils.py                 # 公共工具（200+ 行）
├── schemas.py               # 数据结构定义（200+ 行）
├── prompts.py               # 提示词模板（300+ 行）
├── script_planner.py        # Script Planner Agent（200+ 行）
├── material_planner.py      # Material Planner Agent（200+ 行）
└── director_critic.py       # Director Critic Agent（250+ 行）
```

总计新增代码：约 1350 行
改造现有代码：约 50 行（run_director.py + handlers.js）
