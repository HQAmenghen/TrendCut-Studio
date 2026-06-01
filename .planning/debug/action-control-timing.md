---
status: resolved
trigger: "动作控制方案存在两个问题：1. LLM 生成拼接方案时应该需要剪辑脚本内容，避免在素材剪辑画面插入时进行手势操作，应该在数字人出镜时进行手势；2. 动作组件是默认态-动作态-默认态，有前摇和后摇，合成时应考虑这些因素，避免语音重点和动作不匹配。"
created: 2026-05-29
updated: 2026-05-29
---

## Symptoms

- expected_behavior: "动作规划应基于剪辑脚本区分素材画面和数字人出镜画面，只在数字人出镜片段安排有效手势；动作合成应考虑动作组件的前摇和后摇，使动作峰值与语音重点对齐。"
- actual_behavior: "LLM 生成拼接方案时缺少足够的剪辑脚本文本约束，可能在素材剪辑画面安排手势；动作时间直接按语音重点或片段时间放置，未补偿默认态-动作态-默认态组件的前后摇。"
- error_messages: "未报告运行时报错，表现为生成效果和时序不符合预期。"
- timeline: "当前动作控制方案稳定性问题，开始时间未指定。"
- reproduction: "运行素材驱动/数字人视频生成流程，让 LLM 生成拼接方案并合成带手势动作的视频。"

## Current Focus

- hypothesis: "已确认：动作规划只消费口播文本/音频，没有拿到 script_units/edit_plan/clip_matches；动作源计划也没有把动作组件 activeStart/activeEnd 编译进时间线。"
- test: "python -m unittest python.tests.test_avatar_motion; npm test -- --runTestsByPath server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js; python -m py_compile python\\pipeline\\avatar_motion_plan.py python\\pipeline\\avatar_motion_source_builder.py"
- expecting: "动作计划使用剪辑脚本和素材插片窗口，只在数字人可见窗口安排有效动作，并根据动作组件主动段对齐语音重点。"
- next_action: "complete"
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-29T10:19:38+08:00
  observation: "server/services/materialDriven/avatarMotion.js 已有测试期望向 avatar_motion_plan.py 传递 script_units.json、edit_plan.json、clip_matches.json，但实现原先只传 narration/audio/action-dir/planner 参数。"
  supports: "动作规划缺少剪辑脚本和素材插片上下文，LLM/local planner 无法知道哪些口播时间被素材画面覆盖。"
- timestamp: 2026-05-29T10:19:38+08:00
  observation: "python/pipeline/avatar_motion_plan.py 原先按 narration sentence 直接选择 action；动作模板 action.json 中的 activeStart/activeEnd/sourceDuration 没有进入计划编译。"
  supports: "默认态-动作态-默认态组件的前摇/后摇未被补偿，动作主动段可能晚于语音重点。"
- timestamp: 2026-05-29T10:19:38+08:00
  observation: "新增 cutaway-aware motion plan 覆盖：material cutaway 前半段被识别为数字人不可见窗口，非 idle 动作的 activeTimelineStart 被安排在 cutaway 之后。"
  supports: "修复能够避免在素材插片画面承载手势重点，并把有效动作放到数字人出镜窗口内。"

## Eliminated

- "不是 ComfyUI/RunningHub 渲染失败：没有运行时报错，问题发生在动作计划输入和时间线编译阶段。"
- "不是素材执行计划本身完全缺失：build_execution_plan_from_edit_plan 已能生成 material_cutaway + aiman 段，缺口在动作规划没有读取这些产物。"

## Resolution

- root_cause: "数字人动作规划入口没有接收剪辑脚本和素材插片窗口，且动作组件元数据中的 sourceDuration/activeStart/activeEnd 没有用于编译动作时间线。"
- fix: "avatarMotion.js 传递 script_units/edit_plan/clip_matches；avatar_motion_plan.py 使用这些上下文标注数字人可见窗口，LLM prompt 明确禁止把手势安排在素材覆盖窗口，并把动作组件主动段编译到可见语音重点附近；avatarGeneration.js 传递配置中的 motion planner/provider/model。"
- verification: "PASS: python -m unittest python.tests.test_avatar_motion; PASS: npm test -- --runTestsByPath server/services/materialDriven/__tests__/avatarMotion.test.js server/services/materialDriven/__tests__/avatarGeneration.test.js; PASS: python -m py_compile python\\pipeline\\avatar_motion_plan.py python\\pipeline\\avatar_motion_source_builder.py."
- files_changed: "python/pipeline/avatar_motion_plan.py; python/tests/test_avatar_motion.py; server/services/materialDriven/avatarMotion.js; server/services/materialDriven/avatarGeneration.js; server/services/materialDriven/__tests__/avatarMotion.test.js"

## Specialist Review

- timestamp: 2026-05-29T10:19:38+08:00
  specialist_hint: "python"
  result: "specialist dispatch unavailable in this Codex runtime: no Task/subagent API is exposed, and local codex.exe failed to start with access denied. Proceeded with focused inline verification."
