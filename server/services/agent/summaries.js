const fs = require('fs');
const path = require('path');

const {
  ACTIVE_VERTICAL_STATUSES,
  AVATAR_CONFIG_KEYS,
  createHttpError,
  extractMaterialOutputDir,
  getProjectsRoot,
  isInsideDir,
  normalizeLocalPathCandidate,
  pickString,
  resolveAgentLocalImagePath
} = require('./helpers');

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

function readJsonSafeFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
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

module.exports = {
  buildAgentJobPayload,
  buildProjectFileInfo,
  buildQrCodeImagePayload,
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
  resolvePublicAssetUrlFromPath,
  sanitizeLoginStatus,
  summarizeMaterialTask,
  summarizeReviewRecord,
  summarizeWorkflowStage,
  toReviewVideoPathFromJobStatus
};
