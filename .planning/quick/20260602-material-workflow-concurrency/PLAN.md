---
status: complete
created: 2026-06-02
updated: 2026-06-02
---

# Complete Material Workflow 2-Concurrency

## Goal

Add global two-task concurrency support for the complete material-driven workflow, not only the vertical rendering queue.

## Scope

- Queue material-driven start requests when two complete workflows are already active.
- Preserve existing operator behavior: `/api/material-driven/start` still returns a job id immediately.
- Show queued full-workflow jobs in Live Queue.
- Start queued jobs automatically when a running material-driven workflow completes, fails, or is removed.
- Keep deletion/removal behavior safe for queued/failed terminal items.

## Plan

1. Add a material-driven workflow scheduler around `activeTasks`. Done.
2. Mark newly submitted jobs as `queued` when the global workflow capacity is full. Done.
3. Start queued workflows when active running workflows finish or are deleted. Done.
4. Include queued workflow tasks in registry/live queue status payloads. Done.
5. Add focused tests for scheduler behavior and route registration where practical. Done.
6. Run frontend build, backend lint, and focused Jest tests. Done.
