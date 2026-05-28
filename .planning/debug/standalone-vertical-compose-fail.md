---
status: resolved
trigger: "新的竖屏合成任务一直失败"
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: standalone-vertical-compose-fail

## Symptoms

- Expected behavior: standalone 竖屏短口播任务能完成字幕对齐并渲染输出竖屏视频。
- Actual behavior: 最新 standalone 竖屏合成任务持续失败。
- Error messages: 待从 runtime job 目录和 server log 核实。
- Timeline: 发生在最近调整 standalone 字幕对齐逻辑之后。
- Reproduction: 提交新的 standalone 竖屏合成任务。

## Current Focus

- hypothesis: standalone vertical render was importing a corrupt material-driven final video
- test: inspect latest runtime job artifacts, FFmpeg decode output, and standalone import path
- expecting: standalone should fail early or repair/re-render corrupt input before make_vertical_video.py
- next_action: complete

## Evidence

- timestamp: 2026-05-26T17:30:13+08:00
  observation: Latest job `data/uploads/runtime_jobs/standalone_1779787647675_e4b77664` copied `standalone_input.mp4` from material task `projects/material_1779781524002_75dee116/output_final.mp4`.
  source: runtime artifacts and matching 4,845,813 byte file size/hash
- timestamp: 2026-05-26T17:33:07+08:00
  observation: `make_vertical_video.py` failed with FFmpeg exit 69 while decoding `standalone_input.mp4`; logs show repeated H.264 `Invalid NAL unit size` and AAC decode errors.
  source: `data/logs/server.log`
- timestamp: 2026-05-26T17:33:39+08:00
  observation: Partial `standalone_output_vertical.mp4` existed but ffprobe showed only 8.48s video / audio starting at 34.226s, confirming it was not a valid successful output.
  source: latest runtime job ffprobe
- timestamp: 2026-05-26T17:45:00+08:00
  observation: Material task fallback `projects/material_1779781524002_75dee116/aiman.mp4` decodes cleanly, while imported `output_final.mp4` fails full decode despite probing as MP4.
  source: ffmpeg/ffprobe checks

## Eliminated

- Subtitle alignment as primary failure: ASR/reference fallback completed and wrote `subtitles.json`; final error occurs during vertical FFmpeg render.
- Missing subtitle/image assets: latest job generated `background_generated.png` and five `subtitle_cards/*.png`.
- Frontend-only failure: backend returns `VERTICAL_RENDER_FAILED` from `make_vertical_video.py`.

## Resolution

- root_cause: Standalone imported a corrupt material-driven `output_final.mp4`; FFmpeg could probe the container but failed during decode with invalid H.264 NAL/AAC data, causing vertical render exit 69 and leaving a partial output.
- fix: Standalone input preparation now validates media decode before render. For imported material-driven tasks it only accepts `output_final.mp4`; if that final composite is corrupt, it re-renders material-driven step 7 and then uses the newly generated `output_final.mp4`. It no longer substitutes raw `material.mp4`, avatar-only `aiman.mp4`, or remote source material as standalone vertical input. Corrupt direct uploads fail early with `STANDALONE_UPLOADED_MEDIA_INVALID`.
- verification: `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand`; `npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`; `npx eslint server/services/vertical/standalone.js server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/taskImport.js`; real rerender of `projects/material_1779781524002_75dee116/output_final.mp4`; real vertical render of `data/uploads/runtime_jobs/standalone_1779787647675_e4b77664/standalone_output_vertical.mp4`; final FFmpeg full decode passed.
- files_changed: `server/services/vertical/standalone.js`; `server/services/vertical/__tests__/standaloneTaskImport.test.js`; `.planning/debug/standalone-vertical-compose-fail.md`
