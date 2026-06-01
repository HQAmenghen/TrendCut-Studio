# TrendCut Studio（热点剪辑工作室）

TrendCut Studio 是一套本地运行的全自动热点视频剪辑与发布工作流。它面向短视频运营场景，把热点获取、素材分析、脚本生成、数字人口播、智能混剪、AI 审核、多平台发布和账号监控放在同一个控制台中，帮助操作员把热点内容稳定产出为可审核、可发布的短视频。

## 产品定位

当前版本的主线不是通用视频工具，而是“热点发现 -> 视频制作剪辑 -> 审核 -> 发布”的完整运营流程：

- 获取和翻译热点榜单，维护可转化的热点素材入口。
- 从本地素材或榜单条目启动素材驱动生产。
- 自动完成 ASR、VLM 分析、片段筛选、脚本生成和剪辑计划。
- 生成数字人口播素材或接入已有数字人视频。
- 合成横版成片，并可继续转入竖屏后期合成。
- 执行 AI 视频审核，按建议重新入队修复。
- 汇总可发布素材，生成发布文案，创建抖音、小红书、微信视频号等平台任务。
- 监控账号状态、登录状态、调度任务、自检和通知配置。

## 当前可执行入口

前端已经收敛到统一的运营驾驶舱：

- `frontend/src/App.vue`
- `frontend/src/components/AppHeader.vue`
- `frontend/src/components/AutomationDashboard.vue`
- `frontend/src/composables/useMaterialDriven.js`
- `frontend/src/composables/useStandalone.js`
- `frontend/src/composables/useXaiTop10.js`
- `frontend/src/composables/usePublishCenter.js`

旧版按模块拆分的 Workspace 组件已经清理，当前第一版可执行体验以 `AutomationDashboard.vue` 为主入口。

## 核心工作流

### 1. 热点发现

- 前端：`frontend/src/composables/useXaiTop10.js`
- 后端：`server/routes/xai.js`
- Python：`python/xai/run_xai_top10.py`

用于拉取热点榜单、翻译摘要、维护账号池，并把适合制作的条目送入素材驱动流程。

### 2. 素材驱动视频制作剪辑

- 后端：`server/routes/materialDriven.js`
- Python 主控：`python/pipeline/run_material_driven.py`

当前 7 步流程：

1. 准备素材。
2. 执行 ASR 和 VLM 分析。
3. 切片、评分和选择素材片段。
4. 生成编排规划。
5. 生成脚本、口播稿、Edit Plan 和 Execution Plan。
6. 生成数字人视频或接入已有 `aiman.mp4`。
7. 使用 `smart_video_composer.py` 渲染 `output_final.mp4`。

`aiman.mp4` 是历史保留下来的内部数字人视频文件名，用于兼容现有任务恢复、测试和运行协议，不代表产品名称。

### 3. AI 审核与修复

- 后端：`server/routes/review.js`
- 服务：`server/services/review/`
- Python：`python/review/ai_video_review.py`

用于审核成片质量、保存审核历史，并把需要修复的任务重新送入生产链路。

### 4. 发布自动化

- 后端：`server/routes/publish.js`
- 服务：`server/services/publish/`
- Python：`python/publish/`
- Vendor：`vendor/social-auto-upload/`

用于汇总可发布素材、生成发布文案、创建平台任务，并执行微信视频号、抖音和小红书等发布流程。抖音/小红书发布代码随项目打包在 `vendor/social-auto-upload/` 中，运行态 cookie、二维码和日志写入 `data/social-auto-upload-runtime/`。

## 技术架构

- Node.js + Express：服务装配、路由、任务恢复、调度、自检和本地数据库。
- Vue 3 + Vite：本地运营控制台。
- Python：素材分析、脚本生成、剪辑合成、审核、发布 RPA 和热点抓取。
- SQLite + 文件系统：任务、审核、发布记录和项目运行产物。
- 外部依赖：ComfyUI、LLM Provider、FFmpeg、Playwright 浏览器、平台账号登录态。

## 本地启动

### 1. 安装依赖

```powershell
npm install
pip install -r requirements.txt
```

依赖前提：

- Node.js 18+
- Python 3.10+
- FFmpeg

### 2. 配置环境变量

```powershell
Copy-Item .env.example .env
```

至少建议检查：

- `COMFYUI_BASE_URL`
- `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`
- `XAI_API_KEY`
- `LLM_PROVIDER`
- `AI_REVIEW_ENABLED`

通常不需要设置 `SOCIAL_AUTO_UPLOAD_PYTHON`。只有需要临时切换到另一个 `social-auto-upload` checkout 时，才设置 `SOCIAL_AUTO_UPLOAD_DIR` 作为高级覆盖项。

### 3. 启动服务

```powershell
npm start
```

默认地址：

- `http://localhost:3001`

前端改动后可重建：

```powershell
npm run build:front
```

### 4. 可选自检

```text
GET /api/system/self-check
```

## 推荐阅读

1. [docs/README.md](docs/README.md)
2. [docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md](docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
3. [docs/MATERIAL_DRIVEN_WORKFLOW.md](docs/MATERIAL_DRIVEN_WORKFLOW.md)
4. [docs/MODULE_GUIDE.md](docs/MODULE_GUIDE.md)
5. [docs/SETUP_AND_OPERATIONS.md](docs/SETUP_AND_OPERATIONS.md)
6. [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)
7. [docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
