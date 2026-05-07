---
status: complete
date: 2026-04-23
---

# Quick Task 260423-mbj Summary

## Task

让竖屏合成在合适的场景下使用 `speaker_scene` 主题位置信息，把横版素材的主题内容移动到裁切窗口中心，同时避免破坏已经完成构图的横版成品。

## Changes

- Updated `python/pipeline/make_vertical_video.py` so `load_vertical_plan()` accepts `speaker_scene.json` payloads that store framing data under `timeline`, while also honoring `global_guidance` defaults when present.
- Updated `server/services/vertical/standalone.js` so standalone vertical render only passes `--plan` to `make_vertical_video.py` for raw-upload + ASR flows. Imported finished-task videos now keep their authored horizontal framing and do not re-apply `speaker_scene` follow-crop.
- Added a Python regression test covering `speaker_scene.json -> load_vertical_plan()` parsing.
- Extended standalone Jest coverage to verify imported finished-task videos stay fixed-framed while ASR-generated uploads still forward `speaker_scene.json` into the vertical render step.

## Verification

- `python -m unittest python.tests.test_make_vertical_video`
- `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand`
- `npx eslint server/services/vertical/standalone.js server/services/vertical/__tests__/standaloneTaskImport.test.js --ext .js`
