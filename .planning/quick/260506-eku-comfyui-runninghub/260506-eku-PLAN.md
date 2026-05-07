# Quick Task 260506-eku: 验证原生 ComfyUI 与 RunningHub 两条渲染链路并补齐前端

## Goal

Verify both avatar rendering providers after the RunningHub API key was configured, then complete the frontend controls for all backend-supported RunningHub options.

## Tasks

1. Check secret presence without printing the API key.
2. Test the native ComfyUI and RunningHub rendering paths separately.
3. Add missing frontend controls for RunningHub field names, output node, instance type, run path, personal queue, and retention.
4. Run Jest, server lint, frontend build, and diff checks.
