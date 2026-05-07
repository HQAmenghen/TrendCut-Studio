---
status: complete
date: 2026-04-23
---

# Quick Task 260423-hkn Summary

## Task

竖屏合成模块增加按任务导入功能。

## Changes

- Added backend task import helper for scanning completed `projects/material_*` tasks and resolving `output_final.mp4` plus related JSON metadata.
- Added `GET /api/vertical/material-tasks` for the竖屏 module task picker.
- Extended `/api/generate-vertical-standalone` to accept `sourceTaskDir` without requiring a video upload.
- Added frontend task picker state and UI in the竖屏后期合成 module.
- Preserved manual upload behavior; uploading a video clears task import selection.
- Stopped auto-filling the竖屏标题输入框 from imported source titles; blank titles now trigger `generateHotTitle`.
- Changed imported subtitle priority to prefer final speech-aligned subtitles (`execution_plan.json` / `avatar_segments.json`) over raw material `subtitles.json`.

## Verification

- `npx jest server/services/vertical/__tests__/taskImport.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/routes/__tests__/standalone.test.js --runInBand`
- `npx eslint server/services/vertical/taskImport.js server/services/vertical/standalone.js server/routes/standalone.js server/routes/__tests__/standalone.test.js server/services/vertical/__tests__/taskImport.test.js server/services/vertical/__tests__/standaloneTaskImport.test.js --ext .js`
- `npm run build:front`
