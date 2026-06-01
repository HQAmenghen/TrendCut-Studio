# API 概览

TrendCut Studio 的 HTTP API 由 `server.js` 统一装配。路由模块位于 `server/routes/`，主要业务逻辑位于 `server/services/`。

## API 分组

| 分组 | 前缀 | 用途 |
| --- | --- | --- |
| 素材驱动工作流 | `/api/material-driven` | 启动、继续、重试、重建、重渲染并观察主生产链路。 |
| 热点发现 | `/api/xai-top10` | 执行和读取 xAI/X 热点榜单、分区配置和运行状态。 |
| 竖屏队列 | `/api/xai-top10/vertical-jobs`, `/api/generate-vertical-standalone`, `/api/vertical/*` | 创建、查看、取消、删除和导入竖屏视频任务。 |
| AI 审核 | `/api/review` | 审核视频、保存历史、跳过审核，并按建议重新生成。 |
| 发布中心 | `/api/publish` | 管理发布素材、平台配置、草稿/任务、RPA 执行、账号看板和定时发布。 |
| 系统运维 | `/api/system`, `/api/workflow-config`, `/api/json-files`, `/api/presets` | 自检、任务视图、可编辑 JSON、工作流配置、飞书、登录检测和 LLM 设置。 |
| 登录状态 | `/api/login-status` | 触发登录检测、读取缓存状态、请求二维码截图和发送测试通知。 |
| Agent API | `/api/agent/v1` | 供 MCP 客户端和本地自动化程序使用的 Token 鉴权接口。 |

## 素材驱动工作流

实现位置：`server/routes/materialDriven.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/material-driven/test-comfy` | 测试 ComfyUI 连通性。 |
| `POST` | `/api/material-driven/start` | 从上传文件或 URL 启动素材驱动任务。 |
| `GET` | `/api/material-driven/status/:jobId` | 读取任务快照。 |
| `GET` | `/api/material-driven/active` | 列出活跃素材驱动任务。 |
| `GET` | `/api/material-driven/latest-completed` | 返回最近完成的素材驱动任务。 |
| `GET` | `/api/material-driven/progress/:jobId` | 订阅 SSE 进度事件。 |
| `POST` | `/api/material-driven/continue/:jobId` | 从数字人断点继续执行。 |
| `POST` | `/api/material-driven/retry/:jobId` | 重试指定工作流步骤。 |
| `POST` | `/api/material-driven/rebuild/:jobId` | 从第 5 步重建口播和剪辑计划。 |
| `POST` | `/api/material-driven/rerender/:jobId` | 从第 7 步重新渲染最终视频。 |

## 热点发现

实现位置：`server/routes/xai.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/xai-top10/result` | 读取当前热点结果。 |
| `GET` | `/api/xai-top10/status` | 读取运行状态。 |
| `GET` | `/api/xai-top10/config` | 读取热点配置。 |
| `POST` | `/api/xai-top10/config` | 保存热点配置。 |
| `POST` | `/api/xai-top10/run` | 启动一次热点运行。 |

## 竖屏与独立任务

实现位置：`server/routes/vertical.js`、`server/routes/standalone.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/generate-vertical-standalone` | 生成独立竖屏视频。 |
| `GET` | `/api/vertical/material-tasks` | 列出可导入的已完成素材驱动任务。 |
| `GET` | `/api/vertical/standalone-tasks` | 列出独立竖屏任务。 |
| `GET` | `/api/xai-top10/vertical-jobs` | 列出竖屏队列任务。 |
| `POST` | `/api/xai-top10/vertical-jobs` | 入队竖屏任务。 |
| `POST` | `/api/xai-top10/vertical-jobs/:jobId/cancel` | 取消竖屏队列任务。 |
| `DELETE` | `/api/xai-top10/vertical-jobs/:jobId` | 删除竖屏队列任务。 |

## AI 审核

实现位置：`server/routes/review.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/review/config` | 读取审核配置。 |
| `POST` | `/api/review/config` | 更新审核配置。 |
| `POST` | `/api/review/video` | 对视频执行 AI 审核。 |
| `POST` | `/api/review/skip` | 记录跳过审核的决策。 |
| `POST` | `/api/review/regenerate` | 根据审核建议重新生成。 |
| `GET` | `/api/review/history` | 列出审核记录。 |
| `GET` | `/api/review/:reviewId` | 读取单条审核记录。 |
| `DELETE` | `/api/review/:reviewId` | 删除单条审核记录。 |

