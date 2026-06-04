---
title: Restore Avatar Config In Dashboard
status: completed
completed_at: "2026-06-02T09:19:49+08:00"
---

# Restore Avatar Config In Dashboard

## Summary

在新版自动生产驾驶舱右侧启动区恢复数字人声音、形象和渲染服务配置入口，保持现有紧凑玻璃控制风格。

## Changes

- 在启动操作区新增可折叠的“数字人配置”面板，折叠态展示当前声音和形象摘要。
- 支持选择声音/形象预设，切换上传声音文件或形象图片，并保留启动时的缺失文件保护。
- 接入渲染引擎、服务地址和连接检测按钮，复用现有 `materialDriven` 状态和启动 payload。
- 补齐桌面和移动端样式，避免配置区在窄屏下横向溢出。

## Verification

- `npm run build:front`
- Python Playwright desktop expanded check: no horizontal overflow, defaults selected.
- Python Playwright mobile expanded check at 390px: no horizontal overflow.
