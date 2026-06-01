---
title: Fix Publish Dropdown Scroll
status: completed
completed_at: "2026-06-01T14:58:00+08:00"
---

# Fix Publish Dropdown Scroll

## Summary

修复发布信息弹窗内“发布账号”下拉菜单被弹窗底部区域裁剪、无法完整滚动的问题。

## Changes

- 将发布账号选择器提升为局部层叠上下文，避免被弹窗底部按钮区覆盖。
- 让发布账号下拉菜单在弹窗内向上展开，并保留独立滚动高度。
- 将发布信息弹窗自身从裁剪改为可滚动，避免内容超出视口时无法恢复查看。
- 复用现有 `.select-menu` 的玻璃背景、边框、阴影和滚动条样式，没有改动整体视觉主题。

## Verification

- `npm run build:front`
- `git diff --check`
