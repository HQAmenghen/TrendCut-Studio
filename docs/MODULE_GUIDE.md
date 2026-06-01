# 模块指南

TrendCut Studio 的第一版可执行 UI 已经收敛到统一运营驾驶舱，不再维护旧版按页面拆分的 Workspace 组件。当前前端主入口是 `frontend/src/components/AutomationDashboard.vue`，业务状态主要由 `frontend/src/composables/` 下的组合函数承载。

## 1. 运营驾驶舱

前端：

- `frontend/src/App.vue`
- `frontend/src/components/AppHeader.vue`
- `frontend/src/components/AutomationDashboard.vue`
- `frontend/src/components/ProductionProgressPanel.vue`
- `frontend/src/components/XaiRunErrorModal.vue`

作用：

- 聚合热点发现、素材驱动生产、竖屏合成、审核发布、账号状态和系统运行状态。
- 展示实时任务队列、生产进度、错误状态和可操作的下一步。
- 作为第一版可执行版本的主要操作界面。

## 2. 热点发现

前端：

- `frontend/src/composables/useXaiTop10.js`

后端：

- `server/routes/xai.js`
- `server/services/xai/service.js`

Python：

- `python/xai/run_xai_top10.py`
- `python/xai/translate_result_summaries.py`

作用：

- 拉取 xAI 热点榜单。
- 维护账号池和分区数据。
- 把适合制作的条目送入素材驱动视频制作流程。

## 3. 素材驱动视频制作剪辑

前端：

- `frontend/src/composables/useMaterialDriven.js`

后端：

- `server/routes/materialDriven.js`
- `server/services/materialDriven/`

Python：

- `python/pipeline/run_material_driven.py`
- `python/pipeline/smart_video_composer.py`
- `python/pipeline/planner/`
- `python/pipeline/skills/`

作用：

- 接入本地素材或热点素材。
- 运行素材分析、脚本生成、剪辑计划和成片合成。
- 支持恢复、重试、重建计划和重渲染。
- 产出 `output_final.mp4`，并保留 `aiman.mp4` 作为内部数字人视频文件名以兼容历史任务。

## 4. 竖屏后期合成

前端：

- `frontend/src/composables/useStandalone.js`
- `frontend/src/composables/useVerticalQueue.js`

后端：

- `server/routes/standalone.js`
- `server/routes/vertical.js`
- `server/services/vertical/standalone.js`
- `server/services/vertical/queue.js`

作用：

- 将横版成片转为平台更适配的竖屏素材。
- 管理竖屏任务队列。
- 与审核、发布资产汇总联动。

## 5. AI 审核

前端：

- `frontend/src/composables/useVideoReview.js`

后端：

- `server/routes/review.js`
- `server/services/review/handlers.js`
- `server/services/review/regenerate.js`

Python：

- `python/review/ai_video_review.py`

作用：

- 配置并执行视频审核。
- 保存审核历史。
- 根据修复建议重新入队生成。

## 6. 发布自动化

前端：

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

Vendor：

- `vendor/social-auto-upload/`

作用：

- 汇总可发布素材。
- 生成发布文案。
- 创建抖音、小红书、微信视频号等平台发布任务。
- 执行微信视频号 RPA 和平台登录检测。

## 7. 账号监控与系统运维

前端：

- `frontend/src/components/AutomationDashboard.vue`

后端：

- `server/services/publish/accountDashboard.js`
- `server/routes/publish.js`
- `server/routes/system.js`
- `server/services/system/handlers.js`
- `server/services/system/selfCheck.js`
- `server/services/system/scheduler.js`
- `server/routes/loginStatus.js`

作用：

- 查看账号状态、任务和失败记录。
- 管理预设素材、工作流配置、飞书通知、登录检测和 LLM Provider。
- 执行自检和定时调度。
