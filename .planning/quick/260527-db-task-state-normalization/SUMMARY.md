---
status: complete
---

完成内容：
- TaskStore 新增 taskKey 字段、唯一索引、findTaskByKey、createOrReuseTask，支持数据库层幂等任务。
- standalone 竖屏合成接入 TaskStore：素材任务来源使用 sourceTaskDir 作为幂等键，running/completed 任务优先复用，不重复渲染。
- standalone 流水线阶段写入数据库：准备输入、刷新字幕、ASR、渲染、完成、失败。
- 新增 /api/vertical/standalone-tasks，从数据库返回单条竖屏任务状态。
- 前端 useStandalone 同时读取批量队列与 standalone DB 任务，202 复用运行中任务不再误报失败。

验证：
- npm test -- --runTestsByPath server/core/__tests__/taskStore.test.js server/routes/__tests__/standalone.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/publish/__tests__/assets.test.js
- npm run build:front
- npm run lint -- --quiet
