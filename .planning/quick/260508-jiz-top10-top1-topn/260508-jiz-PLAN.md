# Quick Task 260508-jiz: Top10 分区 TopN 发布计划修正

## Goal

修正发布中心自动化计划：每条发布计划都能独立选择榜单分区和该分区内的 Top1/TopN，避免把计划行号误当成分区内排名；同时统一两种制作模式的视觉设计。

## Tasks

1. Add explicit source-rank model
   - Extend publish config schedules with `sourceRanks`.
   - Update scheduler to pick the configured rank within each partition before fallback replacement.
   - Preserve source rank metadata through queue and publish jobs.

2. Redesign publish center automation rows
   - Replace row labels like global `Top 1/Top 2` with independent plan cards.
   - Add controls for account, partition, partition rank, and time.
   - Use shared CSS classes instead of inline styling for visual consistency.

3. Verify
   - Run focused scheduler tests.
   - Run lint and frontend build.
   - Browser-smoke the publish-center panel.
