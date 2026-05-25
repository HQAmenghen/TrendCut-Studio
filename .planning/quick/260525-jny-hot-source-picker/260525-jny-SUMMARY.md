---
title: Hot source picker first
status: complete
completed: 2026-05-25
---

# Quick Task 260525-jny Summary

## Result

Changed the cockpit source-selection flow so the primary material button opens a hot-list picker instead of the operating system file chooser. Local file upload remains available, but it is explicitly labeled as a fallback.

## Changes

- Replaced the primary pre-start action with `从热门榜单选素材`.
- Added a modal hot-list picker with refresh/run-hot-list actions.
- Added clear empty-state action for fetching a hot list when none is available.
- Renamed local upload to `本地上传备用` and moved it out of the primary path.

## Verification

- `npm run build:front`
- Browser check at `http://127.0.0.1:5174/`: clicking `从热门榜单选素材` opens the hot-list picker and shows the local upload fallback inside the modal.
