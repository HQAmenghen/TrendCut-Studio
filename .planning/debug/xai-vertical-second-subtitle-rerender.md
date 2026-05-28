---
status: fixing
trigger: "XAI 批量竖屏任务 1779843120050_fqt28ap 字幕卡断句不合理，排查是否与 1779839880038_z13r3i9 同类，并重新渲染两个视频。"
created: 2026-05-27
updated: 2026-05-27
---

# Debug Session: xai-vertical-second-subtitle-rerender

## Symptoms
- Expected behavior: XAI 批量竖屏字幕应按原稿自然断句，不能出现 `凯 / 文·沃什`、`货币 / 政策转变`、`配置逻 / 辑` 等断词。
- Actual behavior: `public/xai_vertical_queue/1779843120050_fqt28ap/vertical_output.mp4` 的字幕卡断句不合理；`1779839880038_z13r3i9` 已确认存在参考原稿失败后回退 ASR 导致漏词/错词。
- Reproduction: 检查两个任务目录下的 `reference_subtitles.json`、`reference_authority_debug.json`、`subtitles.json` 与成片 metadata。

## Current Focus
- hypothesis: 两条任务都受参考原稿权威字幕分组失败影响；第一条回退普通 ASR 导致漏词，第二条虽未标记 fallback，但成功分组仍保留了不合理断词。
- test: 使用已保存 ASR 句段与参考原稿，通过修复后的确定性原稿切分重建字幕并重渲染。
- expecting: 新字幕保留原稿文本，避免关键数字/词组被截断或替换。
- next_action: rebuild subtitles and rerender both videos

## Evidence
- 2026-05-27: 第二条 meta 的最终字幕包含 `可能接替...的凯` / `文·沃什，在 CNBC`、`货币` / `政策转变`、`配置逻` / `辑` 等断词。
- 2026-05-27: 第二条 `reference_authority_debug.json` 多次记录 `asr_group_validation_failed`，说明同属参考原稿分组失败链路。
- 2026-05-27: 第二条 `reference_subtitles.json` 中原稿为完整自然文本：`凯文·沃什`、`货币政策转变`、`配置逻辑`。

## Resolution
- root_cause:
- fix:
- verification:
- files_changed:
