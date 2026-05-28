# Quick Task 260527-kxd: Avatar Motion Foundation

**Date:** 2026-05-27
**Status:** In progress

## Goal

Add the first implementation slice for deterministic avatar motion control: motion planning, action preset loading, pose sequence assembly, and guarded Node integration without changing default avatar rendering behavior.

## Tasks

1. Add Python motion planning and pose building scripts.
   - Create sentence/audio-duration based motion plan output.
   - Create action-template based pose sequence output.
   - Keep scripts dependency-light and protocol-compatible.

2. Add Node service and renderer hooks.
   - Generate motion artifacts only when explicitly enabled.
   - Pass pose files to ComfyUI/RunningHub only when configured with pose node IDs.
   - Include motion signatures in RunningHub resume keys.

3. Add focused tests.
   - Cover Python plan/build behavior.
   - Cover workflow pose injection and RunningHub pose node payloads.
