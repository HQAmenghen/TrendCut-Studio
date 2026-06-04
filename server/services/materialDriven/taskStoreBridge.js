const path = require('path');

function getMaterialOutputDir(task = {}) {
  return String(task.outputDir || path.basename(task.outputPath || '') || '').trim();
}

function getMaterialTaskKey(task = {}) {
  const outputDir = getMaterialOutputDir(task);
  return outputDir ? `material:${outputDir}` : '';
}

function getAvatarTaskKey(task = {}, avatarState = {}) {
  const provider = String(avatarState.provider || task.avatarConfig?.renderProvider || '').trim().toLowerCase();
  const providerTaskId = String(avatarState.taskId || avatarState.runningHubTaskId || '').trim();
  if (provider === 'runninghub' && providerTaskId) {
    return `runninghub:${providerTaskId}`;
  }
  const outputDir = getMaterialOutputDir(task);
  return outputDir ? `avatar:${outputDir}` : '';
}

function mapMaterialStatus(status) {
  const normalized = String(status || '').trim();
  if (['completed', 'failed', 'queued', 'running', 'interrupted'].includes(normalized)) return normalized;
  if (normalized.startsWith('waiting_') || normalized === 'generating_avatar' || normalized === 'recovered') {
    return 'running';
  }
  return normalized || 'running';
}

function syncMaterialTask(taskStore, task, extraMetadata = {}) {
  if (!taskStore || !task) return null;
  const taskKey = getMaterialTaskKey(task);
  if (!taskKey) return null;
  const outputDir = getMaterialOutputDir(task);
  const errorMessage = String(extraMetadata.error || task.error || '').trim();
  const status = errorMessage ? 'failed' : mapMaterialStatus(task.status);
  const metadata = {
    outputDir,
    outputPath: task.outputPath || '',
    sourceType: 'material_driven',
    stage: task.status || '',
    currentStep: Number(task.currentStep || 0),
    videoUrl: task.videoUrl || '',
    sourceMeta: task.sourceMeta || {},
    autoGenerate: Boolean(task.autoGenerate),
    useSmartClip: Boolean(task.useSmartClip),
    useCache: Boolean(task.useCache),
    errorCode: '',
    errorStage: '',
    errorDetails: '',
    ...extraMetadata,
    error: errorMessage
  };
  if (task.avatarRenderState && typeof task.avatarRenderState === 'object') {
    metadata.avatarRenderState = task.avatarRenderState;
  }
  const result = taskStore.createOrReuseTask('material_driven', taskKey, metadata, {
    status,
    progress: Number(task.progress || 0),
    message: task.statusText || ''
  });
  return taskStore.updateTask(result.task.id, {
    status,
    progress: Number(task.progress || 0),
    message: task.statusText || '',
    logs: Array.isArray(task.logs) ? task.logs : result.task.logs,
    startedAt: task.startedAt || result.task.startedAt,
    completedAt: task.completedAt || null,
    metadata: {
      ...result.task.metadata,
      ...metadata
    }
  });
}

function syncAvatarTask(taskStore, task, avatarState = {}, extraMetadata = {}) {
  if (!taskStore || !task) return null;
  const taskKey = getAvatarTaskKey(task, avatarState);
  if (!taskKey) return null;
  const provider = String(avatarState.provider || task.avatarConfig?.renderProvider || '').trim().toLowerCase() || 'unknown';
  const rawStatus = String(avatarState.status || task.status || '').trim();
  const status = rawStatus === 'downloaded' || rawStatus === 'completed'
    ? 'completed'
    : rawStatus === 'failed'
      ? 'failed'
      : 'running';
  const progress = status === 'completed'
    ? 100
    : Math.max(0, Math.min(99, Number(task.progress || 0) || 0));
  const metadata = {
    outputDir: getMaterialOutputDir(task),
    outputPath: task.outputPath || '',
    provider,
    providerTaskId: avatarState.taskId || '',
    sourceMaterialTaskKey: getMaterialTaskKey(task),
    stage: rawStatus || 'generating_avatar',
    videoUrl: avatarState.videoUrl || '',
    resumeKey: avatarState.resumeKey || '',
    remoteAudioName: avatarState.remoteAudioName || '',
    remoteImageName: avatarState.remoteImageName || '',
    error: avatarState.error || '',
    ...extraMetadata
  };
  const result = taskStore.createOrReuseTask('avatar_generation', taskKey, metadata, {
    status,
    progress,
    message: task.statusText || rawStatus || '数字人任务进行中'
  });
  return taskStore.updateTask(result.task.id, {
    status,
    progress,
    message: task.statusText || rawStatus || '数字人任务进行中',
    logs: Array.isArray(task.logs) ? task.logs : result.task.logs,
    startedAt: avatarState.submittedAt || result.task.startedAt || task.startedAt || null,
    completedAt: avatarState.downloadedAt || avatarState.completedAt || (status === 'completed' ? task.updatedAt : null),
    metadata: {
      ...result.task.metadata,
      ...metadata
    }
  });
}

module.exports = {
  getAvatarTaskKey,
  getMaterialTaskKey,
  syncAvatarTask,
  syncMaterialTask
};
