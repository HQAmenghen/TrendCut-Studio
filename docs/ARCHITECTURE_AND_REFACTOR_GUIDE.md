# Comfy Panel Demo 架构说明

## 1. 项目定位

`comfy_panel_demo` 当前已经不是单一演示页，而是一套本地 AI 视频生产工作台。它把多条生产链路集中到一个前后端统一的操作台中：

- 数字人口播生成
- AI 混剪与成片输出
- 单条竖屏包装
- 热点榜单抓取与批量竖屏入队
- AI 审核与修复建议
- 发布任务管理与微信视频号自动化发布
- 系统设置、飞书通知、登录检测与 LLM 配置

## 2. 技术栈

- 前端：Vue 3 + Vite
- 后端：Node.js + Express
- 执行层：Python + FFmpeg + Playwright + 外部 AI 服务
- 工作流：ComfyUI、Gemini / Qwen、xAI
- 存储：文件系统 + SQLite + 少量内存状态

## 3. 顶层结构

```text
comfy_panel_demo/
├── frontend/          # Vue 前端源码
├── server/            # Node 后端
├── python/            # Python 执行层
├── config/            # 工作流配置
├── docs/              # 文档
├── data/              # 运行时数据
├── public/            # 静态资源与对外产物
├── frontend-dist/     # 前端构建产物
└── server.js          # 应用装配入口
```

## 4. 前端架构

### 4.1 前端入口

- `frontend/src/App.vue`

前端当前是一个单页工作台壳层，负责：

- 模块切换
- 主题切换
- 挂载初始化
- 各模块自动刷新生命周期

### 4.2 当前模块

前端导航当前包含 6 个模块：

- `pipeline`
- `standalone`
- `xaiTop10`
- `reviewCenter`
- `publishCenter`
- `systemSettings`

### 4.3 主要组件

- `PipelineWorkspace.vue`
  数字人渲染、AI 混剪、竖屏导出入口
- `StandaloneWorkspace.vue`
  单条竖屏视频处理与竖屏队列查看
- `XaiDiscoveryWorkspace.vue`
  榜单抓取、结果展示、批量入队
- `ReviewCenterWorkspace.vue`
  AI 审核记录、审核结果和修复动作
- `PublishCenterWorkspace.vue`
  素材聚合、平台配置、发布任务管理
- `SystemSettingsWorkspace.vue`
  飞书配置、登录检测配置、LLM 配置和系统级设置

### 4.4 前端 composable

- `usePipeline.js`
- `useStandalone.js`
- `useXaiTop10.js`
- `useVideoReview.js`
- `usePublishCenter.js`
- `useVerticalQueue.js`

前端当前已经形成“工作区组件 + composable 状态层”的组织方式，整体比早期单文件聚合更清晰。

## 5. 后端架构

### 5.1 后端目录

```text
server/
├── core/
├── routes/
└── services/
```

### 5.2 `core/`

公共基础设施：

- `http.js`
  统一错误响应输出
- `logger.js`
  启动级日志写入
- `progress.js`
  SSE 客户端与进度推送
- `python.js`
  Node 调 Python 的统一执行协议
- `runtime.js`
  文件、目录、JSON 和进程辅助工具

### 5.3 `routes/`

HTTP 路由注册层：

- `pipeline.js`
- `standalone.js`
- `vertical.js`
- `xai.js`
- `review.js`
- `publish.js`
- `system.js`
- `loginStatus.js`

### 5.4 `services/`

业务服务层：

- `pipeline/`
- `vertical/`
- `xai/`
- `review/`
- `publish/`
- `system/`
- `notification/`

## 6. 主要后端模块

### 6.1 Pipeline

相关文件：

- `server/routes/pipeline.js`
- `server/services/pipeline/handlers.js`
- `server/services/pipeline/comfy.js`
- `server/services/pipeline/workflow.js`

职责：

- 调用 ComfyUI 生成数字人口播
- 执行 `run_asr.py`、`video_vlm.py`、`run_director.py`、`build_video.py`
- 生成最终横版成片
- 可继续派生竖屏包装

### 6.2 Standalone / Vertical

相关文件：

- `server/routes/standalone.js`
- `server/routes/vertical.js`
- `server/services/vertical/standalone.js`
- `server/services/vertical/queue.js`

职责：

- 单条竖屏包装
- 竖屏批量队列
- 任务取消、删除、失败记录
- 调用 ASR、标题生成和竖屏渲染脚本

### 6.3 XAI Discovery

相关文件：

- `server/routes/xai.js`
- `server/services/xai/service.js`

职责：

- 账号池配置读写
- 热点榜单运行状态
- 结果读取
- 调用 `python/xai/run_xai_top10.py`

### 6.4 Review Center

相关文件：

- `server/routes/review.js`
- `server/services/review/index.js`
- `server/services/review/handlers.js`
- `server/services/review/executor.js`
- `server/services/review/store.js`
- `python/review/ai_video_review.py`

