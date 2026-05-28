---
status: investigating
trigger: "XAI 批量竖屏任务 1779839880038_z13r3i9 的成片字幕在 0.06、0.13、0.27 附近与口播/原稿不一致或显示不完整，需要排查是大模型改写还是 ASR 不完整，并加强提示词要求不要更改增删原稿，只按时间轴填入原稿内容。"
created: 2026-05-27
updated: 2026-05-27
---

# Debug Session: xai-vertical-subtitle-mismatch

## Symptoms
- Expected behavior: XAI 批量竖屏字幕应忠实口播/原稿，数字和关键词不能被删改；字幕按时间轴填入原稿内容。
- Actual behavior: `public/xai_vertical_queue/1779839880038_z13r3i9/vertical_output.mp4` 在约 0.06 处 “75000~” 后续数字未显示；约 0.13 处口播/原稿为“顶部的想象”，字幕写成“预期”；约 0.27 处口播说 “1250000 美元”，字幕未显示。
- Error messages: 无显式报错，属于成片字幕内容质量问题。
- Timeline: 用户在 2026-05-27 指出该任务输出异常；任务更新时间 2026/5/27 08:17:14。
- Reproduction: 查看 XAI 批量竖屏任务 `1779839880038_z13r3i9` 的成片及其字幕/中间产物。

## Current Focus
- hypothesis: unknown
- test: compare original source/script, ASR/timeline subtitles, LLM-aligned subtitles, and final render input for the affected timestamps
- expecting: determine whether text loss/mutation originates in ASR, LLM alignment/polish, or rendering/layout
- next_action: gather initial evidence from task artifacts and subtitle prompt/code paths
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence
- 2026-05-27: `public/xai_vertical_queue/1779839880038_z13r3i9/vertical_output.mp4.meta.json` 的最终字幕已经包含错误文本：`750000~`、`顶部的预期`，且缺失 `1,250,000美元`。
- 2026-05-27: `data/uploads/xai_vertical_queue/1779839880038_z13r3i9/reference_subtitles.json` 与 `projects/material_1779836600896_e7d5b756/narration.json` 均包含正确原稿：`750,000到1,250,000美元`、`顶部的想象`、`1,250,000美元对应的是...`。
- 2026-05-27: `reference_authority_debug.json` 显示 LLM 多次返回了正确原稿片段，但严格分组校验报 `asr_group_validation_failed`；随后队列层降级为普通 ASR 字幕，错误 ASR 文本进入成片。
- 2026-05-27: 最小复现调用 `build_reference_authority_failsoft_block` 后，输出包含 `1,250,000美元` 和 `顶部的想象`，且不包含 `750000~` 或 `顶部的预期`。

## Eliminated

## Resolution
- root_cause: 不是大模型改写最终字幕，也不是最终渲染裁切；根因是参考原稿权威模式的分组校验失败后，Node 队列层降级回普通 ASR/翻译结果，ASR 中的漏词和同义错词进入最终字幕。
- fix: 参考原稿模式下，LLM 分组校验失败时优先使用原稿确定性切分兜底；提示词强化 `reference_text` 是唯一文本来源；队列层不再在参考字幕严格失败后静默改跑普通 ASR。
- verification: `npm run lint` 通过；`python -m unittest python.tests.test_run_asr_filetrans -k reference_text_authority` 通过 31 个用例；真实任务最小复现确认保留 `750,000到1,250,000美元` 和 `顶部的想象`。
- files_changed: `python/pipeline/run_asr.py`, `server/services/vertical/queue.js`, `python/tests/test_run_asr_filetrans.py`, `.planning/debug/xai-vertical-subtitle-mismatch.md`
