---
status: resolved
trigger: "User reports two xAI vertical queue outputs have late subtitles: audio starts while subtitle area is blank or still showing the previous subtitle. URLs: /xai_vertical_queue/1779152460046_qv9xk69/vertical_output.mp4 and /xai_vertical_queue/1779149460052_booeazv/vertical_output.mp4."
created: "2026-05-19"
updated: "2026-05-19"
---

# Debug Session: xai-vertical-subtitle-late

## Symptoms

- Expected behavior: xAI vertical queue subtitles should appear in sync with speech, with no audible speech interval left blank and no previous card lingering into the next spoken line.
- Actual behavior: In `1779152460046_qv9xk69` and `1779149460052_booeazv`, some subtitles appear late; voice starts before the matching subtitle card appears, leaving the subtitle region blank or showing the previous subtitle.
- Error messages: No runtime exception reported; issue is visible in rendered video output.
- Timeline: Reported on 2026-05-19 after prior subtitle alignment fixes.
- Reproduction: Inspect queue task directories, subtitle JSON, audio metadata, and rendered `vertical_output.mp4` for the two task ids. Compare subtitle starts against audio/ASR speech starts and check render behavior around subtitle gaps.

## Current Focus

- hypothesis: Strict reference-text-authority ASR kept provider ASR subtitle starts even when the material reference timeline was continuous, creating visible blank/stale subtitle windows at reference block boundaries.
- test: Compare reported task `reference_subtitles.json` against `subtitles.json`; simulate current strict reference-authority finalization; run ASR and vertical queue regressions.
- expecting: Reported gaps close to reference boundaries without reintroducing previous-tail fragments or subtitle overlap.
- next_action: fixed and verified on the two reported queue artifacts; monitor newly generated xAI vertical queue outputs for the "已闭合参考字幕连续口播空隙" ASR log line and for zero internal subtitle gaps in public metadata.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-19T09:20:00+08:00
  observation: `data/uploads/xai_vertical_queue/1779152460046_qv9xk69/subtitles.json` has gaps absent from the material reference timeline. Subtitle 3 ends at `11.3s`; subtitle 4 starts at `12.96s`, while `reference_subtitles.json` block 2 starts at `11.3s`. Subtitle 6 ends at `24.03s`; subtitle 7 starts at `26.96s`, while reference block 3 starts at `24.03s`.
  implication: Late subtitle starts are already present in ASR output before `make_vertical_video.py` renders the MP4.
- timestamp: 2026-05-19T09:23:00+08:00
  observation: `data/uploads/xai_vertical_queue/1779149460052_booeazv/subtitles.json` shows the same pattern: `4.4s -> 5.44s`, `13.04s -> 14.91s`, and `28.8s -> 29.36s` subtitle gaps, while `reference_subtitles.json` is continuous at `0-14.91`, `14.91-29.13`, and `29.13-44.04`.
  implication: The failure is systemic in strict reference-authority timing, not a single bad render.
- timestamp: 2026-05-19T09:27:00+08:00
  observation: FFmpeg `silencedetect` at `-35dB:d=0.25` reported no silence ranges for either `source.mp4`.
  implication: The blank subtitle windows occur over audible audio, matching the user-visible symptom.
- timestamp: 2026-05-19T09:31:00+08:00
  observation: The rendered video path uses `make_vertical_video.py`, which overlays subtitle cards using the `subtitles.json` start times and trims only `0.08s` from card ends via `SUBTITLE_GAP_SECONDS`.
  implication: Rendering did not introduce the multi-second late starts; it faithfully rendered late ASR timings.
- timestamp: 2026-05-19T09:37:00+08:00
  observation: Vertical queue invokes `run_asr.py` with `--reference-subtitles-json ... --reference-text-authority`, but previous generated logs only show "已闭合参考字幕段内短空隙", not the stricter continuous reference gap closure.
  implication: Existing short-gap closure covered intra-block micro gaps, but not multi-second continuous-script gaps at reference block boundaries.
