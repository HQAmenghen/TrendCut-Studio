---
status: resolved
trigger: "subtitle readability/timing rework requested after prior fixes"
created: "2026-05-14"
updated: "2026-05-14"
---

# Debug Session: subtitle-readability-timing-rework

## Symptoms

- expected: Generated vertical video subtitles stay aligned to audio across the whole video while reading naturally, with readability improved through semantic grouping rather than rules alone.
- actual: After previous subtitle fixes, the middle part of the generated vertical video is slightly late relative to audio, and subtitle splitting still does not read naturally.
- error_messages: No runtime exception reported; this is a timing/readability quality regression.
- timeline: Started or reappeared after previous subtitle fixes that made ASR timing authoritative and render-time splitting opt-in.
- reproduction: Inspect runtime job `data/uploads/runtime_jobs/standalone_1778726637625_3e08c720`; compare `subtitles.json` (14 entries), `reference_subtitles.json`, and `narration.json`; investigate `python/pipeline/run_asr.py` `build_reference_authority_subtitles` / `polish_readable_subtitle_segments` and `python/pipeline/make_vertical_video.py` render-time splitting.

## Current Focus

- hypothesis: confirmed. Reference-text authority still had gaps: one standalone ASR retiming path did not enable authority mode, and the readability pass could split/redistribute validated groups with weighted timing rather than using ASR-owned spans.
- test: Add regression coverage for semantic LLM grouping validation, rejected rewrites, rejected unsafe timing shifts, and standalone subtitlesPayload ASR authority mode.
- expecting: Reference text remains the only subtitle text authority, semantic grouping can improve readability only when validation passes, and display timings remain monotonic and derived from ASR spans instead of render-time weighted splitting.
- next_action: resolved.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-14; source: user report; observation: DATA_START User reports that after the previous subtitle fixes, the middle part of the generated vertical video is now slightly late again relative to the audio, and subtitle splitting is still not reading naturally. They want a broad fix that preserves timing alignment and improves readability, with rules alone not considered sufficient. Relevant artifacts: runtime job `data/uploads/runtime_jobs/standalone_1778726637625_3e08c720`; current `subtitles.json`: 14 entries; `reference_subtitles.json` / `narration.json` show larger reference blocks than displayed subtitles; current code path involves `python/pipeline/run_asr.py` `build_reference_authority_subtitles` / `polish_readable_subtitle_segments` and `python/pipeline/make_vertical_video.py` render-time splitting. Recent context: prior fix already made ASR timing authoritative and render-time splitting opt-in. Current suspicion is that readability grouping still relies too heavily on heuristics and may be causing awkward splits or slight pacing drift in the middle. Please investigate root cause and recommend a robust fix strategy that keeps ASR timing aligned while improving subtitle readability more semantically than pure rules. DATA_END
- timestamp: 2026-05-14; source: `data/uploads/runtime_jobs/standalone_1778726637625_3e08c720`; observation: `subtitles.json` and `audio.json` have 14 ASR-timed entries, while `reference_subtitles.json` / `narration.json` have four larger semantic blocks.
- timestamp: 2026-05-14; source: `data/logs/server.log`; observation: the original render for the runtime job loaded 21 subtitle card PNG inputs, showing the artifact was rendered before the latest ASR-owned subtitle JSON state and that render-time/generated-card state can diverge from current subtitles.
- timestamp: 2026-05-14; source: `server/services/vertical/standalone.js`; observation: `subtitlesPayload + useASR` wrote `reference_subtitles.json` but invoked `run_asr.py` without `--reference-text-authority`, leaving the older alignment/refinement path active.
- timestamp: 2026-05-14; source: `python/pipeline/run_asr.py`; observation: `align_reference_authority_with_llm` only assigned text to ASR segments; readability polish after that could split long groups with weighted timing, which can move display boundaries away from ASR evidence.

## Eliminated

- hypothesis: Current `make_vertical_video.py` default render-time splitting is the active cause for newly generated outputs.
  reason: current server calls do not pass `--split-long-subtitles`; the extra cards in the reported runtime job were older/stale render artifacts, while current render prep preserves JSON timing by default.

## Resolution

- root_cause: The previous fix made ASR timing authoritative for some paths, but not all. Standalone retiming with uploaded/forwarded `subtitlesPayload` still used reference subtitles without `--reference-text-authority`, and the authority pipeline still treated semantic readability as a post-processing heuristic that could split long validated groups with weighted timing rather than deriving display spans from ASR-owned reference spans.
- fix: Enable `--reference-text-authority` for standalone `subtitlesPayload + useASR`; harden `run_asr.py` authority mode so LLM readability grouping returns validated `start_index`/`end_index` groups, rejects rewrites/group-shaped fallback misuse, keeps final text as ordered reference substrings, and avoids re-splitting validated groups with weighted display timing.
- verification: `python -m unittest python.tests.test_run_asr_filetrans`; `npx jest server/services/vertical/__tests__/standaloneTaskImport.test.js server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`; `npx eslint server/services/vertical/standalone.js server/services/vertical/queue.js`.
- files_changed: `python/pipeline/run_asr.py`, `python/tests/test_run_asr_filetrans.py`, `server/services/vertical/standalone.js`, `server/services/vertical/__tests__/standaloneTaskImport.test.js`, `.planning/debug/subtitle-readability-timing-rework.md`.
