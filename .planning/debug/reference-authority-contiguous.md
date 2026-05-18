---
status: resolved
trigger: "Standalone vertical failed with REFERENCE_AUTHORITY_ALIGNMENT_FAILED: atom_span_not_contiguous:expected_0_got_1 while aligning reference-authority subtitles."
created: "2026-05-18"
updated: "2026-05-18"
---

# Debug Session: reference-authority-contiguous

## Symptoms

- expected_behavior: "Standalone/queue vertical generation should use ASR only for timing and produce verified subtitles whose text comes from the reference narration."
- actual_behavior: "A standalone vertical task failed in strict reference-authority alignment with atom_span_not_contiguous:expected_0_got_1."
- error_messages: "ReferenceAuthorityAlignmentError: atom_span_not_contiguous:expected_0_got_1; code REFERENCE_AUTHORITY_ALIGNMENT_FAILED; stage subtitle_reference_authority."
- timeline: "Observed after the strict LLM subtitle alignment retry fix was committed."
- reproduction: "Run reference-authority ASR alignment for projects/material_1779076795283_d7cfe72d/output_final.mp4 with projects/material_1779076795283_d7cfe72d/aiman_reference_subtitles.json."

## Current Focus

- hypothesis: "confirmed. The current reference block can be polluted by a repeated ASR tail from the previous block, such as '基础设施。', because it also appears later in the current reference text. That makes atom 0 unsuitable for strict grouping; LLM retries then skip atom 0 and fail contiguity validation."
- test: "Regression tests verify prefix-based ASR trimming, readable atom-size balancing, ASR-authoritative strict timing, and standalone full-ASR retry on REFERENCE_AUTHORITY_ALIGNMENT_FAILED."
- expecting: "The bad leading ASR fragment is excluded before the LLM prompt, readable atoms stay within subtitle length constraints, strict validation either passes or retries the full ASR stage without rendering unverified subtitles."
- next_action: "resolved; rerun affected standalone tasks if operator wants regenerated outputs."
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: "2026-05-18T00:00:00+08:00"
  source: "projects/material_1779076795283_d7cfe72d/reference_authority_debug.json"
  observation: "The failing reference block includes current text starting with '更关键的是...' while selected ASR entries can start with the previous tail '基础设施。'."
  implication: "Substring matching accepted a segment that was not a prefix of the current reference block."

- timestamp: "2026-05-18T00:00:00+08:00"
  source: "local replay through python/pipeline/run_asr.py"
  observation: "After the fix, selected ASR entries for the failing block start at [19.76, 22.64] '更关键的是...' and no longer include [18.8, 19.36] '基础设施。'."
  implication: "LLM prompt input is no longer polluted by the previous sentence tail."

## Eliminated

- hypothesis: "The LLM provider randomly failed without a deterministic input cause."
  reason: "The saved debug payload shows every failed retry received the same polluted first ASR segment and then produced invalid atom coverage such as 0-0 or 1-1."

## Resolution

- root_cause: "The strict reference-authority collector used substring matching to decide whether a leading ASR segment belonged to the current reference block. In this task, the previous sentence tail '基础设施。' also appears later inside the current reference text ('加密基础设施现在...'), so it was accepted as ASR segment 0 even though the current block actually starts with '更关键的是'. The LLM then had no valid allowed range for atom 0 alone, and retries that started from atom 1 failed contiguity with atom_span_not_contiguous:expected_0_got_1. A secondary issue let short atoms merge into overlong atoms, making allowed_atom_ranges less complete."
- fix: "Leading ASR trimming now requires prefix plausibility for same-script reference blocks and removes short/low-duration non-prefix boundary fragments before building the LLM prompt; readable atom balancing no longer merges short atoms past the configured visible-character limit; strict validated LLM timing now keeps ASR timing instead of pulling the first subtitle back to stale reference block starts; standalone vertical ASR retries the whole ASR/reference-authority step on REFERENCE_AUTHORITY_ALIGNMENT_FAILED."
- verification: "python -m unittest python.tests.test_run_asr_filetrans; python -m unittest python.tests.test_make_vertical_video; npm test -- server/services/vertical/__tests__/standaloneTaskImport.test.js --runInBand; npm test -- server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand; npm run lint -- --quiet."
- files_changed: "python/pipeline/run_asr.py, python/tests/test_run_asr_filetrans.py, server/services/vertical/standalone.js, server/services/vertical/__tests__/standaloneTaskImport.test.js, .planning/debug/reference-authority-contiguous.md"
