---
status: investigating
trigger: "User reports clicking retry triggered duplicate RunningHub digital-avatar synthesis jobs, wasting resources. Desired behavior: add task recovery so the same material-driven task detects an existing digital-avatar synthesis id/taskId and continues polling/resuming it, and avoids creating multiple RunningHub jobs after false errors/retries. Relevant files likely server/services/materialDriven/avatarGeneration.js, server/services/materialDriven/autoStart.js, server/services/pipeline/runningHub.js, retry endpoints in server/routes/materialDriven.js/server.js agent materialDrivenStarter. Please investigate and implement a focused fix if clear. Avoid reverting unrelated changes; report changed files."
created: 2026-05-27
updated: 2026-05-27
---

# Debug Session: runninghub-avatar-retry-duplicate-tasks

## Symptoms

DATA_START
User reports clicking retry triggered duplicate RunningHub digital-avatar synthesis jobs, wasting resources. Desired behavior: add task recovery so the same material-driven task detects an existing digital-avatar synthesis id/taskId and continues polling/resuming it, and avoids creating multiple RunningHub jobs after false errors/retries. Relevant files likely server/services/materialDriven/avatarGeneration.js, server/services/materialDriven/autoStart.js, server/services/pipeline/runningHub.js, retry endpoints in server/routes/materialDriven.js/server.js agent materialDrivenStarter. Please investigate and implement a focused fix if clear. Avoid reverting unrelated changes; report changed files.
DATA_END

## Current Focus

- hypothesis: retry path starts avatar synthesis without checking persisted RunningHub task metadata from the project directory
- test: inspect material-driven avatar retry/start code and add focused regression coverage if possible
- expecting: existing task identifiers are either not persisted or not read before creating a new RunningHub task
- next_action: gather initial evidence

## Evidence

## Eliminated

## Resolution

- root_cause:
- fix:
- verification:
- files_changed:
