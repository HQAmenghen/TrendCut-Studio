---
status: resolved
trigger: "账号看板内容管理按钮打开前做了额外登录检测，导致抖音内容管理提示未登录，但登录检测又提示已登录。期望内容管理只复用登录检测弹窗/状态，并提供一个不关闭浏览器的操作。"
created: "2026-05-18T00:00:00+08:00"
updated: "2026-05-18T11:55:10+08:00"
---

# Debug Session: account-content-manager-login

## Symptoms

- Expected behavior: 账号看板点击内容管理时，不再额外发起一套登录检测；逻辑应和“检测登录态”的弹窗保持一致，只多一个保持浏览器/窗口不关闭的操作。
- Actual behavior: 内容管理按钮先检测登录，再打开内容管理；抖音内容管理点击后提示未登录，而手动登录检测又提示已登录。
- Error messages: 前端显示“需要登录”或“该账号登录态已失效，请先完成登录检测后再打开内容管理”。
- Timeline: 用户反馈发生在账号看板新增抖音/小红书登录检测和多账户适配之后。
- Reproduction: 在账号看板点击抖音账号的“内容管理”，随后点击“检测登录态”对比结果。

## Current Focus

- hypothesis: 打开内容管理前的额外 `checkLoginBeforeOpening` 与后端内容管理打开流程使用了不同判定路径/账号 key，造成登录态不一致。
- test: 检查 `AccountDashboardWorkspace.vue`、`usePublishCenter.js` 和发布路由内容管理 handlers 的登录判断差异。
- expecting: 内容管理按钮可删除打开前检测，直接调用内容管理接口；需要登录时复用现有扫码/登录弹窗，而不是阻断在额外检测。
- next_action: fixed and verified
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- `frontend/src/components/AccountDashboardWorkspace.vue` previously called `checkLoginBeforeOpening()` before every content manager open, causing a second login path to run before the content manager session.
- `server/services/publish/platformRpa.js` content manager sessions already run `ensure_cookie_ready()` and can emit `need_login` / QR status, so the frontend pre-check duplicated backend work.
- Existing platform content manager sessions returned `already_open` for any active open-manager process, which hid the latest `need_scan` / `opening` state from frontend polling.
- timestamp: 2026-05-18T11:55:10+08:00
  observation: `frontend/src/composables/usePublishCenter.js` now centralizes platform login response normalization so `need_scan` maps to account status `need_login` while still feeding the QR modal with a normalized image payload.
  result: Platform login checks and content-manager login prompts now share the same status shape.
- timestamp: 2026-05-18T11:55:10+08:00
  observation: Verification passed with `npm test -- --runTestsByPath server/services/publish/__tests__/platformRpa.test.js`, `npm run build:front`, and `npm run lint`.
  result: Focused platform RPA regression, frontend build, and server lint all pass; lint reports one unrelated existing warning in `server/services/publish/__tests__/publishStore.config.test.js`.

## Eliminated

- The issue is not caused by missing platform routes; `/api/publish/platforms/:platformKey/accounts/:accountId/content-manager` exists and routes to `openPlatformContentManager`.

## Resolution

- root_cause: Account dashboard content management performed an extra login check before opening, while the backend content-manager action performed its own login/cookie readiness check. For Douyin this could create conflicting session state where content manager reported not logged in while standalone login detection reported logged in.
- fix: Removed the frontend pre-open login check, made content manager directly call the content-manager endpoint, reused the existing QR modal for `need_scan`, added polling against the same content-manager session, and made platform content-manager sessions return their latest QR/opening/opened state instead of a generic `already_open`.
- verification: `npm test -- --runTestsByPath server/services/publish/__tests__/platformRpa.test.js`; `npm run build:front`; `npm run lint`.
- files_changed: `frontend/src/components/AccountDashboardWorkspace.vue`, `frontend/src/composables/usePublishCenter.js`, `server/services/publish/platformRpa.js`, `server/services/publish/__tests__/platformRpa.test.js`, `.planning/debug/account-content-manager-login.md`.
