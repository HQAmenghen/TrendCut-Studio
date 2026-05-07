---
status: investigating
trigger: "LLM 多批次评估日志出现 Vertex AI Gemini，并且用户要求更换为 qwen；不要使用 Vertex AI，只有 qwen 支持多 API、多批次并发。"
created: "2026-05-06T03:00:00Z"
updated: "2026-05-06T03:00:00Z"
---

# Debug Session: llm-multibatch-qwen

## Symptoms

- expected_behavior: "素材评分的 LLM 多批次并发应使用 qwen，并使用 qwen 的多 API key 能力；不应调用 Vertex AI Gemini。"
- actual_behavior: "运行日志显示 `score_material_segments.py` 期间存在 `[gemini_client] Vertex AI 模式: project=yumeato, location=global`，同时 LLM 批次失败后严格模式中止。"
- error_messages: "Arrearage: Access denied, please make sure your account is in good standing... LLM 批次失败 1 次，严格模式禁止回退规则评分；score_material_segments.py 返回码 1。"
- timeline: "用户在 2026-05-06 11:00 左右观察到失败。项目状态显示 2026-04-27 曾完成“文本处理切换 Vertex AI Gemini，非文本链路保留 Qwen”。"
- reproduction: "运行素材切片/评分步骤，触发 `score_material_segments.py` 的多批次 LLM 评估。"

## Current Focus

- hypothesis: "多批次素材评分链路仍从默认 LLM provider 或 Gemini 客户端读取配置，导致 Vertex AI Gemini 被用于部分批次；qwen 多 key 并发没有被强制绑定到该链路。"
- test: "python -m unittest python.tests.test_score_material_segments"
- expecting: "LLM_PROVIDER=vertex 时素材评分仍创建 qwen client，模型取 QWEN_SCORING_MODEL，批次 generate_content 显式 provider=qwen。"
- next_action: "run focused verification and report outcome"
- reasoning_checkpoint: ""
- tdd_checkpoint: ""

## Evidence

- timestamp: "2026-05-06T03:00:00Z"
  observation: "`python/pipeline/score_material_segments.py` 原先在 main() 中直接调用 `create_llm_client()`，并用 `get_llm_provider()` 写入 scoring_meta；`score_segments_with_llm()` 调用 `generate_content()` 时没有传 provider。"
- timestamp: "2026-05-06T03:01:00Z"
  observation: "`python/llm_client.py` 在 provider 为 `vertex` 时会创建 `gemini_client(vertex_mode=True)`；且 `generate_content()` 未显式 provider 时会回读全局 provider。"
- timestamp: "2026-05-06T03:02:00Z"
  observation: "新增回归测试先失败：缺少评分专用 qwen provider/client，批次调用 kwargs 中没有 provider。"

## Eliminated

## Resolution

- root_cause: "素材评分多批次链路跟随全局 `LLM_PROVIDER`，而全局/text 配置可为 `vertex`；并且批次调用未显式传 provider，导致该链路可能进入 Vertex AI/Gemini 后端。"
- fix: "在 `score_material_segments.py` 中新增评分专用 provider/client，固定 `qwen`；评分模型只取 `QWEN_SCORING_MODEL`/`QWEN_TEXT_MODEL`/Qwen 默认值；每个批次 `generate_content()` 显式传 `provider=\"qwen\"`。"
- verification: "`python -m unittest python.tests.test_score_material_segments` 通过；`python -m unittest python.tests.test_text_llm_provider python.tests.test_video_vlm_vertex` 通过。"
- files_changed: "`python/pipeline/score_material_segments.py`, `python/tests/test_score_material_segments.py`"
