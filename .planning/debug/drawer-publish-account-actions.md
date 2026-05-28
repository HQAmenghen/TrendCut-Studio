---
status: investigating
trigger: "把我下方那几个抽屉一样的设计统一整体的设计风格和语音，不要这样子折叠，话语发布队列执行失败了，我都不能手动重新发布，第三账号检测哪里点击了提示异常，但是也没有让我重新登录，而且应该还有个管理的按钮和添加配置按钮的选择才对。修复这几个问题"
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: drawer-publish-account-actions

## Symptoms

- Expected behavior: Lower-page drawer-like panels should share one visual style and wording, should not use the current collapsed drawer interaction, failed publish queue items should allow manual republish, account check failures should offer re-login, and account configuration should expose management and add-configuration actions.
- Actual behavior: Drawer-like sections look inconsistent/collapsed, failed publish queue items cannot be manually republished, the third account check reports an exception without a re-login path, and account configuration actions are missing.
- Error messages: Account check click reports an abnormal/error prompt; exact text not provided.
- Timeline: Reported during current stabilization work.
- Reproduction: Use the lower dashboard panels, trigger a failed queued publish item, and click the third account check/control.

## Current Focus

- hypothesis: "Dashboard lower support/account panels and publish-center account helpers are incomplete: support queue is read-only/collapsible, dashboard account checks have no visible login modal/actions, and newly added manager/retry helpers are not exported correctly."
- test: "Run frontend build after targeted Vue/composable changes."
- expecting: "Build succeeds and dashboard exposes non-collapsed support panels, republish, account management, add config, and re-login actions."
- next_action: "patch dashboard and publish composable helper wiring"
- reasoning_checkpoint: "Task subagent tool was unavailable in this runtime, so investigation continued narrowly in-session. Existing dirty user changes in PublishCenterWorkspace.vue/usePublishCenter.js were preserved and extended instead of reverted."
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-26T01:26:10.209Z
  source: frontend/src/components/AutomationDashboard.vue
  observation: "Lower support content is wrapped in a <details class=\"support-section\"> drawer and publish queue rows only display title/time/status with no manual retry or publish action."
- timestamp: 2026-05-26T01:26:10.209Z
  source: frontend/src/components/AutomationDashboard.vue
  observation: "Dashboard account panels render only a login-check button for each account; no management or add-configuration actions are available in the dashboard surface."
- timestamp: 2026-05-26T01:26:10.209Z
  source: frontend/src/App.vue
  observation: "The app currently renders AutomationDashboard directly and handles @check-login by calling publishCenter.checkPlatformAccountLogin, but the dashboard does not render the publishCenter QR/login modal state."
- timestamp: 2026-05-26T01:26:10.209Z
  source: frontend/src/composables/usePublishCenter.js
  observation: "Existing dirty changes added openWechatContentManager/openPlatformContentManager/retryQrLogin, but retryQrLogin references undefined centerApi and these helpers are not returned from the composable."

## Eliminated

## Resolution

- root_cause:
- fix:
- verification:
- files_changed:
