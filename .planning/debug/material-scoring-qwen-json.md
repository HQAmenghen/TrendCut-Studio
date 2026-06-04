---
status: fixing
trigger: material scoring qwen non-json strict failure
created: 2026-06-02
updated: 2026-06-02
---

# Debug: Material Scoring Qwen Non-JSON

## Symptoms
- Task 1780364987963_0ff59a0f failed at material-driven step 3.
- score_material_segments.py retried Qwen batches and failed with `无法从响应中提取有效的 JSON`.
- User clarified strict LLM scoring is intended; local rule fallback should not mask failures.

## Evidence
- score_material_segments.py calls generate_content without `response_mime_type="application/json"`.
- qwen_client.generate_content accepts response_mime_type but does not pass a JSON response_format to DashScope.
- Failed raw model responses are not persisted, so the current task cannot show what Qwen actually returned.

## Fix Plan
- Pass JSON MIME type from material scoring calls.
- Teach qwen_client to convert `response_mime_type="application/json"` into DashScope `response_format={"type":"json_object"}` where supported.
- Persist raw non-JSON scoring responses under the task output directory for diagnosis.

## Result
- Updated `python/pipeline/score_material_segments.py` to request JSON output for scoring calls and save malformed raw responses.
- Updated `python/qwen_client.py` so Qwen JSON requests pass `response_format={"type":"json_object"}`.
- Removed hard-coded Qwen 3.5/3.6 text model aliases; `qwen3.5-plus` is a valid DashScope model name and must be sent unchanged.
- Added regression coverage for JSON response format and Qwen 3.5 alias routing.
