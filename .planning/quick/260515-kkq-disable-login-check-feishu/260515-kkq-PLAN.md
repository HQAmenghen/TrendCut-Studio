# Quick Task 260515-kkq: 禁用登录检查自动推送飞书

**Date:** 2026-05-15
**Status:** Executed

## Goal

登录状态检测可以继续更新本地状态和二维码缓存，但不再默认向飞书推送登录提醒、二维码或定时汇总通知。

## Tasks

1. 将登录状态服务的飞书通知改为显式 opt-in，避免默认检查触发通知。
2. 移除定时登录检测中的飞书汇总提醒，并确保路由侧手动检测/刷新二维码不自动通知。
3. 补充回归测试，覆盖服务默认行为和调度器定时登录检测行为。

## Verification

- `npm test -- --runTestsByPath server/services/notification/__tests__/loginStatus.test.js server/services/system/__tests__/scheduler.test.js --runInBand`
- `npm run lint -- --quiet`
