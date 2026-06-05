import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { PublishApiProvider } from './publish-api.provider';
import { TaskApiProvider } from './task-api.provider';
import { WorkerApiProvider } from './worker-api.provider';
import { requireRole } from './bff-authz';

const CAPABILITIES = [
  { name: 'health_check', endpoint: 'GET /api/agent/v1/health', risk: 'low' },
  { name: 'list_capabilities', endpoint: 'GET /api/agent/v1/capabilities', risk: 'low' },
  { name: 'search_posts', endpoint: 'POST /api/agent/v1/posts/search', risk: 'low' },
  { name: 'refresh_hotspot_leaderboard', endpoint: 'POST /api/agent/v1/hotspots/refresh', risk: 'medium' },
  { name: 'generate_video_from_post', endpoint: 'POST /api/agent/v1/videos/generate-from-post', risk: 'medium' },
  { name: 'generate_narration_from_post', endpoint: 'POST /api/agent/v1/videos/generate-narration-from-post', risk: 'medium' },
  { name: 'create_direct_vertical_video', endpoint: 'POST /api/agent/v1/vertical/direct', risk: 'medium' },
  { name: 'review_video', endpoint: 'POST /api/agent/v1/videos/:jobId/review', risk: 'medium' },
  { name: 'create_publish_draft', endpoint: 'POST /api/agent/v1/publish/draft', risk: 'high' },
  { name: 'confirm_publish', endpoint: 'POST /api/agent/v1/publish/confirm', risk: 'high' }
];

@Controller('/api/agent/v1')
export class AgentCompatController {
  constructor(
    private readonly taskApi: TaskApiProvider,
    private readonly workerApi: WorkerApiProvider,
    private readonly publishApi: PublishApiProvider
  ) {}

  @Get('health')
  health(@Req() request: any) {
    requireRole(request.user, 'agent:read', 'agent:write');
    return { success: true, status: 'ok', runtime: 'bff-fastapi-agent-compat' };
  }

  @Get('capabilities')
  capabilities(@Req() request: any) {
    requireRole(request.user, 'agent:read', 'agent:write');
    return { success: true, capabilities: CAPABILITIES };
  }

