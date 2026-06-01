const fs = require('fs');
const path = require('path');

const { listCapabilities } = require('./capabilities');
const { createPublishAgentHandlers } = require('./publishHandlers');
const {
  ACTIVE_VERTICAL_STATUSES,
  DEFAULT_LIMIT,
  DOWNSTREAM_ARTIFACTS_AFTER_NARRATION,
  GENERATION_IDEMPOTENCY_TTL_MS,
  MATERIAL_JOB_DIR_PATTERN,
  MAX_LIMIT,
  PUBLISH_CONFIRMATION_PHRASE,
  createHttpError,
  isInsideDir,
  normalizeAgentError,
  normalizeLocalPathCandidate,
  normalizeMaterialOutputReference,
  normalizePartitionId,
  normalizePost,
  normalizeText,
  pickString,
  postMatchesQuery,
  resolveAgentLocalVideoPath,
  stableHash
} = require('./helpers');
const {
  buildAgentJobPayload,
  buildProjectFileInfo,
  buildWorkflowNextActions,
  createMemoryResponse,
  extractNarrationText,
  getJobTask,
  normalizeAvatarConfigPayload,
  normalizePublishJobSummary,
  normalizeVerticalJob,
  readJsonSafeFile,
  readProjectJson,
  readVerticalJobArtifacts,
  resolveJobOutputInfo,
  summarizeMaterialTask,
  summarizeReviewRecord,
  toReviewVideoPathFromJobStatus
} = require('./summaries');

