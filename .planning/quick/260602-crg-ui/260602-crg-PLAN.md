# Quick Task 260602-crg: 在新版 UI 面板中恢复数字人形象和声音配置入口

## Goal

在新版自动生产驾驶舱中重新露出数字人声音和形象配置，位置要贴近启动操作区，并保持现有液态玻璃/紧凑控制风格一致。

## Tasks

1. 在 `frontend/src/components/AutomationDashboard.vue` 的启动区加入数字人配置摘要和可编辑控件，复用 `materialDriven` 现有 `gen`、`audioMode`、`imageMode`、`presets`、`testComfyConnection` 状态。
2. 在 `frontend/src/components/AutomationDashboard.css` 中补齐紧凑配置面板、摘要 chip、上传按钮、连接检测状态的响应式样式。
3. 运行前端构建或等效检查，并用本地浏览器确认主面板布局没有明显重叠或破版。
