# API 概览

## 总入口

后端统一入口是 `server.js`，当前主要 API 分为以下几组。

## 1. 素材驱动工作流

前缀：`/api/material-driven`

主要接口：

- `POST /start`
  - 启动工作流
- `POST /test-comfy`
  - 测试 ComfyUI 连通性
- `GET /status/:jobId`
  - 查询任务快照
- `GET /progress/:jobId`
  - SSE 实时进度
- `POST /continue/:jobId`
  - 从步骤 6 继续
- `POST /retry/:jobId`
  - 重试指定步骤
- `POST /rebuild/:jobId`
  - 从步骤 5 重建计划
- `POST /rerender/:jobId`
  - 从步骤 7 重渲染

## 2. 热点榜单

前缀：`/api/xai-top10`

主要接口：

- `GET /result`
- `GET /status`
- `GET /config`
- `POST /config`
- `POST /run`

## 3. 竖屏与队列

主要接口：

- `POST /api/generate-vertical-standalone`
- `GET /api/vertical/material-tasks`
- `GET /api/xai-top10/vertical-jobs`
- `POST /api/xai-top10/vertical-jobs`
- `POST /api/xai-top10/vertical-jobs/:jobId/cancel`
- `DELETE /api/xai-top10/vertical-jobs/:jobId`

## 4. AI 审核

前缀：`/api/review`

主要接口：

- `GET /config`
- `POST /config`
- `POST /video`
- `POST /skip`
- `POST /regenerate`
- `GET /history`
- `GET /:reviewId`
- `DELETE /:reviewId`

## 5. 发布中心

前缀：`/api/publish`

主要接口：

- `GET /config`
- `POST /config`
- `GET /assets`
- `POST /description`
- `GET /jobs`
- `POST /jobs`
- `DELETE /jobs/:jobId`
- `DELETE /jobs`
- `POST /jobs/:jobId/archive`
- `POST /jobs/:jobId/unarchive`
- `POST /jobs/archive-completed`
- `POST /jobs/:jobId/regenerate-description`
- `POST /jobs/wechat-channels/start-all`
- `POST /jobs/:jobId/wechat-channels`
- `POST /jobs/:jobId/wechat-channels/retry`
- `POST /jobs/:jobId/wechat-channels/cancel`
- `POST /wechat/test-login/:accountId`

账号看板接口：

- `GET /accounts/dashboard`
- `GET /accounts/:accountId/jobs`
- `GET /accounts/:accountId/failures`

## 6. 系统设置

前缀：`/api/system`

主要能力：

- 预设素材读取
- 启动自检
- 工作流配置读取/保存
- 可编辑 JSON 文件读取/保存
- 文案优化
- 视频比例转换
- 飞书配置
- 登录检测配置
- LLM 配置
- 恢复服务状态与人工操作

## 7. 登录状态

前缀：`/api/login-status`

用于对外暴露登录状态检测与通知相关能力。

## 8. 设计说明

- 大部分业务接口由 Node 完成编排，然后调用 Python 脚本。
- 素材驱动工作流使用 SSE，而不是轮询，来承载实时状态。
- 发布中心和审核中心都依赖本地文件元数据与数据库状态。