## 发布中心

实现位置：`server/routes/publish.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/publish/config` | 读取平台和账号配置。 |
| `POST` | `/api/publish/config` | 保存平台和账号配置。 |
| `GET` | `/api/publish/assets` | 列出可发布视频素材。 |
| `DELETE` | `/api/publish/assets/:assetId` | 删除受管理的发布素材。 |
| `POST` | `/api/publish/description` | 生成发布描述。 |
| `GET` | `/api/publish/jobs` | 列出发布任务。 |
| `POST` | `/api/publish/jobs` | 创建发布任务。 |
| `DELETE` | `/api/publish/jobs/:jobId` | 删除单个发布任务。 |
| `DELETE` | `/api/publish/jobs` | 批量删除发布任务。 |
| `POST` | `/api/publish/jobs/:jobId/archive` | 归档单个任务。 |
| `POST` | `/api/publish/jobs/:jobId/unarchive` | 取消归档单个任务。 |
| `POST` | `/api/publish/jobs/archive-completed` | 归档已完成任务。 |
| `POST` | `/api/publish/jobs/:jobId/regenerate-description` | 重新生成任务描述。 |
| `POST` | `/api/publish/jobs/wechat-channels/start-all` | 启动待执行的视频号任务。 |
| `POST` | `/api/publish/jobs/:jobId/wechat-channels` | 启动单个视频号任务。 |
| `POST` | `/api/publish/jobs/:jobId/wechat-channels/retry` | 重试单个视频号任务。 |
| `POST` | `/api/publish/jobs/:jobId/wechat-channels/cancel` | 取消单个视频号任务。 |
| `POST` | `/api/publish/jobs/:jobId/platforms/:platformKey/start` | 启动指定平台任务。 |
| `POST` | `/api/publish/jobs/:jobId/platforms/:platformKey/retry` | 重试指定平台任务。 |
| `POST` | `/api/publish/jobs/:jobId/platforms/:platformKey/cancel` | 取消指定平台任务。 |
| `POST` | `/api/publish/wechat/test-login/:accountId` | 测试微信登录状态。 |
| `POST` | `/api/publish/wechat/content-manager/:accountId` | 打开微信内容管理页面。 |
| `POST` | `/api/publish/platforms/:platformKey/accounts/:accountId/test-login` | 测试指定平台账号登录状态。 |
| `POST` | `/api/publish/platforms/:platformKey/accounts/:accountId/content-manager` | 打开指定平台内容管理页面。 |
| `GET` | `/api/publish/accounts/dashboard` | 读取账号看板摘要。 |
| `GET` | `/api/publish/accounts/:accountId/jobs` | 列出单个账号的任务。 |
| `GET` | `/api/publish/accounts/:accountId/failures` | 列出单个账号的失败记录。 |

## 系统运维

