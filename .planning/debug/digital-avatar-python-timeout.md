---
status: resolved
trigger: "数字人生成执行中显示 Python script timed out；用户反馈正在进行数字人合成，需要排查哪里出了问题。"
created: "2026-06-03T13:25:00+08:00"
updated: "2026-06-03T13:50:00+08:00"
---

# Debug Session: digital-avatar-python-timeout

## Symptoms

- Expected behavior: 素材驱动流程在步骤5生成口播稿后，步骤6数字人合成应生成 `aiman.mp4` 或可恢复的远端任务状态，并继续到竖屏交付。
- Actual behavior: 前端显示“数字人生成 / 执行中 / Python script timed out”。
- Error messages: `Python script timed out`。
- Timeline: 2026-06-03 13:24:09 +08:00，最新任务 `material_1780463963684_690720d9` 完成步骤5并停在数字人生成前；随后进入数字人合成。
- Reproduction: 在热点素材驱动流程中选择带数字人模式，当前任务进入步骤6数字人合成。

## Current Focus

- hypothesis: Node 调用数字人阶段的某个 Python 子脚本超过了固定 timeout，被 `server/core/python.js` 标记为 `Python script timed out`；需要确认具体是 TTS、字幕对齐、动作计划、动作源视频生成还是渲染前置脚本。
- test: 查看当前任务目录产物、`data/logs/server.log` 最近记录、任务库状态，以及 `server/services/materialDriven/*` 中对 `runPythonScript` 的 timeout 设置。
- expecting: 最近产物能显示已完成到 `avatar_motion_plan.json`，若缺少后续 `avatar_motion_source.mp4` / `avatar_render_state.json` / `aiman.mp4`，超时大概率发生在动作源视频生成或后续渲染准备。
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-03T13:24:09+08:00
  observation: 最新任务 `material_1780463963684_690720d9` 已生成 `narration.json`、`narration_speech.txt`、`edit_plan.json` 并由 Python 主控返回 `end_at: 5`。
  result: 主控脚本不是在步骤1-5失败，而是正常停在步骤5，等待 Node 接管数字人合成。
- timestamp: 2026-06-03T13:25:21+08:00
  observation: 当前任务目录已出现 `avatar_qwen3tts.wav`、`speech_alignment.json`、`avatar_motion_plan.json` 和 `motion_segments/`。
  result: 数字人阶段至少完成了 TTS、语音对齐和动作计划，故超时点应在动作源视频构建、远端渲染提交/轮询或结果下载附近。
- timestamp: 2026-06-03T13:27:21+08:00
  observation: `motion_segments/segment_0001_idle_talking.mp4` 存在且最后更新时间为 13:27:21，但 `avatar_motion_manifest.json`、`avatar_motion_source.mp4`、`avatar_render_state.json`、`aiman.mp4` 均不存在。
  result: 超时发生在提交 RunningHub/ComfyUI 之前，具体落在动作源视频构建阶段 `avatar_motion_source_builder.py`。
- timestamp: 2026-06-03T13:37:00+08:00
  observation: `avatar_motion_plan.json` 中 `duration` 为 `44739.241`，仅有一个 `idle_talking` 片段，片段结束时间同为 `44739.241` 秒；但 `speech_alignment_meta.json` 报告口播时长 `43.84` 秒，`ffprobe avatar_qwen3tts.wav` 报告 `43.920000` 秒。
  result: 动作计划把口播时长放大约 1000 倍，导致后续构建动作源视频时试图生成约 12.4 小时的视频。
- timestamp: 2026-06-03T13:37:00+08:00
  observation: Python `wave.open(...).getnframes()` 读取 `avatar_qwen3tts.wav` 得到 `1073741773` 帧，采样率 `24000`，计算时长 `44739.2405` 秒；同一文件 ffprobe 识别为 `43.92` 秒。
  result: Qwen3TTS 生成的 WAV 头/帧数对 Python `wave` 模块不可信，`avatar_motion_plan.py` 直接信任 WAV 头导致错误时长。
- timestamp: 2026-06-03T13:37:00+08:00
  observation: `server/services/materialDriven/avatarMotion.js` 对 `avatar_motion_plan.py` 和 `avatar_motion_source_builder.py` 共用 `AVATAR_MOTION_TIMEOUT_MS || 2 * 60 * 1000`；`python/pipeline/avatar_motion_source_builder.py` 按计划片段 `duration` 生成帧数。
  result: 前端显示的 `Python script timed out` 来自 Node 的 120 秒动作阶段 Python 超时，最可能是第二个脚本 `avatar_motion_source_builder.py` 被杀掉。
- timestamp: 2026-06-03T13:50:00+08:00
  observation: 联网查阅 DashScope/Qwen TTS 官方文档后确认，非流式 TTS 返回的是音频 URL，客户端自行下载保存；下载产物应作为外部媒体文件处理，不能只信任 WAV header。
  result: 修复应在本地媒体时长解析处增加 ffprobe/文件大小兜底，而不是假设 Qwen3TTS 的 WAV header 永远可靠。
- timestamp: 2026-06-03T13:50:00+08:00
  observation: `resolve_audio_duration()` 已改为优先使用 ffprobe 解析真实媒体时长；WAV 兜底会检查 header 推导时长是否超过文件大小可承载的合理时长，并拒绝异常大时长。
  result: 类似 `0x7fffffff` 占位 RIFF/data 长度的 WAV 不会再让动作计划生成 12 小时片段。

## Eliminated

- 主素材下载、ASR/VLM、素材切片、片段评分、口播稿生成不是本次 `Python script timed out` 的直接发生点。
- Qwen3TTS API 调用本身不是直接超时点：`avatar_qwen3tts.wav/json` 已在 13:24:34 生成。
- 口播 ASR 对齐不是直接超时点：`speech_alignment.json/meta` 与字幕已在 13:24:43 生成。
- RunningHub/ComfyUI 渲染提交、轮询和下载不是直接超时点：没有 `avatar_render_state.json`，说明还没提交到外部渲染服务。

## Resolution

- root_cause: `python/pipeline/avatar_motion_plan.py` 使用 Python `wave` 模块读取 `avatar_qwen3tts.wav` 的损坏/不可信 WAV 帧数，得到 `44739.241s` 而非真实约 `43.9s`，随后 `python/pipeline/avatar_motion_source_builder.py` 在 `server/services/materialDriven/avatarMotion.js` 的 `AVATAR_MOTION_TIMEOUT_MS` 默认 120 秒限制下尝试构建超长动作源视频并被杀掉，表现为 `Python script timed out`。
- fix: `python/pipeline/avatar_motion_plan.py` 现在优先用 ffprobe 读取媒体真实时长，只有 ffprobe 不可用时才回退 Python `wave`；WAV 回退会用文件大小校验 header 时长，拒绝明显不可信的帧数。`python/tests/test_avatar_motion.py` 新增坏 RIFF/data 长度回归测试。
- verification: `python -m unittest python.tests.test_avatar_motion`; `npm test -- --runTestsByPath server/services/materialDriven/__tests__/avatarMotion.test.js`。
- files_changed: `python/pipeline/avatar_motion_plan.py`, `python/tests/test_avatar_motion.py`, `.planning/debug/digital-avatar-python-timeout.md`
