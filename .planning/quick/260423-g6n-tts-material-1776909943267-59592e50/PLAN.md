---
status: in_progress
created: "2026-04-23T11:39:10+08:00"
---

# Quick Task: 调高 TTS 均衡后的 BGM 比例

## Root Cause

上一轮修复把偏低 TTS 拉到目标响度后，仍使用 `15 dB` 的人声/BGM 间隔。成片总响度接近 `-16 LUFS`，但 BGM 被稳定压到口播下方太远，听感偏小。

## Plan

1. Add a regression test that keeps BGM in an audible bed range after voice normalization.
2. Tune the default voice/BGM gap to a less aggressive value while keeping the TTS-first guardrail.
3. Rerender `projects/material_1776909943267_59592e50` from step 7 and verify the media output.
