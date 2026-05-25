---
status: resolved
trigger: "检查发布中心模块的小红书发布功能完成情况；点击小红书登录检测没有反应。"
created: "2026-05-21T00:00:00+08:00"
updated: "2026-05-21T11:45:00+08:00"
---

# Debug Session: xiaohongshu-login-check-no-response

## Symptoms

- Expected behavior: 发布中心的小红书账号点击“检测登录”后，应显示检测中、打开/复用浏览器登录环境，并反馈已登录、需扫码或错误状态。
- Actual behavior: 用户点击“登录检测”后没有可见反应。
- Error messages: 用户未提供前端或后端错误提示。
- Timeline: 当前发布中心小红书功能检查时发现。
- Reproduction: 打开发布中心，进入小红书账号配置区域，点击小红书账号的“检测登录”。

## Current Focus

- hypothesis: 小红书登录检测链路已接线到 `/api/publish/platforms/:platformKey/accounts/:accountId/test-login`，但当前本机小红书发布配置未启用且没有账号，后端会在启动浏览器前拒绝检测；功能实现依赖 social-auto-upload，属于条件可用/部分完成状态。
- test: 检查 `PublishCenterWorkspace.vue`、`usePublishCenter.js`、`server/routes/publish.js`、`server/services/publish/handlers.js`、`platformRpa.js` 和 Python 小红书 RPA 适配。
- expecting: 找到无响应发生在前端事件绑定、请求失败未反馈、账号缺失、路由缺失或 Python 脚本卡住中的哪一层。
- next_action: fixed and verified
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "发布中心小红书账号卡片的“检测登录”按钮已绑定到 center.checkPlatformAccountLogin(platform.key, account.id)，按钮检测中状态依赖 checkingLoginAccounts。"
  source: "frontend/src/components/PublishCenterWorkspace.vue:551"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "checkPlatformAccountLogin 会立即打开登录状态弹窗、写入 checking 状态，并 POST 到 /api/publish/platforms/${platformKey}/accounts/${accountId}/test-login。"
  source: "frontend/src/composables/usePublishCenter.js:1612"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "后端确实注册了 /api/publish/platforms/:platformKey/accounts/:accountId/test-login，并转入 handlers.testPlatformLogin。"
  source: "server/routes/publish.js:23"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "testPlatformLogin 只支持 douyin/xiaohongshu，校验 accountId 和 checkPlatformLogin 初始化后调用 checkPlatformLogin(platformKey, accountId)。"
  source: "server/services/publish/handlers.js:608"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "checkPlatformLogin 最终进入 social-auto-upload 账号操作；若平台未启用、账号不存在、账号别名/运行目录不可用，会在启动 Python/浏览器前直接 reject。"
  source: "server/services/publish/platformRpa.js:588"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "当前本机配置中 xiaohongshu.enabled=false，sauAccountName 为空，accounts=[]。因此点击小红书账号检测没有可检测账号/启用平台。"
  source: "python/publish/platform_config.json:193"
- timestamp: "2026-05-21T00:00:00+08:00"
  observation: "代码路径说明小红书发布依赖 vendor/social-auto-upload，cookie、二维码、日志写入 data/social-auto-upload-runtime。"
  source: "README.md:124"
- timestamp: "2026-05-21T11:45:00+08:00"
  observation: "前端平台账号检测已补强：点击后立即显示 loading 弹窗、写入 checking 状态、记录运行日志，后端返回 starting/checking_login 时归一成 checking，错误时保留弹窗并显示失败原因。"
  source: "frontend/src/composables/usePublishCenter.js:341, frontend/src/composables/usePublishCenter.js:1612"
- timestamp: "2026-05-21T11:45:00+08:00"
  observation: "小红书/抖音账号行已补充账号级登录状态 badge，检测结果不再只藏在运行摘要里。"
  source: "frontend/src/components/PublishCenterWorkspace.vue:542"

## Eliminated

- hypothesis: "前端没有给小红书检测按钮绑定点击事件。"
  reason: "按钮绑定存在，指向 center.checkPlatformAccountLogin(platform.key, account.id)。"
- hypothesis: "后端缺少小红书检测路由。"
  reason: "路由 /api/publish/platforms/:platformKey/accounts/:accountId/test-login 已注册。"

## Resolution

- root_cause: 当前小红书发布未启用且没有配置账号/登录账号别名；登录检测链路存在，但后端会因平台未启用或账号不存在而拒绝启动 social-auto-upload/浏览器检测。
- fix: 发布中心平台账号检测点击后立即显示 loading 弹窗、写入 `checking` 状态并记录日志；对 `starting`/`checking_login` 做前端状态归一；错误时保持弹窗并显示失败原因；小红书/抖音账号行补充登录状态 badge。仍需要在发布中心启用小红书、添加账号并填写 social-auto-upload 登录账号别名后保存，才能进入真实扫码/发布检测。
- verification: `npm run build:front`; `npm test -- --runTestsByPath server/services/publish/__tests__/platformRpa.test.js`; `python -m unittest python.tests.test_social_auto_upload_adapter python.tests.test_browser_platform_rpa`; 本地 3001/Vite 页面确认当前小红书显示未启用且无账号。
- files_changed: `frontend/src/composables/usePublishCenter.js`, `frontend/src/components/PublishCenterWorkspace.vue`, `.planning/debug/xiaohongshu-login-check-no-response.md`
