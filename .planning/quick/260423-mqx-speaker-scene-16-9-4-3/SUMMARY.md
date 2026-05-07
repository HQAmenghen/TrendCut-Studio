---
status: complete
date: 2026-04-23
---

# Quick Task 260423-mqx Summary

## Task

删除竖屏 `speaker_scene` 智能裁切链，并把主剪辑母版从 `16:9` 调整为 `4:3` 适配。

## Changes

- Removed the standalone vertical `speaker_scene / --plan` handoff so the final vertical packaging stage no longer applies the previously added follow-crop behavior.
- Simplified `python/pipeline/make_vertical_video.py` back to fixed center crop behavior and removed the temporary vertical plan parsing / tween-crop support that had been added for standalone smart reframing.
- Changed `SmartVideoComposer` landscape canvas normalization from `16:9` to `4:3`, so avatar and material clips now conform to the same `4:3` master canvas before final packaging.
- Updated regression tests to lock the new rules: no standalone `--plan` handoff, and `4:3` master canvas sizing in the smart composer.

## Verification

- `python -m unittest python.tests.test_smart_video_composer`
- `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand`
- `npx eslint server/services/vertical/standalone.js server/services/vertical/__tests__/standaloneTaskImport.test.js --ext .js`
