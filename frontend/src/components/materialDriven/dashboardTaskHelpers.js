export const activePublishStates = new Set([
  'starting',
  'navigating',
  'need_login',
  'login_ready',
  'uploading',
  'uploaded',
  'editing',
  'publishing',
  'processing'
]);

export const waitingPublishStates = new Set([
  'scheduled_wait',
  'ready',
  'pending',
  'pending_integration',
  'partial_ready',
  'rpa_available',
  'ready_for_manual_publish'
]);

export const terminalPublishStates = new Set([
  'published',
  'failed',
  'cancelled',
  'archived'
]);

export const terminalAvatarStates = new Set([
  'completed',
  'failed',
  'failure',
  'error',
  'canceled',
  'cancelled',
  'published'
]);

export const getMaterialQueueKey = (task) => {
  const output = String(task?.outputPath || task?.outputDir || '').trim();
  if (output) return `material:${output}`;
  const taskKey = String(task?.taskKey || '').trim();
  if (taskKey.startsWith('material:')) return taskKey;
  if (taskKey.startsWith('runninghub:')) return `avatar:${taskKey}`;
  return `task:${String(task?.id || '').trim()}`;
};

export const isMaterialAvatarTask = (task) => task?.taskType === 'avatar_generation' || Boolean(task?.avatarRenderState?.taskId);

export const getAvatarTaskStatus = (task = {}) => String(task?.avatarRenderState?.status || task?.status || '').trim().toLowerCase();

export const isTerminalAvatarTask = (task = {}) => {
  const taskStatus = String(task?.status || '').trim().toLowerCase();
  const avatarStatus = String(task?.avatarRenderState?.status || '').trim().toLowerCase();
  return terminalAvatarStates.has(taskStatus) || terminalAvatarStates.has(avatarStatus);
};

export const mergeMaterialQueueTask = (existing, incoming) => {
  if (!existing) return incoming;
  const existingIsAvatar = isMaterialAvatarTask(existing);
  const incomingIsAvatar = isMaterialAvatarTask(incoming);
  const primary = existingIsAvatar && !incomingIsAvatar ? incoming : existing;
  const secondary = primary === existing ? incoming : existing;
  const avatarTask = incomingIsAvatar ? incoming : (existingIsAvatar ? existing : null);
  const merged = {
    ...primary,
    logs: [
      ...(Array.isArray(primary.logs) ? primary.logs : []),
      ...(Array.isArray(secondary.logs) ? secondary.logs : [])
    ].slice(-200),
    avatarRenderState: primary.avatarRenderState || secondary.avatarRenderState || null,
    outputPath: primary.outputPath || secondary.outputPath || '',
    sourceMeta: Object.keys(primary.sourceMeta || {}).length ? primary.sourceMeta : (secondary.sourceMeta || {}),
    sourcePost: primary.sourcePost || secondary.sourcePost || null,
    updatedAt: String(primary.updatedAt || '').localeCompare(String(secondary.updatedAt || '')) >= 0
      ? primary.updatedAt
      : secondary.updatedAt
  };
  if (avatarTask && !isTerminalAvatarTask(avatarTask)) {
    merged.status = 'generating_avatar';
    merged.currentStep = Math.max(Number(merged.currentStep || 0), 6);
    merged.progress = Math.max(Number(merged.progress || 0), Number(avatarTask.progress || 0), 86);
    merged.statusText = avatarTask.statusText || merged.statusText || 'RunningHub 数字人合成中';
    merged.error = '';
  }
  return merged;
};

export const getGroupedMaterialTasks = (tasks) => {
  const grouped = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const key = getMaterialQueueKey(task);
    if (!key) continue;
    grouped.set(key, mergeMaterialQueueTask(grouped.get(key), task));
  }
  return Array.from(grouped.values());
};

export const getVerticalTaskMaterialKey = (task) => {
  const metadata = task?.metadata || {};
  const sourceTaskDir = String(
    task?.sourceTaskDir ||
    task?.materialTaskDir ||
    metadata.sourceTaskDir ||
    metadata.materialTaskDir ||
    metadata.sourceMaterialTaskDir ||
    ''
  ).trim();
  return sourceTaskDir ? `material:${sourceTaskDir}` : '';
};

export const normalizeUnifiedTaskForQueue = (task) => {
  const metadata = task?.metadata || {};
  if (task?.type === 'vertical_queue') {
    return {
      id: task.id,
      status: task.rawStatus || task.status,
      progress: task.progress,
      message: task.message,
      title: task.title || metadata.title || metadata.author || task.id,
      author: metadata.author || '',
      sourceTaskDir: metadata.sourceTaskDir || metadata.materialTaskDir || metadata.sourceMaterialTaskDir || '',
      materialTaskDir: metadata.materialTaskDir || metadata.sourceTaskDir || '',
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      createdAt: task.createdAt,
      fromUnifiedTaskView: true
    };
  }
  if (task?.type === 'standalone_vertical') {
    return {
      id: task.id,
      taskKey: task.taskKey || '',
      status: task.rawStatus || task.status,
      progress: task.progress,
      message: task.message,
      sourceTaskDir: metadata.sourceTaskDir || '',
      runtimeJobId: metadata.runtimeJobId || '',
      title: task.title || metadata.title || metadata.sourceTaskDir || task.id,
      stage: metadata.stage || '',
      errorDetails: metadata.errorDetails || metadata.error || '',
      updatedAt: task.updatedAt,
      startedAt: task.startedAt,
      createdAt: task.createdAt,
      fromUnifiedTaskView: true
    };
  }
  return null;
};
