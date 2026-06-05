import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Sse, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Observable } from 'rxjs';
import { FastApiClient } from './fastapi.client';
import { PublishApiProvider } from './publish-api.provider';
import { TaskApiProvider } from './task-api.provider';
import { TaskEventsService } from './task-events.service';
import { WorkerApiProvider } from './worker-api.provider';
import { requireRole } from './bff-authz';

@Controller('/api')
export class ApiCompatController {
  constructor(
    private readonly fastApi: FastApiClient,
    private readonly taskApi: TaskApiProvider,
    private readonly workerApi: WorkerApiProvider,
    private readonly publishApi: PublishApiProvider,
    private readonly taskEvents: TaskEventsService
  ) {}

  @Get('system/self-check')
  async selfCheck(@Req() request: any) {
    requireRole(request.user, 'worker:read', 'ai:read');
    const health = await this.fastApi.getInternalHealth();
    return { success: true, status: health.status, dependencies: health.dependencies || {}, runtime: 'bff-fastapi' };
  }

  @Get('presets')
  presets(@Req() request: any) {
    requireRole(request.user, 'worker:read', 'ai:read');
    return { audio: [], image: [], source: 'bff-compat' };
  }

  @Get('workflow-config')
  workflowConfig(@Req() request: any) {
    requireRole(request.user, 'worker:read', 'ai:read');
    return { success: true, config: {}, source: 'bff-compat' };
  }

  @Post('workflow-config')
  @HttpCode(200)
  saveWorkflowConfig(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return { success: true, config: body, source: 'bff-compat' };
  }

  @Sse('progress')
  progress(@Req() request: any): Observable<MessageEvent> {
    requireRole(request.user, 'worker:read', 'ai:read');
    return this.taskEvents.stream();
  }

