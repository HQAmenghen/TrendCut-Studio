---
status: complete
quick_id: 260515-lf6
completed: 2026-05-15
---

# Quick Task 260515-lf6 Summary

账号看板新增抖音和小红书登录检测、内容管理入口，并把抖音/小红书从单账号别名扩展为多账号配置。旧的单账号 `sauAccountName` 配置会自动迁移为默认账号，已创建的旧任务没有显式账号时会回退到第一个可用账号。

## Changed

- `server/services/publish/publishStore.config.js` 支持 `douyin.accounts[]` 和 `xiaohongshu.accounts[]`，保留旧字段兼容。
- 发布任务创建、重建和平台 RPA 启动都会携带并解析选中的抖音/小红书账号。
- `python/publish/social_auto_upload_adapter.py` 新增 `check_login` 和 `open_manager` 动作，复用 social-auto-upload cookie 与二维码回传。
- 发布路由新增抖音/小红书账号级登录检测和内容管理接口。
- 账号看板聚合微信视频号、抖音、小红书账号，并显示平台、登录状态、发布统计和操作按钮。
- 发布中心配置页新增抖音/小红书多账号维护，创建发布任务时可选择具体账号。
- 补充配置迁移和账号看板统计回归测试。

## Verification

- Passed: `npm test -- --runTestsByPath server/services/publish/__tests__/publishStore.config.test.js server/services/publish/__tests__/accountDashboard.test.js server/services/publish/__tests__/platformRpa.test.js --runInBand`
- Passed: `npm test -- --runTestsByPath server/services/publish/__tests__/assets.test.js server/services/publish/__tests__/handlers.test.js server/services/publish/__tests__/platformRpa.test.js server/services/publish/__tests__/scheduling.test.js server/services/publish/__tests__/wechatRpa.process.test.js server/services/publish/__tests__/publishStore.config.test.js server/services/publish/__tests__/accountDashboard.test.js --runInBand`
- Passed: `python -m unittest python.tests.test_social_auto_upload_adapter`
- Passed: `npm run build:front`
- Passed: `npm run lint -- --quiet`
