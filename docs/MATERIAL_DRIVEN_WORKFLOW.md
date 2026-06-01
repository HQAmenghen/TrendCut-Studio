# TrendCut Studio 素材驱动剪辑工作流

## 主入口

当前主入口：

- 前端：`frontend/src/components/AutomationDashboard.vue`
- 前端状态：`frontend/src/composables/useMaterialDriven.js`
- 后端：`server/routes/materialDriven.js`
- Python 主控：`python/pipeline/run_material_driven.py`

## 工作流目标

把一个热点素材视频转成一条可发布的“数字人主讲 + 热点素材插片”成片，并把中间结果完整保存在项目目录中，便于复查、继续执行、重建计划、重渲染、审核和发布。

## 输入方式

支持两种输入：

- 本地上传素材视频
- 从 xAI 热点榜单模块一键转入远程视频地址

可选增强能力：

- 自动调用 ComfyUI 生成数字人
- 选择音频/图片预设，或上传自己的音频/图片

## 7 步执行流程

### 步骤 1：准备素材

- 复制或下载素材到任务目录
- 标准命名为 `material.mp4`

### 步骤 2：分析素材

- 运行 `run_asr.py`
- 运行 `video_vlm.py`

主要产物：

- `audio.json`
- `result.json`

### 步骤 3：切片、评分、选段

- `segment_material.py`
- `score_material_segments.py`
- `select_material_segments.py`

主要产物：

- `material_segments.json`
- `material_segments_scored.json`
- `selected_segments.json`

### 步骤 4：编排规划

根据选段结果生成后续脚本和编排输入。

这一阶段不再走旧 `agents/` 流程，而是进入当前的规划与技能模块。

### 步骤 5：重建脚本与整段口播稿

主控会根据素材大纲和技能模块生成：

- `script_units.json`
- `narration.json`
- `edit_plan.json`
- `execution_plan.json`

当前实现重点：

- 以 `script_units` 为规范口播源
- 用 `planner/` 与 `skills/` 产出新的镜头和执行计划
- 支持后续单独“重建剪辑计划”

### 步骤 6：生成数字人

有两种方式：

- 自动模式
  - Node 先把流程停在步骤 5
  - 调用 ComfyUI 生成内部数字人视频文件 `aiman.mp4`
  - 再从步骤 6 继续
- 手动模式
  - 用户自己放入 `aiman.mp4`
  - 再调用继续执行

此阶段还会生成：

- `avatar_manifest.json`
- `avatar_segments.json`

### 步骤 7：渲染成片

由 `smart_video_composer.py` 根据 `execution_plan.json` 合成：

- `output_final.mp4`

`aiman.mp4` 是历史运行协议文件名，保留用于兼容已有任务恢复、竖屏合成、发布资产汇总和测试，不代表产品名称。

## Node 侧工作流控制

`server/routes/materialDriven.js` 负责：

- 启动任务
- 测试 ComfyUI 连通性
- 推送 SSE 实时事件
- 恢复磁盘上的项目任务
- 继续执行
- 重试指定步骤
- 从步骤 5 重建计划
- 从步骤 7 重渲染

## SSE 事件

前端会监听这些关键事件：

- `step`
- `progress`
- `status`
- `plan_summary`
- `narration_summary`
- `complete`
- `error_event`

## 典型任务目录

`projects/material_<jobId>/` 下常见文件：

- `material.mp4`
- `audio.json`
- `result.json`
- `selected_segments.json`
- `narration.json`
- `script_units.json`
- `edit_plan.json`
- `execution_plan.json`
- `aiman.mp4`
- `avatar_segments.json`
- `output_final.mp4`

## 当前实现要点

- 任务状态会保存到前端本地存储，刷新后可恢复。
- 后端支持根据 `outputPath` 从磁盘恢复任务快照。
- 生产链路已经默认围绕素材驱动目录 `projects/` 工作。
- “重建计划”和“重渲染”是当前链路的重要能力，不再需要从头跑完整旧链路。
- 第一版可执行 UI 已经收敛到 `AutomationDashboard.vue`，不再依赖旧 Workspace 页面组件。
