---
status: resolved
trigger: "用户反馈最新任务的合成动作参考视频全程没有动作；期望出镜时偶尔有动作。用户还怀疑 RunningHub 上原本已有参考视频没有被新上传的视频覆盖，导致实际任务里的动作没有进入流程。"
created: 2026-06-03
updated: 2026-06-03
---

# Debug Session: runninghub-action-reference

## Symptoms

- Expected behavior: 数字人动作参考视频应在出镜时偶尔加入动作，不需要频繁动作。
- Actual behavior: 最新任务的 `avatar_motion_source.mp4` 全程没有动作，表现为 idle talking。
- Error messages: 无明确报错。
- Timeline: 2026-06-03 用户检查最新任务产物后发现。
- Reproduction: 运行 material-driven 数字人合成流程，查看 `projects/<material_task>/avatar_motion_source.mp4` 和 RunningHub 提交节点输入。

## Current Focus

- hypothesis: 动作参考生成策略把动作计划退化为单段 idle image；或 RunningHub 提交时复用了旧任务/旧远端 pose，导致新参考视频没有进入节点 279。
- test: 检查 `avatar_motion_plan.json` / `avatar_motion_manifest.json` 与 `avatarGeneration`、`avatarMotion`、`runningHub` 上传/复用逻辑。
- expecting: 能找到生成参考视频的动作片段选择条件，以及 RunningHub `nodeInfoList` 是否每次带新上传 `remotePoseName`。
- next_action: gather initial evidence
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-03T14:45:05+08:00
  source: projects/material_1780465540472_131a1e47/avatar_motion_plan.json
  observation: 最新任务的 `decisionSegments` 全部为 `idle_talking`，最终 `segments` 被编译为单段 44.56s idle。
  implication: 合成动作参考视频全程无动作的直接原因在本地动作计划阶段，不是 RunningHub 渲染后才丢动作。
- timestamp: 2026-06-03T14:45:05+08:00
  source: projects/material_1780465540472_131a1e47/avatar_motion_manifest.json
  observation: manifest 只有一个 `idle_image` 段，duration=44.56，poseInputPath 指向 `avatar_motion_source.mp4`。
  implication: 上传给 RunningHub 的参考视频本身就是静态 idle 源。
- timestamp: 2026-06-03T14:45:05+08:00
  source: projects/material_1780465540472_131a1e47/avatar_render_state.json
  observation: RunningHub `nodeInfoList` 包含 `279.video=openapi/...mp4`，说明当前任务有提交动作参考节点；但旧状态没有独立记录该远端 pose 对应的本地 motionSignature。
  implication: 新鲜提交路径已带 pose 节点，但缓存/恢复路径缺少“远端 pose 与当前动作源一致”的证据，可能复用旧 pose/output。
- timestamp: 2026-06-03T14:45:05+08:00
  source: python/pipeline/avatar_motion_plan.py
  observation: LLM 动作规划是权威路径；当 LLM 返回全 idle 时，原逻辑直接编译并生成全 idle 参考视频。
  implication: 修复应强化 LLM 判断和自检，而不是用本地规则替 LLM 选择动作。
- timestamp: 2026-06-03T14:45:05+08:00
  source: verification
  observation: `python -m unittest python.tests.test_avatar_motion` 通过，14 tests；`npx jest server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/pipeline/__tests__/runningHub.test.js --runInBand` 通过，28 tests。
  implication: LLM idle review、RunningHub pose signature reuse guard、现有 RunningHub pose-node guard 均有回归覆盖。

## Eliminated

- RunningHub fresh submit completely没有 pose 节点：最新任务 state 已包含 `nodeId=279, fieldName=video, fieldValue=openapi/...mp4`。
- 缺少动作模板文件：`config/avatar_actions/*/source.mp4` 均存在。

## Resolution

- root_cause: LLM 动作计划返回全 idle 后系统没有自检/重试，直接生成单段 idle 参考视频；RunningHub 缓存恢复只证明“曾有 pose 节点”，没有证明远端 pose 与当前 motionSignature 一致。
- fix: 动作计划 prompt 明确“出镜时偶尔有动作”的目标，并在可见窗口足够但第一次 LLM 输出全 idle 时触发第二次 LLM 自检重判；第二次仍全 idle 则停止生成全 idle 参考视频。RunningHub 状态新增 `remotePoseSignature`，复用/恢复时签名缺失或不匹配会重新上传动作参考并提交新任务。
- verification: `python -m unittest python.tests.test_avatar_motion`; `npx jest server/services/materialDriven/__tests__/avatarGeneration.test.js server/services/pipeline/__tests__/runningHub.test.js --runInBand`.
- files_changed: `python/pipeline/avatar_motion_plan.py`, `python/tests/test_avatar_motion.py`, `server/services/materialDriven/avatarGeneration.js`, `server/services/materialDriven/__tests__/avatarGeneration.test.js`.
