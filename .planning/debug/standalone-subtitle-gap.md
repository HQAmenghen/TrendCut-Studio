---
status: resolved
trigger: "User reports http://localhost:3001/runtime_jobs/standalone_1779329258817_1f2197fd/standalone_output_vertical.mp4?t=1779329915694.3726 has a subtitle blank gap around 13s: audio starts at 13s but the subtitle does not appear until 15s. Diagnose the cause and implement a general fix to prevent recurrence."
created: "2026-05-21"
updated: "2026-05-21"
---

# Debug Session: standalone-subtitle-gap

## Symptoms

- Expected behavior: When audible narration begins around 13s, the matching subtitle card should appear immediately or within a very small tolerance.
- Actual behavior: Around 13s, speech is audible while the subtitle area is blank until roughly 15s.
- Error messages: No runtime exception reported; this is visible in the rendered standalone vertical MP4.
- Timeline: Reported on 2026-05-21 for `standalone_1779329258817_1f2197fd`.
- Reproduction: Inspect the runtime job artifacts, subtitle JSON, audio/video timeline, and standalone render path for `standalone_output_vertical.mp4`; compare subtitle starts against audible speech and source metadata.

## Current Focus

- hypothesis: Standalone accepted a subtitle timeline with an internal non-silent gap, and the renderer faithfully left that interval blank.
- test: compare job subtitle JSON, FFprobe stream starts, FFmpeg silencedetect output, renderer overlay behavior, and regenerated artifact timing.
- expecting: 13.20s->15.84s is present before render; closing non-silent gaps before subtitle card generation removes the blank window without altering real silence.
- next_action: fixed and verified for `standalone_1779329258817_1f2197fd`; keep the render-time active-audio gap guard covered by tests.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-05-21T11:00:00+08:00
  observation: `data/uploads/runtime_jobs/standalone_1779329258817_1f2197fd/subtitles.json` had subtitle 5 ending at `13.20s` and subtitle 6 starting at `15.84s`, leaving a `2.64s` internal subtitle gap.
  implication: The blank subtitle window existed in the subtitle source timeline before card generation.
- timestamp: 2026-05-21T11:04:00+08:00
  observation: FFprobe showed both input and output audio/video streams start at `0.000000`, with total duration around `40.35s`.
  implication: The symptom was not caused by a global audio/video timestamp offset.
- timestamp: 2026-05-21T11:07:00+08:00
  observation: FFmpeg `silencedetect=noise=-35dB:d=0.15` reported no silence ranges for `standalone_input.mp4`.
  implication: The `13.20s -> 15.84s` subtitle gap occurs over audible content, matching the user report.
- timestamp: 2026-05-21T11:40:00+08:00
  observation: Re-render logged `Closed 1 active-audio subtitle gap(s): 15.84s->13.20s` and regenerated subtitle metadata has `maxGap=0`.
  implication: The general render-time guard closes this class of audible subtitle gaps for the reported artifact.

## Eliminated

- hypothesis: The vertical renderer delayed subtitle cards by roughly two seconds.
  reason: `make_vertical_video.py` overlays cards using the card start time directly; the reported gap was already present in `subtitles.json`.
- hypothesis: The reported interval was intentional silence.
  reason: `silencedetect` found no silence ranges in the input media at the reported interval.

## Resolution

- root_cause: Standalone generation can consume imported or ASR-produced subtitle JSON directly. If that JSON contains an internal timing gap while narration remains audible, `make_vertical_video.py` previously preserved the gap and rendered no subtitle card until the next subtitle's late start time.
- fix: Added a render-preparation guard in `python/pipeline/make_vertical_video.py` that runs FFmpeg silencedetect against the input video, scans adjacent subtitle windows, and closes bounded internal gaps (`0.25s` to `3.5s`) only when the gap contains active audio. The corrected subtitle timeline is written back to `subtitles.json` before subtitle cards are generated.
- files_changed:
  - `python/pipeline/make_vertical_video.py`
  - `python/tests/test_make_vertical_video.py`
  - `.planning/debug/standalone-subtitle-gap.md`
- verification:
  - `python -m unittest python.tests.test_make_vertical_video`
  - Re-rendered `data/uploads/runtime_jobs/standalone_1779329258817_1f2197fd/standalone_output_vertical.mp4`
  - Confirmed regenerated `subtitles.json` has subtitle 6 at `13.20s -> 17.76s` and `maxGap=0`
  - Updated `standalone_output_vertical.mp4.meta.json` subtitles to match regenerated timing
