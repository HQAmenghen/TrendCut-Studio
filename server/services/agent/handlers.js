const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { listCapabilities } = require('./capabilities');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const GENERATION_IDEMPOTENCY_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLISH_CONFIRMATION_PHRASE = 'CONFIRM_PUBLISH';
const MATERIAL_JOB_DIR_PATTERN = /^material_[A-Za-z0-9_.-]+$/;
const ACTIVE_VERTICAL_STATUSES = new Set([
  'queued',
  'running',
  'preparing',
  'downloading',
  'transcribing',
  'rendering',
  'reviewing'
]);
const DOWNSTREAM_ARTIFACTS_AFTER_NARRATION = [
  'aiman.mp4',
  'avatar_manifest.json',
  'avatar_render_state.json',
  'avatar_segments.json',
  'execution_plan.json',
  'narration_speech.json',
  'narration_speech.txt',
  'output_final.mp4',
  'qwen_tts_metadata.json'
];
const AVATAR_CONFIG_KEYS = [
  'genText',
  'renderProvider',
  'avatarRenderProvider',
  'provider',
  'serverUrl',
  'runningHubApiKey',
  'runningHubBaseUrl',
  'runningHubWorkflowId',
  'runningHubRunPath',
  'runningHubAccessPassword',
  'runningHubInstanceType',
  'runningHubUsePersonalQueue',
  'runningHubRetainSeconds',
  'runningHubAudioNodeId',
  'runningHubAudioFieldName',
  'runningHubImageNodeId',
  'runningHubImageFieldName',
  'runningHubPoseNodeId',
  'runningHubPoseFieldName',
  'runningHubOutputNodeId',
  'trimSeconds',
  'maxDuration',
  'audioPreset',
  'imagePreset'
];

function pickString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePartitionId(value) {
  const text = String(value || '').trim().toLowerCase();
  const aliases = {
    crypto: 'crypto',
    '加密': 'crypto',
    '币圈': 'crypto',
    web3: 'crypto',
    finance: 'finance',
    '金融': 'finance',
    tech: 'tech',
    '科技': 'tech',
    ai: 'ai',
    '人工智能': 'ai'
  };
  return aliases[text] || text || 'crypto';
}

function stableHash(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex')
    .slice(0, 24);
}

function createHttpError(status, code, stage, error, details = '', hint = '') {
  const err = new Error(error);
  err.status = status;
  err.code = code;
  err.stage = stage;
  err.details = details;
  err.hint = hint;
  return err;
}

function normalizeAgentError(err, fallback = {}) {
  return {
    status: Number(err?.status || fallback.status || 500),
    code: String(err?.code || fallback.code || 'AGENT_REQUEST_FAILED'),
    stage: String(err?.stage || fallback.stage || 'agent.request'),
    error: String(err?.message || err?.error || fallback.error || 'agent 请求失败'),
    details: String(err?.details || fallback.details || ''),
    hint: String(err?.hint || fallback.hint || '')
  };
}

function normalizeLocalPathCandidate(value) {
  let text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return '';
  if (/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname || text);
    } catch (_err) {}
  } else if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch (_err) {}
  }

  const wslMatch = text.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
  if (wslMatch) {
    return `${wslMatch[1].toUpperCase()}:\\${wslMatch[2].replace(/\//g, '\\')}`;
  }
  const msysMatch = text.match(/^\/([a-zA-Z])\/(.+)$/);
  if (msysMatch) {
    return `${msysMatch[1].toUpperCase()}:\\${msysMatch[2].replace(/\//g, '\\')}`;
  }
  return text;
}

function extractMaterialOutputDir(value, paths = {}) {
  let text = normalizeLocalPathCandidate(value);
  if (!text) return '';

  try {
    const parsed = new URL(text);
    text = decodeURIComponent(parsed.pathname || text);
  } catch (_err) {}
  text = text.split('?')[0].split('#')[0];

  const parts = text.split(/[\\/]+/).filter(Boolean);
  const materialPart = parts.find((part) => MATERIAL_JOB_DIR_PATTERN.test(part));
  if (materialPart) return materialPart;

  const projectsRoot = getProjectsRoot(paths);
  const resolved = path.isAbsolute(text) ? path.resolve(text) : '';
  if (resolved && isInsideDir(resolved, projectsRoot)) {
    const statTarget = fs.existsSync(resolved) ? resolved : path.dirname(resolved);
    const isFile = fs.existsSync(resolved) ? fs.statSync(resolved).isFile() : Boolean(path.extname(resolved));
    const dirPath = isFile ? path.dirname(statTarget) : statTarget;
    const outputDir = path.basename(dirPath);
    if (outputDir) return outputDir;
  }

  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (path.extname(last) && parts.length > 1) return parts[parts.length - 2];
    return last;
  }
  return text;
}

function resolveAgentLocalVideoPath(value, paths = {}) {
  const text = normalizeLocalPathCandidate(value);
  if (!text || !path.isAbsolute(text)) return '';
  const allowedRoots = [
    paths.PROJECT_ROOT,
    paths.PROJECTS_DIR,
    paths.DATA_DIR,
    paths.UPLOADS_DIR,
    paths.PUBLIC_DIR,
    paths.RUNTIME_ROOT,
    paths.VERTICAL_PUBLIC_DIR,
    paths.VERTICAL_QUEUE_ROOT
  ].map((root) => String(root || '').trim()).filter(Boolean);
  const resolved = path.resolve(text);
  if (!allowedRoots.some((root) => isInsideDir(resolved, root))) return '';
  return resolved;
}

