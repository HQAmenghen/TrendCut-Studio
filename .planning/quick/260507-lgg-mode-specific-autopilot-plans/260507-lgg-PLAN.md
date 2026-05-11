# Quick Task 260507-lgg: Mode-specific Auto-Pilot plans

## Goal

Make Auto-Pilot support independent schedules per production mode, so operators can configure one plan for avatar videos and another plan for non-avatar videos.

## Tasks

1. Persist per-mode account/time schedules in publish config.
2. Make the scheduler use per-mode schedules when queueing and creating scheduled jobs.
3. Update Publish Center to edit each mode's plan separately.
4. Show configured automation plans in the task list even before publish jobs are generated.
5. Run focused tests/build verification.
