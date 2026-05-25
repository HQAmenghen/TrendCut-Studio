---
name: video-assistant-agent
description: Use local video assistant MCP tools for Comfy Panel workflows. Use when the user asks about local hotspot/加密分区榜单, material-driven video jobs, narration/avatar/final render checkpoints, vertical/竖屏合成, WeChat/video publish drafts, scheduled publish tasks, or frontend-created publish queue status.
---

# Video Assistant Agent

## Overview

This project has a local Agent API exposed through MCP. Prefer the MCP tools over web search, browser search, direct internal `/api/*` calls, or hand-built filesystem paths.

## Tool Rules

- For “加密分区榜单”, “当前热点榜单”, “crypto 榜单”, use `list_hotspot_leaderboard` or `search_posts`. Do not search Google/Bing.
- For “刷新榜单”, use `refresh_hotspot_leaderboard`, then `get_hotspot_refresh_status`.
- For “先出稿/看看口播稿”, use `generate_narration_from_rank` or `generate_narration_from_post`, then `get_narration_draft`.
- For “不加数字人/直接竖屏/原视频转竖屏/只做竖屏合成”, use `create_direct_vertical_video` or `create_no_avatar_vertical_video`. This branch does not generate narration or digital human output.
- For “把这个素材任务做竖屏/按任务导入竖屏”, use `create_vertical_video_from_material_job` when a material jobId/outputPath exists. This tool passes `sourceTaskDir` and `materialTaskDir` so reference subtitles and task context are imported correctly.
- For “把榜单第 N 条做成竖屏”, use `create_vertical_video_from_rank`; for a selected post object, use `create_vertical_video_from_post`.
- For checking vertical progress, use `list_vertical_jobs` or `get_vertical_job_status`.
- For digital human work, use `generate_avatar_video`, `generate_avatar_video_with_runninghub`, `get_avatar_status`, and `preview_avatar_video`. Do not edit task JSON by hand unless the tool reports that the service is unavailable.
- For final editing from a material-driven job after avatar is ready, use `render_final_video`.
- For publish tasks created in the frontend UI, use `get_publish_schedule_summary`, `list_scheduled_publish_tasks`, or `get_publish_task_status`.
- For “给我登录二维码/扫码登录/账号二维码截图”, use `get_login_qrcode` with the account id. If the user did not provide an account id, first use `list_login_statuses` or `get_publish_account_dashboard`.
- For publishing, create drafts first. Do not call `confirm_publish` unless the user explicitly confirms and the server allows real publish.

## Branch Map

Use this map before choosing a tool:

1. Local system health and capability discovery
   - `health_check`
   - `list_capabilities`

2. Hotspot leaderboard and source selection
   - `list_hotspot_partitions`
   - `get_hotspot_refresh_status`
   - `refresh_hotspot_leaderboard`
   - `list_hotspot_leaderboard`
   - `search_posts`
   - `list_video_ready_posts`
   - `find_post_by_rank`

3. Material-driven workflow with narration and optional digital human
   - One-click from post/rank: `generate_video_from_post`, `generate_video_from_rank`
   - Narration-first from post/rank: `generate_narration_from_post`, `generate_narration_from_rank`
   - Status and next choices: `get_job_status`, `summarize_job_status`, `get_workflow_next_actions`
   - Script review/edit: `get_narration_draft`, `revise_narration_draft`
   - Avatar config/generation: `update_avatar_render_config`, `generate_avatar_video`, `generate_avatar_video_with_runninghub`
   - Avatar status/preview: `get_avatar_status`, `preview_avatar_video`
   - Avatar-ready final output: `render_final_video`, `continue_workflow_one_click`
   - Final preview/review: `preview_generated_video`, `review_video`, `review_generated_video`

4. Direct vertical branch without digital human
   - Discover importable material tasks first: `list_material_tasks`
   - From direct video URL or local video path: `create_direct_vertical_video`
   - Explicit no-avatar wording: `create_no_avatar_vertical_video`
   - From existing material job output without new avatar: `create_vertical_video_from_material_job`
   - From local leaderboard: `create_vertical_video_from_rank`, `create_vertical_video_from_post`
   - Status: `list_vertical_jobs`, `get_vertical_job_status`

5. Publish assets, drafts, and scheduled frontend tasks
   - Available videos: `list_publish_assets`
   - Drafts/jobs: `list_publish_drafts`
   - WeChat draft: `create_wechat_publish_draft`
   - Multi-platform draft: `create_multi_platform_publish_draft`
   - Generic draft: `create_publish_draft`
   - Schedule summary: `get_publish_schedule_summary`
   - Scheduled task list: `list_scheduled_publish_tasks`
   - One publish task detail: `get_publish_task_status`
   - Account dashboard: `get_publish_account_dashboard`
   - Account-specific jobs/failures: `list_publish_account_jobs`, `list_publish_account_failures`
   - Real publish gate: `confirm_publish`

6. Review and login observability
   - Review history/detail: `list_review_history`, `get_review_record`
   - Cached account login statuses: `list_login_statuses`, `get_login_status`
   - Login QR screenshot: `get_login_qrcode`
   - Do not clear login caches or trigger Feishu test notifications from natural language unless a future explicit tool exists with confirmation.

## Do Not Expose Directly

These internal endpoints are intentionally not part of this skill/MCP surface:

- Config write endpoints (`postConfig`, workflow/json/env writes) unless a narrow confirmed wrapper is added.
- Delete/clear endpoints for publish jobs, review records, login caches, or vertical jobs.
- Browser-opening content manager endpoints.
- Raw login check endpoints. Use `get_login_qrcode` for QR refresh/screenshots.
- Direct RPA start/retry/cancel endpoints for real publishing, except through the conservative draft/confirm gate.
- Raw upload/multipart standalone generation; prefer `create_direct_vertical_video` or `create_vertical_video_from_material_job`.

## Direct Vertical Examples

For “这个视频不加数字人，直接竖屏” with a URL:

```json
{
  "tool": "create_direct_vertical_video",
  "args": {
    "videoUrl": "https://example.com/source.mp4",
    "title": "标题",
    "summary": "素材说明"
  }
}
```

For a local file or WSL path:

```json
{
  "tool": "create_no_avatar_vertical_video",
  "args": {
    "videoPath": "C:/Users/PC/Desktop/comfy_panel_demo/data/uploads/source.mp4",
    "outputPath": "material_xxx"
  }
}
```

For an existing material task:

```json
{
  "tool": "create_vertical_video_from_material_job",
  "args": {
    "jobId": "material_job_xxx",
    "outputPath": "material_xxx",
    "sourceVideoFile": "output_final.mp4"
  }
}
```

## Natural Replies

Keep user-facing replies concise. Report outcomes and next choices, not hidden reasoning or raw tool traces. When a checkpoint completes, offer the natural next decision:

- After narration: ask whether to review/edit the script, generate avatar, or continue one-click.
- After avatar: ask whether to preview avatar or render the final vertical video.
- After final/vertical output: ask whether to review, preview, or create a publish draft.

## Path Handling

When the user gives a Windows path, WSL path, `file://` URL, or a path with spaces, pass it as `outputPath` to the MCP tool. Do not manually split paths on spaces. The Agent API normalizes common Windows/WSL forms and extracts the `material_*` task directory.