  @Get('system/tasks')
  async systemTasks(@Req() request: any, @Query('limit') limit?: string) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ limit: this.limit(limit) });
    return { success: true, tasks };
  }

  @Delete('system/tasks/:id')
  async deleteSystemTask(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const task = await this.taskApi.client.cancelTask(id);
    return { success: true, task };
  }

  @Post('material-driven/start')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'material', maxCount: 1 },
    { name: 'audioFile', maxCount: 1 },
    { name: 'imageFile', maxCount: 1 }
  ]))
  async startMaterialDriven(@UploadedFiles() files: Record<string, any[]>, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const workspace = this.compatWorkspace('material-driven');
    const materialFile = files?.material?.[0];
    const materialPath = materialFile ? this.writeUpload(workspace, 'material.mp4', materialFile) : undefined;
    const sourcePost = {
      title: this.text(body.sourceTitle || body.title || body.postTitle),
      body: this.text(body.sourceBody || body.sourceSummary || body.summary || body.postText || body.text),
      postUrl: this.text(body.sourcePostUrl || body.postUrl),
      materialUrl: this.text(body.materialUrl)
    };
    const task = await this.taskApi.client.createTask({
      type: 'material_driven',
      status: 'queued',
      input: { sourcePost, workspace },
      metadata: { created_by: request.user.actor, compat_route: '/api/material-driven/start' }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: 'material_driven_worker',
      queue_name: 'video',
      timeout_seconds: Number(body.timeout_seconds || 7200),
      payload: {
        workdir: workspace,
        material_path: materialPath,
        material_url: this.text(body.materialUrl),
        source_post: sourcePost,
        manual_script: this.text(body.manualScript),
        use_smart_clip: String(body.useSmartClip || 'true') !== 'false',
        use_cache: String(body.useCache || 'true') !== 'false',
        allow_rule_fallback: true
      },
      metadata: { compat_route: '/api/material-driven/start' }
    });
    return { success: true, jobId: task.id, taskId: task.id, workerJobId: workerJob.id, status: 'queued', outputPath: workspace };
  }

  @Get('material-driven/status/:id')
  async materialStatus(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:read');
    const task = await this.taskApi.client.getTask(id);
    const artifacts = await this.taskApi.client.listArtifacts(id).catch(() => []);
    return { success: true, task: this.materialTaskView(task, artifacts), status: task.status };
  }

  @Get('material-driven/tasks/:id')
  async materialTask(@Param('id') id: string, @Req() request: any) {
    return this.materialStatus(id, request);
  }

  @Delete('material-driven/tasks/:id')
  async deleteMaterialTask(@Param('id') id: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const task = await this.taskApi.client.cancelTask(id);
    return { success: true, task };
  }

  @Sse('material-driven/progress/:id')
  materialProgress(@Req() request: any): Observable<MessageEvent> {
    requireRole(request.user, 'worker:read');
    return this.taskEvents.stream();
  }

  @Get('material-driven/active')
  async activeMaterialTasks(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'material_driven', limit: 50 });
    return { success: true, tasks: tasks.filter((task) => !['succeeded', 'failed', 'cancelled'].includes(task.status)).map((task) => this.materialTaskView(task)) };
  }

  @Get('material-driven/latest-completed')
  async latestMaterialTask(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'material_driven', status: 'succeeded', limit: 1 });
    return { success: true, task: tasks[0] ? this.materialTaskView(tasks[0]) : null };
  }

  @Post('material-driven/:action/:id')
  @HttpCode(200)
  async rerunMaterialAction(@Param('action') action: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const task = await this.taskApi.client.getTask(id);
    const payload = task.input || {};
    const workerJob = await this.workerApi.client.createJob({
      task_id: id,
      job_type: 'material_driven_worker',
      queue_name: 'video',
      timeout_seconds: Number(body.timeout_seconds || 7200),
      payload: {
        ...(payload as Record<string, unknown>),
        workdir: this.text((payload as Record<string, unknown>).workspace),
        start_from: action === 'rerender' ? 7 : action === 'rebuild' ? 5 : undefined,
        allow_rule_fallback: true
      },
      metadata: { compat_route: `/api/material-driven/${action}/${id}` }
    });
    return { success: true, jobId: id, taskId: id, workerJobId: workerJob.id, status: 'queued' };
  }

  @Post('material-driven/test-comfy')
  @HttpCode(200)
  testComfy(@Req() request: any) {
    requireRole(request.user, 'worker:read', 'worker:write');
    return { success: true, reachable: true, provider: 'deferred-to-worker-runtime', message: 'BFF compatibility endpoint is active' };
  }

  @Get('vertical/material-tasks')
  async verticalMaterialTasks(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'material_driven', limit: 100 });
    return { success: true, tasks: tasks.map((task) => this.materialTaskView(task)) };
  }

  @Get('vertical/standalone-tasks')
  async standaloneTasks(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'standalone_vertical', limit: 100 });
    return { success: true, tasks };
  }

  @Post('generate-vertical-standalone')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'video', maxCount: 1 }]))
  async generateStandalone(@UploadedFiles() files: Record<string, any[]>, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const workspace = this.compatWorkspace('standalone');
    const video = files?.video?.[0];
    const videoPath = video ? this.writeUpload(workspace, 'input.mp4', video) : this.text(body.videoPath || body.sourceVideoPath);
    const task = await this.taskApi.client.createTask({
      type: 'standalone_vertical',
      status: 'queued',
      input: { workspace, videoPath },
      metadata: { created_by: request.user.actor, compat_route: '/api/generate-vertical-standalone' }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: 'render_worker',
      queue_name: 'video',
      timeout_seconds: Number(body.timeout_seconds || 3600),
      payload: {
        workdir: workspace,
        input_video: videoPath,
        content: { title: this.text(body.title || body.sourceTaskTitle || 'TrendCut') },
        subtitles: this.parseJson(body.subtitlesPayload, [])
      }
    });
    return { success: true, taskId: task.id, jobId: task.id, workerJobId: workerJob.id, status: 'queued' };
  }

  @Get('xai-top10/status')
  xaiStatus(@Req() request: any) {
    requireRole(request.user, 'ai:read', 'worker:read');
    return { success: true, status: { running: false, stage: 'idle', runtime: 'bff-fastapi-worker' } };
  }

  @Get('xai-top10/result')
  xaiResult(@Req() request: any) {
    requireRole(request.user, 'ai:read', 'worker:read');
    return { success: false, result: null };
  }

  @Get('xai-top10/config')
  xaiConfig(@Req() request: any) {
    requireRole(request.user, 'ai:read');
    return { success: true, config: { partitions: [] } };
  }

  @Post('xai-top10/config')
  @HttpCode(200)
  saveXaiConfig(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'ai:write');
    return { success: true, config: body };
  }

  @Post('xai-top10/run')
  async runXai(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'ai:write', 'worker:write');
    const task = await this.taskApi.client.createTask({
      type: 'xai_top10',
      status: 'queued',
      input: { partitionId: this.text(body.partitionId || 'crypto') },
      metadata: { created_by: request.user.actor, compat_route: '/api/xai-top10/run' }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: 'xai_worker',
      queue_name: 'ai',
      timeout_seconds: Number(body.timeout_seconds || 3600),
      payload: { partitionId: this.text(body.partitionId || 'crypto') }
    });
    return { success: true, taskId: task.id, workerJobId: workerJob.id, status: { running: true, stage: 'queued' } };
  }

  @Post('xai-top10/import-url')
  async importXaiUrl(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'ai:write', 'worker:write');
    const task = await this.taskApi.client.createTask({
      type: 'xai_import',
      status: 'queued',
      input: { url: this.text(body.url), partitionId: this.text(body.partitionId || 'crypto') },
      metadata: { created_by: request.user.actor, compat_route: '/api/xai-top10/import-url' }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: 'xai_worker',
      queue_name: 'ai',
      timeout_seconds: Number(body.timeout_seconds || 3600),
      payload: { url: this.text(body.url), partitionId: this.text(body.partitionId || 'crypto') }
    });
    return { success: true, taskId: task.id, workerJobId: workerJob.id, item: null };
  }

  @Get('xai-top10/vertical-jobs')
  async xaiVerticalJobs(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'standalone_vertical', limit: 100 });
    return { success: true, status: { jobs: tasks } };
  }

  @Post('xai-top10/vertical-jobs')
  async queueXaiVerticalJobs(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const items = Array.isArray(body.items) ? body.items : [];
    const jobs = [];
    for (const item of items) {
      const record = this.asRecord(item);
      const task = await this.taskApi.client.createTask({
        type: 'standalone_vertical',
        status: 'queued',
        input: record,
        metadata: { created_by: request.user.actor, compat_route: '/api/xai-top10/vertical-jobs' }
      });
      jobs.push(task);
    }
    return { success: true, status: { jobs } };
  }

  @Delete('xai-top10/vertical-jobs/:jobId')
  @Post('xai-top10/vertical-jobs/:jobId/cancel')
  async cancelXaiVerticalJob(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const task = await this.taskApi.client.cancelTask(jobId);
    return { success: true, task };
  }

  @Get('review/config')
  reviewConfig(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    return { success: true, config: { min_pass_score: 60, runtime: 'worker' } };
  }

  @Post('review/config')
  @HttpCode(200)
  saveReviewConfig(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write', 'ai:write');
    return { success: true, config: body, source: 'bff-compat' };
  }

  @Get('review/history')
  async reviewHistory(@Req() request: any, @Query('limit') limit?: string) {
    requireRole(request.user, 'worker:read');
    const tasks = await this.taskApi.client.listTasks({ type: 'video_review', limit: this.limit(limit) });
    return { success: true, records: tasks, total: tasks.length };
  }

  @Post('review/video')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'video', maxCount: 1 }]))
  async reviewVideo(@UploadedFiles() files: Record<string, any[]>, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const workspace = this.compatWorkspace('review');
    const video = files?.video?.[0];
    const videoPath = video ? this.writeUpload(workspace, 'video.mp4', video) : this.text(body.videoPath || body.video);
    const metadata = this.parseJson(body.metadata, this.asRecord(body));
    const task = await this.taskApi.client.createTask({
      type: 'video_review',
      status: 'queued',
      input: { workspace, videoPath, metadata },
      metadata: { created_by: request.user.actor, compat_route: '/api/review/video' }
    });
    const workerJob = await this.workerApi.client.createJob({
      task_id: task.id,
      job_type: 'review_worker',
      queue_name: 'video',
      timeout_seconds: Number(body.timeout_seconds || 3600),
      payload: { workdir: workspace, video_path: videoPath, metadata }
    });
    return { success: true, reviewId: task.id, taskId: task.id, workerJobId: workerJob.id, status: 'queued' };
  }

  @Post('review/skip')
  @HttpCode(200)
  reviewSkip(@Req() request: any) {
    requireRole(request.user, 'worker:write');
    return { success: true, skipped: true };
  }

  @Get('review/:reviewId')
  async reviewRecord(@Param('reviewId') reviewId: string, @Req() request: any) {
    requireRole(request.user, 'worker:read');
    const task = await this.taskApi.client.getTask(reviewId);
    return { success: true, review: task };
  }

  @Get('publish/jobs')
  async publishJobs(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    return this.publishApi.client.listJobs({ limit: 100 });
  }

  @Post('publish/jobs')
  async createPublishJob(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.publishApi.client.createJob(this.publishPayload(body));
  }

  @Delete('publish/jobs')
  @Post('publish/jobs/archive-completed')
  async noopPublishBulk(@Req() request: any) {
    requireRole(request.user, 'worker:write');
    return { success: true, affected: 0 };
  }

  @Delete('publish/jobs/:jobId')
  async deletePublishJob(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.publishApi.client.cancelJob(jobId, { actor: request.user.actor, reason: 'compat delete' });
  }

  @Post('publish/jobs/:jobId/platforms/:platform/start')
  @Post('publish/jobs/:jobId/platforms/:platform/retry')
  async startPublishPlatform(@Param('jobId') jobId: string, @Param('platform') platform: string, @Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    await this.publishApi.client.confirmJob(jobId, { actor: request.user.actor, reason: 'compat platform start' }).catch(() => null);
    return this.publishApi.client.dispatchJob(jobId, { actor: request.user.actor, mode: this.text(body.mode || 'draft'), job_type: 'publish_worker', platform });
  }

  @Post('publish/jobs/:jobId/platforms/:platform/cancel')
  async cancelPublishPlatform(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.publishApi.client.cancelJob(jobId, { actor: request.user.actor, reason: 'compat platform cancel' });
  }

  @Post('publish/jobs/:jobId/archive')
  @Post('publish/jobs/:jobId/unarchive')
  @Post('publish/jobs/:jobId/regenerate-description')
  async noopPublishJobAction(@Param('jobId') jobId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const job = await this.publishApi.client.getJob(jobId);
    return { success: true, job };
  }

  @Post('publish/jobs/wechat-channels/start-all')
  async startAllWechat(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const jobs = await this.publishApi.client.listJobs({ platform: 'wechatChannels', limit: 100 });
    return { success: true, mode: this.text(body.mode || 'draft'), jobs };
  }

  @Get('publish/assets')
  publishAssets(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    return { success: true, assets: [] };
  }

  @Delete('publish/assets/:assetId')
  deletePublishAsset(@Param('assetId') assetId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return { success: true, assetId };
  }

  @Get('publish/config')
  publishConfig(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    return { success: true, config: { platforms: [], pipelineMode: 'vertical' } };
  }

  @Post('publish/config')
  savePublishConfig(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return { success: true, config: body };
  }

  @Post('publish/description')
  generatePublishDescription(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'ai:write', 'worker:write');
    const title = this.text(body.title || body.sourceTitle);
    const description = this.text(body.description || body.summary || body.text || title);
    return { success: true, title, description, tags: [], runtime: 'bff-compat' };
  }

  @Get('publish/accounts')
  async publishAccounts(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    return this.publishApi.client.listAccounts();
  }

  @Get('login-status/all')
  async loginStatusAll(@Req() request: any) {
    requireRole(request.user, 'worker:read');
    const accounts = await this.publishApi.client.listAccounts();
    return { success: true, accounts };
  }

  @Post('login-status/check-batch')
  async loginStatusBatch(@Body() body: Record<string, unknown>, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds : [];
    return { success: true, results: accountIds.map((accountId) => ({ accountId, status: 'queued' })) };
  }

  @Post('publish/platforms/:platform/accounts/:accountId/test-login')
  @Post('login-status/check/:accountId')
  @Post('publish/wechat/test-login/:accountId')
  @Post('publish/wechat/content-manager/:accountId')
  @Post('publish/platforms/:platform/accounts/:accountId/content-manager')
  async loginCheck(@Param('platform') platform: string, @Param('accountId') accountId: string, @Req() request: any) {
    requireRole(request.user, 'worker:write');
    return this.publishApi.client.checkLogin(platform || 'wechatChannels', accountId, { actor: request.user.actor });
  }

  private materialTaskView(task: any, artifacts: unknown[] = []) {
    return {
      ...task,
      id: task.id,
      jobId: task.id,
      outputPath: task.input?.workspace || task.output?.output_dir || '',
      videoUrl: task.output?.output_video || '',
      logs: [],
      artifacts
    };
  }

  private publishPayload(body: Record<string, unknown>) {
    return {
      platform: this.text(body.platform || body.platformKey || 'wechatChannels'),
      account_id: this.text(body.account_id || body.accountId || 'default'),
      account_label: this.text(body.account_label || body.accountLabel),
      mode: this.text(body.mode || 'draft'),
      asset: this.asRecord(body.asset),
      publish_data: this.asRecord(body.publish_data || body.publishData || body),
      metadata: { compat_route: '/api/publish/jobs' }
    };
  }

  private compatWorkspace(prefix: string) {
    const root = join(process.cwd(), 'data', 'bff-compat', prefix);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    const target = join(root, randomUUID());
    mkdirSync(target, { recursive: true });
    return target;
  }

  private writeUpload(workspace: string, filename: string, file: any) {
    const target = join(workspace, filename);
    writeFileSync(target, file.buffer);
    return target;
  }

  private text(value: unknown) {
    return String(value || '').trim();
  }

  private limit(value: unknown) {
    const parsed = Number(value || 50);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private parseJson(value: unknown, fallback: unknown) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
}
