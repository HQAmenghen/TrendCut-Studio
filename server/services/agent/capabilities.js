const CAPABILITIES = [
  {
    name: 'health_check',
    endpoint: 'GET /api/agent/v1/health',
    risk: 'low',
    description: '检查本地控制台、运行依赖和 agent 接口是否可用。'
  },
  {
    name: 'list_capabilities',
    endpoint: 'GET /api/agent/v1/capabilities',
    risk: 'low',
    description: '列出 V0 agent 层暴露给智能体的工具能力。'
  },
  {
    name: 'search_posts',
    endpoint: 'POST /api/agent/v1/posts/search',
    risk: 'low',
    description: '从已有 xAI 榜单结果中筛选候选热点/推文素材。'
  },
  {
    name: 'list_hotspot_partitions',
    endpoint: 'GET /api/agent/v1/hotspots/partitions',
    risk: 'low',
    description: '列出可用热点榜单分区和账号池数量，适合“不知道有哪些分区”。'
  },
  {
    name: 'get_hotspot_refresh_status',
    endpoint: 'GET /api/agent/v1/hotspots/status',
    risk: 'low',
    description: '查询热点榜单刷新任务是否正在运行、当前阶段、最近结果更新时间和错误日志摘要。'
  },
  {
    name: 'refresh_hotspot_leaderboard',
    endpoint: 'POST /api/agent/v1/hotspots/refresh',
    risk: 'medium',
    description: '触发指定分区重新抓取/生成热点榜单，适合“刷新加密分区榜单”。'
  },
  {
    name: 'list_hotspot_leaderboard',
    endpoint: 'POST /api/agent/v1/posts/search',
    risk: 'low',
    description: '按分区查看本地热点榜单，适合“查看加密/金融/科技/AI 分区榜单”。'
  },
  {
    name: 'list_video_ready_posts',
    endpoint: 'POST /api/agent/v1/posts/search',
    risk: 'low',
    description: '列出已有视频链接、可直接用于素材驱动生成的热点内容。'
  },
  {
    name: 'find_post_by_rank',
    endpoint: 'POST /api/agent/v1/posts/search',
    risk: 'low',
    description: '按榜单排名定位某条热点，适合“选第 1 条/第 3 条”。'
  },
  {
    name: 'generate_video_from_post',
    endpoint: 'POST /api/agent/v1/videos/generate-from-post',
    risk: 'medium',
    description: '根据单条候选热点素材启动素材驱动视频生成。'
  },
  {
    name: 'generate_video_from_rank',
    endpoint: 'POST /api/agent/v1/videos/generate-from-post',
    risk: 'medium',
    description: '按分区榜单排名直接启动视频生成，仍只创建生成任务，不发布。'
  },
  {
    name: 'generate_narration_from_post',
    endpoint: 'POST /api/agent/v1/videos/generate-narration-from-post',
    risk: 'medium',
    description: '根据候选热点先生成口播稿，完成后停在人工确认点，不自动合成数字人。'
  },
  {
    name: 'generate_narration_from_rank',
    endpoint: 'POST /api/agent/v1/videos/generate-narration-from-post',
    risk: 'medium',
    description: '按榜单排名先生成口播稿，适合“先出稿我看看”。'
  },
  {
    name: 'list_vertical_jobs',
    endpoint: 'GET /api/agent/v1/vertical/jobs',
    risk: 'low',
    description: '列出竖屏合成队列任务、进度、失败摘要和生成结果。'
  },
  {
    name: 'get_vertical_job_status',
    endpoint: 'GET /api/agent/v1/vertical/jobs/:jobId',
    risk: 'low',
    description: '查询单个竖屏合成任务进行到哪一步，以及输出视频是否已生成。'
  },
  {
    name: 'list_material_tasks',
    endpoint: 'GET /api/agent/v1/material/tasks',
    risk: 'low',
    description: '列出 projects 下已完成、可导入竖屏/发布的素材驱动任务。'
  },
  {
    name: 'create_vertical_video_from_rank',
    endpoint: 'POST /api/agent/v1/vertical/from-post',
    risk: 'medium',
    description: '按热点榜单排名创建竖屏合成任务，适合“把加密榜第 1 条做成竖屏”。'
  },
  {
    name: 'create_vertical_video_from_post',
    endpoint: 'POST /api/agent/v1/vertical/from-post',
    risk: 'medium',
    description: '从 search_posts 返回的热点素材创建竖屏合成任务。'
  },
  {
    name: 'create_direct_vertical_video',
    endpoint: 'POST /api/agent/v1/vertical/direct',
    risk: 'medium',
    description: '直接把视频 URL 或本地视频文件做竖屏合成，不生成口播稿、不合成数字人，适合“直接接入竖屏”。'
  },
  {
    name: 'create_no_avatar_vertical_video',
    endpoint: 'POST /api/agent/v1/vertical/direct',
    risk: 'medium',
    description: '无数字人分支：只走原视频竖屏合成/字幕/标题渲染，完成后再预览、审核或创建发布草稿。'
  },
  {
    name: 'create_vertical_video_from_material_job',
    endpoint: 'POST /api/agent/v1/vertical/from-material-job',
    risk: 'medium',
    description: '从已有素材驱动任务导入 output_final.mp4 并绑定 sourceTaskDir/materialTaskDir，避免竖屏合成时丢失任务上下文。'
  },
  {
    name: 'get_job_status',
    endpoint: 'GET /api/agent/v1/jobs/:jobId',
    risk: 'low',
    description: '查询由 agent 发起或现有工作流产生的视频任务状态。'
  },
  {
    name: 'get_workflow_next_actions',
    endpoint: 'GET /api/agent/v1/jobs/:jobId/next-actions',
    risk: 'low',
    description: '根据当前产物判断下一步可选动作，例如先看口播、生成数字人、剪辑出片或创建草稿。'
  },
  {
    name: 'get_narration_draft',
    endpoint: 'GET /api/agent/v1/jobs/:jobId/narration',
    risk: 'low',
    description: '查看当前口播稿和分段脚本，供用户提出修改建议。'
  },
  {
    name: 'revise_narration_draft',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/narration/revise',
    risk: 'medium',
    description: '保存用户修改后的口播稿，并清理数字人/成片等下游旧产物后重建口播结构。'
  },
  {
    name: 'generate_avatar_video',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/avatar/generate',
    risk: 'medium',
    description: '在口播稿确认后启动数字人合成；该步骤较慢，可单独查询进度。'
  },
  {
    name: 'update_avatar_render_config',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/avatar/config',
    risk: 'medium',
    description: '更新指定任务的数字人渲染配置，例如在 ComfyUI 与 RunningHub 之间切换。'
  },
  {
    name: 'generate_avatar_video_with_runninghub',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/avatar/generate',
    risk: 'medium',
    description: '强制使用 RunningHub 配置生成数字人，并把 renderProvider=runninghub 写入任务状态。'
  },
  {
    name: 'get_avatar_status',
    endpoint: 'GET /api/agent/v1/jobs/:jobId/avatar',
    risk: 'low',
    description: '查询数字人合成进度、RunningHub/ComfyUI 状态以及 aiman.mp4 是否就绪。'
  },
  {
    name: 'preview_avatar_video',
    endpoint: 'GET /api/agent/v1/jobs/:jobId/avatar/preview',
    risk: 'low',
    description: '返回数字人视频预览地址，便于先看数字人效果。'
  },
  {
    name: 'render_final_video',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/render-final',
    risk: 'medium',
    description: '数字人确认后执行剪辑、混剪和竖屏成片。'
  },
  {
    name: 'continue_workflow_one_click',
    endpoint: 'POST /api/agent/v1/jobs/:jobId/continue-one-click',
    risk: 'medium',
    description: '从当前检查点一步到位继续：生成数字人并剪辑出片，但仍不会发布。'
  },
  {
    name: 'summarize_job_status',
    endpoint: 'GET /api/agent/v1/jobs/:jobId',
    risk: 'low',
    description: '返回更适合自然语言展示的任务状态摘要。'
  },
  {
    name: 'preview_generated_video',
    endpoint: 'GET /api/agent/v1/jobs/:jobId',
    risk: 'low',
    description: '返回生成视频的预览路径/公开路径提示。'
  },
  {
    name: 'review_video',
    endpoint: 'POST /api/agent/v1/videos/:jobId/review',
    risk: 'medium',
    description: '对已生成的视频执行 AI 审核。'
  },
  {
    name: 'review_generated_video',
    endpoint: 'POST /api/agent/v1/videos/:jobId/review',
    risk: 'medium',
    description: '对生成任务对应成片执行审核，并返回审核结果。'
  },
  {
    name: 'list_review_history',
    endpoint: 'GET /api/agent/v1/reviews',
    risk: 'low',
    description: '列出 AI 审核历史记录、状态、评分和可修复建议摘要。'
  },
  {
    name: 'get_review_record',
    endpoint: 'GET /api/agent/v1/reviews/:reviewId',
    risk: 'low',
    description: '查询单条 AI 审核记录详情。'
  },
  {
    name: 'create_publish_draft',
    endpoint: 'POST /api/agent/v1/publish/draft',
    risk: 'medium',
    description: '为指定任务或素材创建发布草稿，不自动发布。'
  },
  {
    name: 'list_publish_assets',
    endpoint: 'GET /api/agent/v1/publish/assets',
    risk: 'low',
    description: '列出当前可用于创建发布草稿的视频素材。'
  },
  {
    name: 'list_publish_drafts',
    endpoint: 'GET /api/agent/v1/publish/drafts',
    risk: 'low',
    description: '列出已创建的发布草稿和发布任务状态。'
  },
  {
    name: 'get_publish_schedule_summary',
    endpoint: 'GET /api/agent/v1/publish/schedule',
    risk: 'low',
    description: '统计前端 UI 或 agent 创建的发布任务数量、定时任务数量、到期数量和各状态分布。'
  },
  {
    name: 'list_scheduled_publish_tasks',
    endpoint: 'GET /api/agent/v1/publish/scheduled',
    risk: 'low',
    description: '列出当前定时发布任务，包括 scheduledAt、平台、账号和平台任务状态。'
  },
  {
    name: 'get_publish_task_status',
    endpoint: 'GET /api/agent/v1/publish/tasks/:publishJobId',
    risk: 'low',
    description: '查询单个发布任务/定时任务的详细状态和平台执行结果。'
  },
  {
    name: 'get_publish_account_dashboard',
    endpoint: 'GET /api/agent/v1/publish/accounts/dashboard',
    risk: 'low',
    description: '查询发布账号看板，包括账号数量、登录状态、近 7 天成功/失败和运行中任务。'
  },
  {
    name: 'list_publish_account_jobs',
    endpoint: 'GET /api/agent/v1/publish/accounts/:accountId/jobs',
    risk: 'low',
    description: '按账号查询发布任务列表，可筛选平台和状态。'
  },
  {
    name: 'list_publish_account_failures',
    endpoint: 'GET /api/agent/v1/publish/accounts/:accountId/failures',
    risk: 'low',
    description: '按账号查询失败发布任务，用于排查某个微信/平台账号发布失败。'
  },
  {
    name: 'list_login_statuses',
    endpoint: 'GET /api/agent/v1/login-statuses',
    risk: 'low',
    description: '只读列出账号登录状态缓存，不触发登录检测、不清缓存。'
  },
  {
    name: 'get_login_status',
    endpoint: 'GET /api/agent/v1/login-statuses/:accountId',
    risk: 'low',
    description: '只读查询单个账号登录状态缓存。'
  },
  {
    name: 'get_login_qrcode',
    endpoint: 'POST /api/agent/v1/login-statuses/:accountId/qrcode',
    risk: 'medium',
    description: '刷新并返回指定账号的登录二维码截图，供用户扫码登录；不发布内容、不发送飞书通知。'
  },
  {
    name: 'create_wechat_publish_draft',
    endpoint: 'POST /api/agent/v1/publish/draft',
    risk: 'medium',
    description: '为视频号创建发布草稿，不自动发布。'
  },
  {
    name: 'create_multi_platform_publish_draft',
    endpoint: 'POST /api/agent/v1/publish/draft',
    risk: 'medium',
    description: '为指定平台创建发布草稿，不自动发布。'
  },
  {
    name: 'confirm_publish',
    endpoint: 'POST /api/agent/v1/publish/confirm',
    risk: 'high',
    description: '受控确认发布。V0 默认要求显式确认，不能由一句自然语言直接发布。'
  }
];

function listCapabilities() {
  return CAPABILITIES.map((capability) => ({ ...capability }));
}

module.exports = {
  listCapabilities
};