  @Get('hotspots/partitions')
  listHotspotPartitions(@Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, partitions: [] };
  }

  @Get('hotspots/status')
  async getHotspotRefreshStatus(@Req() request: any) {
    requireRole(request.user, 'agent:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'xai_top10', limit: 20 });
    return { success: true, tasks, running: tasks.some((task) => ['created', 'queued', 'running', 'retrying'].includes(task.status)) };
  }

  @Post('hotspots/refresh')
  @HttpCode(200)
  async refreshHotspotLeaderboard(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('xai_top10', 'xai_worker', body, request.user.actor, 'agent.hotspots.refresh');
  }

  @Post('posts/search')
  @HttpCode(200)
  searchPosts(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, posts: [], query: body, source: 'bff-agent-compat' };
  }

  @Post('videos/generate-from-post')
  @HttpCode(200)
  async generateVideoFromPost(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('material_driven', 'material_driven_worker', body, request.user.actor, 'agent.video.generate_from_post', 'video');
  }

  @Post('videos/generate-narration-from-post')
  @HttpCode(200)
  async generateNarrationFromPost(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('script_generation', 'script_worker', body, request.user.actor, 'agent.video.generate_narration', 'ai');
  }

  @Get('vertical/jobs')
  async listVerticalJobs(@Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    const jobs = await this.taskApi.client.listTasks({ type: 'standalone_vertical', limit: this.limit(limit) });
    return { success: true, jobs };
  }

  @Post('vertical/from-post')
  @HttpCode(200)
  async createVerticalFromPost(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('standalone_vertical', 'render_worker', body, request.user.actor, 'agent.vertical.from_post', 'video');
  }

  @Post('vertical/direct')
  @HttpCode(200)
  async createVerticalDirect(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('standalone_vertical', 'render_worker', body, request.user.actor, 'agent.vertical.direct', 'video');
  }

  @Post('vertical/from-material-job')
  @HttpCode(200)
  async createVerticalFromMaterialJob(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('standalone_vertical', 'render_worker', body, request.user.actor, 'agent.vertical.from_material_job', 'video');
  }

  @Get('vertical/jobs/:jobId')
  async getVerticalJob(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, job: await this.taskApi.client.getTask(jobId) };
  }

  @Get('material/tasks')
  async listMaterialTasks(@Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'material_driven', limit: this.limit(limit) });
    return { success: true, tasks };
  }

  @Get('jobs/:jobId')
  async getJob(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, job: await this.taskApi.client.getTask(jobId) };
  }

  @Get('jobs/:jobId/next-actions')
  getWorkflowNextActions(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, jobId, nextActions: ['check_status', 'review_artifacts', 'retry_or_cancel_if_failed'] };
  }

  @Get('jobs/:jobId/narration')
  async getNarrationDraft(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    const task = await this.taskApi.client.getTask(jobId);
    return { success: true, jobId, narration: task.output?.narration || task.output?.script || null, task };
  }

  @Post('jobs/:jobId/narration/revise')
  @HttpCode(200)
  async reviseNarrationDraft(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('script_revision', 'script_worker', { ...body, source_task_id: jobId }, request.user.actor, 'agent.narration.revise', 'ai');
  }

  @Post('jobs/:jobId/avatar/config')
  @HttpCode(200)
  updateAvatarConfig(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return { success: true, jobId, config: body, status: 'accepted' };
  }

  @Post('jobs/:jobId/avatar/generate')
  @HttpCode(200)
  async generateAvatarVideo(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('avatar_generation', 'material_driven_worker', { ...body, source_task_id: jobId }, request.user.actor, 'agent.avatar.generate', 'video');
  }

  @Get('jobs/:jobId/avatar')
  getAvatarStatus(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, jobId, status: 'tracked_by_task_artifacts' };
  }

  @Get('jobs/:jobId/avatar/preview')
  previewAvatarVideo(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, jobId, preview: null };
  }

  @Post('jobs/:jobId/render-final')
  @HttpCode(200)
  async renderFinalVideo(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('render_final', 'render_worker', { ...body, source_task_id: jobId }, request.user.actor, 'agent.render_final', 'video');
  }

  @Post('jobs/:jobId/continue-one-click')
  @HttpCode(200)
  async continueWorkflowOneClick(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    const task = await this.taskApi.client.resumeTask(jobId);
    return { success: true, jobId, task, input: body };
  }

  @Post('videos/:jobId/review')
  @HttpCode(200)
  async reviewVideo(@Param('jobId') jobId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'agent:write');
    return this.enqueueTaskWorker('video_review', 'review_worker', { ...body, source_task_id: jobId }, request.user.actor, 'agent.video.review', 'ai');
  }

  @Get('reviews')
  async listReviewHistory(@Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    const reviews = await this.taskApi.client.listTasks({ type: 'video_review', limit: this.limit(limit) });
    return { success: true, reviews };
  }

  @Get('reviews/:reviewId')
  async getReviewRecord(@Param('reviewId') reviewId: string, @Req() request: any) {
    requireRole(request.user, 'agent:read');
    return { success: true, review: await this.taskApi.client.getTask(reviewId) };
  }

  @Get('publish/assets')
  listPublishAssets(@Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    return { success: true, assets: [] };
  }

  @Get('publish/drafts')
  async listPublishDrafts(@Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const drafts = await this.publishApi.client.listJobs({ limit: this.limit(limit), status: 'created' });
    return { success: true, drafts };
  }

  @Get('publish/schedule')
  async getPublishScheduleSummary(@Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const jobs = await this.publishApi.client.listJobs({ limit: 50 });
    return { success: true, jobs, total: jobs.length };
  }

  @Get('publish/scheduled')
  async listScheduledPublishTasks(@Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const jobs = await this.publishApi.client.listJobs({ limit: this.limit(limit), status: 'scheduled' });
    return { success: true, jobs };
  }

  @Get('publish/tasks/:publishJobId')
  async getPublishTaskStatus(@Param('publishJobId') publishJobId: string, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    return { success: true, job: await this.publishApi.client.getJob(publishJobId) };
  }

  @Get('publish/accounts/dashboard')
  async getPublishAccountDashboard(@Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const accounts = await this.publishApi.client.listAccounts();
    return { success: true, accounts };
  }

  @Get('publish/accounts/:accountId/jobs')
  async listPublishAccountJobs(@Param('accountId') accountId: string, @Query('limit') limit: string | undefined, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const jobs = await this.publishApi.client.listJobs({ limit: this.limit(limit) });
    return { success: true, accountId, jobs };
  }

  @Get('publish/accounts/:accountId/failures')
  listPublishAccountFailures(@Param('accountId') accountId: string, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    return { success: true, accountId, failures: [] };
  }

  @Post('publish/draft')
  @HttpCode(200)
  async createPublishDraft(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'publish:write', 'agent:write');
    const job = await this.publishApi.client.createJob({ ...body, requested_by: request.user.actor, source: 'agent_compat' });
    return { success: true, publishJobId: (job as any)?.id, job };
  }

  @Post('publish/confirm')
  @HttpCode(200)
  async confirmPublish(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'publish:confirm', 'publish:write', 'agent:write');
    const publishJobId = this.text(body.publishJobId || body.jobId || body.id);
    const confirmed = String(body.confirmation || '').toLowerCase().includes('confirm') || body.allowRealPublish === true;
    const job = await this.publishApi.client.confirmJob(publishJobId, { ...body, actor: request.user.actor, confirmed });
    return { success: true, publishJobId, job };
  }

  @Get('login-statuses')
  async listLoginStatuses(@Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const accounts = await this.publishApi.client.listAccounts();
    return { success: true, statuses: accounts };
  }

  @Get('login-statuses/:accountId')
  async getLoginStatus(@Param('accountId') accountId: string, @Req() request: any) {
    requireRole(request.user, 'publish:read', 'agent:read');
    const accounts = await this.publishApi.client.listAccounts();
    return { success: true, accountId, status: accounts.find((account: any) => account.id === accountId) || null };
  }

  @Post('login-statuses/:accountId/qrcode')
  @HttpCode(200)
  async getLoginQrCode(@Param('accountId') accountId: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'publish:write', 'agent:write');
    const platform = this.text(body.platform || 'wechat-channels');
    const result = await this.publishApi.client.checkLogin(platform, accountId, { ...body, actor: request.user.actor, request_qrcode: true });
    return { success: true, accountId, result };
  }

  private async enqueueTaskWorker(type: string, jobType: string, input: Record<string, unknown>, actor: string, compatRoute: string, queueName = 'default') {
    const task = await this.taskApi.client.createTask({
      type,
      status: 'queued',
      input,
      metadata: { created_by: actor, compat_route: compatRoute }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: jobType,
      queue_name: queueName,
      timeout_seconds: Number(input.timeout_seconds || 7200),
      payload: input,
      metadata: { created_by: actor, compat_route: compatRoute }
    });
    return { success: true, jobId: task.id, task, workerJob };
  }

  private limit(value: string | undefined): number {
    const parsed = Number(value || 50);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(parsed, 200);
  }

  private text(value: unknown): string {
    return String(value || '').trim();
  }
}
