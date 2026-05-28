# 全链路数据库任务状态统一

目标：把素材驱动、RunningHub 数字人、竖屏合成等长任务状态收口到 SQLite TaskStore。数据库作为任务状态权威源，磁盘作为产物与恢复校验来源。

计划：
1. 梳理 material-driven 启动/继续/重试/RunningHub 状态写入点。
2. 定义统一 taskKey：material:<outputDir/jobId>、avatar:<providerTaskId>、vertical:<sourceTaskDir>。
3. 在 material 主流程与 RunningHub 数字人阶段写入 TaskStore。
4. 让 active/queue 查询合并 DB 状态，减少内存/扫描依赖。
5. 补测试覆盖重启恢复、重试复用、任务状态查询。
