# 当前项目目录结构

这份文档用于说明 **当前目录结构的真实含义**，并明确哪些目录属于源码、哪些目录属于构建产物、哪些目录属于运行时数据。

## 1. 顶层目录

```text
comfy_panel_demo/
├── config/                    # 配置文件
├── data/                      # 运行时数据与日志
├── docs/                      # 项目文档
├── frontend/                  # 前端源码
├── frontend-dist/             # 前端构建产物
├── public/                    # 静态资源与对外输出目录
├── python/                    # Python 执行层
├── scripts/                   # 工具脚本
├── server/                    # Node 后端模块
├── .env.example               # 环境变量模板
├── Dockerfile
├── docker-compose.yml
├── package.json
├── requirements.txt
├── server.js                  # 服务装配入口
└── 一键启动.bat
```

## 2. 源码目录

### 2.1 `server/`

后端源码目录，当前采用 `core / routes / services` 分层：

```text
server/
├── core/
│   ├── http.js
│   ├── logger.js
│   ├── progress.js
│   ├── python.js
│   └── runtime.js
├── routes/
│   ├── loginStatus.js
│   ├── pipeline.js
│   ├── publish.js
│   ├── review.js
│   ├── standalone.js
│   ├── system.js
│   ├── vertical.js
│   └── xai.js
└── services/
    ├── notification/
    ├── pipeline/
    ├── publish/
    ├── review/
    ├── system/
    ├── vertical/
    └── xai/
```

### 2.2 `frontend/`

前端源码目录：

```text
frontend/src/
├── App.vue
├── main.js
├── styles.css
├── components/
│   ├── PipelineWorkspace.vue
│   ├── StandaloneWorkspace.vue
│   ├── XaiDiscoveryWorkspace.vue
│   ├── ReviewCenterWorkspace.vue
│   ├── PublishCenterWorkspace.vue
│   ├── SystemSettingsWorkspace.vue
│   ├── ReviewResultCard.vue
│   ├── RunLogPanel.vue
│   ├── TopNavigation.vue
│   └── ConsoleHero.vue
└── composables/
    ├── usePipeline.js
    ├── usePublishCenter.js
    ├── useStandalone.js
    ├── useVerticalQueue.js
    ├── useVideoReview.js
    └── useXaiTop10.js
```

### 2.3 `python/`

Python 目录里同时包含公共客户端和业务脚本：

```text
python/
├── gemini_client.py
├── llm_client.py
├── load_env.py
├── qwen_client.py
├── script_protocol.py
├── pipeline/
├── publish/
├── review/
└── xai/
```

说明：

- `python/pipeline/`：混剪、字幕、标题、竖屏包装脚本
- `python/publish/`：发布中心、微信视频号 RPA、登录检测脚本
- `python/review/`：AI 审核脚本
- `python/xai/`：热点榜单抓取和摘要翻译

### 2.4 `docs/`

项目文档目录，索引见 [docs/README.md](/Users/PC/Desktop/comfy_panel_demo/docs/README.md)。

### 2.5 `scripts/`

工具脚本目录：

- `scripts/smoke_test.js`
- `scripts/utils/env.js`
- `scripts/utils/load_env.py`

## 3. 构建产物目录

### 3.1 `frontend-dist/`

前端构建后默认提供给服务端静态托管的目录，不属于前端源码。

## 4. 运行时目录

### 4.1 `data/`

运行期主目录，常见内容包括：

- `data/logs/`
- `data/uploads/runtime_jobs/`
- `data/uploads/xai_vertical_queue/`

这里是运行目录，不应与源码目录混淆。

### 4.2 `public/`

这个目录既包含静态资源，也包含部分对外暴露的运行结果，例如：

- `public/output_final.mp4`
- `public/standalone_output_vertical.mp4`
- `public/xai_vertical_queue/...`

所以 `public/` 不是纯静态源码目录，而是“静态资源 + 输出产物”的混合目录。

## 5. 当前目录里混入的运行文件

当前仓库里除了源码，还混有一部分运行中产生的文件，例如：

- `python/pipeline/*.mp4`
- `python/pipeline/*.json`
- `python/pipeline/subtitle_cards/`
- `python/publish/publish_jobs.db*`
- `python/publish/wechat_channels_tasks/`
- `python/publish/temp_qrcode.png`
- `python/xai/result*.json`
- `python/xai/run_*.log`

这些文件多数不是工程源码，而是调试、缓存、任务状态或输出结果。

## 6. 当前对目录的推荐理解

### 6.1 工程文件

主要包括：

- `server/`
- `frontend/`
- `python/*.py`
- `docs/`
- `config/`
- `scripts/`
- 根目录配置文件

### 6.2 非工程文件

主要包括：

- `data/`
- `frontend-dist/`
- `public/` 中运行产物
- `python/` 子目录中的任务结果、数据库、日志、媒体文件

## 7. 维护建议

- 修改架构或新增模块时，优先同步更新 [README.md](/Users/PC/Desktop/comfy_panel_demo/README.md)。
- 目录结构变化时，同步更新本文件。
- 如果后续继续工程化，建议把运行产物进一步迁出源码目录，减少仓库噪音和认知成本。
