---
status: complete
---

完成内容：
- 实时进度：material Python 协议/百分比/步骤解析后同步写 TaskStore，刷新/重启后 DB 进度更可信。
- 恢复策略：material_driven、avatar_generation、standalone_vertical 纳入恢复服务，默认手动恢复，避免服务重启后误自动重跑昂贵任务。
- 磁盘扫描：保留为旧任务/产物校验兜底，registry 在扫描恢复时会同步 DB，逐步变成索引修复路径。
- 统一任务视图：新增 /api/system/tasks，合并 TaskStore、publishStore、XAI 当前任务投影；发布/RPA/XAI 不迁移业务数据，只桥接任务视图。
- 保留设计：视频、字幕、执行计划、metadata 仍在磁盘作为产物，不做无收益入库。

验证：
- npm test -- --runTestsByPath server/core/__tests__/taskView.test.js server/routes/__tests__/system.test.js server/core/__tests__/recovery.test.js server/services/materialDriven/__tests__/taskStoreBridge.test.js server/services/materialDriven/__tests__/taskRegistry.test.js server/services/materialDriven/__tests__/pipelineProcess.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/core/__tests__/taskStore.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/routes/__tests__/standalone.test.js server/services/publish/__tests__/assets.test.js server/services/system/__tests__/scheduler.test.js
- npm run build:front
- npm run lint -- --quiet