实现位置：`server/routes/system.js`，恢复相关路由在 `server.js` 中注册。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/system/self-check` | 检查环境、目录、Python、FFmpeg、Python 包、Playwright 和 ComfyUI 配置。 |
| `GET` | `/api/system/tasks` | 读取统一任务视图。 |
| `GET` | `/api/presets` | 列出数字人、音频和图片预设。 |
| `GET` | `/api/workflow-config` | 读取工作流配置。 |
| `POST` | `/api/workflow-config` | 保存工作流配置。 |
| `GET` | `/api/json-files` | 列出允许编辑的 JSON 文件。 |
| `GET` | `/api/json-files/:fileName` | 读取指定 JSON 文件。 |
| `POST` | `/api/json-files/:fileName` | 保存指定 JSON 文件。 |
| `POST` | `/api/optimize-text` | 使用配置的 LLM 优化文本。 |
| `POST` | `/api/convert-video` | 转换视频比例。 |
| `GET` | `/api/system/feishu-config` | 读取飞书配置。 |
| `POST` | `/api/system/feishu-config` | 保存飞书配置。 |
| `GET` | `/api/system/login-check-config` | 读取登录检测配置。 |
| `POST` | `/api/system/login-check-config` | 保存登录检测配置。 |
| `GET` | `/api/system/llm-config` | 读取 LLM 配置。 |
| `POST` | `/api/system/llm-config` | 保存 LLM 配置。 |
| `GET` | `/api/system/recovery/status` | 读取中断任务恢复状态。 |
| `POST` | `/api/system/recovery/retry/:taskId` | 重试中断任务。 |
| `POST` | `/api/system/recovery/cancel/:taskId` | 取消中断任务。 |

## 登录状态

实现位置：`server/routes/loginStatus.js`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/login-status/check-all` | 检查所有已配置账号。 |
| `POST` | `/api/login-status/check-batch` | 检查选中的账号批次。 |
| `POST` | `/api/login-status/check/:accountId` | 检查单个账号。 |
| `GET` / `POST` | `/api/login-status/request-latest-qr/:accountId` | 请求最新二维码截图。 |
| `GET` | `/api/login-status/all` | 读取所有账号缓存状态。 |
| `GET` | `/api/login-status/:accountId` | 读取单个账号缓存状态。 |
| `DELETE` | `/api/login-status/cache/:accountId?` | 清理登录状态缓存。 |
| `POST` | `/api/login-status/test-feishu` | 发送飞书测试通知。 |

## Agent API

实现位置：`server/routes/agent.js`，由 `mcp-server/` 消费。

| 区域 | 端点 |
| --- | --- |
| 健康检查 | `GET /api/agent/v1/health`, `GET /api/agent/v1/capabilities` |
| 热点 | `GET /api/agent/v1/hotspots/partitions`, `GET /api/agent/v1/hotspots/status`, `POST /api/agent/v1/hotspots/refresh`, `POST /api/agent/v1/posts/search` |
| 视频生成 | `POST /api/agent/v1/videos/generate-from-post`, `POST /api/agent/v1/videos/generate-narration-from-post`, `GET /api/agent/v1/jobs/:jobId`, `GET /api/agent/v1/jobs/:jobId/next-actions` |
| 口播与数字人 | `GET /api/agent/v1/jobs/:jobId/narration`, `POST /api/agent/v1/jobs/:jobId/narration/revise`, `POST /api/agent/v1/jobs/:jobId/avatar/config`, `POST /api/agent/v1/jobs/:jobId/avatar/generate`, `GET /api/agent/v1/jobs/:jobId/avatar`, `GET /api/agent/v1/jobs/:jobId/avatar/preview` |
| 渲染与竖屏 | `POST /api/agent/v1/jobs/:jobId/render-final`, `POST /api/agent/v1/jobs/:jobId/continue-one-click`, `GET /api/agent/v1/vertical/jobs`, `POST /api/agent/v1/vertical/from-post`, `POST /api/agent/v1/vertical/direct`, `POST /api/agent/v1/vertical/from-material-job`, `GET /api/agent/v1/vertical/jobs/:jobId`, `GET /api/agent/v1/material/tasks` |
| 审核 | `POST /api/agent/v1/videos/:jobId/review`, `GET /api/agent/v1/reviews`, `GET /api/agent/v1/reviews/:reviewId` |
| 发布 | `GET /api/agent/v1/publish/assets`, `GET /api/agent/v1/publish/drafts`, `GET /api/agent/v1/publish/schedule`, `GET /api/agent/v1/publish/scheduled`, `GET /api/agent/v1/publish/tasks/:publishJobId`, `POST /api/agent/v1/publish/draft`, `POST /api/agent/v1/publish/confirm` |
| 账号与登录 | `GET /api/agent/v1/publish/accounts/dashboard`, `GET /api/agent/v1/publish/accounts/:accountId/jobs`, `GET /api/agent/v1/publish/accounts/:accountId/failures`, `GET /api/agent/v1/login-statuses`, `GET /api/agent/v1/login-statuses/:accountId`, `POST /api/agent/v1/login-statuses/:accountId/qrcode` |

Agent API 的设计目标是提供受控自动化入口。真实发布确认与草稿创建分离，并要求显式确认。
