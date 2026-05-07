# 架构说明

## 总体结构

当前项目是一个 `Node.js + Vue 3 + Python` 的本地 AI 视频工作台，Node 负责服务装配与任务编排，Python 负责视频分析、脚本生成和合成执行，Vue 负责统一控制台。

```text
Vue Workspace
  -> Express Routes / Services
  -> Python Scripts / Local Runtime
  -> projects/ + data/ + public/
```

## 当前核心业务流

主业务已经收敛为这条链路：

`热门发现 -> 素材驱动生产 -> AI 审核 -> 发布任务 -> 账号监控/系统运维`

其中最重要的生产入口是：

- 前端：`frontend/src/components/MaterialDrivenWorkspace.vue`
- 状态管理：`frontend/src/composables/useMaterialDriven.js`
- 后端：`server/routes/materialDriven.js`
- Python 主控：`python/pipeline/run_material_driven.py`

## 分层职责

### 前端层

- 入口：`frontend/src/App.vue`
- 当前工作区：
  - `MaterialDrivenWorkspace`
  - `StandaloneWorkspace`
  - `XaiDiscoveryWorkspace`
  - `ReviewCenterWorkspace`
  - `PublishCenterWorkspace`
  - `AccountDashboardWorkspace`
  - `SystemSettingsWorkspace`

前端负责：

- 发起任务
- 订阅实时进度
- 保存本地状态
- 串联模块跳转
- 展示脚本、计划、审核和发布数据

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

Node 层负责：

- 统一暴露 HTTP API
- 管理文件上传与项目目录
- 推送 SSE 进度事件
- 启停 Python 脚本
- 汇总数据库、配置、自检和调度逻辑

### Service 层

主要服务位于 `server/services/`：

- `pipeline/`
  - ComfyUI 上传与工作流读写
- `vertical/`
  - 竖屏任务队列与单任务执行
- `review/`
  - 审核配置、执行、历史和重新生成
- `publish/`
  - 素材收集、任务存储、文案生成、微信视频号 RPA、账号看板
- `system/`
  - 自检、调度器、系统设置
- `notification/`
  - 飞书通知与登录状态检测
- `xai/`
  - 热点榜单执行与结果管理

### Python 执行层

#### `python/pipeline/`

当前重点是素材驱动生产线：

- `run_material_driven.py`
  - 主控脚本
- `run_asr.py`
  - 音频识别
- `video_vlm.py`
  - 视觉理解
- `segment_material.py`
  - 素材切片
- `score_material_segments.py`
  - 片段评分
- `select_material_segments.py`
  - 选段
- `smart_video_composer.py`
  - 成片合成
- `subtitle_generator.py`
  - 字幕生成
- `planner/`
  - Edit Plan 规划逻辑
- `skills/`
  - 文案、镜头、脚本和编辑风格技能模块
- `prompt_skills/`
  - 对应提示词技能说明

#### `python/review/`

- `ai_video_review.py`
  - 对视频进行质量审核并输出修复建议

#### `python/publish/`

- `generate_publish_description.py`
  - 发布文案生成
- `wechat_channels_rpa.py`
  - 微信视频号发布自动化
- `wechat_check_login.py`
  - 登录检测

#### `python/xai/`

- `run_xai_top10.py`
  - 榜单抓取
- `translate_result_summaries.py`
  - 结果翻译

## 当前状态变化

和旧实现相比，当前项目已经发生这些结构性变化：

- 旧 `pipeline.js` 路由已经移除，不再是主入口。
- 素材驱动工作流已经成为默认生产链路。
- Python 侧旧 `agents/` 目录已被新的 `planner/`、`skills/`、`prompt_skills/` 取代。
- 审核、发布、账号看板、系统设置都已形成独立模块，而不是附属脚本。
- 项目目录 `projects/` 已成为素材驱动任务的标准运行容器。

## 运行时闭环

一个完整任务通常按以下路径流转：

1. 从本地上传或从 xAI 榜单转入素材。
2. Node 在 `projects/<job>` 下创建任务目录。
3. Python 执行素材分析、选段、脚本和执行计划生成。
4. Node 视配置调用 ComfyUI，产出 `aiman.mp4`。
5. Python 根据 `execution_plan.json` 合成 `output_final.mp4`。
6. 审核中心读取元数据并生成审核记录。
7. 发布中心汇总成片并创建平台任务。

## 文档同步优先级

以下内容变化时需要优先更新文档：

- `frontend/src/App.vue`
- `server.js`
- `server/routes/materialDriven.js`
- `python/pipeline/run_material_driven.py`
- `server/services/publish/handlers.js`
- `server/services/review/handlers.js`
