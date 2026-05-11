# Comfy Panel Demo

一个面向本地生产环境的 AI 视频工作台，当前已经形成以“素材驱动热点转视频”为核心的生产链路，并把审核、发布、账号看板和系统运维整合到同一套控制台里。

## 当前定位

当前项目的主入口不是旧版 `pipeline` 路由，而是新的 `materialDriven` 工作流：

- 热点视频发现与转入
- 素材驱动脚本编排
- 数字人口播生成
- 智能混剪与成片导出
- AI 审核与修复建议
- 发布任务管理与微信视频号 RPA
- 账号看板、登录检测、飞书通知、LLM 配置

## 当前前端模块

- `热点转视频生产线`
  - 从本地上传或从热门榜单转入素材
  - 启动 7 步素材驱动工作流
  - 查看脚本、Edit Plan、Execution Plan、时间线和日志
  - 支持重建计划、重渲染、断点继续
- `竖屏后期合成`
  - 单条竖屏后期合成
  - 竖屏队列管理
- `热门视频榜单`
  - 拉取 xAI Top10 榜单
  - 一键转入素材驱动工作流
- `AI 审核中心`
  - 执行审核、查看历史、跳过审核
  - 根据修复建议重新入队生成
- `一键发布`
  - 汇总可发布素材
  - 自动生成发布文案
  - 创建多平台发布任务
  - 执行微信视频号 RPA
- `账号看板`
  - 查看账号状态、任务与失败记录
- `系统设置`
  - 自检、预设素材、工作流配置
  - 飞书通知、登录检测、LLM 配置

## 核心实现

### 1. Node.js 后端装配层

- 入口：`server.js`
- 职责：
  - 注册所有 HTTP 路由
  - 管理任务存储、恢复、自检、调度器
  - 把前端请求分发到 Python 执行层或本地服务

### 2. 素材驱动生产主链

- 路由：`server/routes/materialDriven.js`
- Python 主控：`python/pipeline/run_material_driven.py`
- 当前 7 步流程：
  1. 准备素材
  2. ASR + VLM 分析
  3. 素材切片、评分、选段
  4. 编排规划
  5. 生成脚本、口播稿、Edit Plan、Execution Plan
  6. 生成数字人或接入已有 `aiman.mp4`
  7. 使用 `smart_video_composer.py` 渲染 `output_final.mp4`

这个链路已经不再依赖旧的 `server/routes/pipeline.js`，而是通过素材驱动路由、SSE 状态推送和项目目录恢复机制来运行。

### 3. Python 执行层

- `python/pipeline/`
  - 素材分析、切片、评分、脚本生成、数字人映射、视频合成
- `python/review/`
  - AI 视频审核
- `python/publish/`
  - 发布文案生成、微信视频号 RPA、登录检测
- `python/xai/`
  - 热点榜单抓取与翻译

### 4. 运行时目录

- `projects/`
  - 素材驱动工作流的项目目录，保存中间文件和成片
- `data/`
  - 数据库、上传缓存、运行时任务
- `public/`
  - 对外暴露的静态资源和预设素材
- `frontend-dist/`
  - 前端构建产物

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
