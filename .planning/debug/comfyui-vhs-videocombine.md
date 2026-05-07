---
status: root_cause_found
trigger: "ComfyUI submit failed with HTTP 400. Container logs show invalid prompt: Cannot execute because node VHS_VideoCombine does not exist. Details: Node ID '#151'."
created: 2026-04-29
updated: 2026-04-29
---

# Debug Session: comfyui-vhs-videocombine

## Symptoms

- Expected behavior: Submitting the generated ComfyUI prompt to `/prompt` should enqueue and execute the video workflow.
- Actual behavior: The backend submit call receives HTTP 400 from ComfyUI.
- Error messages: `[ComfyUI 提交失败] URL: https://5a7b6b490cf62cb4-5a7b6b490cf62cb4.runsync.serverless.ppinfra.com/prompt, Status: 400, Message: Request failed with status code 400`; ComfyUI reports `invalid prompt: Cannot execute because node VHS_VideoCombine does not exist. Details: Node ID '#151'`.
- Timeline: The container started at `2026-04-29T04:02:02Z`; failed prompt submissions were logged at `2026-04-29T04:45:34Z` and `2026-04-29T04:46:09Z`.
- Reproduction: Submit the current material-driven ComfyUI workflow to the listed ComfyUI endpoint while the remote runtime lacks the custom node that provides `VHS_VideoCombine`.

## Current Focus

- hypothesis: The workflow references a VideoHelperSuite custom node (`VHS_VideoCombine`) that is not installed or not loaded in the remote ComfyUI runtime.
- test: compare the workflow node types against the custom nodes/extensions available in the ComfyUI container
- expecting: ComfyUI rejects the prompt before execution because node `#151` has an unknown `class_type`
- next_action: report confirmed root cause to operator; no application source fix requested
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-04-29
  source: operator-provided backend error
  observation: `/prompt` returned HTTP 400 during ComfyUI prompt submission.
- timestamp: 2026-04-29
  source: operator-provided ComfyUI container log
  observation: ComfyUI parsed the prompt, then rejected it as `invalid_prompt` because `VHS_VideoCombine` does not exist at node ID `#151`.

## Eliminated

- hypothesis: This is a network connectivity failure to ComfyUI.
  evidence: ComfyUI received the prompt and logged `got prompt`; the server response was a validation error, not a connection timeout.
- hypothesis: This is an application-side generic HTTP client failure.
  evidence: The ComfyUI container provides a specific invalid prompt message naming the missing node type.

## Resolution

- root_cause: The submitted ComfyUI workflow contains node `#151` with class type `VHS_VideoCombine`, but the remote ComfyUI runtime does not have the custom node package that defines that node loaded.
- fix: not applied; root-cause-only request
- verification: ComfyUI container logs show `got prompt`, then `invalid_prompt` with `Cannot execute because node VHS_VideoCombine does not exist`, so the request reached ComfyUI and failed at workflow validation.
- files_changed: .planning/debug/comfyui-vhs-videocombine.md
