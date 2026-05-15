---
status: complete
quick_id: 260515-g5r
completed: 2026-05-15
---

完善抖音和小红书浏览器自动发布功能。

完成内容：
- 强化 `python/publish/browser_platform_rpa.py`：按平台选择标题/正文/发布按钮 selector；首次打开登录页时等待用户登录后继续；上传控件找不到时先点击上传入口再重试；失败时保持浏览器供人工接管。
- 更新发布中心平台提示，明确抖音/小红书走浏览器 RPA，不再显示为仅预留字段。
- 导出浏览器 RPA 平台定义并补充 Node 单测，覆盖 payload 写入、上传页和账号隔离 profile。
- 新增 Python 单测，覆盖平台策略、上传入口兜底和登录等待。

验证：
- `python -m unittest python.tests.test_browser_platform_rpa python.tests.test_wechat_channels_rpa`
- `npx jest server/services/publish/__tests__/platformRpa.test.js --runInBand`
- `npx jest server/services/publish/__tests__ --runInBand`
- `npm run lint`
- `npm run build:front`
