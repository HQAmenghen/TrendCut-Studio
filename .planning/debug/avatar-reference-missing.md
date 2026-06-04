---
status: resolved
trigger: "当前视频合成一直出现数字人合成动作异常，疑似没有生成参考视频；缺失参考视频也不报错停止，仍进入数字人合成导致错误视频"
created: 2026-06-03
updated: 2026-06-03
---

# Avatar Reference Missing

## Symptoms

- Expected behavior: 启用数字人动作时，任务必须先生成动作参考视频，并把参考视频输入到数字人合成服务。
- Actual behavior: 当前合成结果出现动作异常，疑似没有生成对应参考视频。
- Error messages: 缺失参考视频没有显式报错停止。
- Timeline: 2026-06-03 当前运行任务复现。
- Reproduction: 素材驱动流程进入数字人合成阶段。

## Current Focus

- hypothesis: 动作参考生成或复用校验链路存在绕过点，导致没有本次动作参考输入也能进入合成/混剪。
- test: 检查 material-driven 步骤 6、RunningHub/ComfyUI 渲染输入、缓存复用和继续/重试逻辑。
- expecting: 找到参考视频未生成的原因，并在缺失时 fail-fast 或强制重生。
- next_action: gather initial evidence

## Evidence

- timestamp: 2026-06-03T00:00:00+08:00
  observation: `server/services/materialDriven/avatarMotion.js` had to validate that `avatar_motion_source.mp4` and `poseInputPath` exist after `avatar_motion_source_builder.py`; otherwise the pipeline could treat a protocol result as success without a real reference video.
  implication: missing reference video generation must be a hard failure when avatar motion is enabled.
- timestamp: 2026-06-03T00:00:00+08:00
  observation: RunningHub submission accepted empty `posePath` and only appended the pose node when a file was present.
  implication: a motion-enabled render could submit audio+image only, producing abnormal avatar motion instead of stopping.
- timestamp: 2026-06-03T00:00:00+08:00
  observation: cached/downloaded RunningHub state could be reused without proving `remotePoseName` or the configured pose node was present.
  implication: retry/continue paths could keep or resume an old pose-less avatar output.
- timestamp: 2026-06-03T00:00:00+08:00
  observation: Follow-up regression tests now cover a source builder that returns a success protocol but omits the real `avatar_motion_source.mp4` or returns a missing `poseInputPath`.
  implication: avatar motion generation cannot silently report success without a usable local reference video.
- timestamp: 2026-06-03T00:00:00+08:00
  observation: Follow-up regression tests now cover RunningHub render results and cached/downloaded state without `remotePoseName` or a `279.video` node input.
  implication: pose-less RunningHub output is rejected before download/reuse instead of becoming `aiman.mp4`.
- timestamp: 2026-06-03T00:00:00+08:00
  observation: Follow-up AutoPilot tests now assert that an existing `aiman.mp4` is insufficient when `avatar_motion_source.mp4` is missing or RunningHub pose proof is absent.
  implication: AutoPilot must fail before step 6 mixing instead of mixing stale or pose-less avatar video.

## Eliminated

## Resolution

- root_cause: Avatar motion was default-enabled/required, but the render path did not consistently require a real motion reference file or prove that RunningHub received the pose video node before submitting, resuming, downloading, or reusing avatar output.
- fix: Added fail-fast checks for missing generated motion video, required RunningHub pose input at renderer/client boundaries, rejected pose-less RunningHub resumes, prevented reuse of cached RunningHub state without pose proof, preserved pose metadata in downloaded render state, rejected invalid RunningHub output before writing completed state, and added follow-up regressions for missing pose files, pose-less downloads/reuse, stale `aiman.mp4`, and AutoPilot pre-step-6 failure.
- verification: `npx jest server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/materialDriven/__tests__/pipelineProcess.test.js server/services/materialDriven/__tests__/autoStart.test.js server/services/pipeline/__tests__/avatarRenderer.test.js server/services/pipeline/__tests__/runningHub.test.js --runInBand`; `npx eslint server/services/materialDriven/avatarGeneration.js server/services/materialDriven/autoStart.js server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/materialDriven/__tests__/autoStart.test.js`
- files_changed: server/services/materialDriven/avatarGeneration.js, server/services/materialDriven/avatarMotion.js, server/services/materialDriven/pipelineProcess.js, server/services/materialDriven/autoStart.js, server/services/pipeline/avatarRenderer.js, server/services/pipeline/runningHub.js, server/services/materialDriven/__tests__/avatarGeneration.test.js, server/services/materialDriven/__tests__/avatarMotion.test.js, server/services/materialDriven/__tests__/pipelineProcess.test.js, server/services/materialDriven/__tests__/autoStart.test.js, server/services/pipeline/__tests__/avatarRenderer.test.js, server/services/pipeline/__tests__/runningHub.test.js
