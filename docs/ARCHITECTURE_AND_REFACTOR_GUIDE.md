# 架构说明

## 总体结构

TrendCut Studio 是一个 `Node.js + Vue 3 + Python` 的本地热点视频剪辑运营系统。Node 负责服务装配、任务编排和本地持久化，Python 负责视频分析、脚本生成、合成执行、审核和 RPA，Vue 负责统一运营驾驶舱。

```text
Vue Cockpit
  -> Express Routes / Services
  -> Python Scripts / Local Runtime
  -> projects/ + data/ + public/
```

## 当前核心业务流

主业务已经收敛为这条链路：

`热点发现 -> 素材驱动视频制作剪辑 -> AI 审核 -> 发布任务 -> 账号监控/系统运维`

其中最重要的生产入口是：

- 前端：`frontend/src/components/AutomationDashboard.vue`
- 状态管理：`frontend/src/composables/useMaterialDriven.js`
- 后端：`server/routes/materialDriven.js`
- Python 主控：`python/pipeline/run_material_driven.py`

## 分层职责

### 前端层

- 入口：`frontend/src/App.vue`
- 标题区：`frontend/src/components/AppHeader.vue`
- 驾驶舱：`frontend/src/components/AutomationDashboard.vue`
- 实时进度：`frontend/src/components/ProductionProgressPanel.vue`
- 状态组合函数：
  - `frontend/src/composables/useMaterialDriven.js`
  - `frontend/src/composables/useStandalone.js`
  - `frontend/src/composables/useVerticalQueue.js`
  - `frontend/src/composables/useVideoReview.js`
  - `frontend/src/composables/usePublishCenter.js`
  - `frontend/src/composables/publishCenter/domain.mjs`
  - `frontend/src/composables/publishCenter/autoPilot.mjs`
  - `frontend/src/composables/useXaiTop10.js`

前端负责：

- 发起热点、生产、审核、发布和运维操作。
- 订阅实时进度。
- 保存可恢复的本地状态。
- 汇总脚本、计划、审核、发布、账号和系统数据。
- 在统一驾驶舱中展示操作员最需要处理的下一步。

### Node 路由层

- 入口：`server.js`
- 路由注册：
  - `server/routes/materialDriven.js`
  - `server/routes/standalone.js`
  - `server/routes/xai.js`
  - `server/routes/review.js`
  - `server/routes/publish.js`
  - `server/routes/system.js`
  - `server/routes/loginStatus.js`
  - `server/routes/vertical.js`
  - `server/routes/agent.js`

Node 层负责：

- 统一暴露 HTTP API。
- 管理文件上传与项目目录。
- 推送 SSE 进度事件。
- 启停 Python 脚本。
- 汇总数据库、配置、自检和调度逻辑。

### Service 层

主要服务位于 `server/services/`：

- `agent/`
  - 本地 Agent API V0，供 MCP 或自动化客户端读取热点、任务、发布和运行状态。
- `materialDriven/`
  - 素材驱动生产流程的状态、事件、数字人生成和恢复逻辑。
- `pipeline/`
  - ComfyUI 上传与工作流读写。
- `vertical/`
  - 竖屏任务队列与单任务执行。
- `review/`
  - 审核配置、执行、历史和重新生成。
- `publish/`
  - 素材收集、任务存储、文案生成、微信视频号 RPA、账号看板。
- `system/`
  - 自检、调度器、系统设置。
  - `scheduler.js` 是组合根，负责注册各类后台任务。
  - `schedulerAutoPilot.js` 承载无人值守发片、榜单触发、数字人桥接、竖屏队列恢复和发布任务桥接。
  - `schedulerPublish.js` 承载定时发布和自动归档。
  - `schedulerCleanup.js` 承载运行数据清理。
  - `schedulerLoginCheck.js` 承载账号登录检测调度。
- `notification/`
  - 飞书通知与登录状态检测。
- `xai/`
  - 热点榜单执行与结果管理。

### Python 执行层

#### `python/pipeline/`