- timestamp: 2026-05-19T09:50:00+08:00
  observation: Current fix introduces strict-mode continuous reference gap closure. Direct simulation over the two reported artifact sets produces no subtitle gaps: `1779152460046_qv9xk69` closes starts to `11.3s` and `24.03s`; `1779149460052_booeazv` closes starts to `5.44s`, `14.91s`, and `29.13s`.
  implication: New strict reference-authority finalization removes the visible late-subtitle windows for the reported pattern.
- timestamp: 2026-05-19T09:44:02+08:00
  observation: A real rerun for `1779152460046_qv9xk69` did receive earlier ASR segments (`未来10年，AI`, `可能像当年Excel`), but `reference_authority_debug.json` showed the LLM returned `start_index`/`end_index` values matching reference-text character positions instead of ASR segment indices.
  implication: The first fix exposed a second systemic issue: strict validation rejected a semantically valid, text-contiguous LLM grouping because of index-field ambiguity, then fell back to the poorer ASR timing.
- timestamp: 2026-05-19T09:59:05+08:00
  observation: After accepting validated reference-text position groups and rerunning both reports, public metadata shows `maxGap=0.000` for `1779152460046_qv9xk69` (13 subtitles) and `1779149460052_booeazv` (14 subtitles). Refreshed public videos have durations `37.24s` and `44.15s`.
  implication: The actual public artifacts now use the repaired timing, not just future jobs.

## Eliminated

- hypothesis: `make_vertical_video.py` overlay timing shifts subtitle cards late.
  reason: Renderer uses `card["start"]` directly in FFmpeg `between(t,start,end)` and only shortens card end by `0.08s`; artifact `subtitles.json` already contains 1.04s-2.93s late starts.
- hypothesis: The reported gaps are intentional silence.
  reason: FFmpeg `silencedetect` found no silence windows at `-35dB:d=0.25` in either source video.

## Resolution

- root_cause: Strict reference-text-authority subtitle generation trusted ASR segment starts for continuous material-script blocks. When Qwen Filetrans produced late starts around reference block boundaries, the generated `subtitles.json` left audible speech intervals blank or showing the prior subtitle. Existing `close_short_reference_authority_gaps` only closed small internal gaps and did not repair continuous reference-timeline gaps of roughly 1-3 seconds.
- root_cause_followup: Qwen Filetrans may also normalize text granularity (`未来十年` -> `未来10年`) and the LLM may return character-position `start_index`/`end_index` groups even when the prompt asks for atom groups. The previous strict validator treated those fields only as ASR segment indices, so correct readable groups could be rejected.
- fix: Added continuous reference gap closure for strict reference-authority blocks in `python/pipeline/run_asr.py`. It extends subtitle starts/ends to nearby continuous reference block boundaries when the gap is bounded, while preserving a guard so intentionally excluded previous-tail ASR fragments are not pulled into the next block. Also added numeric-equivalent reference matching and a strict text-position-group validator: if LLM output text is a contiguous copy of the reference, covers the full block in order, passes timing/readability checks, and its position hints match the reference, the timing is derived from ASR/reference spans instead of being rejected.
- files_changed:
  - `python/pipeline/run_asr.py`
  - `python/tests/test_run_asr_filetrans.py`
  - `.planning/debug/xai-vertical-subtitle-late.md`
- verification:
  - `python -m unittest python.tests.test_run_asr_filetrans`
  - `python -m unittest python.tests.test_make_vertical_video`
  - `npx jest server/services/vertical/__tests__/queueAsrFileUrl.test.js --runInBand`
  - `npm run lint -- --quiet`
  - reran ASR and render for `1779152460046_qv9xk69`; public metadata max gap `0.000s`
  - reran ASR and render for `1779149460052_booeazv`; public metadata max gap `0.000s`
