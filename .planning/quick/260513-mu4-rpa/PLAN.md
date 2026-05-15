---
status: in-progress
date: 2026-05-13
---

# Quick Task: 多平台 RPA 发布路径与自动发布平台复选

## Goal
- 自动发布创建时支持选择多个目标平台。
- 优先实现 RPA 路径：视频号保留现状，抖音/小红书先以浏览器自动化草稿/发布为扩展方向。
- 保持现有发布任务模型和调度可恢复。

## Plan
1. 梳理现有发布配置、任务创建、调度、前端托管计划。
2. 增加自动托管计划的平台复选配置并保存到 publish config。
3. 让自动托管创建任务时按平台复选生成 selectedPlatforms/platformSelections/platformTasks。
4. 铺设通用 RPA 服务入口，为 douyin/xiaohongshu 提供脚本、路由和运行状态更新。
5. 运行聚焦测试。
