---
status: resolved
trigger: "REFERENCE_AUTHORITY_ALIGNMENT_FAILED 在 2026-05-20 16:14:23 再次复发；此前已修过边界前缀归属，用户要求彻底解决不会复发的通用方案。"
created: 2026-05-20
updated: 2026-05-20T16:34:55+08:00
---

# Debug Session: reference-authority-recur-again

## Symptoms

- Expected behavior: 单条竖屏生成流程在 ASR 与参考口播稿存在分段、标点、短片段或时长偏差时，应尽量自动对齐并产出结果；只有音频与稿件确实不对应时才失败。
- Actual behavior: 前端在 2026-05-20 16:14:23 显示 `单条竖屏生成失败`。
- Error messages: `错误码：REFERENCE_AUTHORITY_ALIGNMENT_FAILED`；提示“系统会重试 ASR 与参考文本分配；如果持续失败，请检查口播稿是否对应最终成片音频。”
- Timeline: 同类问题在 2026-05-20 10:31:19 经过边界归属修复后，16:14:23 再次出现。
- Reproduction: 最新失败产物位于 `projects/material_1779257949941_e0dadfc5/reference_authority_debug.json`。

## Current Focus

- hypothesis: confirmed. 不是 Saylor/MicroStrategy 边界前缀问题；16:14 样本是 strict reference-authority 的第二个通用失败模式：LLM 返回了可覆盖全文的 character-position text groups，但校验先按 ASR index groups 解释并失败，且 strict atom 模式缺少确定性 atom fallback。
- test: 已离线 replay `projects/material_1779257949941_e0dadfc5/reference_authority_debug.json` 最后一条 2026-05-20T16:14:23 事件；当前源码可验证并生成 3 条字幕，全文覆盖，无 severe timing issues。
- expecting: 回归测试覆盖 16:14 样本，后续同类 character-position text group 输出不会触发 `REFERENCE_AUTHORITY_ALIGNMENT_FAILED`。
- next_action: none.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-20T16:24:00+08:00
  observation: `reference_authority_debug.json` 是事件数组，共 7 条；最终失败事件时间为 2026-05-20T16:14:23，reason=`asr_group_validation_failed`，reference 为 “当然，AI 编程目前还难以搞定全新的架构创新...”。
  artifact: `projects/material_1779257949941_e0dadfc5/reference_authority_debug.json`
- timestamp: 2026-05-20T16:27:00+08:00
  observation: 最终 LLM 输出使用 `start_index`/`end_index` 作为字符位置提示，text 片段按顺序覆盖完整 reference；旧路径先把这些字段当作 ASR segment index 校验，超出 0..4 后直接失败。
  artifact: `python/pipeline/run_asr.py`
- timestamp: 2026-05-20T16:31:00+08:00
  observation: strict mode 中 `require_atom_groups=True` 且模型未返回 atom spans 时，当前修复会先尝试 text group 校验；若覆盖全文但单条 timing/readability 不合格，则使用确定性 readable-atom partition 生成可读分组。
  artifact: `python/pipeline/run_asr.py`
- timestamp: 2026-05-20T16:34:00+08:00
  observation: 离线 replay 最后一条失败事件通过：validated=True，entries=3，joined_matches=True，severe_issues=[]。
  artifact: local replay command against `projects/material_1779257949941_e0dadfc5/reference_authority_debug.json`
- timestamp: 2026-05-20T16:34:55+08:00
  observation: `python -m unittest python.tests.test_run_asr_filetrans` 通过，Ran 61 tests OK。
  artifact: test output
## Eliminated

- Backend did not reload as sole cause: current source behavior differs from the captured artifact (`require_atom_groups` is now true for the same block), but replay also exposed a real strict-mode validator gap that needed coverage.
- Keyword-specific fix: no Saylor/MicroStrategy or domain keyword checks were added; the fix is based on reference text coverage, position hints, readable atoms, and ASR timing.

## Resolution

- root_cause: strict reference-authority treated character-position `start_index`/`end_index` LLM output as ASR-index grouping and could abort before deterministic atom partition fallback, so a full-reference-covering output at 2026-05-20 16:14:23 still failed validation.
- fix: generalized validator fallback in `python/pipeline/run_asr.py` accepts full-coverage text groups with valid position hints by building deterministic readable-atom groups; atom generation/allowed ranges now preserve sentence-readable splits and normalized ASR fragments.
- verification: `python -m unittest python.tests.test_run_asr_filetrans` -> Ran 61 tests OK; direct replay of the 16:14 artifact -> 3 entries, joined reference matches, severe_issues=[].
- files_changed: `python/pipeline/run_asr.py`; `python/tests/test_run_asr_filetrans.py`; `.planning/debug/reference-authority-recur-again.md`