职责：

- 审核配置读写
- 视频审核触发
- 审核历史查询
- 审核失败跳过
- 根据审核结果触发重新生成

### 6.5 Publish Center

相关文件：

- `server/routes/publish.js`
- `server/services/publish/handlers.js`
- `server/services/publish/assets.js`
- `server/services/publish/store.js`
- `server/services/publish/wechatRpa.js`
- `python/publish/wechat_channels_rpa.py`

职责：

- 聚合可发布素材
- 管理发布任务
- 管理平台配置
- 执行微信视频号自动化发布
- 维护发布运行状态和日志

### 6.6 System / Notification / Login Status

相关文件：

- `server/routes/system.js`
- `server/routes/loginStatus.js`
- `server/services/system/handlers.js`
- `server/services/system/selfCheck.js`
- `server/services/system/scheduler.js`
- `server/services/notification/feishu.js`
- `server/services/notification/loginStatus.js`

职责：

- 启动自检
- 工作流配置和 JSON 文件编辑
- 文案润色和视频比例转换
- 飞书配置管理
- 登录检测配置管理
- LLM 配置读写
- 定时检测和主动检测账号登录状态

## 7. Python 执行层

### 7.1 公共能力

- `llm_client.py`
- `gemini_client.py`
- `qwen_client.py`
- `script_protocol.py`

### 7.2 Pipeline 脚本

- `run_asr.py`
- `video_vlm.py`
- `run_director.py`
- `build_video.py`
- `generate_title.py`
- `optimize_text.py`
- `convert_ratio.py`
- `make_vertical_video.py`

### 7.3 Publish / Login

- `generate_publish_description.py`
- `wechat_channels_rpa.py`
- `wechat_check_login.py`
- `wechat_check_login_remote.py`

### 7.4 Review

- `review/ai_video_review.py`

### 7.5 XAI

- `xai/run_xai_top10.py`
- `xai/translate_result_summaries.py`

## 8. 关键业务链路

### 8.1 数字人口播 + AI 混剪

1. 前端调用 `/api/generate`
2. Node 调用 ComfyUI 输出数字人口播
3. 前端调用 `/api/run-pipeline`
4. Node 顺序执行 Pipeline Python 脚本
5. 成片输出到 `public/output_final.mp4`

### 8.2 单条竖屏

1. 上传视频
2. 执行 ASR 或读取 SRT
3. 生成标题
4. 调用 `make_vertical_video.py`
5. 输出竖屏成片

### 8.3 热点榜单

1. 读取账号池配置
2. 调用 `run_xai_top10.py`
3. 输出榜单结果
4. 选中结果送入竖屏队列

### 8.4 AI 审核

1. 前端选择视频发起审核
2. Node 触发 `ai_video_review.py`
3. 存储审核结果与评分
4. 前端展示修复建议
5. 可继续触发重新生成或送入发布

### 8.5 发布中心

1. 聚合可发布素材
2. 创建发布任务
3. 绑定平台和账号
4. 执行微信视频号自动化发布
5. 写回任务状态和运行日志

### 8.6 登录检测

1. 读取微信账号配置
2. 通过登录检测服务拉起检查
3. 可选发送飞书通知
4. 写入状态缓存与结果摘要

## 9. 当前状态存储方式

项目当前是混合存储：

- SQLite
  发布任务主数据
- JSON / 文件
  配置、结果、中间产物、脚本输入输出
- 内存 Map
  SSE 客户端、部分运行态队列、发布中的进程和登录检测会话

这意味着项目已经具备工程化基础，但仍属于 **单机型、本地工作台型架构**，并不适合直接按多实例分布式服务理解。

## 10. 架构优势

- 前端模块化已经成型
- 后端基础设施与业务层有明确边界
- Node / Python 调用协议已经统一
- 发布、审核、系统配置这几块已从主入口中拆出

## 11. 当前主要限制

- `server.js` 仍然较大，仍承担一部分项目级规则与装配职责
- 运行产物仍部分混在源码目录下
- 队列和部分长任务状态仍依赖内存
- 文件协议耦合仍然较重

## 12. 推荐维护入口

接手这个项目时，建议按以下顺序理解：

1. [README.md](/Users/PC/Desktop/comfy_panel_demo/README.md)
2. [PROJECT_STRUCTURE.md](/Users/PC/Desktop/comfy_panel_demo/docs/PROJECT_STRUCTURE.md)
3. [RUNTIME_ARTIFACTS_AND_BOUNDARIES.md](/Users/PC/Desktop/comfy_panel_demo/docs/RUNTIME_ARTIFACTS_AND_BOUNDARIES.md)
4. 当前文件：
   - `server.js`
   - `frontend/src/App.vue`
   - `server/services/publish/store.js`
   - `server/services/vertical/queue.js`