function createAgentHandlers(deps) {
  const {
    sendError,
    paths,
    selfCheckService,
    xaiService,
    materialDrivenStarter,
    reviewHandlers,
    verticalQueueService,
    taskStore,
    publishStore,
    loginStatusService,
    accountDashboardService,
    publishAssetsService,
    generatePublishDescription,
    buildPublishTask,
    buildShortTitle,
    resetPublishAssetsCache,
    startWechatRpa,
    startPlatformRpa
  } = deps;

  const generationRequests = new Map();

  function sendNormalizedError(res, err, fallback) {
    const normalized = normalizeAgentError(err, fallback);
    return sendError(res, normalized);
  }

  function cleanupGenerationRequests(now = Date.now()) {
    for (const [key, entry] of generationRequests.entries()) {
      if (!entry || now - Number(entry.createdAt || 0) > GENERATION_IDEMPOTENCY_TTL_MS) {
        generationRequests.delete(key);
      }
    }
  }

  function getSelfCheckReport() {
    return typeof selfCheckService?.run === 'function' ? selfCheckService.run() : null;
  }

  function readSearchResult(partitionId = '') {
    if (!xaiService || typeof xaiService.ensureTranslatedResult !== 'function') {
      throw createHttpError(500, 'AGENT_XAI_UNAVAILABLE', 'agent.posts.search', 'xAI 服务未初始化');
    }
    try {
      return xaiService.ensureTranslatedResult(partitionId);
    } catch (err) {
      throw createHttpError(
        404,
        'AGENT_POSTS_RESULT_NOT_FOUND',
        'agent.posts.search',
        '未找到可搜索的热点结果',
        err.message,
        '请先在控制台运行一次 xAI Top10 榜单任务，或确认分区参数正确'
      );
    }
  }

  function getHotspotStatusPayload(partitionId = '') {
    if (!xaiService || typeof xaiService.getStatus !== 'function') {
      throw createHttpError(500, 'AGENT_XAI_STATUS_UNAVAILABLE', 'agent.hotspots.status', '榜单状态服务未初始化');
    }
    return xaiService.getStatus(normalizePartitionId(partitionId));
  }

  function findPostByReference(reference = {}) {
    const partitionId = pickString(reference.partitionId, reference.sourcePartitionId, reference.partition?.id);
    const result = readSearchResult(partitionId);
    const posts = (Array.isArray(result.items) ? result.items : [])
      .map((item) => normalizePost(item, {
        partition: result.partition,
        partitionId,
        partitionLabel: result.partition?.label
      }));
    const postId = pickString(reference.postId, reference.post_id);
    const postUrl = pickString(reference.postUrl, reference.post_url);
    const videoUrl = pickString(reference.videoUrl, reference.video_url);
    const id = pickString(reference.id, reference.agentPostId);
    const rank = Number(reference.rank || 0) || 0;

    return posts.find((post) => {
      if (id && post.id === id) return true;
      if (postId && post.postId === postId) return true;
      if (postUrl && post.postUrl === postUrl) return true;
      if (videoUrl && post.videoUrl === videoUrl) return true;
      if (rank && post.rank === rank) return true;
      return false;
    }) || null;
  }

  function createReviewRequestResponse(resolve, reject) {
    return {
      statusCode: 200,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(payload) {
        if (this.statusCode >= 400 || payload?.success === false) {
          reject(createHttpError(
            this.statusCode,
            payload?.code || 'AGENT_REVIEW_FAILED',
            payload?.stage || 'agent.video.review',
            payload?.error || '审核失败',
            payload?.details || '',
            payload?.hint || ''
          ));
          return this;
        }
        resolve(payload);
        return this;
      }
    };
  }

  async function startVideoFromPost(req, res, options = {}) {
    cleanupGenerationRequests();
    const mode = options.mode || req.body?.mode || 'material-driven';
    const forceAutoGenerate = options.autoGenerate;
    try {
      const post = findPostByReference(req.body?.post || req.body || {});
      if (!post) {
        throw createHttpError(404, 'AGENT_POST_NOT_FOUND', 'agent.video.generate', '未找到匹配的热点内容', '', '请先调用 search_posts，并传入返回的 id/postId/postUrl/rank');
      }
      if (!post.videoUrl) {
        throw createHttpError(400, 'AGENT_POST_VIDEO_URL_MISSING', 'agent.video.generate', '该热点内容缺少可下载的视频地址');
      }

      const autoGenerate = typeof forceAutoGenerate === 'boolean'
        ? forceAutoGenerate
        : req.body?.autoGenerate !== false;
      const idempotencyKey = pickString(req.body?.idempotencyKey, req.get?.('idempotency-key')) ||
        stableHash({
          postId: post.postId,
          postUrl: post.postUrl,
          videoUrl: post.videoUrl,
          mode,
          autoGenerate
        });
      const existing = generationRequests.get(idempotencyKey);
      if (existing) {
        return res.json({
          success: true,
          idempotent: true,
          message: '已存在相同生成请求，返回已有任务',
          job: buildAgentJobPayload(existing.jobId, existing.outputPath, {
            idempotencyKey,
            post,
            workflowMode: autoGenerate ? 'one_click' : 'narration_first'
          })
        });
      }

      const result = await materialDrivenStarter.start({
        videoUrl: post.videoUrl,
        title: post.title || post.summary,
        summary: post.summary,
        author: post.author,
        postId: post.postId,
        postUrl: post.postUrl,
        sourcePartitionId: post.partition?.id,
        sourcePartitionLabel: post.partition?.label,
        sourceRank: post.rank,
        avatarConfig: normalizeAvatarConfigPayload(req.body || {}),
        useSmartClip: req.body?.useSmartClip !== false,
        useCache: req.body?.useCache !== false,
        autoGenerate
      });
      generationRequests.set(idempotencyKey, {
        createdAt: Date.now(),
        jobId: result.jobId,
        outputPath: result.outputPath,
        post
      });
      res.json({
        success: true,
        message: options.message || (autoGenerate ? '视频生成任务已启动' : '口播稿生成任务已启动，完成后会等待你确认下一步'),
        job: buildAgentJobPayload(result.jobId, result.outputPath, {
          idempotencyKey,
          post,
          workflowMode: autoGenerate ? 'one_click' : 'narration_first',
          next: autoGenerate
            ? '可用 get_job_status 查询进度'
            : '口播完成后，用 get_narration_draft 查看稿件，再选择生成数字人或一步到位出片'
        })
      });
    } catch (err) {
      sendNormalizedError(res, err, {
        code: 'AGENT_VIDEO_GENERATE_FAILED',
        stage: 'agent.video.generate',
        error: options.error || '启动视频生成失败',
        hint: '请检查源视频地址、ComfyUI/RunningHub、Python 和 FFmpeg 配置'
      });
    }
  }

  async function refreshHotspotLeaderboard(req, res) {
    try {
      if (!xaiService || typeof xaiService.run !== 'function') {
        throw createHttpError(500, 'AGENT_XAI_RUN_UNAVAILABLE', 'agent.hotspots.refresh', '榜单刷新服务未初始化');
      }
      const partitionId = normalizePartitionId(req.body?.partitionId || req.body?.partition);
      const clientId = pickString(req.body?.clientId, `agent-${partitionId}-${Date.now()}`);
      const payload = await new Promise((resolve, reject) => {
        const upstreamRes = createMemoryResponse(resolve, reject);
        Promise.resolve(xaiService.run(clientId, upstreamRes, partitionId)).catch(reject);
      });
      res.json({
        success: true,
        message: '热点榜单已刷新',
        partitionId,
        clientId,
        result: payload.result || null,
        status: payload.status || getHotspotStatusPayload(partitionId)
      });
    } catch (err) {
      sendNormalizedError(res, err, {
        code: 'AGENT_HOTSPOTS_REFRESH_FAILED',
        stage: 'agent.hotspots.refresh',
        error: '刷新热点榜单失败',
        hint: '请确认该分区账号池不为空，且 XAI_API_KEY 可用；如果已有任务在跑，请稍后查询状态'
      });
    }
  }

  function listPersistedVerticalJobs(limit = 50) {
    if (!taskStore || typeof taskStore.listTasks !== 'function') return [];
    return taskStore.listTasks('vertical_queue', limit).map((task) => {
      const metadata = task.metadata || {};
      return {
        id: task.id,
        status: task.status,
        progress: task.progress,
        message: task.message || '',
        currentStage: metadata.currentStage || '',
        title: metadata.title || '',
        author: metadata.author || '',
        sourceType: metadata.sourceType || '',
        sourcePartitionId: metadata.sourcePartitionId || '',
        sourcePartitionLabel: metadata.sourcePartitionLabel || '',
        sourceRank: metadata.sourceRank || 0,
        sourceTaskDir: metadata.sourceTaskDir || '',
        materialTaskDir: metadata.materialTaskDir || '',
        videoUrl: metadata.videoUrl || '',
        renderOptions: metadata.renderOptions || {},
        logs: task.logs || [],
        createdAt: task.createdAt || '',
        updatedAt: task.updatedAt || '',
        startedAt: task.startedAt || '',
        completedAt: task.completedAt || ''
      };
    });
  }

  function getVerticalJobsSnapshot(limit = 50) {
    if (verticalQueueService && typeof verticalQueueService.getStatus === 'function') {
      const status = verticalQueueService.getStatus();
      return {
        concurrency: status.concurrency || 0,
        running: status.running || 0,
        queued: status.queued || 0,
        jobs: Array.isArray(status.jobs) ? status.jobs.slice(0, limit) : []
      };
    }
    return {
      concurrency: 0,
      running: 0,
      queued: 0,
      jobs: listPersistedVerticalJobs(limit)
    };
  }

  function findVerticalJob(jobId) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return null;
    if (verticalQueueService && typeof verticalQueueService.getJob === 'function') {
      const job = verticalQueueService.getJob(normalizedJobId);
      if (job) return job;
    }
    if (taskStore && typeof taskStore.getTask === 'function') {
      const task = taskStore.getTask(normalizedJobId);
      if (task && task.type === 'vertical_queue') {
        return listPersistedVerticalJobs(1).find((job) => job.id === normalizedJobId) || {
          id: task.id,
          status: task.status,
          progress: task.progress,
          message: task.message || '',
          logs: task.logs || [],
          ...(task.metadata || {}),
          createdAt: task.createdAt || '',
          updatedAt: task.updatedAt || '',
          startedAt: task.startedAt || '',
          completedAt: task.completedAt || ''
        };
      }
    }
    return null;
  }

  function buildVerticalItemFromPost(post, body = {}) {
    return {
      sourceType: 'agent_hotspot',
      author: post.author || '',
      postId: post.postId || '',
      postUrl: post.postUrl || '',
      sourcePartitionId: post.partition?.id || normalizePartitionId(body.partitionId || body.partition),
      sourcePartitionLabel: post.partition?.label || '',
      sourceRank: post.rank || 0,
      title: post.title || post.summary || '',
      summary: post.summary || '',
      videoUrl: post.videoUrl || '',
      renderOptions: body.renderOptions && typeof body.renderOptions === 'object' ? body.renderOptions : {}
    };
  }

  function buildDirectVerticalItem(body = {}) {
    const source = body.source && typeof body.source === 'object' ? body.source : {};
    const videoUrl = pickString(body.videoUrl, body.url, source.videoUrl, source.url);
    const localVideoPath = resolveAgentLocalVideoPath(
      body.videoPath || body.localVideoPath || body.originalVideoPath || source.videoPath || source.localVideoPath,
      paths
    );
    if (!videoUrl && !localVideoPath) {
      throw createHttpError(
        400,
        'AGENT_VERTICAL_SOURCE_MISSING',
        'agent.vertical.direct',
        '缺少直接竖屏合成的视频来源',
        '',
        '请传入 videoUrl，或传入项目目录内的 videoPath/localVideoPath'
      );
    }
    if (localVideoPath && !fs.existsSync(localVideoPath)) {
      throw createHttpError(
        404,
        'AGENT_VERTICAL_LOCAL_VIDEO_NOT_FOUND',
        'agent.vertical.direct',
        '本地视频文件不存在',
        localVideoPath,
        '请确认路径存在；Windows/WSL/file:// 路径可以原样传入'
      );
    }
    const sourceTaskDir = normalizeMaterialOutputReference(
      body.sourceTaskDir || body.materialTaskDir || body.outputPath || source.sourceTaskDir || source.materialTaskDir || '',
      paths
    );
    const renderOptions = {
      ...(body.renderOptions && typeof body.renderOptions === 'object' ? body.renderOptions : {})
    };
    if (localVideoPath) {
      renderOptions.originalVideoPath = localVideoPath;
    }
    if (sourceTaskDir) {
      renderOptions.sourceTaskDir = sourceTaskDir;
      renderOptions.materialTaskDir = sourceTaskDir;
    }
    return {
      sourceType: 'agent_direct_vertical',
      author: pickString(body.author, source.author),
      postId: pickString(body.postId, source.postId),
      postUrl: pickString(body.postUrl, source.postUrl),
      sourcePartitionId: pickString(body.partitionId, source.partitionId),
      sourcePartitionLabel: pickString(body.partitionLabel, source.partitionLabel),
      sourceRank: Number(body.rank || source.rank || 0) || 0,
      title: pickString(body.title, source.title, '直接竖屏合成'),
      summary: pickString(body.summary, source.summary),
      videoUrl: videoUrl || localVideoPath,
      sourceTaskDir,
      materialTaskDir: sourceTaskDir,
      referenceSubtitles: Array.isArray(body.referenceSubtitles) ? body.referenceSubtitles : [],
      renderOptions
    };
  }

  function buildVerticalItemFromMaterialJob(body = {}) {
    const jobId = String(body.jobId || body.materialJobId || '').trim();
    const requestedOutputPath = normalizeMaterialOutputReference(
      body.outputPath || body.outputDir || body.materialTaskDir || body.sourceTaskDir || body.taskDir || '',
      paths
    );
    const status = jobId ? resolveStatusOrThrow(jobId, requestedOutputPath, 'agent.vertical.from_material') : null;
    const task = getJobTask(status || {});
    const outputInfo = resolveJobOutputInfo(task, requestedOutputPath, paths);
    if (!outputInfo.outputDir || !outputInfo.outputPath) {
      throw createHttpError(
        404,
        'AGENT_VERTICAL_MATERIAL_DIR_NOT_FOUND',
        'agent.vertical.from_material',
        '未找到可导入的素材任务目录',
        '',
        '请传入素材生成任务的 jobId 和 outputPath，例如 material_xxx'
      );
    }

    const preferredFile = normalizeLocalPathCandidate(pickString(body.sourceVideoFile, body.videoFile, 'output_final.mp4'));
    const originalVideoPath = path.isAbsolute(preferredFile)
      ? path.resolve(preferredFile)
      : path.join(outputInfo.outputPath, preferredFile);
    if (!isInsideDir(originalVideoPath, outputInfo.outputPath)) {
      throw createHttpError(
        400,
        'AGENT_VERTICAL_SOURCE_VIDEO_OUTSIDE_TASK',
        'agent.vertical.from_material',
        '指定的视频文件不在素材任务目录内',
        originalVideoPath,
        '请传入任务目录内的视频文件名，例如 output_final.mp4'
      );
    }
    if (!fs.existsSync(originalVideoPath)) {
      throw createHttpError(
        404,
        'AGENT_VERTICAL_SOURCE_VIDEO_NOT_FOUND',
        'agent.vertical.from_material',
        '素材任务内没有可用于竖屏合成的视频文件',
        originalVideoPath,
        '请先完成数字人/成片生成，或指定 sourceVideoFile 为已存在的视频文件'
      );
    }

    const renderOptions = {
      ...(body.renderOptions && typeof body.renderOptions === 'object' ? body.renderOptions : {}),
      originalVideoPath,
      sourceTaskDir: outputInfo.outputDir,
      materialTaskDir: outputInfo.outputDir
    };
    return {
      sourceType: 'agent_material_job',
      author: pickString(task.sourcePost?.author, task.sourceMeta?.sourceAuthor, body.author),
      postId: pickString(task.sourcePost?.postId, task.sourceMeta?.sourcePostId, body.postId),
      postUrl: pickString(task.sourcePost?.postUrl, task.sourceMeta?.postUrl, body.postUrl),
      sourcePartitionId: pickString(task.sourceMeta?.sourcePartitionId, body.partitionId),
      sourcePartitionLabel: pickString(task.sourceMeta?.sourcePartitionLabel, body.partitionLabel),
      sourceRank: Number(task.sourceMeta?.sourceRank || body.rank || 0) || 0,
      title: pickString(body.title, task.sourcePost?.title, task.sourcePost?.body, '素材任务竖屏合成'),
      summary: pickString(body.summary, task.sourcePost?.body, task.sourcePost?.summary),
      videoUrl: pickString(task.videoUrl, task.sourceMeta?.videoUrl, body.videoUrl, originalVideoPath),
      sourceTaskDir: outputInfo.outputDir,
      materialTaskDir: outputInfo.outputDir,
      referenceSubtitles: Array.isArray(body.referenceSubtitles) ? body.referenceSubtitles : [],
      renderOptions
    };
  }

  function findExistingVerticalJob(predicate) {
    const snapshot = getVerticalJobsSnapshot(100);
    return (snapshot.jobs || []).find(predicate) || null;
  }

  function listMaterialTaskSummaries(query = {}) {
    const limit = Math.max(1, Math.min(100, Number(query.limit || 50) || 50));
    const tasks = [];
    if (paths.PROJECTS_DIR && fs.existsSync(paths.PROJECTS_DIR)) {
      const entries = fs.readdirSync(paths.PROJECTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && MATERIAL_JOB_DIR_PATTERN.test(entry.name));
      for (const entry of entries) {
        const taskPath = path.join(paths.PROJECTS_DIR, entry.name);
        const finalPath = path.join(taskPath, 'output_final.mp4');
        if (!fs.existsSync(finalPath)) continue;
        const sourcePost = readJsonSafeFile(path.join(taskPath, 'source_post.json'), {});
        const narration = readJsonSafeFile(path.join(taskPath, 'narration.json'), {});
        const subtitles = readJsonSafeFile(path.join(taskPath, 'aiman_subtitles.json'), null) ||
          readJsonSafeFile(path.join(taskPath, 'subtitles.json'), []);
        const scriptText = extractNarrationText(narration, null);
        const stat = fs.statSync(finalPath);
        tasks.push(summarizeMaterialTask({
          id: entry.name,
          outputDir: entry.name,
          title: pickString(sourcePost?.title, narration?.title, sourcePost?.body, entry.name),
          videoUrl: `/projects/${encodeURIComponent(entry.name)}/output_final.mp4`,
          updatedAt: stat.mtime.toISOString(),
          hasSubtitles: Array.isArray(subtitles) && subtitles.length > 0,
          subtitleSource: Array.isArray(subtitles) && subtitles.length > 0 ? 'aiman_subtitles.json/subtitles.json' : '',
          subtitleCount: Array.isArray(subtitles) ? subtitles.length : 0,
          sourcePostUrl: pickString(sourcePost?.postUrl, sourcePost?.url),
          scriptPreview: scriptText.slice(0, 120)
        }));
      }
    }
    const textQuery = normalizeText(query.query || '').toLowerCase();
    return tasks
      .filter((task) => {
        if (!textQuery) return true;
        const haystack = [
          task.id,
          task.outputDir,
          task.title,
          task.sourcePostUrl,
          task.scriptPreview
        ].map((value) => String(value || '')).join(' ').toLowerCase();
        return haystack.includes(textQuery);
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit);
  }

  async function callHandler(handler, req = {}) {
    if (typeof handler !== 'function') {
      throw createHttpError(500, 'AGENT_HANDLER_UNAVAILABLE', 'agent.upstream', '上游处理器未初始化');
    }
    return new Promise((resolve, reject) => {
      const upstreamRes = createMemoryResponse(resolve, reject);
      Promise.resolve(handler(req, upstreamRes)).catch(reject);
    });
  }

  function buildPublishSchedulePayload(query = {}) {
    if (!publishStore || typeof publishStore.readPublishJobs !== 'function') {
      throw createHttpError(500, 'AGENT_PUBLISH_JOBS_UNAVAILABLE', 'agent.publish.schedule', '发布任务服务未初始化');
    }
    const limit = Math.max(1, Math.min(100, Number(query.limit || 50) || 50));
    const includeArchived = query.includeArchived === true || query.includeArchived === 'true' || query.includeArchived === '1';
    const statusFilter = String(query.status || '').trim();
    const platformFilter = String(query.platform || '').trim();
    const scheduledOnly = query.scheduledOnly === true || query.scheduledOnly === 'true' || query.scheduledOnly === '1';
    const nowMs = Date.now();
    const payload = publishStore.readPublishJobs();
    const jobs = (payload.jobs || [])
      .map((job) => normalizePublishJobSummary(job, nowMs))
      .filter((job) => includeArchived || !job.archived)
      .filter((job) => !statusFilter || job.status === statusFilter)
      .filter((job) => !platformFilter || job.selectedPlatforms.includes(platformFilter) || job.platformTasks.some((task) => task.platform === platformFilter))
      .filter((job) => !scheduledOnly || job.scheduled)
      .slice(0, limit);
    const activeJobs = (payload.jobs || [])
      .map((job) => normalizePublishJobSummary(job, nowMs))
      .filter((job) => includeArchived || !job.archived);
    const byStatus = {};
    const byPlatform = {};
    for (const job of activeJobs) {
      byStatus[job.status || 'unknown'] = (byStatus[job.status || 'unknown'] || 0) + 1;
      for (const platform of job.selectedPlatforms || []) {
        byPlatform[platform] = (byPlatform[platform] || 0) + 1;
      }
    }
    const scheduledJobs = activeJobs.filter((job) => job.scheduled);
    return {
      success: true,
      generatedAt: new Date().toISOString(),
      summary: {
        total: activeJobs.length,
        scheduled: scheduledJobs.length,
        due: activeJobs.filter((job) => job.due).length,
        published: activeJobs.filter((job) => job.status === 'published').length,
        failed: activeJobs.filter((job) => job.status === 'failed').length,
        publishing: activeJobs.filter((job) => job.status === 'publishing').length,
        ready: activeJobs.filter((job) => ['ready', 'partial_ready', 'ready_for_manual_publish'].includes(job.status)).length,
        archived: (payload.jobs || []).filter((job) => job.archived).length,
        byStatus,
        byPlatform
      },
      total: jobs.length,
      jobs
    };
  }

  function resolveStatusOrThrow(jobId, outputPath, stage) {
    if (!jobId) {
      throw createHttpError(400, 'AGENT_JOB_ID_MISSING', stage, '缺少 jobId');
    }
    const status = materialDrivenStarter.getStatus(jobId, outputPath);
    if (!status) {
      throw createHttpError(404, 'AGENT_JOB_NOT_FOUND', stage, '任务不存在或无法恢复', '', '如果任务来自刷新前，请同时传入 outputPath');
    }
    return status;
  }

  function removeDownstreamArtifacts(task, outputPath) {
    const outputInfo = resolveJobOutputInfo(task, outputPath, paths);
    if (!outputInfo.outputPath) return [];
    const removed = [];
    for (const fileName of DOWNSTREAM_ARTIFACTS_AFTER_NARRATION) {
      const filePath = path.join(outputInfo.outputPath, fileName);
      if (!isInsideDir(filePath, outputInfo.projectsRoot)) continue;
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          removed.push(fileName);
        }
      } catch (_err) {}
    }
    return removed;
  }

  const publishAgentHandlers = createPublishAgentHandlers({
    paths,
    publishStore,
    loginStatusService,
    accountDashboardService,
    publishAssetsService,
    materialDrivenStarter,
    generatePublishDescription,
    buildPublishTask,
    buildShortTitle,
    resetPublishAssetsCache,
    startWechatRpa,
    startPlatformRpa,
    buildPublishSchedulePayload,
    sendNormalizedError
  });

  return {
    health: (_req, res) => {
      try {
        const report = getSelfCheckReport();
        res.json({
          success: true,
          service: 'trendcut-studio-agent-v1',
          status: report?.summary?.status || 'ok',
          generatedAt: new Date().toISOString(),
          agent: {
            tokenConfigured: Boolean(process.env.AGENT_API_TOKEN),
            publishRequiresConfirmation: true,
            defaultHost: process.env.HOST || '127.0.0.1'
          },
          selfCheck: report
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_HEALTH_FAILED',
          stage: 'agent.health',
          error: 'agent 健康检查失败'
        });
      }
    },

    capabilities: (_req, res) => {
      res.json({
        success: true,
        version: 'v1',
        capabilities: listCapabilities(),
        safety: {
          auth: 'AGENT_API_TOKEN',
          publish: 'draft_then_confirm',
          auditLog: 'data/logs/agent_audit.log'
        }
      });
    },

    searchPosts: (req, res) => {
      try {
        const partitionId = pickString(req.body?.partitionId, req.body?.partition);
        const query = normalizeText(req.body?.query || '');
        const requireVideo = req.body?.requireVideo !== false;
        const limit = Math.max(1, Math.min(MAX_LIMIT, Number(req.body?.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT));
        const result = readSearchResult(partitionId);
        const context = {
          partition: result.partition,
          partitionId,
          partitionLabel: result.partition?.label
        };
        const posts = (Array.isArray(result.items) ? result.items : [])
          .map((item) => normalizePost(item, context))
          .filter((post) => (!requireVideo || post.videoUrl) && postMatchesQuery(post, query))
          .slice(0, limit);

        res.json({
          success: true,
          query,
          partition: result.partition || null,
          total: posts.length,
          posts
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_POSTS_SEARCH_FAILED',
          stage: 'agent.posts.search',
          error: '搜索热点内容失败'
        });
      }
    },

    listHotspotPartitions: (_req, res) => {
      try {
        if (!xaiService || typeof xaiService.readConfig !== 'function') {
          throw createHttpError(500, 'AGENT_XAI_CONFIG_UNAVAILABLE', 'agent.hotspots.partitions', '榜单分区配置服务未初始化');
        }
        const config = xaiService.readConfig();
        res.json({
          success: true,
          activePartitionId: config.activePartitionId || '',
          partitions: (config.partitions || []).map((partition) => ({
            id: partition.id,
            label: partition.label,
            description: partition.description || '',
            accountCount: Array.isArray(partition.accounts) ? partition.accounts.length : 0
          }))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_HOTSPOT_PARTITIONS_FAILED',
          stage: 'agent.hotspots.partitions',
          error: '读取热点分区失败'
        });
      }
    },

    getHotspotRefreshStatus: (req, res) => {
      try {
        const partitionId = normalizePartitionId(req.query?.partitionId || req.query?.partition);
        res.json({
          success: true,
          partitionId,
          status: getHotspotStatusPayload(partitionId)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_HOTSPOTS_STATUS_FAILED',
          stage: 'agent.hotspots.status',
          error: '查询热点榜单状态失败'
        });
      }
    },

    refreshHotspotLeaderboard,

    generateVideoFromPost: (req, res) => startVideoFromPost(req, res),

    generateNarrationFromPost: (req, res) => startVideoFromPost(req, res, {
      autoGenerate: false,
      mode: 'narration-first',
      message: '口播稿生成任务已启动，完成后会等待你确认下一步',
      error: '启动口播稿生成失败'
    }),

    listVerticalJobs: (req, res) => {
      try {
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50) || 50));
        const statusFilter = String(req.query?.status || '').trim();
        const sourceType = String(req.query?.sourceType || '').trim();
        const materialTaskDir = normalizeMaterialOutputReference(req.query?.materialTaskDir || req.query?.outputPath || '', paths);
        const snapshot = getVerticalJobsSnapshot(limit);
        const jobs = (snapshot.jobs || [])
          .filter((job) => !statusFilter || String(job.status || '') === statusFilter)
          .filter((job) => !sourceType || String(job.sourceType || '') === sourceType)
          .filter((job) => !materialTaskDir || job.materialTaskDir === materialTaskDir || job.sourceTaskDir === materialTaskDir)
          .slice(0, limit)
          .map((job) => ({
            ...normalizeVerticalJob(job),
            artifacts: readVerticalJobArtifacts(job, paths)
          }));
        res.json({
          success: true,
          queue: {
            concurrency: snapshot.concurrency,
            running: snapshot.running,
            queued: snapshot.queued
          },
          total: jobs.length,
          jobs
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_VERTICAL_JOBS_FAILED',
          stage: 'agent.vertical.jobs',
          error: '查询竖屏合成任务失败'
        });
      }
    },

    listMaterialTasks: (req, res) => {
      try {
        const tasks = listMaterialTaskSummaries(req.query || {});
        res.json({
          success: true,
          total: tasks.length,
          tasks
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_MATERIAL_TASKS_FAILED',
          stage: 'agent.material.tasks',
          error: '查询素材任务失败'
        });
      }
    },

    getVerticalJob: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        if (!jobId) {
          throw createHttpError(400, 'AGENT_VERTICAL_JOB_ID_MISSING', 'agent.vertical.job', '缺少竖屏任务 ID');
        }
        const job = findVerticalJob(jobId);
        if (!job) {
          throw createHttpError(404, 'AGENT_VERTICAL_JOB_NOT_FOUND', 'agent.vertical.job', '竖屏任务不存在或已不在内存中');
        }
        res.json({
          success: true,
          job: {
            ...normalizeVerticalJob(job),
            artifacts: readVerticalJobArtifacts(job, paths)
          }
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_VERTICAL_JOB_FAILED',
          stage: 'agent.vertical.job',
          error: '查询竖屏任务失败'
        });
      }
    },

    createVerticalFromPost: (req, res) => {
      try {
        if (!verticalQueueService || typeof verticalQueueService.enqueue !== 'function') {
          throw createHttpError(500, 'AGENT_VERTICAL_QUEUE_UNAVAILABLE', 'agent.vertical.from_post', '竖屏队列服务未初始化');
        }
        const post = findPostByReference(req.body?.post || req.body || {});
        if (!post) {
          throw createHttpError(404, 'AGENT_POST_NOT_FOUND', 'agent.vertical.from_post', '未找到匹配的热点内容', '', '请先调用 search_posts，并传入返回的 id/postId/postUrl/rank');
        }
        if (!post.videoUrl) {
          throw createHttpError(400, 'AGENT_POST_VIDEO_URL_MISSING', 'agent.vertical.from_post', '该热点内容缺少可用于竖屏合成的视频地址');
        }
        const item = buildVerticalItemFromPost(post, req.body || {});
        const idempotencyKey = pickString(req.body?.idempotencyKey) || stableHash({
          type: 'vertical_from_post',
          postId: item.postId,
          postUrl: item.postUrl,
          videoUrl: item.videoUrl,
          renderOptions: item.renderOptions
        });
        const existing = req.body?.forceNew === true ? null : findExistingVerticalJob((job) => (
          ACTIVE_VERTICAL_STATUSES.has(String(job.status || '')) &&
          stableHash({
            type: 'vertical_from_post',
            postId: job.postId,
            postUrl: job.postUrl,
            videoUrl: job.videoUrl,
            renderOptions: job.renderOptions || {}
          }) === idempotencyKey
        ));
        if (existing) {
          return res.json({
            success: true,
            idempotent: true,
            message: '已存在相同竖屏合成任务，返回已有任务',
            job: normalizeVerticalJob(existing)
          });
        }
        const job = verticalQueueService.enqueue(item);
        res.json({
          success: true,
          message: '竖屏合成任务已加入队列',
          idempotencyKey,
          job: normalizeVerticalJob(job),
          next: '使用 get_vertical_job_status 查询竖屏合成进度'
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_VERTICAL_FROM_POST_FAILED',
          stage: 'agent.vertical.from_post',
          error: '创建热点竖屏合成任务失败'
        });
      }
    },

    createVerticalDirect: (req, res) => {
      try {
        if (!verticalQueueService || typeof verticalQueueService.enqueue !== 'function') {
          throw createHttpError(500, 'AGENT_VERTICAL_QUEUE_UNAVAILABLE', 'agent.vertical.direct', '竖屏队列服务未初始化');
        }
        const item = buildDirectVerticalItem(req.body || {});
        const idempotencyKey = pickString(req.body?.idempotencyKey) || stableHash({
          type: 'vertical_direct_no_avatar',
          videoUrl: item.videoUrl,
          originalVideoPath: item.renderOptions?.originalVideoPath || '',
          sourceTaskDir: item.sourceTaskDir || '',
          renderOptions: item.renderOptions
        });
        const existing = req.body?.forceNew === true ? null : findExistingVerticalJob((job) => (
          ACTIVE_VERTICAL_STATUSES.has(String(job.status || '')) &&
          job.sourceType === 'agent_direct_vertical' &&
          pickString(job.renderOptions?.originalVideoPath, job.videoUrl) === pickString(item.renderOptions?.originalVideoPath, item.videoUrl)
        ));
        if (existing) {
          return res.json({
            success: true,
            idempotent: true,
            message: '已存在相同直接竖屏合成任务，返回已有任务',
            job: normalizeVerticalJob(existing)
          });
        }
        const job = verticalQueueService.enqueue(item);
        res.json({
          success: true,
          message: '已创建直接竖屏合成任务：该分支不会生成口播稿或数字人，只做原视频竖屏合成/字幕/标题渲染。',
          idempotencyKey,
          source: {
            videoUrl: item.videoUrl,
            originalVideoPath: item.renderOptions?.originalVideoPath || '',
            sourceTaskDir: item.sourceTaskDir || ''
          },
          job: normalizeVerticalJob(job),
          next: '使用 get_vertical_job_status 查询进度；完成后可预览、审核或创建发布草稿。'
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_VERTICAL_DIRECT_FAILED',
          stage: 'agent.vertical.direct',
          error: '创建直接竖屏合成任务失败',
          hint: '请传入 videoUrl，或传入项目目录内存在的视频文件路径'
        });
      }
    },

    createVerticalFromMaterialJob: (req, res) => {
      try {
        if (!verticalQueueService || typeof verticalQueueService.enqueue !== 'function') {
          throw createHttpError(500, 'AGENT_VERTICAL_QUEUE_UNAVAILABLE', 'agent.vertical.from_material', '竖屏队列服务未初始化');
        }
        const item = buildVerticalItemFromMaterialJob(req.body || {});
        const idempotencyKey = pickString(req.body?.idempotencyKey) || stableHash({
          type: 'vertical_from_material',
          materialTaskDir: item.materialTaskDir,
          originalVideoPath: item.renderOptions?.originalVideoPath,
          renderOptions: item.renderOptions
        });
        const existing = req.body?.forceNew === true ? null : findExistingVerticalJob((job) => (
          ACTIVE_VERTICAL_STATUSES.has(String(job.status || '')) &&
          (job.materialTaskDir === item.materialTaskDir || job.sourceTaskDir === item.sourceTaskDir)
        ));
        if (existing) {
          return res.json({
            success: true,
            idempotent: true,
            message: '该素材任务已有竖屏合成任务在执行或排队，返回已有任务',
            job: normalizeVerticalJob(existing)
          });
        }
        const job = verticalQueueService.enqueue(item);
        res.json({
          success: true,
          message: '已按素材任务导入竖屏合成队列，并绑定 sourceTaskDir/materialTaskDir 供参考字幕导入。',
          idempotencyKey,
          source: {
            materialTaskDir: item.materialTaskDir,
            originalVideoPath: item.renderOptions?.originalVideoPath || ''
          },
          job: normalizeVerticalJob(job),
          next: '使用 get_vertical_job_status 查询竖屏合成进度；完成后可创建发布草稿。'
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_VERTICAL_FROM_MATERIAL_FAILED',
          stage: 'agent.vertical.from_material',
          error: '从素材任务创建竖屏合成失败',
          hint: '请确认传入了正确的 jobId/outputPath，且任务目录内存在 output_final.mp4'
        });
      }
    },

    getJob: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.query?.outputPath || '').trim();
        if (!jobId) {
          throw createHttpError(400, 'AGENT_JOB_ID_MISSING', 'agent.jobs.status', '缺少 jobId');
        }
        const status = materialDrivenStarter.getStatus(jobId, outputPath);
        if (!status) {
          throw createHttpError(404, 'AGENT_JOB_NOT_FOUND', 'agent.jobs.status', '任务不存在或无法恢复', '', '如果任务来自刷新前，请同时传入 outputPath');
        }
        res.json({
          success: true,
          job: status.task ? status.task : status
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_JOB_STATUS_FAILED',
          stage: 'agent.jobs.status',
          error: '查询任务状态失败'
        });
      }
    },

    getWorkflowNextActions: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.query?.outputPath || '').trim();
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.workflow.next');
        const task = getJobTask(status);
        res.json({
          success: true,
          jobId,
          outputPath: resolveJobOutputInfo(task, outputPath, paths).outputDir,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_WORKFLOW_NEXT_FAILED',
          stage: 'agent.workflow.next',
          error: '判断下一步失败'
        });
      }
    },

    getNarrationDraft: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.query?.outputPath || '').trim();
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.narration.get');
        const task = getJobTask(status);
        const narration = task.narration || readProjectJson(task, outputPath, paths, 'narration.json', null);
        const scriptUnits = task.scriptUnits || readProjectJson(task, outputPath, paths, 'script_units.json', null);
        const text = extractNarrationText(narration, scriptUnits);
        res.json({
          success: true,
          jobId,
          ready: Boolean(text),
          status: task.status || '',
          currentStep: task.currentStep || 0,
          progress: task.progress || 0,
          narration,
          scriptUnits,
          text,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_NARRATION_GET_FAILED',
          stage: 'agent.narration.get',
          error: '读取口播稿失败'
        });
      }
    },

    reviseNarrationDraft: async (req, res) => {
      try {
        if (typeof materialDrivenStarter.retryStep !== 'function') {
          throw createHttpError(500, 'AGENT_WORKFLOW_STEP_UNAVAILABLE', 'agent.narration.revise', '当前服务未暴露口播重建能力');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        const revisedText = String(req.body?.narrationText || req.body?.revisedText || req.body?.manualScript || '').trim();
        if (!revisedText) {
          throw createHttpError(400, 'AGENT_NARRATION_TEXT_MISSING', 'agent.narration.revise', '缺少修改后的口播稿文本');
        }
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.narration.revise');
        const task = getJobTask(status);
        const outputInfo = resolveJobOutputInfo(task, outputPath, paths);
        if (!outputInfo.outputPath) {
          throw createHttpError(404, 'AGENT_JOB_OUTPUT_NOT_FOUND', 'agent.narration.revise', '未找到任务输出目录');
        }
        fs.writeFileSync(path.join(outputInfo.outputPath, 'manual_narration.txt'), revisedText, 'utf8');
        const removedArtifacts = removeDownstreamArtifacts(task, outputPath);
        const result = await materialDrivenStarter.retryStep(jobId, outputInfo.outputDir, 5, {
          autoGenerate: false,
          useCache: req.body?.useCache !== false
        });
        res.json({
          success: true,
          message: '已保存修改后的口播稿，并重新生成口播结构。下游数字人和成片会在确认后重新生成。',
          jobId,
          outputPath: outputInfo.outputDir,
          removedArtifacts,
          job: getJobTask(result),
          next: buildWorkflowNextActions(getJobTask(result) || task, outputInfo.outputDir, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_NARRATION_REVISE_FAILED',
          stage: 'agent.narration.revise',
          error: '修改口播稿失败'
        });
      }
    },

    generateAvatarVideo: async (req, res) => {
      try {
        if (typeof materialDrivenStarter.generateAvatarOnly !== 'function') {
          throw createHttpError(500, 'AGENT_AVATAR_STEP_UNAVAILABLE', 'agent.avatar.generate', '当前服务未暴露数字人生成能力');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        resolveStatusOrThrow(jobId, outputPath, 'agent.avatar.generate');
        const avatarConfig = normalizeAvatarConfigPayload(req.body || {});
        const result = await materialDrivenStarter.generateAvatarOnly(jobId, outputPath, {
          avatarConfig,
          force: req.body?.force === true
        });
        const task = getJobTask(result);
        res.json({
          success: true,
          message: '数字人生成已启动。这一步可能较慢，可用 get_avatar_status 查询进度。',
          jobId,
          job: task,
          avatar: buildProjectFileInfo(task, outputPath, paths, 'aiman.mp4'),
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_AVATAR_GENERATE_FAILED',
          stage: 'agent.avatar.generate',
          error: '启动数字人生成失败',
          hint: '请确认口播稿已生成，并检查音频/人物预设、ComfyUI 或 RunningHub 配置'
        });
      }
    },

    updateAvatarConfig: async (req, res) => {
      try {
        if (typeof materialDrivenStarter.updateAvatarConfig !== 'function') {
          throw createHttpError(500, 'AGENT_AVATAR_CONFIG_STEP_UNAVAILABLE', 'agent.avatar.config', '当前服务未暴露数字人配置更新能力');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        resolveStatusOrThrow(jobId, outputPath, 'agent.avatar.config');
        const avatarConfig = normalizeAvatarConfigPayload(req.body || {});
        const result = await materialDrivenStarter.updateAvatarConfig(jobId, outputPath, {
          avatarConfig
        });
        const task = getJobTask(result);
        res.json({
          success: true,
          message: '数字人渲染配置已保存',
          jobId,
          outputPath: task?.outputPath || outputPath,
          avatarConfig: task?.avatarConfig || avatarConfig,
          job: task,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_AVATAR_CONFIG_UPDATE_FAILED',
          stage: 'agent.avatar.config',
          error: '更新数字人渲染配置失败'
        });
      }
    },

    getAvatarStatus: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.query?.outputPath || '').trim();
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.avatar.status');
        const task = getJobTask(status);
        const avatar = buildProjectFileInfo(task, outputPath, paths, 'aiman.mp4');
        const renderState = readProjectJson(task, outputPath, paths, 'avatar_render_state.json', null);
        res.json({
          success: true,
          jobId,
          status: task.status || '',
          currentStep: task.currentStep || 0,
          progress: task.progress || 0,
          statusText: task.statusText || '',
          avatar,
          renderState,
          ready: avatar.exists,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_AVATAR_STATUS_FAILED',
          stage: 'agent.avatar.status',
          error: '查询数字人状态失败'
        });
      }
    },

    previewAvatarVideo: (req, res) => {
      try {
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.query?.outputPath || '').trim();
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.avatar.preview');
        const task = getJobTask(status);
        const avatar = buildProjectFileInfo(task, outputPath, paths, 'aiman.mp4');
        if (!avatar.exists) {
          throw createHttpError(404, 'AGENT_AVATAR_VIDEO_NOT_FOUND', 'agent.avatar.preview', '数字人视频还不存在', '', '请先生成数字人，或稍后查询状态');
        }
        res.json({
          success: true,
          jobId,
          avatar,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_AVATAR_PREVIEW_FAILED',
          stage: 'agent.avatar.preview',
          error: '预览数字人失败'
        });
      }
    },

    renderFinalVideo: async (req, res) => {
      try {
        if (typeof materialDrivenStarter.renderFinal !== 'function') {
          throw createHttpError(500, 'AGENT_RENDER_STEP_UNAVAILABLE', 'agent.video.render', '当前服务未暴露剪辑出片能力');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        const status = resolveStatusOrThrow(jobId, outputPath, 'agent.video.render');
        const task = getJobTask(status);
        const avatar = buildProjectFileInfo(task, outputPath, paths, 'aiman.mp4');
        if (!avatar.exists) {
          throw createHttpError(409, 'AGENT_AVATAR_REQUIRED', 'agent.video.render', '剪辑出片前需要先有数字人视频', '', '请先调用 generate_avatar_video，或选择 continue_workflow_one_click 一步到位');
        }
        const result = await materialDrivenStarter.renderFinal(jobId, outputPath, {
          useCache: req.body?.useCache !== false
        });
        const latestTask = getJobTask(result);
        res.json({
          success: true,
          message: '剪辑/竖屏出片已启动，可继续查询任务状态。',
          jobId,
          job: latestTask,
          next: buildWorkflowNextActions(latestTask, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_FINAL_RENDER_FAILED',
          stage: 'agent.video.render',
          error: '启动剪辑出片失败'
        });
      }
    },

    continueWorkflowOneClick: async (req, res) => {
      try {
        if (typeof materialDrivenStarter.continueOneClick !== 'function') {
          throw createHttpError(500, 'AGENT_ONE_CLICK_UNAVAILABLE', 'agent.workflow.one_click', '当前服务未暴露一步到位能力');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        resolveStatusOrThrow(jobId, outputPath, 'agent.workflow.one_click');
        const result = await materialDrivenStarter.continueOneClick(jobId, outputPath, {
          avatarConfig: normalizeAvatarConfigPayload(req.body || {}),
          useCache: req.body?.useCache !== false
        });
        const task = getJobTask(result);
        res.json({
          success: true,
          message: '已选择一步到位：将生成数字人并继续剪辑出片。',
          jobId,
          job: task,
          next: buildWorkflowNextActions(task, outputPath, paths)
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ONE_CLICK_FAILED',
          stage: 'agent.workflow.one_click',
          error: '启动一步到位流程失败'
        });
      }
    },

    reviewVideo: async (req, res) => {
      try {
        if (!reviewHandlers || typeof reviewHandlers.reviewVideo !== 'function') {
          throw createHttpError(500, 'AGENT_REVIEW_UNAVAILABLE', 'agent.video.review', '审核服务未初始化');
        }
        const jobId = String(req.params.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || req.query?.outputPath || '').trim();
        const status = materialDrivenStarter.getStatus(jobId, outputPath);
        if (!status) {
          throw createHttpError(404, 'AGENT_JOB_NOT_FOUND', 'agent.video.review', '任务不存在或无法恢复');
        }
        const videoPath = pickString(req.body?.videoPath, toReviewVideoPathFromJobStatus(status, paths.PROJECT_ROOT));
        if (!videoPath || !fs.existsSync(videoPath)) {
          throw createHttpError(404, 'AGENT_REVIEW_VIDEO_NOT_FOUND', 'agent.video.review', '视频文件不存在，无法审核');
        }
        const payload = await new Promise((resolve, reject) => {
          const reviewReq = {
            body: {
              videoPath,
              assetId: jobId
            }
          };
          const reviewRes = createReviewRequestResponse(resolve, reject);
          Promise.resolve(reviewHandlers.reviewVideo(reviewReq, reviewRes)).catch(reject);
        });
        res.json({
          success: true,
          jobId,
          videoPath,
          review: payload
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_REVIEW_FAILED',
          stage: 'agent.video.review',
          error: '审核视频失败'
        });
      }
    },

    listReviewHistory: async (req, res) => {
      try {
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50) || 50));
        const offset = Math.max(0, Number(req.query?.offset || 0) || 0);
        const payload = await callHandler(reviewHandlers?.getHistory, {
          query: { limit, offset }
        });
        res.json({
          success: true,
          total: payload.total || 0,
          limit: payload.limit || limit,
          offset: payload.offset || offset,
          records: (payload.records || []).map((record) => summarizeReviewRecord(record))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_REVIEW_HISTORY_FAILED',
          stage: 'agent.review.history',
          error: '读取审核历史失败'
        });
      }
    },

    getReviewRecord: async (req, res) => {
      try {
        const reviewId = String(req.params.reviewId || req.query?.reviewId || '').trim();
        if (!reviewId) {
          throw createHttpError(400, 'AGENT_REVIEW_ID_MISSING', 'agent.review.get', '缺少审核记录 ID');
        }
        const payload = await callHandler(reviewHandlers?.getReview, {
          params: { reviewId }
        });
        res.json({
          success: true,
          record: summarizeReviewRecord(payload.record || {}),
          raw: payload.record || null
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_REVIEW_GET_FAILED',
          stage: 'agent.review.get',
          error: '查询审核记录失败'
        });
      }
    },

    ...publishAgentHandlers
  };
}

module.exports = {
  PUBLISH_CONFIRMATION_PHRASE,
  createAgentHandlers,
  normalizePost
};
