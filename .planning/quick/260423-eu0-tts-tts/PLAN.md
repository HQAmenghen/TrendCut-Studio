---
status: in_progress
created: "2026-04-23T10:40:48+08:00"
---

# Quick Task: TTS 与 BGM 音量均衡

## Goal

剪辑合成时保护新 TTS 口播的可听度，避免最终成品里背景音乐压过人声。

## Design

- 在 `SmartVideoComposer` 自动配乐混音前处理主音轨：分析主音轨响度，低于目标时按上限抬升。
- 再按主音轨响度计算 BGM 目标响度，让 BGM 比口播低一个稳定间隔。
- 保留最终整体响度归一化，用它控制成品总音量，而不是用它解决口播和 BGM 的相对比例。

## Plan

1. Add focused Python unit tests for low TTS loudness and negative LUFS environment configuration.
2. Update `python/pipeline/smart_video_composer.py` to normalize voice before BGM mix and allow BGM to duck lower when needed.
3. Run the targeted Python test file and update the quick task summary.

## Out of Scope

- 前端音量滑杆或配置 UI。
- 更换 TTS 供应商或重新生成已有音频。
