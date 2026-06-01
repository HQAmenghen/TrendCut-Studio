---
status: awaiting_human_verify
trigger: "账号登录弹窗里小红书登录检测失败，点击重新登录没有用。"
created: "2026-05-29T16:06:58+08:00"
updated: "2026-05-29T16:30:00+08:00"
---

# Debug Session: xhs-login-button-no-effect

## Symptoms

- Expected behavior: 小红书账号点击登录/重新登录时应打开或继续平台登录检测，给出二维码/浏览器登录状态；失败后点击重新登录应重新触发同一个小红书账号登录流程。
- Actual behavior: 弹窗显示"登录检测失败 / 测试平台登录状态失败"，点击重新登录没有有效反应。
- Error messages: 前端弹窗显示"测试平台登录状态失败"。
- Timeline: 账号管理添加/配置入口调整后，用户尝试添加小红书并登录时发现。
- Reproduction: 在账号管理里添加小红书账号，点击检测/登录，弹窗失败后点击"重新登录"。

## Current Focus

- hypothesis: 小面板添加小红书只新增账号、未启用平台；后端登录检测又被平台启用开关拦截，导致每次重试都立即失败。
- test: 检查 `AutomationDashboard.vue` 添加账号是否启用平台、`usePublishCenter.js` 错误展示、`platformRpa.js` 登录检测的 enabled gate。
- expecting: 添加账号会启用对应平台；登录检测不被发布启用开关阻断；失败弹窗显示真实后端 details。
- next_action: human_verify
- reasoning_checkpoint:
  hypothesis: "addAccountConfig 添加账号时未启用平台 (updateConfig(platformKey, 'enabled', true))，且平台登录检测被发布启用开关拦截，导致每次 retry 都在后端立即失败；前端又丢弃了后端 details 以致用户看不到真实原因。"
  confirming_evidence:
    - "AutomationDashboard.vue 原 addAccountConfig 只调用 addSauAccount，未设置 config.xiaohongshu.enabled = true"
    - "platformRpa.js 的 runSocialAutoUploadAccountAction 在解析账号前检查 platformConfigRoot.enabled，小红书未启用时直接 reject"
    - "usePublishCenter.js 的 checkPlatformAccountLogin catch 块只显示 normalized.message，丢弃了 normalized.details（后端真实错误）"
  falsification_test: "如果修复后添加小红书账号会自动启用平台、登录检测不再被启用开关阻断、且错误信息包含后端 details，则用户在点击重新登录时会看到具体的失败原因而不是无反应"
  fix_rationale: "三个修复点分别解决：1) 添加账号时自动启用平台（前端）；2) 移除登录检测的发布启用 gate（后端）；3) 错误信息展示后端 details（前端）。这样即使用户环境缺少 social-auto-upload 配置，也能看到具体错误而非泛化提示。"
  blind_spots: "用户本机的 social-auto-upload 是否已正确配置小红书账号（sauAccountName 是否匹配）；Python 环境是否就绪；未做端到端浏览器验证。"

## Evidence

- timestamp: 2026-05-29T16:09:20+08:00
  observation: `AutomationDashboard.vue` 的小面板添加账号只调用 `addSauAccount`，未设置 `config.xiaohongshu.enabled = true`。
  result: confirmed
- timestamp: 2026-05-29T16:09:50+08:00
  observation: `platformRpa.js` 的 `runSocialAutoUploadAccountAction()` 在解析账号前先检查平台 `enabled`，小红书未启用时直接抛出"小红书尚未启用"，前端只显示泛化错误。
  result: confirmed
- timestamp: 2026-05-29T16:12:30+08:00
  observation: Verification passed with `npm test -- --runTestsByPath server/services/publish/__tests__/platformRpa.test.js`, `npm run build:front`, and `npm run lint`.
  result: focused regression, frontend build, and server lint all pass.
- timestamp: 2026-05-29T16:25:00+08:00
  observation: 确认 retryQrLogin 代码逻辑正确——正确检测 source === 'platform-account-login'，正确分割 accountKey 为 platformKey/accountId，正确调用 checkPlatformAccountLogin。重试按钮无反应的原因不是前端重试逻辑缺陷，而是后端每次都以相同错误立即失败。
  result: confirmed
- timestamp: 2026-05-29T16:28:00+08:00
  observation: 所有三个修复已作为未提交更改应用到代码中。platformRpa.test.js (10/10 passed), build:front (success), lint (clean)。
  result: all verifications pass

## Eliminated

- hypothesis: "retryQrLogin 函数逻辑有误，无法正确路由到 checkPlatformAccountLogin"
  evidence: "代码审查确认 retryQrLogin 正确处理 source === 'platform-account-login' 和 accountKey.includes(':') 分支，正确调用 checkPlatformAccountLogin(platformKey, accountId)"
  timestamp: 2026-05-29T16:25:00+08:00

## Resolution

- root_cause: 账号管理小面板创建小红书账号时没有同步启用小红书平台（`config.xiaohongshu.enabled` 保持 false），而后端平台登录检测 `runSocialAutoUploadAccountAction` 在解析账号前先检查平台发布启用开关 `platformConfigRoot.enabled`，导致登录检测在打开二维码/浏览器前就失败并抛出"小红书尚未启用"；前端错误展示又丢弃了后端 details（`normalized.details` 包含真实错误原因），用户收到泛化错误"测试平台登录状态失败"而无法诊断。每次点击重试都因相同原因立即失败，表现为"没有有效反应"。
- fix: 1) `addAccountConfig` 添加账号时自动调用 `updateConfig(platformKey, 'enabled', true)` 启用对应平台；2) 移除 `platformRpa.js` 中 `runSocialAutoUploadAccountAction` 的平台发布启用检查（账号登录检测/内容管理不再被发布启用开关阻断）；3) 前端 `checkPlatformAccountLogin` 错误处理将 `normalized.details` 拼接到错误消息中显示。
- verification: `npm test -- --runTestsByPath server/services/publish/__tests__/platformRpa.test.js` (10/10 passed); `npm run build:front` (success); `npm run lint` (clean).
- files_changed: `frontend/src/components/AutomationDashboard.vue`, `frontend/src/composables/usePublishCenter.js`, `server/services/publish/platformRpa.js`, `server/services/publish/__tests__/platformRpa.test.js`.
