# 模块指南

## 1. 热点转视频生产线

前端：

- `frontend/src/components/MaterialDrivenWorkspace.vue`
- `frontend/src/composables/useMaterialDriven.js`

后端：

- `server/routes/materialDriven.js`

Python：

- `python/pipeline/run_material_driven.py`

作用：

- 接入素材
- 运行 7 步生产线
- 展示脚本、计划和日志
- 支持重建、重试、重渲染

## 2. 竖屏后期合成

前端：

- `frontend/src/components/StandaloneWorkspace.vue`
- `frontend/src/composables/useStandalone.js`

后端：

- `server/routes/standalone.js`
- `server/services/vertical/standalone.js`
- `server/services/vertical/queue.js`

作用：

- 单视频竖屏处理
- 竖屏任务队列
- 与审核、发布资产汇总联动

## 3. 热门视频榜单

前端：

- `frontend/src/components/XaiDiscoveryWorkspace.vue`
- `frontend/src/composables/useXaiTop10.js`

后端：

- `server/routes/xai.js`
- `server/services/xai/service.js`

Python：

- `python/xai/run_xai_top10.py`
- `python/xai/translate_result_summaries.py`

作用：

- 拉取 xAI 榜单
- 维护账号池
- 一键把条目送入素材驱动工作流

## 4. AI 审核中心

前端：

- `frontend/src/components/ReviewCenterWorkspace.vue`
- `frontend/src/composables/useVideoReview.js`

后端：

- `server/routes/review.js`
- `server/services/review/handlers.js`
- `server/services/review/regenerate.js`

Python：

- `python/review/ai_video_review.py`

作用：

- 配置审核
- 发起审核
- 保存审核历史
- 根据修复建议重新入队生成

## 5. 一键发布

前端：

- `frontend/src/components/PublishCenterWorkspace.vue`
- `frontend/src/composables/usePublishCenter.js`

后端：

- `server/routes/publish.js`
- `server/services/publish/handlers.js`
- `server/services/publish/store.js`
- `server/services/publish/wechatRpa.js`

Python：

- `python/publish/generate_publish_description.py`
- `python/publish/wechat_channels_rpa.py`
- `python/publish/wechat_check_login.py`

作用：

- 汇总可发布素材
- 生成发布文案
- 创建平台任务
- 执行微信视频号自动化

## 6. 账号看板

前端：

- `frontend/src/components/AccountDashboardWorkspace.vue`

后端：

- `server/services/publish/accountDashboard.js`
- `server/routes/publish.js` 中的账号相关接口

作用：

- 查看账号状态
- 查看账号维度任务和失败记录
- 联动登录检测结果

## 7. 系统设置

前端：

- `frontend/src/components/SystemSettingsWorkspace.vue`

后端：

- `server/routes/system.js`
- `server/services/system/handlers.js`
- `server/services/system/selfCheck.js`
- `server/services/system/scheduler.js`
- `server/routes/loginStatus.js`

作用：

- 自检
- 预设素材管理
- 工作流配置
- 飞书通知配置
- 登录检测配置
- LLM 提供商配置
