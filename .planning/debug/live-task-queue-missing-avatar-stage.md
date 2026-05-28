---
status: resolved
trigger: live-task-queue-missing-avatar-stage
created: 2026-05-27
updated: 2026-05-27
---

## Symptoms

DATA_START
Context: Comfy Panel Demo Node/Vue/Python app. User says the new realtime task queue in frontend/src/components/AutomationDashboard.vue is wrong: a scheduled task is currently running in background, in digital avatar synthesis stage, but the Live Queue does not show that stage/subtitle/status text. Screenshot shows Live Queue panel with failed publish tasks, one “主流程” row with stale-looking text, and AutoPilot plans.

Relevant initial observations:
- frontend/src/components/AutomationDashboard.vue currently builds liveTaskItems from current materialDriven composable, xai loading, standalone queueStatus, publishCenter.jobs, and autoPilotAllPlans.
- server/routes/materialDriven.js has activeTasks shared map and /api/material-driven/status/:jobId but no global list endpoint.
- server.js materialDrivenStarter appears to start avatar-only / one-click background work for AutoPilot around lines 910-1036.
- server/services/materialDriven/sharedState.js and taskRegistry likely matter.

Task: identify correct backend/runtime state source for scheduled material-driven/avatar tasks and implement/propose a focused fix. Edit files directly if clear. Avoid reverting existing user changes. Report changed files.
DATA_END

## Current Focus

- hypothesis: /api/material-driven/active must treat project files as the durable source for material-driven avatar render state, not activeTasks memory.
- next_action: complete

## Evidence

- timestamp: 2026-05-27T02:05:06+08:00
  observation: `projects/material_1779844527596_f5e5b8d4/avatar_render_state.json` has provider `runninghub`, status `polling_interrupted`, taskId `2059444888252145666`, no `aiman.mp4`, and no `output_final.mp4`.
  implication: The task is recoverable/in-flight from disk even when `activeTasks` memory is empty.
- timestamp: 2026-05-27T02:10:00+08:00
  observation: A direct registry call with `activeTasks.clear()` returns task `1779844527596_f5e5b8d4` from disk with status `generating_avatar`, currentStep `6`, progress `86`, and empty `error`.
  implication: The Live Queue backend can show the RunningHub task after memory loss/restart.

## Eliminated

## Resolution

- root_cause: `/api/material-driven/active` depended on runtime memory for the live material-driven queue, so a RunningHub avatar render persisted only in `projects/material_*/avatar_render_state.json` disappeared after memory loss/restart; additionally, a transient `polling_interrupted` error could be surfaced as a dashboard failure even though the remote task was still recoverable.
- fix: Made the material-driven task registry list durable in-flight RunningHub avatar renders from project files, using `avatar_render_state.json` for task identity/state and `task_state.json`/`source_post.json` for dashboard metadata; persisted `polling_interrupted` and related recoverable statuses now show as running/recoverable without copying transient errors into `task.error`.
- verification: `npx jest server/services/materialDriven/__tests__/taskRegistry.test.js --runInBand` passed; `npx eslint server/services/materialDriven/taskRegistry.js server/services/materialDriven/__tests__/taskRegistry.test.js` passed; direct registry probe with empty `activeTasks` returned RunningHub taskId `2059444888252145666`.
- files_changed: `server/services/materialDriven/taskRegistry.js`; `server/services/materialDriven/__tests__/taskRegistry.test.js`; `.planning/debug/live-task-queue-missing-avatar-stage.md`
