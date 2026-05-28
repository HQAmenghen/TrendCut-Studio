# Quick Task 260520-gah: 在竖屏后期合成流程中增加可选自定义片尾视频拼接 - Plan

**Date:** 2026-05-20
**Status:** In Progress

## Goal
Add an optional custom outro video to the vertical post-production render flow. When provided, the vertical render should append the outro after the generated vertical output without affecting existing renders that do not provide one.

## Tasks
1. Trace vertical render submission from frontend to server to Python.
2. Add optional outro file handling in the standalone vertical UI and service request path.
3. Add Python-side FFmpeg concatenation after vertical render, with graceful validation and no behavior change when omitted.
4. Add focused tests for argument passing and Python concat behavior.
