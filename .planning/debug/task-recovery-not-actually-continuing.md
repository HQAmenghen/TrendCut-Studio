---
slug: task-recovery-not-actually-continuing
status: resolved
trigger: user_report
created_at: 2026-05-28T10:02:39.7958032+08:00
updated_at: 2026-05-28T10:15:28.2747928+08:00
---

# Debug Session: task-recovery-not-actually-continuing

## Current Focus

**hypothesis:** DB display recovery exists, but scheduler/vertical queue does not actually resume post-restart `vertical_queue` tasks.

**next_action:** Investigate scheduler and vertical queue recovery paths for DB-backed `vertical_queue` tasks with completed artifacts after restart.

## Symptoms

- Workspace: `C:\Users\PC\Desktop\comfy_panel_demo`
- Issue: Live Queue shows recovered DB task, but Activity/runtime logs do not change. User asks whether task recovery is real.
- Prior diagnosis: DB display recovery exists, but scheduler/vertical queue does not actually resume post-restart `vertical_queue` tasks.
- Observed stale task: `vertical_queue` id `1779846480045_xtas8j2`, status `reviewing`, progress `92`, updatedAt `2026-05-27T01:54:48.005Z`.
- `/api/xai-top10/vertical-jobs` memory queue empty.
- Artifacts exist at `public/xai_vertical_queue/1779846480045_xtas8j2/vertical_output.mp4` and `.meta.json`.
- Scheduler restart lost in-memory `autoPilotJobs`.

## Evidence

- timestamp: 2026-05-28T10:02:39.7958032+08:00
  source: user_report
  detail: Recovery appears only in DB display; runtime queue and activity logs do not continue after restart.
- timestamp: 2026-05-28T10:15:28.2747928+08:00
  source: implementation
  detail: `vertical_queue` runtime state now hydrates DB tasks and marks tasks with existing `public/xai_vertical_queue/<id>/vertical_output.mp4` as completed; scheduler rebuilds autopilot monitoring for recovered queue jobs and runs the existing publish-job creation path with duplicate checks.
- timestamp: 2026-05-28T11:13:28.6384138+08:00
  source: regression_fix
  detail: Scheduler recovery now snapshots only unfinished vertical_queue tasks before hydration, skips historical completed tasks, and invokes recovery monitoring even when the in-memory autopilot map is empty after restart.

## Goal

Implement real recovery for DB-backed vertical_queue tasks with completed artifacts after restart so chain continues to publish/job finalization without duplicate jobs, and status/logs update visibly.

## Likely Files

- `server/services/system/scheduler.js`
- `server/services/vertical/queue.js`
- `server/core/taskStore.js`
- relevant tests

## Resolution

**root_cause:** Restart recovery only affected persisted task display/retry paths; the vertical queue runtime `Map` and scheduler `autoPilotJobs` monitor were not rebuilt from DB tasks, so completed artifacts after restart were never observed by the publish continuation loop.

**fix:** Added vertical queue DB hydration for persisted jobs with completed artifacts, added scheduler autopilot monitor recovery for DB-backed vertical queue jobs, and covered the restart continuation path with focused Jest tests.

**followup_fix:** Bounded scheduler recovery to tasks that were unfinished before hydration, preventing old completed vertical artifacts from creating new scheduled publish jobs while still continuing interrupted/reviewing completed-artifact tasks.
