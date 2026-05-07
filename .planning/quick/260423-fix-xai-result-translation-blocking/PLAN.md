---
status: in_progress
created: "2026-04-23T09:51:00+08:00"
---

# Fix xAI Result Translation Blocking

## Goal

Prevent the xAI Top10 result endpoint from freezing the Node service when summary translation fails or hangs.

## Plan

1. Add a focused regression test for `ensureTranslatedResult()`.
2. Make translation post-processing bounded and non-blocking from the operator perspective by falling back to the original summary text when translation cannot complete promptly.
3. Verify the focused xAI test and the live `/api/xai-top10/status` and `/api/xai-top10/result` endpoints.
