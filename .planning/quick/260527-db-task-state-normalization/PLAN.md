# 数据库任务状态规范化

目标：把长任务状态逐步收口到 SQLite TaskStore，优先覆盖重启/刷新/重试最容易重复提交的竖屏与素材驱动恢复路径。

计划：
1. 梳理现有 TaskStore 与竖屏/素材任务使用方式。
2. 增加 TaskStore 对幂等任务查找/复用的能力。
3. 让 standalone 竖屏生成写入/复用数据库任务状态，完成后记录产物与 sourceTaskDir。
4. 补测试验证同一 sourceTaskDir 不重复创建活跃竖屏任务，重启后可从 DB 查到状态。
