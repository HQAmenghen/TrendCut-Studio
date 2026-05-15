---
status: complete
quick_id: 260515-hmx
completed: 2026-05-15
---

代码级融合 social-auto-upload 抖音/小红书 uploader，并支持草稿模式。

完成内容：
- 新增 `python/publish/social_auto_upload_adapter.py`，运行在 social-auto-upload 的 Python 环境中，直接 import 其 DouYinVideo / XiaoHongShuVideo。
- `publish` 模式调用第三方原有发布流程。
- `draft` 模式复用第三方上传、填写、封面处理逻辑，但停在点击发布前并保持浏览器打开供人工确认。
- Node 发布中心优先调用 direct adapter，保留无 SAU 配置时的本地浏览器 RPA 回退。
- 自检加入 direct adapter 脚本检查，前端提示更新为代码级适配器。
- 新增 adapter payload 单测。

验证：
- `python -m unittest python.tests.test_social_auto_upload_adapter python.tests.test_browser_platform_rpa python.tests.test_wechat_channels_rpa`
- `npx jest server/services/publish/__tests__/platformRpa.test.js server/core/__tests__/python.test.js --runInBand`
- `npx jest server/services/publish/__tests__ --runInBand`
- `npm run lint`
- `npm run build:front`
- `C:\Users\PC\social-auto-upload\.venv\Scripts\python.exe python\publish\social_auto_upload_adapter.py --help`
- `C:\Users\PC\social-auto-upload\.venv\Scripts\python.exe -m py_compile python\publish\social_auto_upload_adapter.py`
