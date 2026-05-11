---
status: complete
created_at: 2026-05-09T01:22:19.093Z
---

# Quick Task: Skip Silent Auto Publish

## Goal

Prevent automatically fetched videos with no usable spoken subtitle content from continuing into vertical render output or scheduled publish job creation.

## Plan

1. Add a vertical queue guard after ASR reads subtitles.
2. Mark no-transcript queue jobs as `skipped` with an operator-readable message.
3. Teach the scheduler to treat `skipped` queue jobs as terminal for AutoPilot monitoring.
4. Add focused Jest coverage for the queue skip and scheduler terminal handling.