当前重点是素材驱动视频制作剪辑：

- `run_material_driven.py`
  - 主控脚本。
- `run_asr.py`
  - 音频识别。
- `video_vlm.py`
  - 视觉理解。
- `segment_material.py`
  - 素材切片。
- `score_material_segments.py`
  - 片段评分。
- `select_material_segments.py`
  - 选段。
- `smart_video_composer.py`
  - 成片合成。
- `subtitle_generator.py`
  - 字幕生成。
- `planner/`
  - Edit Plan 规划逻辑。
- `skills/`
  - 文案、镜头、脚本和编辑风格技能模块。
- `prompt_skills/`
  - 对应提示词技能说明。

#### `python/review/`

- `ai_video_review.py`
  - 对视频进行质量审核并输出修复建议。

#### `python/publish/`

- `generate_publish_description.py`
  - 发布文案生成。
- `wechat_channels_rpa.py`
  - 微信视频号发布自动化。
- `wechat_check_login.py`
  - 登录检测。

#### `python/xai/`

- `run_xai_top10.py`
  - 榜单抓取。
- `translate_result_summaries.py`
  - 结果翻译。

## 当前状态变化

和旧实现相比，当前项目已经发生这些结构性变化：

- 旧 `pipeline.js` 路由已经移除，不再是主入口。
- 素材驱动视频制作剪辑已经成为默认生产链路。
- 前端第一版可执行 UI 已收敛到 `AutomationDashboard.vue`，旧 Workspace 组件已清理。
- Python 侧旧 `agents/` 目录已被新的 `planner/`、`skills/`、`prompt_skills/` 取代。
- 审核、发布、账号看板、系统设置都已形成可复用服务，而不是附属脚本。
- 项目目录 `projects/` 已成为素材驱动任务的标准运行容器。
- 发布中心前端规则已从 `usePublishCenter.js` 抽到 `publishCenter/domain.mjs` 和 `publishCenter/autoPilot.mjs`，组合函数主要保留响应式状态、接口调用和 UI 编排。
- 后台调度已从单一大型 `scheduler.js` 拆为组合根加多个 `scheduler*.js` 模块，避免 AutoPilot、发布、清理和登录检测继续混在同一个文件。

## 运行时闭环

一个完整任务通常按以下路径流转：

1. 从本地上传或从 xAI 榜单转入素材。
2. Node 在 `projects/<job>` 下创建任务目录。
3. Python 执行素材分析、选段、脚本和执行计划生成。
4. Node 视配置调用 ComfyUI，产出内部数字人视频文件 `aiman.mp4`。
5. Python 根据 `execution_plan.json` 合成 `output_final.mp4`。
6. 审核中心读取元数据并生成审核记录。
7. 发布中心汇总成片并创建平台任务。

`aiman.mp4`、`aiman_subtitles.json` 等文件名是历史运行协议的一部分，保留用于兼容已有项目目录、恢复逻辑和测试。

## 文档同步优先级

以下内容变化时需要优先更新文档：

- `frontend/src/App.vue`
- `frontend/src/components/AutomationDashboard.vue`
- `server.js`
- `server/routes/materialDriven.js`
- `python/pipeline/run_material_driven.py`
- `server/services/publish/handlers.js`
- `server/services/review/handlers.js`
- `server/services/agent/handlers.js`
- `frontend/src/composables/publishCenter/`
- `server/services/system/scheduler*.js`

## 维护原则

- 不要把发布中心的账号规则、平台选择、自动托管映射和展示摘要重新塞回 `AutomationDashboard.vue` 或 `usePublishCenter.js`。
- 不要把具体后台任务直接写进 `server/services/system/scheduler.js`；该文件应保持为调度组合根。
- 修改 AutoPilot 行为时，优先补充或运行 `server/services/system/__tests__/scheduler.test.js`。
- 修改 Node/Python 进度协议时，同步检查 `contracts/python_protocol.schema.json`、`server/core/pythonProtocol.js` 和 `python/script_protocol.py`。
