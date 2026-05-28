---
status: resolved
trigger: "XAI vertical queue task 1779147540079_uwrlwcp failed with REFERENCE_AUTHORITY_ALIGNMENT_FAILED after retries: atom_span_not_allowed:1-2 and atom_span_not_contiguous:expected_1_got_2."
created: "2026-05-19"
updated: "2026-05-19"
---

# Debug Session: reference-authority-allowed-range

## Symptoms

- expected_behavior: "Strict reference-authority subtitle alignment should retry toward a verified high-quality subtitle result and should not fail on valid natural subtitle groupings."
- actual_behavior: "Task 1779147540079_uwrlwcp failed after ASR retry with atom_span_not_allowed:1-2 and atom_span_not_contiguous:expected_1_got_2."
- error_messages: "REFERENCE_AUTHORITY_ALIGNMENT_FAILED; ReferenceAuthorityAlignmentError: atom_span_not_allowed:1-2; ReferenceAuthorityAlignmentError: atom_span_not_contiguous:expected_1_got_2."
- timeline: "Observed on 2026-05-19 after the previous repeated-tail ASR boundary fix."
- reproduction: "Inspect data/uploads/xai_vertical_queue/1779147540079_uwrlwcp/reference_authority_debug.json and replay current run_asr reference-authority prompt/validation."

## Current Focus

- hypothesis: "Confirmed: prompt generation and strict validation were not using the same reference-authority ASR normalization for micro fragments, so the model followed the prompt's atom grid but validation rebuilt a different grid and rejected valid spans."
- test: "Replay the saved reference_authority_debug.json block and add a regression for the natural 0-0 / 1-2 / 3-3 atom grouping."
- expecting: "The saved LLM output validates, allowed_atom_ranges includes 1-2, and strict reference-authority tests pass."
- next_action: "complete"
- reasoning_checkpoint: "The production debug payload showed ASR segment 1 was a 0.16s tail `作。` and segment 2 was `Harry John`. Prompt generation merges micro-fragments before building reference_atoms; strict validation and diagnostics must use that same normalized ASR timeline or they can assign `Harry Jung 带领团队...` to the 0.16s tail and reject a valid `1-2` grouping."
- tdd_checkpoint: "Regression test added: `test_reference_authority_atom_ranges_allow_tail_fragment_with_previous_sentence`. It reproduces the saved atom grouping and verifies the validator accepts it."

## Evidence

- timestamp: 2026-05-19; source: `data/uploads/xai_vertical_queue/1779147540079_uwrlwcp/reference_authority_debug.json`; observation: "Saved failed output repeatedly used atom spans `0-0`, `1-2`, `3-3` or skipped atom 1. The key block had ASR segment 1 as a 0.16s tail `作。` and segment 2 as `Harry John`, causing raw validation to give atom 1 an impossible 0.16s timing."
- timestamp: 2026-05-19; source: `python/pipeline/run_asr.py`; observation: "`build_reference_authority_prompt`, `align_reference_authority_with_llm`, `validate_reference_authority_llm_results`, and diagnostics run reference-authority atom grouping on `merge_reference_authority_micro_asr_fragments(...)`, keeping prompt, validation, and debug output on the same normalized ASR timeline."
- timestamp: 2026-05-19; source: `python/tests/test_run_asr_filetrans.py`; observation: "Added regression `test_reference_authority_atom_ranges_allow_tail_fragment_with_previous_sentence`; it asserts allowed ranges include `(1, 2)` and that the saved natural atom grouping validates to the full reference text."
- timestamp: 2026-05-19; source: "verification"; observation: "`python -m unittest python.tests.test_run_asr_filetrans` ran 57 tests and passed. A saved artifact replay returned `validated_count=3`, `joined_matches=True`, and allowed ranges including `1-2`."

## Eliminated

- hypothesis: "The LLM was simply ignoring the allowed_atom_ranges contract."; reason: "The saved `0-0 / 1-2 / 3-3` output is valid against the normalized prompt atom grid; the validator was rebuilding a different raw grid."
- hypothesis: "The reference text did not match the final audio."; reason: "After micro-fragment normalization, the saved LLM output joins exactly to the reference text and passes strict validation."

## Resolution

- root_cause: "Reference-authority prompt generation merged short ASR micro-fragments before presenting `reference_atoms`, but strict validation/diagnostics could rebuild atoms from raw ASR entries; the model's valid `1-2` grouping was rejected as `atom_span_not_allowed` because raw atom 1 inherited only the 0.16s punctuation-tail timing."
- fix: "Normalize reference-authority ASR entries through `merge_reference_authority_micro_asr_fragments(...)` consistently across prompt construction, strict validation, diagnostics, readable-atom detection, and LLM alignment, and add a regression for the failed saved block."
- verification: "`python -m unittest python.tests.test_run_asr_filetrans` passed; saved debug JSON replay validates the original LLM output with `joined_matches=True`."
- files_changed: "`python/pipeline/run_asr.py`; `python/tests/test_run_asr_filetrans.py`; `.planning/debug/reference-authority-allowed-range.md`."
