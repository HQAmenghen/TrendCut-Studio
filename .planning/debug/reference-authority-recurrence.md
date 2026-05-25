---
status: resolved
trigger: "单条竖屏生成失败: REFERENCE_AUTHORITY_ALIGNMENT_FAILED 复发；之前已经进行过几次修复，要求排查根本原因并彻底修复。"
created: 2026-05-20
updated: 2026-05-20T11:10:00+08:00
---

# Debug Session: reference-authority-recurrence

## Symptoms

- Expected behavior: 单条竖屏生成流程应在 ASR 与参考口播稿对齐存在轻微分段差异时自动修复或安全降级，最终产出字幕/竖屏视频。
- Actual behavior: 单条竖屏生成失败，前端显示 `REFERENCE_AUTHORITY_ALIGNMENT_FAILED`。
- Error messages: `错误码：REFERENCE_AUTHORITY_ALIGNMENT_FAILED`；建议为“系统会重试 ASR 与参考文本分配；如果持续失败，请检查口播稿是否对应最终成片音频。”
- Timeline: 该问题此前经过多次修复，但在 2026-05-20 10:31:19 再次复发。
- Reproduction: `projects/material_1779240897950_e3378c13/reference_authority_debug.json` 修改时间为 2026-05-20 10:31:18，匹配本次失败。

## Current Focus

- hypothesis: confirmed. 当前参考段选择 ASR 片段时，会把贴近段尾、但更匹配下一参考段开头的短片段归入当前段；当这个短片段的文本也出现在当前段早些位置时，旧逻辑尤其容易误判。
- test: 复现 `Michael Saylor` / 下一段 `Saylor 坦承...` 的边界样本，并增加非关键词中文样本 `第二点`，验证规则不是人名/品牌特判。
- expecting: 当前段不占用下一段开头片段；下一段能承接该片段；最终字幕可见文本与参考稿一致。
- next_action: complete.
- reasoning_checkpoint: 本次 `Saylor` 不是幻听，它是下一段真实开头。根因是参考块边界归属错误，而不是 ASR 输出无用。修复必须按通用前缀/后缀和时间边界判断归属，不能写任何固定关键词。
- tdd_checkpoint: 新增真实复发样本测试和非关键词边界测试；完整 Python 测试通过。

## Evidence

- timestamp: 2026-05-20; source: `projects/material_1779240897950_e3378c13/aiman_reference_subtitles.json`; observation: 第一段以“推到台前”结束，第二段以 `Saylor 坦承这很难...` 开始。
- timestamp: 2026-05-20; source: `projects/material_1779240897950_e3378c13/reference_authority_debug.json`; observation: 失败 payload 的第一段 ASR 列表末尾包含单独的 `Saylor`，导致第一段 reference/ASR pieces 数量不一致并触发 strict 校验失败。
- timestamp: 2026-05-20; source: user correction; observation: 完整原稿确认边界 `Saylor` 是有用内容，属于下一段，不应被视为幻听或丢弃。
- timestamp: 2026-05-20; source: `python/pipeline/run_asr.py`; observation: 旧 `collect_asr_entries_for_reference` 只在尾部片段“不匹配当前参考段”时才会弹出；如果短片段也能在当前段中找到子串，就不会让给下一段。
- timestamp: 2026-05-20; source: targeted replay; observation: 修复后第一段选段止于“的掌舵人正在把这个愿景推到台前。”，第二段第一个选段为 `Saylor`。
- timestamp: 2026-05-20; source: tests; observation: 新增 `test_reference_authority_boundary_prefix_rule_is_not_keyword_specific`，用 `第二点` 验证同一规则适用于非人名、非品牌、非英文 token。

## Eliminated

- hypothesis: `Saylor` 是 ASR 幻听，应忽略或丢弃。
  reason: 用户提供完整原稿确认它是下一段开头。
- hypothesis: 需要给 `Saylor` / `MicroStrategy` 写关键词特判。
  reason: 生产代码没有任何这些词的判断；修复基于 normalized visible text 的下一段前缀匹配、当前段后缀匹配、片段长度和边界距离。
- hypothesis: 只要放宽 atom 校验即可。
  reason: 这会掩盖当前段抢占下一段开头的问题；已撤回该方向，改为先修正 ASR 片段归属。

## Resolution

- root_cause: strict reference-authority 对齐在选择当前参考段 ASR 片段时，缺少“边界短片段更属于下一参考段开头”的通用归属规则。若下一段开头 token/短语在当前段早些位置也出现过，旧逻辑会把它保留在当前段，导致当前段 reference/ASR 分配失败并抛出 `REFERENCE_AUTHORITY_ALIGNMENT_FAILED`。此外，atom allowed range 对轻微低于阅读时长的片段过早拒绝，阻止后续时间平衡修复。
- fix: 增加通用边界归属判断：边界附近短 ASR 片段如果前缀匹配下一参考段、且不是当前参考段后缀，则从当前段移出，下一段可在起点附近承接未使用前缀片段。将 atom 时长过滤从“略低于最小阅读时长即拒绝”改为“不可容忍短时长才拒绝”，保留严重过短保护。
- verification: `python -m unittest python.tests.test_run_asr_filetrans` 通过 60 个测试；`python -m unittest discover -s python/tests -p "test_*.py"` 通过 171 个测试；离线 replay 显示前两段可见文本与参考稿一致，且 `Saylor` 被第二段承接。
- files_changed: `python/pipeline/run_asr.py`; `python/tests/test_run_asr_filetrans.py`; `.planning/debug/reference-authority-recurrence.md`.
