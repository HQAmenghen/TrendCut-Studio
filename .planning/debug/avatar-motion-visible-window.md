---
status: investigating
trigger: "Avatar gesture actions are sometimes planned during source-material-only sections, and action component neutral lead-in makes gesture peaks miss speech emphasis."
created: 2026-05-29
updated: 2026-05-29
---

# Avatar Motion Visible Window Debug

## Symptoms

- Expected behavior: Gesture actions should be planned only where the digital human is visible in the final edit.
- Actual behavior: The motion planner may place gesture segments at speech emphasis times that later correspond to source material rather than avatar video.
- Expected behavior: Action templates that start from neutral should account for their lead-in time so the visible gesture peak aligns with the speech emphasis.
- Actual behavior: The planner currently treats the segment start as the emphasis moment, so neutral lead-in can make the gesture feel late.

## Current Focus

- hypothesis: The avatar motion planner only receives narration text/audio and action metadata, not the material-driven execution plan or avatar visibility windows.
- test: Inspect material-driven execution plan shape and avatar motion planner inputs.
- expecting: Need to pass edit-plan context into avatar motion planning and use action metadata activeStart/activeEnd while scheduling.
- next_action: gather initial evidence

## Evidence

## Eliminated

## Resolution