function resolveAgentLocalImagePath(value, paths = {}) {
  const text = normalizeLocalPathCandidate(value);
  if (!text || !path.isAbsolute(text)) return '';
  const allowedRoots = [
    paths.PROJECT_ROOT,
    paths.PROJECTS_DIR,
    paths.DATA_DIR,
    paths.UPLOADS_DIR,
    paths.PUBLIC_DIR,
    paths.RUNTIME_ROOT,
    paths.PUBLISH_CENTER_DIR,
    paths.WECHAT_RPA_PROFILE_ROOT,
    paths.PLATFORM_RPA_PROFILE_ROOT
  ].map((root) => String(root || '').trim()).filter(Boolean);
  const resolved = path.resolve(text);
  if (!allowedRoots.some((root) => isInsideDir(resolved, root))) return '';
  return resolved;
}

function normalizeMaterialOutputReference(value, paths = {}) {
  return extractMaterialOutputDir(value, paths) || String(value || '').trim();
}

function normalizePost(raw = {}, context = {}) {
  const rank = Number(raw.rank || raw.sourceRank || raw.source_rank || 0) || 0;
  const postId = pickString(raw.post_id, raw.postId, raw.sourcePostId, raw.id, raw.url);
  const postUrl = pickString(raw.post_url, raw.postUrl, raw.sourcePostUrl, raw.url);
  const videoUrl = pickString(raw.video_url, raw.videoUrl, raw.materialUrl, raw.sourceVideoUrl);
  const author = pickString(raw.author, raw.sourceAuthor, raw.username, raw.account);
  const title = pickString(raw.title, raw.post_title, raw.headline);
  const summary = pickString(raw.author_summary_zh, raw.summary_zh, raw.author_summary, raw.summary, raw.text, raw.content);
  const partition = raw.partition || context.partition || {};
  const partitionId = pickString(raw.source_partition_id, raw.sourcePartitionId, partition.id, context.partitionId);
  const partitionLabel = pickString(raw.source_partition_label, raw.sourcePartitionLabel, partition.label, context.partitionLabel);
  const id = stableHash({ postId, postUrl, videoUrl, author, rank, partitionId });

  return {
    id,
    rank,
    author,
    title,
    summary,
    postId,
    postUrl,
    videoUrl,
    hotScore: Number(raw.hot_score || raw.hotScore || 0) || 0,
    views: Number(raw.views || 0) || 0,
    viewsDisplay: pickString(raw.views_display, raw.viewsDisplay),
    partition: {
      id: partitionId,
      label: partitionLabel
    },
    raw
  };
}

function postMatchesQuery(post, query) {
  const text = normalizeText([
    post.author,
    post.title,
    post.summary,
    post.postUrl,
    post.postId,
    post.partition?.label
  ].join(' ')).toLowerCase();
  return !query || text.includes(query.toLowerCase());
}

function toReviewVideoPathFromJobStatus(statusPayload, projectRoot = process.cwd()) {
  const task = statusPayload?.task || statusPayload || {};
  const outputDir = String(task.outputPath || task.outputDir || '').trim();
  if (!outputDir) return '';
  return path.join(projectRoot, 'projects', outputDir, 'output_final.mp4');
}

function resolvePublicAssetUrlFromPath(videoPath, projectRoot) {
  const normalized = path.resolve(videoPath);
  const root = path.resolve(projectRoot);
  if (normalized.toLowerCase().startsWith(path.join(root, 'projects').toLowerCase() + path.sep)) {
    const relative = path.relative(path.join(root, 'projects'), normalized).split(path.sep).map(encodeURIComponent).join('/');
    return `/projects/${relative}`;
  }
  if (normalized.toLowerCase().startsWith(path.join(root, 'public').toLowerCase() + path.sep)) {
    const relative = path.relative(path.join(root, 'public'), normalized).split(path.sep).map(encodeURIComponent).join('/');
    return `/${relative}`;
  }
  return '';
}

function getProjectsRoot(paths = {}) {
  return path.resolve(paths.PROJECTS_DIR || path.join(paths.PROJECT_ROOT || process.cwd(), 'projects'));
}

function isInsideDir(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getJobTask(statusPayload) {
  return statusPayload?.task ? statusPayload.task : statusPayload;
}

function resolveJobOutputInfo(task = {}, outputPath = '', paths = {}) {
  const projectsRoot = getProjectsRoot(paths);
  const candidates = [
    task.outputDir,
    task.outputPath,
    task.output_dir,
    outputPath
  ].map((value) => normalizeLocalPathCandidate(value)).filter(Boolean);

  for (const candidate of candidates) {
    const outputDir = extractMaterialOutputDir(candidate, paths);
    const absolutePath = path.isAbsolute(candidate)
      ? path.resolve(path.extname(candidate) ? path.dirname(candidate) : candidate)
      : path.resolve(projectsRoot, outputDir || candidate);
    if (!isInsideDir(absolutePath, projectsRoot)) continue;
    return {
      outputDir: path.basename(absolutePath),
      outputPath: absolutePath,
      projectsRoot
    };
  }

  return {
    outputDir: '',
    outputPath: '',
    projectsRoot
  };
}

function buildProjectFileInfo(task, outputPath, paths, fileName) {
  const outputInfo = resolveJobOutputInfo(task, outputPath, paths);
  const localPath = outputInfo.outputPath ? path.join(outputInfo.outputPath, fileName) : '';
  const exists = Boolean(localPath && fs.existsSync(localPath));
  return {
    exists,
    fileName,
    outputDir: outputInfo.outputDir,
    localPath: exists ? localPath : '',
    publicUrl: exists && outputInfo.outputDir
      ? resolvePublicAssetUrlFromPath(localPath, paths.PROJECT_ROOT || process.cwd())
      : ''
  };
}

function readProjectJson(task, outputPath, paths, fileName, fallback = null) {
  const info = buildProjectFileInfo(task, outputPath, paths, fileName);
  if (!info.exists) return fallback;
  try {
    return JSON.parse(fs.readFileSync(info.localPath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function extractNarrationText(narration, scriptUnitsPayload) {
  const fromNarration = String(narration?.full_text || narration?.text || '').trim();
  if (fromNarration) return fromNarration;
  const units = Array.isArray(scriptUnitsPayload?.script_units)
    ? scriptUnitsPayload.script_units
    : Array.isArray(scriptUnitsPayload)
      ? scriptUnitsPayload
      : [];
  return units.map((unit) => String(unit?.text || '').trim()).filter(Boolean).join('\n\n');
}

function normalizeAvatarConfigPayload(body = {}, options = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const fromNested = source.avatarConfig && typeof source.avatarConfig === 'object' ? source.avatarConfig : {};
  const config = { ...fromNested };
  for (const key of AVATAR_CONFIG_KEYS) {
    if (source[key] !== undefined) {
      config[key] = source[key];
    }
  }
  const provider = String(options.renderProvider || config.renderProvider || config.avatarRenderProvider || config.provider || '').trim().toLowerCase();
  if (provider) {
    config.renderProvider = provider === 'runninghub' ? 'runninghub' : 'comfyui';
  }
  return config;
}

function summarizeWorkflowStage(task = {}, assets = {}) {
  if (task.status === 'failed') return 'failed';
  if (assets.finalVideo?.exists || task.status === 'completed') return 'final_ready';
  if (assets.avatarVideo?.exists) return 'avatar_ready';
  if (task.status === 'generating_avatar') return 'avatar_generating';
  if (assets.narrationReady) return 'narration_ready';
  if (Number(task.currentStep || 0) >= 1 || task.status === 'running') return 'narration_generating';
  return 'not_started';
}

function buildWorkflowNextActions(task = {}, outputPath = '', paths = {}) {
  const narration = task.narration || readProjectJson(task, outputPath, paths, 'narration.json', null);
  const scriptUnits = task.scriptUnits || readProjectJson(task, outputPath, paths, 'script_units.json', null);
  const avatarVideo = buildProjectFileInfo(task, outputPath, paths, 'aiman.mp4');
  const finalVideo = buildProjectFileInfo(task, outputPath, paths, 'output_final.mp4');
  const narrationReady = Boolean(extractNarrationText(narration, scriptUnits));
  const stage = summarizeWorkflowStage(task, {
    narrationReady,
    avatarVideo,
    finalVideo
  });

  if (stage === 'failed') {
    return {
      stage,
      prompt: '任务失败了，可以先查看失败原因，再按当前阶段重试。',
      actions: [
        { name: 'get_job_status', label: '查看失败原因', risk: 'low' },
        { name: 'get_workflow_next_actions', label: '重新判断下一步', risk: 'low' }
      ]
    };
  }

  if (stage === 'final_ready') {
    return {
      stage,
      prompt: '成片已经生成。下一步可以先预览/审核，也可以创建发布草稿；真实发布仍需要人工确认。',
      actions: [
        { name: 'preview_generated_video', label: '预览成片', risk: 'low' },
        { name: 'review_generated_video', label: '审核成片', risk: 'medium' },
        { name: 'create_publish_draft', label: '创建发布草稿', risk: 'medium' }
      ]
    };
  }

  if (stage === 'avatar_ready') {
    return {
      stage,
      prompt: '数字人视频已经生成。下一步希望先预览数字人效果，还是直接剪辑出片？',
      actions: [
        { name: 'preview_avatar_video', label: '先预览数字人', risk: 'low' },
        { name: 'render_final_video', label: '剪辑并生成竖屏成片', risk: 'medium' },
        { name: 'revise_narration_draft', label: '回到口播稿修改', risk: 'medium' }
      ]
    };
  }

  if (stage === 'avatar_generating') {
    return {
      stage,
      prompt: '数字人正在生成中，这一步通常比较慢。可以稍后查询进度。',
      actions: [
        { name: 'get_avatar_status', label: '查询数字人进度', risk: 'low' },
        { name: 'get_job_status', label: '查看完整任务状态', risk: 'low' }
      ]
    };
  }

  if (stage === 'narration_ready') {
    return {
      stage,
      prompt: '口播稿已经完成。下一步希望先合成数字人看看效果，还是一步到位直接剪辑出片？',
      actions: [
        { name: 'get_narration_draft', label: '查看口播稿', risk: 'low' },
        { name: 'revise_narration_draft', label: '修改口播稿', risk: 'medium' },
        { name: 'generate_avatar_video', label: '先合成数字人', risk: 'medium' },
        { name: 'continue_workflow_one_click', label: '一步到位出片', risk: 'medium' }
      ]
    };
  }

  return {
    stage,
    prompt: '口播稿还在生成或尚未开始。可以继续查询，等口播完成后再选择下一步。',
    actions: [
      { name: 'get_job_status', label: '查询任务状态', risk: 'low' },
      { name: 'get_narration_draft', label: '查看口播是否完成', risk: 'low' }
    ]
  };
}

function normalizeVerticalJob(job = {}) {
  const status = String(job.status || '').trim();
  return {
    id: job.id || '',
    status,
    active: ACTIVE_VERTICAL_STATUSES.has(status),
    progress: Number.isFinite(Number(job.progress)) ? Number(job.progress) : 0,
    message: job.message || '',
    currentStage: job.currentStage || '',
    title: job.title || '',
    author: job.author || '',
    sourceType: job.sourceType || '',
    sourcePartitionId: job.sourcePartitionId || '',
    sourcePartitionLabel: job.sourcePartitionLabel || '',
    sourceRank: Number(job.sourceRank || 0) || 0,
    sourceTaskDir: job.sourceTaskDir || '',
    materialTaskDir: job.materialTaskDir || '',
    referenceSubtitleSource: job.referenceSubtitleSource || '',
    resultVideoUrl: job.resultVideoUrl || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    startedAt: job.startedAt || '',
    completedAt: job.completedAt || '',
    failure: job.failureSummary || job.failure || null,
    recentLogs: Array.isArray(job.logs) ? job.logs.slice(-20) : []
  };
}

function readVerticalJobArtifacts(job = {}, paths = {}) {
  const queueRoot = paths.VERTICAL_QUEUE_ROOT || path.join(paths.DATA_DIR || process.cwd(), 'uploads', 'xai_vertical_queue');
  const publicRoot = paths.VERTICAL_PUBLIC_DIR || path.join(paths.PROJECT_ROOT || process.cwd(), 'public', 'xai_vertical_queue');
  const jobId = String(job.id || '').trim();
  if (!jobId) return {};
  const queueDir = path.join(queueRoot, jobId);
  const publicDir = path.join(publicRoot, jobId);
  const resultPath = path.join(publicDir, 'vertical_output.mp4');
  const failurePath = path.join(queueDir, 'failure.json');
  return {
    queueDir: fs.existsSync(queueDir) ? queueDir : '',
    publicDir: fs.existsSync(publicDir) ? publicDir : '',
    resultVideo: {
      exists: fs.existsSync(resultPath),
      localPath: fs.existsSync(resultPath) ? resultPath : '',
      publicUrl: fs.existsSync(resultPath) ? `/xai_vertical_queue/${encodeURIComponent(jobId)}/vertical_output.mp4` : ''
    },
    failure: fs.existsSync(failurePath) ? readJsonSafeFile(failurePath, null) : null
  };
}

function readJsonSafeFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function summarizePublishPlatformTask(task = {}) {
  return {
    platform: task.platform || '',
    status: task.status || '',
    title: task.title || '',
    accountId: task.accountId || '',
    accountLabel: task.accountLabel || '',
    sauAccountName: task.sauAccountName || '',
    updatedAt: task.updatedAt || '',
    lastRunAt: task.lastRunAt || '',
    lastFailureAt: task.lastFailureAt || '',
    runtime: task.runtime ? {
      state: task.runtime.state || '',
      lastMessage: task.runtime.lastMessage || '',
      updatedAt: task.runtime.updatedAt || null
    } : null,
    publishResult: task.publishResult || null
  };
}

function normalizePublishJobSummary(job = {}, nowMs = Date.now()) {
  const platformTasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
  const scheduledAtMs = job.scheduledAt ? new Date(job.scheduledAt).getTime() : NaN;
  const hasScheduledWaitingTask = platformTasks.some((task) => String(task.status || '') === 'scheduled_wait');
  const isScheduled = Boolean(job.scheduledAt) || String(job.status || '') === 'scheduled_wait' || hasScheduledWaitingTask;
  const isDue = Boolean(
    !job.archived &&
    job.scheduledAt &&
    Number.isFinite(scheduledAtMs) &&
    scheduledAtMs <= nowMs &&
    (String(job.status || '') === 'scheduled_wait' || hasScheduledWaitingTask)
  );
  return {
    id: job.id || '',
    status: job.status || '',
    archived: Boolean(job.archived),
    scheduled: isScheduled,
    due: isDue,
    scheduledAt: job.scheduledAt || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    title: pickString(job.publishData?.title, job.asset?.metadata?.suggestedTitle, job.asset?.label, job.asset?.compactLabel),
    description: job.publishData?.description || '',
    asset: job.asset ? {
      id: job.asset.id || '',
      label: job.asset.label || job.asset.compactLabel || '',
      sourceType: job.asset.sourceType || '',
      url: job.asset.url || '',
      path: job.asset.path || ''
    } : null,
    selectedPlatforms: Array.isArray(job.selectedPlatforms) ? job.selectedPlatforms : [],
    platformTasks: platformTasks.map((task) => summarizePublishPlatformTask(task)),
    platformErrors: Array.isArray(job.platformErrors) ? job.platformErrors : []
  };
}

function summarizeMaterialTask(task = {}) {
  return {
    id: task.id || task.outputDir || '',
    outputDir: task.outputDir || task.id || '',
    title: task.title || '',
    videoUrl: task.videoUrl || '',
    updatedAt: task.updatedAt || '',
    hasSubtitles: Boolean(task.hasSubtitles),
    subtitleSource: task.subtitleSource || '',
    subtitleCount: Number(task.subtitleCount || 0) || 0,
    sourcePostUrl: task.sourcePostUrl || '',
    scriptPreview: task.scriptPreview || ''
  };
}

function summarizeReviewRecord(record = {}) {
  return {
    id: record.id || '',
    assetId: record.asset_id || record.assetId || '',
    videoPath: record.video_path || record.videoPath || '',
    status: record.review_status || record.status || '',
    overallScore: record.overall_score ?? record.overallScore ?? null,
    scores: {
      content: record.content_quality_score ?? null,
      subtitle: record.subtitle_accuracy_score ?? null,
      title: record.title_appeal_score ?? null,
      editing: record.editing_quality_score ?? null
    },
    createdAt: record.created_at || record.createdAt || '',
    completedAt: record.completed_at || record.completedAt || '',
    error: record.error_message || '',
    fixSuggestions: record.fix_suggestions || record.fixSuggestions || [],
    titleSuggestions: record.title_suggestions || record.titleSuggestions || []
  };
}

function sanitizeLoginStatus(status = {}) {
  return {
    accountId: status.accountId || '',
    accountLabel: status.accountLabel || status.account?.displayName || status.account?.helperAccount || status.accountId || '',
    status: status.status || '',
    lastCheck: status.lastCheck || status.lastCheckedAt || null,
    lastNotify: status.lastNotify || null,
    error: status.error || '',
    hasQrCode: Boolean(status.qrCodePath)
  };
}

function buildQrCodeImagePayload(result = {}, paths = {}) {
  const qrCodePath = String(result.qrCodePath || '').trim();
  const localQrCodePath = resolveAgentLocalImagePath(qrCodePath, paths);
  const payload = {
    qrCodePath,
    localQrCodePath,
    hasQrCode: Boolean(localQrCodePath),
    mimeType: 'image/png',
    qrCodeBase64: '',
    qrCodeDataUrl: ''
  };
  if (!localQrCodePath) return payload;

  try {
    const stat = fs.statSync(localQrCodePath);
    if (!stat.isFile()) {
      payload.hasQrCode = false;
      return payload;
    }
    const qrCodeBase64 = fs.readFileSync(localQrCodePath).toString('base64');
    payload.qrCodeBase64 = qrCodeBase64;
    payload.qrCodeDataUrl = `data:${payload.mimeType};base64,${qrCodeBase64}`;
    payload.fileName = path.basename(localQrCodePath);
    payload.fileSize = stat.size;
    payload.modifiedAt = stat.mtime.toISOString();
  } catch (_err) {
    payload.hasQrCode = false;
  }
  return payload;
}

function buildAgentJobPayload(jobId, outputPath, extra = {}) {
  return {
    jobId,
    outputPath,
    ...extra
  };
}

function createMemoryResponse(resolve, reject) {
  return {
    statusCode: 200,
    headersSent: false,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.headersSent = true;
      if (this.statusCode >= 400 || payload?.success === false) {
        reject(createHttpError(
          this.statusCode,
          payload?.code || 'AGENT_UPSTREAM_FAILED',
          payload?.stage || 'agent.upstream',
          payload?.error || '上游请求失败',
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

  async function createPublishJobFromAsset({ asset, platforms, title, description, tags, platformSelections, scheduledTime }) {
    const config = publishStore.readPublishConfig();
    const selectedPlatforms = Array.isArray(platforms) && platforms.length
      ? platforms.map((value) => String(value).trim()).filter(Boolean)
      : ['wechatChannels'];
    const publishTitle = pickString(title, asset?.metadata?.suggestedTitle, asset?.compactLabel, asset?.label, '热点视频');
    let finalDescription = String(description || '').trim();
    const tagStrategy = Array.isArray(tags) && tags.length ? 'system' : 'model';

    if (!finalDescription && typeof generatePublishDescription === 'function') {
      finalDescription = await generatePublishDescription(
        asset?.metadata?.sourceSummary || asset?.metadata?.suggestedDescription || publishTitle,
        {
          includeTags: tagStrategy === 'model',
          title: publishTitle,
          allowFallback: true,
          timeoutMs: 180000
        }
      );
    }
    if (!finalDescription) {
      finalDescription = publishTitle;
    }

    const publishData = {
      title: publishTitle,
      shortTitle: typeof buildShortTitle === 'function' ? buildShortTitle(publishTitle, '热点速递') : publishTitle.slice(0, 16),
      description: finalDescription,
      tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      coverUrl: '',
      tagStrategy
    };
    const platformTasks = [];
    const platformErrors = [];
    const selections = platformSelections && typeof platformSelections === 'object' ? platformSelections : {};

    for (const platformKey of selectedPlatforms) {
      const platformConfig = config?.[platformKey] || null;
      if (!platformConfig) {
        platformErrors.push({ platform: platformKey, error: '未知平台' });
        continue;
      }
      if (!platformConfig.enabled) {
        platformErrors.push({ platform: platformKey, error: '该平台尚未启用' });
      }
      const selection = selections[platformKey] && typeof selections[platformKey] === 'object'
        ? selections[platformKey]
        : {};
      const task = buildPublishTask(platformKey, publishData, asset.url, platformConfig, {
        accountId: selection.accountId || '',
        accountLabel: selection.accountLabel || '',
        sauAccountName: selection.sauAccountName || ''
      });
      task.status = scheduledTime ? 'scheduled_wait' : task.status;
      platformTasks.push(task);
    }

    if (!platformTasks.length) {
      throw createHttpError(
        400,
        'AGENT_PUBLISH_TASKS_EMPTY',
        'agent.publish.draft',
        '没有可创建的发布平台任务',
        JSON.stringify(platformErrors),
        '请检查发布平台是否已启用，或指定有效 platforms'
      );
    }

    const payload = publishStore.readPublishJobs();
    const now = new Date().toISOString();
    const job = {
      id: typeof publishStore.makeJobId === 'function' ? publishStore.makeJobId() : `job_${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      archived: false,
      archivedAt: null,
      status: scheduledTime ? 'scheduled_wait' : (platformErrors.length > 0 ? 'partial_ready' : 'ready'),
      scheduledAt: scheduledTime ? new Date(scheduledTime).toISOString() : null,
      asset,
      publishData,
      selectedPlatforms,
      platformSelections: selections,
      platformTasks,
      platformErrors,
      agentCreated: true
    };
    payload.jobs = [job, ...(payload.jobs || [])].slice(0, 50);
    publishStore.writePublishJobs(payload);
    return job;
  }

  function findAssetForJob(jobId, outputPath = '') {
    if (typeof resetPublishAssetsCache === 'function') resetPublishAssetsCache();
    const assets = typeof publishAssetsService?.collectPublishAssets === 'function'
      ? publishAssetsService.collectPublishAssets()
      : [];
    if (!jobId && !outputPath) return null;
    const jobText = String(jobId || '').trim();
    const outputText = String(outputPath || '').trim();
    return assets.find((asset) => {
      const haystack = [asset.id, asset.url, asset.path, asset.label].map((value) => String(value || '')).join(' ');
      return (jobText && haystack.includes(jobText)) || (outputText && haystack.includes(outputText));
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

  return {
    health: (_req, res) => {
      try {
        const report = getSelfCheckReport();
        res.json({
          success: true,
          service: 'comfy-panel-agent-v1',
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

    listPublishAssets: (req, res) => {
      try {
        if (!publishAssetsService || typeof publishAssetsService.collectPublishAssets !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_ASSETS_UNAVAILABLE', 'agent.publish.assets', '发布素材服务未初始化');
        }
        if (typeof resetPublishAssetsCache === 'function') resetPublishAssetsCache();
        const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 20) || 20));
        const sourceType = String(req.query?.sourceType || '').trim();
        const query = normalizeText(req.query?.query || '').toLowerCase();
        const assets = publishAssetsService.collectPublishAssets()
          .filter((asset) => !sourceType || asset.sourceType === sourceType)
          .filter((asset) => {
            if (!query) return true;
            const haystack = [
              asset.id,
              asset.label,
              asset.displayLabel,
              asset.compactLabel,
              asset.typeLabel,
              asset.metadata?.suggestedTitle,
              asset.metadata?.sourceSummary
            ].map((value) => String(value || '')).join(' ').toLowerCase();
            return haystack.includes(query);
          })
          .slice(0, limit);
        res.json({
          success: true,
          total: assets.length,
          assets
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_ASSETS_FAILED',
          stage: 'agent.publish.assets',
          error: '读取可发布素材失败'
        });
      }
    },

    listPublishDrafts: (req, res) => {
      try {
        if (!publishStore || typeof publishStore.readPublishJobs !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_JOBS_UNAVAILABLE', 'agent.publish.jobs', '发布任务服务未初始化');
        }
        const limit = Math.max(1, Math.min(50, Number(req.query?.limit || 20) || 20));
        const includeArchived = req.query?.includeArchived === 'true' || req.query?.includeArchived === '1';
        const statusFilter = String(req.query?.status || '').trim();
        const payload = publishStore.readPublishJobs();
        const jobs = (payload.jobs || [])
          .filter((job) => includeArchived || !job.archived)
          .filter((job) => !statusFilter || String(job.status || '') === statusFilter)
          .slice(0, limit);
        res.json({
          success: true,
          total: jobs.length,
          jobs
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_JOBS_FAILED',
          stage: 'agent.publish.jobs',
          error: '读取发布草稿失败'
        });
      }
    },

    getPublishScheduleSummary: (req, res) => {
      try {
        res.json(buildPublishSchedulePayload({
          ...req.query,
          scheduledOnly: req.query?.scheduledOnly === undefined ? false : req.query.scheduledOnly
        }));
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_SCHEDULE_FAILED',
          stage: 'agent.publish.schedule',
          error: '查询定时发布任务失败'
        });
      }
    },

    listScheduledPublishTasks: (req, res) => {
      try {
        res.json(buildPublishSchedulePayload({
          ...req.query,
          scheduledOnly: true
        }));
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_SCHEDULE_LIST_FAILED',
          stage: 'agent.publish.schedule',
          error: '列出定时发布任务失败'
        });
      }
    },

    getPublishTaskStatus: (req, res) => {
      try {
        const publishJobId = String(req.params.publishJobId || req.params.jobId || '').trim();
        if (!publishJobId) {
          throw createHttpError(400, 'AGENT_PUBLISH_JOB_ID_MISSING', 'agent.publish.task', '缺少发布任务 ID');
        }
        const payload = buildPublishSchedulePayload({ includeArchived: true, limit: 100 });
        const job = (payload.jobs || []).find((item) => item.id === publishJobId) || null;
        if (!job) {
          throw createHttpError(404, 'AGENT_PUBLISH_JOB_NOT_FOUND', 'agent.publish.task', '发布任务不存在');
        }
        res.json({
          success: true,
          job
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_TASK_FAILED',
          stage: 'agent.publish.task',
          error: '查询发布任务失败'
        });
      }
    },

    getPublishAccountDashboard: async (_req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountDashboard !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_DASHBOARD_UNAVAILABLE', 'agent.publish.accounts', '账号看板服务未初始化');
        }
        const dashboard = await accountDashboardService.getAccountDashboard();
        res.json({
          success: true,
          summary: dashboard.summary || {},
          accounts: dashboard.accounts || []
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_DASHBOARD_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询发布账号看板失败'
        });
      }
    },

    listPublishAccountJobs: (req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountJobs !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_JOBS_UNAVAILABLE', 'agent.publish.accounts', '账号任务服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.publish.accounts', '缺少账号 ID');
        }
        const platform = String(req.query?.platform || 'wechatChannels').trim();
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 50) || 50));
        const status = String(req.query?.status || '').trim() || undefined;
        const jobs = accountDashboardService.getAccountJobs(accountId, { platform, status, limit });
        res.json({
          success: true,
          accountId,
          platform,
          total: jobs.length,
          jobs: jobs.map((job) => normalizePublishJobSummary(job))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_JOBS_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询账号发布任务失败'
        });
      }
    },

    listPublishAccountFailures: (req, res) => {
      try {
        if (!accountDashboardService || typeof accountDashboardService.getAccountFailedJobs !== 'function') {
          throw createHttpError(500, 'AGENT_ACCOUNT_FAILURES_UNAVAILABLE', 'agent.publish.accounts', '账号失败任务服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.publish.accounts', '缺少账号 ID');
        }
        const platform = String(req.query?.platform || 'wechatChannels').trim();
        const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20) || 20));
        const jobs = accountDashboardService.getAccountFailedJobs(accountId, limit, platform);
        res.json({
          success: true,
          accountId,
          platform,
          total: jobs.length,
          jobs: jobs.map((job) => normalizePublishJobSummary(job))
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_ACCOUNT_FAILURES_FAILED',
          stage: 'agent.publish.accounts',
          error: '查询账号失败任务失败'
        });
      }
    },

    listLoginStatuses: (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.getAllStatus !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_STATUS_UNAVAILABLE', 'agent.login.status', '登录状态服务未初始化');
        }
        const statuses = loginStatusService.getAllStatus().map((status) => sanitizeLoginStatus(status));
        const statusFilter = String(req.query?.status || '').trim();
        const filtered = statuses.filter((status) => !statusFilter || status.status === statusFilter);
        res.json({
          success: true,
          summary: {
            total: filtered.length,
            loggedIn: filtered.filter((item) => item.status === 'logged_in').length,
            needLogin: filtered.filter((item) => item.status === 'need_login').length,
            error: filtered.filter((item) => item.status === 'error').length
          },
          statuses: filtered
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_STATUS_FAILED',
          stage: 'agent.login.status',
          error: '查询登录状态失败'
        });
      }
    },

    getLoginStatus: (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.getAccountStatus !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_STATUS_UNAVAILABLE', 'agent.login.status', '登录状态服务未初始化');
        }
        const accountId = String(req.params.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.login.status', '缺少账号 ID');
        }
        const status = loginStatusService.getAccountStatus(accountId);
        if (!status) {
          throw createHttpError(404, 'AGENT_LOGIN_STATUS_NOT_FOUND', 'agent.login.status', '未找到该账号的登录状态缓存');
        }
        res.json({
          success: true,
          accountId,
          status: sanitizeLoginStatus({ accountId, ...status })
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_STATUS_GET_FAILED',
          stage: 'agent.login.status',
          error: '查询账号登录状态失败'
        });
      }
    },

    getLoginQrCode: async (req, res) => {
      try {
        if (!loginStatusService || typeof loginStatusService.requestLatestQrCode !== 'function') {
          throw createHttpError(500, 'AGENT_LOGIN_QRCODE_UNAVAILABLE', 'agent.login.qrcode', '登录二维码服务未初始化');
        }
        const accountId = String(req.params.accountId || req.body?.accountId || req.query?.accountId || '').trim();
        if (!accountId) {
          throw createHttpError(400, 'AGENT_ACCOUNT_ID_MISSING', 'agent.login.qrcode', '缺少账号 ID');
        }
        const result = await loginStatusService.requestLatestQrCode(accountId, {
          notifyFeishu: false,
          trigger: 'agent_qrcode_request'
        });
        const image = buildQrCodeImagePayload(result, paths);
        const status = result.status || (image.hasQrCode ? 'need_login' : '');
        res.json({
          success: true,
          accountId,
          status,
          message: status === 'logged_in'
            ? '账号已登录，不需要扫码'
            : '已刷新登录二维码截图，请扫码完成登录',
          refreshQrUrl: result.refreshQrUrl || '',
          image,
          requiresScan: status !== 'logged_in' && image.hasQrCode,
          note: '该接口只刷新/读取二维码截图，不会发布内容，也不会发送飞书通知。'
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_LOGIN_QRCODE_FAILED',
          stage: 'agent.login.qrcode',
          error: '获取登录二维码失败',
          hint: '请确认账号 ID 存在，且当前账号没有正在执行的发布任务。'
        });
      }
    },

    createPublishDraft: async (req, res) => {
      try {
        if (!publishStore || !publishAssetsService) {
          throw createHttpError(500, 'AGENT_PUBLISH_UNAVAILABLE', 'agent.publish.draft', '发布服务未初始化');
        }
        const assetId = String(req.body?.assetId || '').trim();
        const jobId = String(req.body?.jobId || '').trim();
        const outputPath = String(req.body?.outputPath || '').trim();
        const assets = typeof publishAssetsService.collectPublishAssets === 'function'
          ? publishAssetsService.collectPublishAssets()
          : [];
        let asset = assetId ? assets.find((item) => item.id === assetId) : null;
        if (!asset) asset = findAssetForJob(jobId, outputPath);
        if (!asset && jobId) {
          const status = materialDrivenStarter.getStatus(jobId, outputPath);
          const videoPath = status ? toReviewVideoPathFromJobStatus(status, paths.PROJECT_ROOT) : '';
          if (videoPath && fs.existsSync(videoPath)) {
            asset = {
              id: stableHash({ videoPath }),
              label: `素材驱动成片 ${jobId}`,
              compactLabel: `素材驱动成片 ${jobId}`,
              typeLabel: '素材驱动成片',
              sourceType: 'material_driven',
              path: videoPath,
              url: resolvePublicAssetUrlFromPath(videoPath, paths.PROJECT_ROOT),
              metadata: {
                suggestedTitle: status?.task?.sourcePost?.title || status?.task?.sourceMeta?.sourceAuthor || '热点视频',
                suggestedDescription: status?.task?.sourcePost?.body || '',
                sourceSummary: status?.task?.sourcePost?.body || '',
                sourceUrl: status?.task?.sourcePost?.postUrl || status?.task?.sourceMeta?.postUrl || '',
                author: status?.task?.sourcePost?.author || status?.task?.sourceMeta?.sourceAuthor || ''
              }
            };
          }
        }
        if (!asset) {
          throw createHttpError(404, 'AGENT_PUBLISH_ASSET_NOT_FOUND', 'agent.publish.draft', '未找到可发布的视频素材', '', '请确认视频任务已完成，或传入 /api/publish/assets 中存在的 assetId');
        }

        const publishJob = await createPublishJobFromAsset({
          asset,
          platforms: req.body?.platforms,
          title: req.body?.title,
          description: req.body?.description,
          tags: req.body?.tags,
          platformSelections: req.body?.platformSelections,
          scheduledTime: req.body?.scheduledTime
        });

        res.json({
          success: true,
          message: '发布草稿已创建，尚未执行真实发布',
          publishJob,
          requiresConfirmation: true,
          confirmationPhrase: PUBLISH_CONFIRMATION_PHRASE
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_DRAFT_FAILED',
          stage: 'agent.publish.draft',
          error: '创建发布草稿失败'
        });
      }
    },

    confirmPublish: async (req, res) => {
      try {
        const publishJobId = String(req.body?.publishJobId || req.body?.jobId || '').trim();
        const platformKey = String(req.body?.platform || req.body?.platformKey || 'wechatChannels').trim();
        const confirmation = String(req.body?.confirmation || '').trim();
        const allowRealPublish = process.env.AGENT_ENABLE_REAL_PUBLISH === 'true' || req.body?.allowRealPublish === true;
        if (!publishJobId) {
          throw createHttpError(400, 'AGENT_PUBLISH_JOB_ID_MISSING', 'agent.publish.confirm', '缺少发布任务 ID');
        }
        if (confirmation !== PUBLISH_CONFIRMATION_PHRASE) {
          throw createHttpError(
            409,
            'AGENT_PUBLISH_CONFIRMATION_REQUIRED',
            'agent.publish.confirm',
            '真实发布需要显式确认',
            '',
            `请先人工核对草稿，再使用 confirmation="${PUBLISH_CONFIRMATION_PHRASE}"`
          );
        }
        if (!allowRealPublish) {
          throw createHttpError(
            403,
            'AGENT_REAL_PUBLISH_DISABLED',
            'agent.publish.confirm',
            'V0 默认禁用真实发布',
            '',
            '如确需本地自测真实发布，请设置 AGENT_ENABLE_REAL_PUBLISH=true 后再确认'
          );
        }

        const starter = platformKey === 'wechatChannels' ? startWechatRpa : startPlatformRpa;
        if (typeof starter !== 'function') {
          throw createHttpError(500, 'AGENT_PUBLISH_STARTER_UNAVAILABLE', 'agent.publish.confirm', '发布执行服务未初始化');
        }
        if (platformKey === 'wechatChannels') {
          await starter(publishJobId, 'publish');
        } else {
          await starter(publishJobId, platformKey, 'publish');
        }
        const payload = publishStore.readPublishJobs();
        const publishJob = (payload.jobs || []).find((job) => job.id === publishJobId) || null;
        res.json({
          success: true,
          message: '已启动真实发布流程',
          publishJob
        });
      } catch (err) {
        sendNormalizedError(res, err, {
          code: 'AGENT_PUBLISH_CONFIRM_FAILED',
          stage: 'agent.publish.confirm',
          error: '确认发布失败'
        });
      }
    }
  };
}

module.exports = {
  PUBLISH_CONFIRMATION_PHRASE,
  createAgentHandlers,
  normalizePost
};
