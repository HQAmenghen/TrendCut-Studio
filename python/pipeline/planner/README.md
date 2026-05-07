# Pipeline Planner

这一层负责把多个 skill 的输出合并成统一的剪辑计划。

## 当前预留文件

- `edit_planner.py`
  未来负责产出 `edit_plan`
- `schemas.py`
  未来负责维护剪辑计划版本和字段定义

## 目标

把“内容理解”和“最终渲染”之间加上一层明确的中间协议，避免后续逻辑继续堆进现有合成脚本。
