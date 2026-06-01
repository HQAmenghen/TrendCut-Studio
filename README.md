# TrendCut Studio

<p align="center">
  <strong>本地化热点视频剪辑、审核与发布工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/HQAmenghen/TrendCut-Studio"><img alt="GitHub repository" src="https://img.shields.io/badge/GitHub-TrendCut--Studio-181717?logo=github&logoColor=white"></a>
  <a href="https://gitee.com/HQAmenghen/TrendCut-Studio"><img alt="Gitee repository" src="https://img.shields.io/badge/Gitee-TrendCut--Studio-C71D23?logo=gitee&logoColor=white"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white">
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42B883?logo=vue.js&logoColor=white">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white">
  <img alt="FFmpeg" src="https://img.shields.io/badge/FFmpeg-required-007808?logo=ffmpeg&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

TrendCut Studio（热点剪辑工作室）是一套面向短视频运营的本地控制台。项目把热点发现、素材分析、脚本生成、数字人口播、视频合成、AI 审核、发布任务和账号状态监控整合在同一套工作流中，适合在可信本机环境内运行自动化内容生产链路。

项目采用 Node.js + Vue + Python 架构：Node.js 负责本地服务、任务调度和数据持久化，Vue 提供操作台界面，Python 负责素材分析、剪辑合成、AI 审核、热点抓取和发布自动化脚本。ComfyUI、LLM Provider、FFmpeg、Playwright 浏览器和平台账号登录态属于外部运行依赖，需要按实际环境单独配置。

## 功能概览

- 热点发现：获取热点榜单、翻译摘要、维护可转化的选题入口。
- 素材驱动生产：从本地素材或热点条目启动生产，自动完成 ASR、VLM 分析、片段筛选、脚本生成和剪辑计划。
- 数字人口播：支持接入 ComfyUI 或已有数字人视频，生成生产链路所需的口播素材。
- 视频合成：输出横版成片，并可衔接竖屏后期合成流程。
- AI 审核：对成片进行质量检查，保存审核历史，并支持按建议重新修复。
- 发布中心：生成发布文案，创建抖音、小红书、微信视频号等平台任务。
- 账号与系统运维：提供登录检测、飞书通知、定时任务、自检和运行配置管理。

## 工作流

```text
热点榜单 / 本地素材
        |
        v
素材准备 -> ASR / VLM 分析 -> 片段筛选 -> 脚本与剪辑计划
        |                                      |
        v                                      v
数字人口播 / 口播视频 --------------------> 视频合成
                                               |
                                               v
                                      AI 审核与修复
                                               |
                                               v
                                      发布任务与账号监控
```

素材驱动生产是当前主流程。每个任务会在 `projects/material_<jobId>/` 下保存中间文件、执行计划和最终视频，便于恢复、排查和二次处理。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | Vue 3, Vite, CSS |
| 后端 | Node.js, Express, better-sqlite3, node-cron |
| Python 执行层 | Python 3.10+, MoviePy, faster-whisper, Playwright, LLM SDK |
| 媒体处理 | FFmpeg, ComfyUI, 本地文件系统 |
| 数据存储 | SQLite, JSON 文件, 项目目录 |
| 自动化发布 | Playwright RPA, vendored social-auto-upload |

## 环境要求

- Node.js 18+
- npm
- Python 3.10+
- pip
- FFmpeg，并确保可通过 `PATH` 调用
- 可访问的 ComfyUI 服务（需要自动数字人时）
- 至少一个可用的 LLM Provider 配置
- Playwright Python 浏览器依赖（需要微信视频号自动化时）

## 快速开始

### 1. 克隆项目

```powershell
git clone https://github.com/HQAmenghen/TrendCut-Studio.git
cd TrendCut-Studio
```

### 2. 安装依赖

```powershell
npm install
pip install -r requirements.lock.txt
```

`requirements.txt` 保留为直接依赖清单，`requirements.lock.txt` 锁定可复现运行环境。新增或升级 Python 依赖时，先更新直接依赖清单，再重新生成并审阅锁文件：

```powershell
python -m pip freeze --requirement python/pipeline/requirements.txt > requirements.lock.txt
npm run check:py-lock
```

如需执行微信视频号 RPA，请安装 Playwright 浏览器：

```powershell
python -m playwright install chromium
```

### 3. 配置环境变量

```powershell
Copy-Item .env.example .env
```

常用配置项：

| 变量 | 说明 |
| --- | --- |
| `COMFYUI_BASE_URL` | ComfyUI 服务地址 |
| `LLM_PROVIDER` | LLM 提供商，当前支持 `gemini`、`qwen` |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Gemini 凭据 |
| `QWEN_API_KEY` / `DASHSCOPE_API_KEY` | Qwen / DashScope 凭据 |
| `XAI_API_KEY` | 热点榜单接口凭据 |
| `AI_REVIEW_ENABLED` | 是否启用 AI 审核 |
| `FEISHU_WEBHOOK_URL` | 飞书通知 Webhook |
| `LOGIN_CHECK_ENABLED` | 是否启用登录状态检测 |

更多配置说明见 [docs/SETUP_AND_OPERATIONS.md](docs/SETUP_AND_OPERATIONS.md)。

### 4. 启动服务

```powershell
npm start
```

默认访问地址：

```text
http://localhost:3001
```

前端开发模式：

```powershell
npm run dev:front
```

构建前端静态资源：

```powershell
npm run build:front
```

## Docker 运行

项目提供 `Dockerfile` 和 `docker-compose.yml`，用于打包本地控制台服务。容器仍然需要访问外部 ComfyUI、LLM Provider、平台账号状态和宿主机持久化目录。

```powershell
docker compose up --build
```

默认服务端口为 `3001`。运行前请检查 `.env`、挂载目录和外部服务地址是否符合当前机器环境。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动本地 Express 服务 |
| `npm run dev:front` | 启动 Vite 前端开发服务 |
| `npm run build:front` | 构建前端产物到 `frontend-dist/` |
| `npm test` | 运行 Node.js Jest 测试 |
| `npm run test:py` | 运行 Python 单元测试 |
| `npm run lint` | 检查 `server/` 和 `scripts/` 下的 JavaScript 代码 |
| `npm run check:py-lock` | 检查 Python 锁文件是否覆盖直接依赖 |
| `npm run ci` | 执行项目 CI 脚本 |

## 项目结构

```text
trendcut-studio/
├─ server.js                  # Express 服务入口
├─ frontend/                  # Vue 前端源码
├─ frontend-dist/             # 前端构建产物
├─ server/                    # 后端路由、服务和核心工具
├─ python/                    # 素材生产、审核、发布和热点脚本
├─ public/                    # 静态资源与预设素材
├─ data/                      # 本地数据库、上传文件和运行缓存
├─ projects/                  # 素材驱动任务产物
├─ docs/                      # 长期维护文档
├─ vendor/                    # 随项目打包的第三方源码
├─ scripts/                   # 工程脚本
├─ Dockerfile
└─ docker-compose.yml
```

详细目录说明见 [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md)。

## 核心入口

| 模块 | 入口 |
| --- | --- |
| 前端控制台 | `frontend/src/App.vue`, `frontend/src/components/AutomationDashboard.vue` |
| 素材驱动生产 | `server/routes/materialDriven.js`, `python/pipeline/run_material_driven.py` |
| AI 审核 | `server/routes/review.js`, `server/services/review/`, `python/review/ai_video_review.py` |
| 发布中心 | `server/routes/publish.js`, `server/services/publish/`, `python/publish/` |
| 发布中心前端规则 | `frontend/src/composables/publishCenter/domain.mjs`, `frontend/src/composables/publishCenter/autoPilot.mjs` |
| 热点榜单 | `server/routes/xai.js`, `python/xai/run_xai_top10.py` |
| 系统设置与自检 | `server/routes/system.js`, `server/services/system/handlers.js` |
| 后台调度 | `server/services/system/scheduler.js`, `server/services/system/schedulerAutoPilot.js`, `server/services/system/schedulerPublish.js`, `server/services/system/schedulerCleanup.js`, `server/services/system/schedulerLoginCheck.js` |

## 运行数据与安全边界

TrendCut Studio 面向本地可信环境设计。项目会在运行过程中生成视频、截图、浏览器用户态、SQLite 数据库、任务日志和平台发布缓存。请注意：

- 不要提交 `.env`、账号凭据、浏览器 profile、cookie、二维码、平台日志和未脱敏素材。
- `data/`、`projects/`、`public/` 中可能包含运行产物，提交前应确认内容是否适合进入仓库。
- 发布自动化依赖平台 Web 流程和登录态，平台页面变化可能导致 RPA 失败。
- 自动数字人链路依赖外部 ComfyUI 服务，服务不可用时应通过自检和错误日志定位。

运行产物边界说明见 [docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)。

## 文档

- [文档索引](docs/README.md)
- [架构与重构指南](docs/ARCHITECTURE_AND_REFACTOR_GUIDE.md)
- [素材驱动工作流](docs/MATERIAL_DRIVEN_WORKFLOW.md)
- [模块说明](docs/MODULE_GUIDE.md)
- [API 概览](docs/API_OVERVIEW.md)
- [环境与运维](docs/SETUP_AND_OPERATIONS.md)
- [项目结构](docs/PROJECT_STRUCTURE.md)
- [运行产物与边界](docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)

## 开发建议

1. 修改后端路由或服务时，优先复用 `server/core/http.js` 的错误响应格式。
2. 修改长任务链路时，同步检查任务恢复、进度事件和失败落盘行为。
3. 修改 Python 脚本时，遵守 `contracts/python_protocol.schema.json` 中的 JSONL 协议，保留可被 Node 解析的结构化输出和明确退出码。
4. 修改前端操作台时，保持核心生产流程在首屏可操作。
5. 涉及运行目录、缓存目录或平台账号数据时，先确认 `.gitignore` 和文档边界。
6. 新增发布中心规则时，优先放入 `frontend/src/composables/publishCenter/` 的领域模块，不要重新堆回大型 Vue 组件或 `usePublishCenter.js`。
7. 新增后台定时任务时，保持 `server/services/system/scheduler.js` 作为组合根，具体调度逻辑放入对应 `scheduler*.js` 模块。

## 测试与检查

```powershell
npm run lint
npm test
npm run test:py
```

系统自检接口：

```text
GET /api/system/self-check
```

该接口会检查关键环境变量、目录、Python、FFmpeg、关键 Python 包、Playwright 浏览器和 ComfyUI 配置。缺失的外部能力会以 `warn` 或 `fail` 返回，便于在启动生产任务前定位环境问题。

## 贡献

欢迎提交 issue、改进建议和 pull request。建议在提交前完成以下检查：

- 变更范围清晰，避免同时混入运行产物和源码修改。
- README、`docs/` 与实际行为保持一致。
- 新增外部依赖时说明安装方式、环境变量和失败处理。
- 涉及平台发布、账号登录或 RPA 的改动需要说明验证方式。

## 许可

本项目采用 MIT License。第三方 vendored 代码说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
