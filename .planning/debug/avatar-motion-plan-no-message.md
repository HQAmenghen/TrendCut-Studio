---
status: investigating
trigger: "用户反馈数字人生成执行中卡在 86%，显示数字人动作计划生成失败，反复重试失败且没有具体消息。"
created: 2026-06-03
updated: 2026-06-03
---

# Debug Session: avatar-motion-plan-no-message

## Symptoms

- Expected behavior: 动作计划失败时，任务日志/UI 应显示具体原因；可恢复失败不应表现为无消息反复重试。
- Actual behavior: UI 只显示“数字人动作计划生成失败”，进度 86%，无具体错误。
- Error messages: 用户侧未看到具体消息。
- Timeline: 调整动作参考 LLM prompt 后，在数字人动作计划阶段出现。
- Reproduction: 重试数字人生成步骤，动作计划阶段失败。

## Current Focus

- hypothesis: Python 动作计划脚本抛出了具体异常，但 Node/UI 只展示通用 error_message；或 LLM 全 idle 保护触发后没有把异常 details 传到任务日志。
- test: 查看 server log、任务日志、Python protocol error 输出和 `runPythonScript` 错误传播。
- expecting: 找到被吞掉的 Python stderr/protocol details，并把它写入 task log/status。
- next_action: gather initial evidence

## Evidence

## Eliminated

## Resolution

- root_cause:
- fix:
- verification:
- files_changed:
