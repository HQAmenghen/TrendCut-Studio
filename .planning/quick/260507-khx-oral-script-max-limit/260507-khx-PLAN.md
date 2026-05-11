# Quick Task 260507-khx: 修改口播稿生成的最长字数限制，字数超标不放行，大模型重试压缩

## Goal

口播稿生成必须遵守最长字数限制。超过上限的模型输出不能进入后续数字人生成，应触发大模型修复压缩；若仍超限则失败中止。

## Tasks

1. 在 `ScriptPolisherSkill` 的校验层显式检查字数上下限，尤其是超过 `SCRIPT_POLISH_MAX_CHARS` 时记录错误并进入 repair retry。
2. 在关闭二次优化时也禁止超长草稿放行；如果草稿超限，仍强制进入大模型压缩重写循环。
3. 强化 repair prompt 的压缩要求，并补充单测覆盖“首次超长后重试压缩”和“关闭优化时仍强制压缩”。

## Verification

- `python -m unittest python.tests.test_script_polisher_skill`
