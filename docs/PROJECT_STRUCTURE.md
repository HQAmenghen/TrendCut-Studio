# 项目结构

## 顶层目录

```text
comfy_panel_demo/
├─ server.js
├─ frontend/
├─ frontend-dist/
├─ server/
├─ python/
├─ config/
├─ public/
├─ data/
├─ projects/
├─ docs/
└─ scripts/
```

## 目录职责

### `frontend/`

Vue 3 前端源码。

- `src/App.vue`
  - 前端总入口与模块切换
- `src/components/`
  - 各业务工作区组件
- `src/composables/`
  - 业务状态与 API 调用封装

### `frontend-dist/`

前端构建产物，`server.js` 会直接静态托管。

### `server/`

Node 后端源码。

- `routes/`
  - HTTP 路由声明
- `services/`
  - 业务服务层
- `core/`
  - 任务存储、错误、恢复、进度、Python 调用等基础能力
- `config/`
  - 路径和运行时配置

### `python/`

Python 执行层。

- `pipeline/`
  - 素材驱动生产、竖屏合成和相关能力
- `review/`
  - AI 审核
- `publish/`
  - 发布与 RPA
- `xai/`
  - 热点榜单抓取与翻译

### `config/`

工作流与系统配置文件，例如 `workflow_api.json`。

### `public/`

静态资源目录。

- `presets/audio/`
  - 数字人音频预设
- `presets/image/`
  - 数字人图片预设
- 其他公开可访问资源

### `data/`

运行期数据目录。

- `tasks.db`
  - 统一任务存储
- `uploads/`
  - 上传文件、运行时队列、临时任务目录
- 其他本地数据库与缓存

### `projects/`

素材驱动工作流的标准项目目录。

每个任务通常会生成一个 `projects/material_<id>/`，其中保存：

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

### `docs/`

当前有效文档目录，只保留长期维护文档。

### `scripts/`

工程工具脚本，如 CI、安装钩子、冒烟脚本等。

## 当前关键源码入口

### 前端入口

- `frontend/src/App.vue`
- `frontend/src/components/MaterialDrivenWorkspace.vue`
- `frontend/src/composables/useMaterialDriven.js`

### 后端入口

- `server.js`
- `server/routes/materialDriven.js`
- `server/services/publish/handlers.js`
- `server/services/review/handlers.js`
- `server/services/system/handlers.js`

### Python 入口

- `python/pipeline/run_material_driven.py`
- `python/review/ai_video_review.py`
- `python/publish/generate_publish_description.py`
- `python/publish/wechat_channels_rpa.py`
- `python/xai/run_xai_top10.py`

## 结构上的注意点

- 仓库中仍然混有部分运行产物和缓存文件，不应把它们当作源码模块。
- `python/pipeline/` 下既有源码，也可能存在演示产物、缓存 JSON、字幕图和输出视频。
- `projects/`、`data/`、`frontend-dist/` 是最典型的运行期目录。
