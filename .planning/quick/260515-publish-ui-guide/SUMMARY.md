---
status: complete
quick_id: 260515-publish-ui-guide
completed: 2026-05-15
---

优化发布中心抖音/小红书配置 UI，让账号配置和草稿测试更直观。

完成内容：
- 将抖音/小红书平台字段里的 `SAU 账号名` 改成更易理解的 `登录账号别名`。
- 为抖音/小红书配置区增加 3 步引导：启用平台、填写别名、保存后去任务里草稿测试。
- 为登录账号别名增加示例与说明，并提供“一键填入推荐别名”按钮。
- 将任务操作按钮改成更直观的“草稿测试”和“自动发表”，并增加安全测试提示。

验证：
- `npx jest server/services/publish/__tests__/platformRpa.test.js --runInBand`
- `npm run build:front`
