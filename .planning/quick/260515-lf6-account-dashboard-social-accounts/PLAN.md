---
status: in-progress
quick_id: 260515-lf6
created: 2026-05-15
---

# Quick Task 260515-lf6: 账号看板新增抖音和小红书登录检测控制与多账户适配

## Goal

在已验证抖音 social-auto-upload 集成可用的基础上，把抖音和小红书纳入账号看板，并支持多个账号的登录态检测、二维码登录提示、内容管理入口和发布任务账号选择。

## Tasks

1. 将抖音和小红书配置从单账号字段兼容扩展为 `accounts[]`，旧字段自动迁移为默认账号。
2. 让发布任务创建、任务重建和平台 RPA 启动使用所选账号，而不是只读平台级别账号。
3. 新增抖音/小红书账号级登录检测和内容管理 API，复用 social-auto-upload cookie 与二维码链路。
4. 更新账号看板展示，按平台显示账号、状态、统计和控制按钮。
5. 更新发布中心配置和创建任务表单，支持抖音/小红书多账号维护与选择。
6. 补充后端回归测试并运行前端构建、lint 和相关测试。

## Notes

- 登录态保存为 `data/social-auto-upload-runtime/cookies/<platform>_<account>.json`，实际有效期由平台 cookie/session 决定。
- 登录检测不自动推送飞书。
- `python/publish/platform_rpa_tasks/` 是运行产物，不纳入提交。
