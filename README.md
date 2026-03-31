# Comfy Panel Demo

一个面向本地生产环境的 AI 视频工作台，覆盖数字人口播、AI 混剪、竖屏包装、热点发现、AI 审核、发布任务和系统运维配置。

## 当前功能

- 数字人口播生成与主链路混剪
- 单条竖屏后期合成
- 热点视频发现与批量送入竖屏队列
- AI 审核中心与修复建议
- 发布中心与微信视频号自动化发布
- 系统设置、飞书通知、登录检测、LLM 配置

## 当前工程结构

- `server.js`：Node.js 服务装配入口
- `server/`：后端模块，按 `core / routes / services` 分层
- `frontend/`：Vue 3 前端源码
- `frontend-dist/`：前端构建产物
- `python/`：Python 执行层
  - `python/pipeline/`：混剪、字幕、标题、竖屏包装脚本
  - `python/publish/`：发布中心和微信视频号 RPA
  - `python/review/`：AI 审核脚本
  - `python/xai/`：热点榜单抓取、翻译和账号池配置
- `config/`：工作流和系统配置
- `data/`：运行时数据、日志、上传和任务目录
- `docs/`：项目文档
- `scripts/`：工具脚本

## 代码与运行产物的边界

这个仓库当前同时包含源码和运行期产物。

- **源码/工程文件**：`server/`、`frontend/`、`python/*.py`、`docs/`、配置文件
- **构建产物**：`frontend-dist/`
- **运行产物**：`data/`、`public/xai_vertical_queue/`、`python/pipeline/*.mp4|*.json|subtitle_cards/`
- **运行配置/状态**：`python/publish/*.db`、`python/publish/wechat_channels_tasks/`、`python/xai/result*.json`

建议把“工程文件”和“运行产物”分开理解。详细说明见 [docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)。

## 本地运行

### 1. 安装依赖

先安装：

- Node.js 18 或 20
- Python 3.10+
- FFmpeg

安装 Node 依赖：

```bash
npm install
```

安装 Python 依赖：

```bash
pip install -r requirements.txt
```

根目录 `requirements.txt` 当前会继续引用 `python/pipeline/requirements.txt`。

### 2. 配置环境变量

先复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

至少需要关注这些配置：

- `COMFYUI_BASE_URL`
- `GEMINI_API_KEY` 或 `GOOGLE_API_KEY`
- `XAI_API_KEY`
- `AI_REVIEW_ENABLED`
- `LLM_PROVIDER` 相关变量

详细变量说明见：

- [.env.example](/Users/PC/Desktop/comfy_panel_demo/.env.example)
- [docs/LLM_PROVIDER_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/LLM_PROVIDER_GUIDE.md)
- [docs/SYSTEM_SETTINGS_AND_LOGIN_CHECK_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/SYSTEM_SETTINGS_AND_LOGIN_CHECK_GUIDE.md)

### 3. 启动服务

```bash
npm start
```

如果需要重建前端：

```bash
npm run build:front
```

Windows 启动脚本：

- `一键启动.bat`

可选快速验证：

```bash
npm run smoke:test
```

服务默认监听：

- 本机：`http://localhost:3001`
- 局域网：`http://你的局域网IP:3001`

启动后可访问自检接口：

```text
http://localhost:3001/api/system/self-check
```

### 4. Docker 运行

```bash
docker compose up --build
```

Windows PowerShell 传入变量示例：

```powershell
$env:GEMINI_API_KEY="你的Key"
docker compose up --build
```

## 主要业务模块

### 1. Pipeline

- 前端：`PipelineWorkspace.vue` + `usePipeline.js`
- 后端：`server/routes/pipeline.js`
- Python：`python/pipeline/`

### 2. Standalone Vertical

- 前端：`StandaloneWorkspace.vue` + `useStandalone.js`
- 后端：`server/routes/standalone.js`
- Python：`python/pipeline/run_asr.py`、`make_vertical_video.py`

### 3. XAI Discovery

- 前端：`XaiDiscoveryWorkspace.vue` + `useXaiTop10.js`
- 后端：`server/routes/xai.js`
- Python：`python/xai/`

### 4. Review Center

- 前端：`ReviewCenterWorkspace.vue` + `useVideoReview.js`
- 后端：`server/routes/review.js`
- Python：`python/review/ai_video_review.py`

### 5. Publish Center

- 前端：`PublishCenterWorkspace.vue` + `usePublishCenter.js`
- 后端：`server/routes/publish.js`
- Python：`python/publish/`

### 6. System Settings / Login Status

- 前端：`SystemSettingsWorkspace.vue`
- 后端：`server/routes/system.js`、`server/routes/loginStatus.js`
- 服务：飞书通知、登录检测、LLM 配置、自检

## 常见问题

### 1. 局域网访问不到

检查：

- 服务是否已启动
- 本机防火墙是否允许 `3001`
- 当前访问 IP 是否为本机局域网地址

### 2. 竖屏标题或字幕不显示

重点检查任务目录里的这些文件是否生成：

- `content.json`
- `subtitles.json`
- `vertical_output.mp4`

### 3. AI 审核结果为空

重点检查：

- `AI_REVIEW_ENABLED`
- Gemini / Qwen 相关 Key
- `python/review/ai_video_review.py`

### 4. 微信视频号登录检测异常

重点检查：

- 登录检测配置
- 飞书配置
- `python/publish/wechat_check_login.py`
- `python/publish/wechat_check_login_remote.py`

更多排障见：

- [docs/STARTUP_SELF_CHECK.md](/Users/PC/Desktop/comfy_panel_demo/docs/STARTUP_SELF_CHECK.md)
- [docs/SMOKE_TEST_CHECKLIST.md](/Users/PC/Desktop/comfy_panel_demo/docs/SMOKE_TEST_CHECKLIST.md)
- [docs/login-check/LOGIN_CHECK_DIAGNOSIS.md](/Users/PC/Desktop/comfy_panel_demo/docs/login-check/LOGIN_CHECK_DIAGNOSIS.md)

## 推荐阅读顺序

1. [docs/README.md](/Users/PC/Desktop/comfy_panel_demo/docs/README.md)
2. [docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md](/Users/PC/Desktop/comfy_panel_demo/docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
3. [docs/PROJECT_STRUCTURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/PROJECT_STRUCTURE.md)
4. [docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
