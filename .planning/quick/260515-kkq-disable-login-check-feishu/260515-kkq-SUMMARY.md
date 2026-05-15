---
status: complete
date: 2026-05-15
---

# Quick Task 260515-kkq Summary

禁用了登录检查链路的飞书自动推送。登录状态服务现在只在调用方显式传入 `notifyFeishu: true` 且配置也开启时才会调用飞书；定时登录检测只更新本地状态缓存和二维码信息，不再发送汇总提醒。

## Changed

- `server/services/notification/loginStatus.js` 默认不通知飞书，刷新二维码默认只更新本地缓存。
- `server/routes/loginStatus.js` 手动检测和刷新二维码接口不再触发飞书推送。
- `server/services/system/scheduler.js` 定时登录检测调用 `notifyFeishu: false`，并移除需要登录时的飞书汇总消息。
- `server/services/system/handlers.js` 和 `frontend/src/components/SystemSettingsWorkspace.vue` 将登录状态飞书通知的默认展示改为关闭。
- 新增服务和调度器回归测试，防止默认自动通知回退。

## Verification

- Passed: `npm test -- --runTestsByPath server/services/notification/__tests__/loginStatus.test.js server/services/system/__tests__/scheduler.test.js --runInBand`
- Passed: `npm run lint -- --quiet`
