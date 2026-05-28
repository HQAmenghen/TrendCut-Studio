---
status: complete
---

# Quick Task 260522-nzc Summary

Implemented per-plan avatar preset selection for Auto-Pilot avatar schedules and updated the local runtime config to use `毕.mp3` with `毕（保守）.png`.

## Changes
- Added preset loading and per-schedule `audioPresets` / `imagePresets` support in the publish-center composable.
- Reworked Auto-Pilot plan rows into compact summary rows with expandable settings for platform/account/avatar preset controls.
- Extended publish config normalization so the new per-plan preset arrays are preserved.
- Updated the scheduler to pass the selected per-plan avatar presets into material-driven avatar generation and job metadata.
- Updated local ignored runtime config `python/publish/platform_config.json` so existing avatar plans use `毕（保守）.png`.

## Verification
- `node --check server/services/system/scheduler.js`
- `node --check server/services/publish/publishStore.config.js`
- `npm test -- --runInBand server/services/publish/__tests__/publishStore.config.test.js server/services/system/__tests__/scheduler.test.js`
- `npm run build:front`
- `npm run lint`
- Browser check at `http://127.0.0.1:3001`: expanded the first avatar plan and confirmed `数字人形象` is `毕（保守）`.
