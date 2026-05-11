---
status: resolved
trigger: "latest material-driven task did not use source material at the beginning even though a relevant opening quote was found"
created: 2026-05-11
updated: 2026-05-11
---

# Debug Session: Material Hook Cutaway Rejected

## Symptoms

- Expected behavior: A high-priority hook with a relevant quote segment should use a material cutaway at the beginning.
- Actual behavior: The latest task starts with a digital avatar segment from `0.00s` to `12.91s`.
- Evidence: `clip_matches.json` matched `script_001` to `seg_08`, but set `use_cutaway: false`.
- Reproduction: Inspect latest project `projects/material_1778462863141_bf267634`.

## Current Focus

- hypothesis: `speaker_quote` is treated as incompatible with `speaker_commentary` even when the matched material segment has `evidence.evidence_type: speaker_quote`.
- test: Add a regression covering a high-priority hook whose segment event is `speaker_commentary` but evidence type is `speaker_quote`.
- expecting: The hook is selected as `use_cutaway: true`.
- next_action: inspect clip selector compatibility scoring and patch the narrow rule.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-11; source: latest task; observation: `execution_plan.json` first segment is `type: aiman`.
- timestamp: 2026-05-11; source: `clip_matches.json`; observation: `script_001` matched `seg_08` but was rejected for `person_mismatch;event_type_mismatch;event_tag_mismatch`.
- timestamp: 2026-05-11; source: `material_segments_scored.json`; observation: `seg_08` has `event.event_type: speaker_commentary` and `evidence.evidence_type: speaker_quote`.

## Eliminated

## Resolution

- root_cause: Clip selector event-type scoring only compared the requested event type to `segment.event.event_type`; it ignored `segment.evidence.evidence_type`, so a direct `speaker_quote` evidence segment categorized as `speaker_commentary` became a hard `event_type_mismatch`.
- fix: Pass segment evidence type into event-type scoring and treat an exact evidence-type match as compatible direct evidence without broadly accepting every `speaker_commentary` segment as a quote.
- verification: `python -m unittest python.tests.test_clip_selector.ClipSelectorLocalizationTest.test_run_accepts_speaker_commentary_when_segment_has_speaker_quote_evidence`; `python -m unittest python.tests.test_clip_selector`
- files_changed: `python/pipeline/skills/clip_selector.py`; `python/tests/test_clip_selector.py`; `.planning/debug/material-hook-cutaway-rejected.md`
