---
status: complete
---

完成内容：
- 全链路统一到 TaskStore 语义：material_driven、avatar_generation、standalone_vertical、已有 vertical_queue。
- 新增 materialDriven/taskStoreBridge.js，集中管理 taskKey 与内存任务到数据库任务的映射。
- material 主任务使用 taskKey=material:<outputDir>，状态变化在启动、阶段推进、等待数字人、失败、完成时写 DB。
- RunningHub 数字人子任务使用 taskKey=runninghub:<taskId>，提交、轮询中断、完成、下载完成均写 DB。
- AutoPilot 程序化启动入口也传入 taskStore，避免托管链路绕开数据库。
- material active 查询合并 DB 中的 material_driven 和 avatar_generation 活跃任务，面板能看到 DB 恢复任务。
- standalone 竖屏和前端 DB 队列展示已保留并纳入统一链路。

验证：
- npm test -- --runTestsByPath server/services/materialDriven/__tests__/taskStoreBridge.test.js server/services/materialDriven/__tests__/taskRegistry.test.js server/services/materialDriven/__tests__/pipelineProcess.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/core/__tests__/taskStore.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/routes/__tests__/standalone.test.js server/services/publish/__tests__/assets.test.js server/services/system/__tests__/scheduler.test.js
- npm run build:front
- npm run lint -- --quiet
