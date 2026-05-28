const fs = require('fs');
const path = require('path');
const { activeTasks, taskClients } = require('./sharedState');
const { createDefaultAvatarConfig, normalizeSourceMeta, readTaskState, writeTaskState } = require('./taskState');
const { addTaskLog } = require('./events');
const { syncAvatarTask, syncMaterialTask } = require('./taskStoreBridge');
const { buildVersionedProjectFileUrl, nowIso, readJsonSafe } = require('./utils');

const ACTIVE_RUNNINGHUB_RENDER_STATUSES = new Set([
  '',
  'submitted',
  'polling',
  'polling_interrupted',
  'download_interrupted',
  'completed'
]);
const TERMINAL_AVATAR_STATUSES = new Set([
  'completed',
  'failed',
  'failure',
  'error',
  'canceled',
  'cancelled',
  'published'
]);
const FAILED_AVATAR_STATUSES = new Set(['failed', 'failure', 'error']);
const CANCELLED_AVATAR_STATUSES = new Set(['canceled', 'cancelled']);

function mergeSourceMeta(primary = {}, fallback = {}) {
  const normalizedPrimary = normalizeSourceMeta(primary || {});
  const normalizedFallback = normalizeSourceMeta(fallback || {});
  return {
    sourceAuthor: normalizedPrimary.sourceAuthor || normalizedFallback.sourceAuthor,
    sourcePostId: normalizedPrimary.sourcePostId || normalizedFallback.sourcePostId,
    sourcePartitionId: normalizedPrimary.sourcePartitionId || normalizedFallback.sourcePartitionId,
    sourcePartitionLabel: normalizedPrimary.sourcePartitionLabel || normalizedFallback.sourcePartitionLabel,
    sourceRank: normalizedPrimary.sourceRank || normalizedFallback.sourceRank,
    videoUrl: normalizedPrimary.videoUrl || normalizedFallback.videoUrl,
    postUrl: normalizedPrimary.postUrl || normalizedFallback.postUrl
  };
}

function createMaterialDrivenTaskRegistry(paths, options = {}) {
  const taskStore = options.taskStore || null;
  function inferJobIdFromOutputDir(outputDir = '') {
    const value = String(outputDir || '').trim();
    const matched = value.match(/^material_(.+)$/);
    return matched ? matched[1] : value;
  }

  function readPersistedAvatarState(outputPath) {
    return readJsonSafe(path.join(outputPath, 'avatar_render_state.json'), null);
  }

  function isActiveRunningHubAvatarState(avatarState) {
    if (!avatarState || typeof avatarState !== 'object') return false;
    if (String(avatarState.provider || '').trim().toLowerCase() !== 'runninghub') return false;
    if (!String(avatarState.taskId || '').trim()) return false;
    const status = String(avatarState.status || '').trim().toLowerCase();
    return ACTIVE_RUNNINGHUB_RENDER_STATUSES.has(status);
  }

  function getRecoveredRunningHubStatusText(avatarState) {
    const taskId = String(avatarState?.taskId || '').trim();
    const status = String(avatarState?.status || '').trim().toLowerCase();
    if (status === 'download_interrupted') {
      return `RunningHub 已返回结果，等待下载数字人视频，taskId=${taskId}`;
    }
    if (status === 'completed') {
      return `RunningHub 渲染完成，等待写入本地数字人视频，taskId=${taskId}`;
    }
    if (status === 'polling_interrupted') {
      return `RunningHub 数字人任务正在远端运行，可恢复查询，taskId=${taskId}`;
    }
    return `RunningHub 数字人合成中，taskId=${taskId}`;
  }

  function getRecoveredRunningHubProgress(avatarState) {
    const status = String(avatarState?.status || '').trim().toLowerCase();
    if (status === 'download_interrupted' || status === 'completed') return 89;
    return 86;
  }

  function getAvatarTerminalStatus(avatarState) {
    const status = String(avatarState?.status || '').trim().toLowerCase();
    if (FAILED_AVATAR_STATUSES.has(status)) return 'failed';
    if (CANCELLED_AVATAR_STATUSES.has(status)) return 'cancelled';
    return '';
  }

  function buildRecoveredTaskFromDir(outputDir, options = {}) {
    const safeOutputDir = String(outputDir || '').trim();
    if (!safeOutputDir) return null;
    const outputPath = path.join(paths.PROJECTS_DIR, safeOutputDir);
    if (!fs.existsSync(outputPath)) return null;

    const persistedState = readTaskState(outputPath);
    const sourcePost = readJsonSafe(path.join(outputPath, 'source_post.json'), null);
    const avatarState = readPersistedAvatarState(outputPath);
    const finalVideoPath = path.join(outputPath, 'output_final.mp4');
    const hasFinalVideo = fs.existsSync(finalVideoPath);
    const finalVideoUpdatedAt = hasFinalVideo ? fs.statSync(finalVideoPath).mtime.toISOString() : '';
    const hasAimanVideo = fs.existsSync(path.join(outputPath, 'aiman.mp4'));
    const hasNarration = fs.existsSync(path.join(outputPath, 'narration.json'));
    const hasEditPlan = fs.existsSync(path.join(outputPath, 'edit_plan.json'));
    const hasSelectedSegments = fs.existsSync(path.join(outputPath, 'selected_segments.json'));
    const hasRunningHubTask = isActiveRunningHubAvatarState(avatarState);
    const avatarTerminalStatus = getAvatarTerminalStatus(avatarState);

    let currentStep = 1;
    let progress = 0;
    let status = 'completed';
    let statusText = '已从磁盘恢复任务状态';
    let completedAt = hasFinalVideo ? finalVideoUpdatedAt : null;

    if (hasFinalVideo) {
      currentStep = 7;
      progress = 100;
      status = 'completed';
      statusText = '制作完成';
    } else if (avatarTerminalStatus) {
      currentStep = 6;
      progress = 86;
      status = avatarTerminalStatus;
      statusText = String(avatarState?.error || '').trim() || 'RunningHub 数字人任务已结束';
      completedAt = null;
    } else if (hasAimanVideo) {
      currentStep = 7;
      progress = 90;
      status = 'waiting_render';
      statusText = '数字人已就绪，等待最终渲染';
      completedAt = null;
    } else if (hasRunningHubTask) {
      currentStep = 6;
      progress = getRecoveredRunningHubProgress(avatarState);
      status = 'generating_avatar';
      statusText = getRecoveredRunningHubStatusText(avatarState);
      completedAt = null;
    } else if (hasNarration) {
      currentStep = 6;
      progress = 72;
      status = 'waiting_avatar';
      statusText = '脚本已生成，等待生成数字人';
      completedAt = null;
    } else if (hasEditPlan) {
      currentStep = 5;
      progress = 56;
      status = 'ready_to_narration';
      statusText = '编排已完成，等待生成口播稿';
      completedAt = null;
    } else if (hasSelectedSegments) {
      currentStep = 4;
      progress = 36;
      status = 'ready_to_plan';
      statusText = '切片已完成，等待编排规划';
      completedAt = null;
    } else {
      currentStep = 1;
      progress = 5;
      status = 'recovered';
      statusText = '已恢复初始素材状态';
      completedAt = null;
    }

    const recovered = {
      id: options.jobId || inferJobIdFromOutputDir(safeOutputDir),
      process: null,
      outputPath,
      useSmartClip: persistedState.useSmartClip,
      useCache: persistedState.useCache,
      autoGenerate: persistedState.autoGenerate,
      status,
      currentStep,
      progress,
      statusText,
      logs: [],
      startedAt: avatarState?.submittedAt || sourcePost?.savedAt || null,
      updatedAt: finalVideoUpdatedAt || avatarState?.updatedAt || sourcePost?.savedAt || nowIso(),
      completedAt,
      error: String(avatarState?.status || '').trim().toLowerCase() === 'failed'
        ? String(avatarState?.error || '')
        : '',
      videoUrl: hasFinalVideo ? buildVersionedProjectFileUrl(safeOutputDir, finalVideoPath) : '',
      outputDir: safeOutputDir,
      lastStdout: '',
      lastStderr: '',
      sourceMeta: mergeSourceMeta(persistedState.sourceMeta, sourcePost),
      avatarConfig: persistedState.avatarConfig,
      sourcePost,
      avatarRenderState: avatarState || null
    };
    if (options.includeRecoveryLog !== false) {
      addTaskLog(recovered, `任务已从项目目录恢复，识别到当前进度：步骤 ${currentStep} (${statusText})`, 'info');
    }
    return recovered;
  }

  function persistTaskStateSnapshot(task) {
    if (!task?.outputPath) return;
    writeTaskState(task.outputPath, {
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      autoGenerate: task.autoGenerate,
      sourceMeta: mergeSourceMeta(task.sourceMeta, task.sourcePost),
      avatarConfig: task.avatarConfig || createDefaultAvatarConfig()
    });
    syncMaterialTask(taskStore, task);
    const avatarState = readPersistedAvatarState(task.outputPath);
    if (avatarState?.provider || avatarState?.taskId) {
      syncAvatarTask(taskStore, task, avatarState);
    }
  }

  function resolveTask(jobId, outputDir = '') {
    const existing = activeTasks.get(jobId);
    if (existing) return existing;

    const safeOutputDir = String(outputDir || '').trim();
    if (!safeOutputDir) return null;

    const recovered = buildRecoveredTaskFromDir(safeOutputDir, { jobId });
    if (!recovered) return null;
    activeTasks.set(jobId, recovered);
    persistTaskStateSnapshot(recovered);
    return recovered;
  }

  function buildStatusPayload(task) {
    const sourcePost = readJsonSafe(path.join(task.outputPath, 'source_post.json'), task.sourcePost || null);
    const narration = readJsonSafe(path.join(task.outputPath, 'narration.json'), null);
    const scriptUnits = readJsonSafe(path.join(task.outputPath, 'script_units.json'), null);
    const editPlan = readJsonSafe(path.join(task.outputPath, 'edit_plan.json'), null);
    const executionPlan = readJsonSafe(path.join(task.outputPath, 'execution_plan.json'), null);
    const avatarSegments = readJsonSafe(path.join(task.outputPath, 'avatar_segments.json'), null);
    const sourceMeta = mergeSourceMeta(task.sourceMeta, sourcePost);
    const outputDir = task.outputDir || path.basename(task.outputPath || '');
    const finalVideoUrl = buildVersionedProjectFileUrl(
      outputDir,
      path.join(task.outputPath || '', 'output_final.mp4')
    );
    const avatarRenderState = task.avatarRenderState || readPersistedAvatarState(task.outputPath) || null;
    const avatarTerminalStatus = getAvatarTerminalStatus(avatarRenderState);
    const payload = {
      success: true,
      task: {
        id: task.id,
        status: avatarTerminalStatus || task.status || 'unknown',
        currentStep: Number(task.currentStep || 0),
        progress: Number(task.progress || 0),
        statusText: task.statusText || '',
        logs: Array.isArray(task.logs) ? task.logs : [],
        startedAt: task.startedAt || null,
        updatedAt: task.updatedAt || null,
        completedAt: task.completedAt || null,
        error: avatarTerminalStatus === 'failed'
          ? String(avatarRenderState?.error || task.error || '')
          : (task.error || ''),
        videoUrl: finalVideoUrl || task.videoUrl || '',
        outputPath: task.outputDir || '',
        sourceMeta,
        avatarConfig: task.avatarConfig || createDefaultAvatarConfig(),
        sourcePost: sourcePost || null,
        avatarRenderState,
        narration: narration || null,
        scriptUnits: scriptUnits || null,
        editPlan: editPlan || null,
        executionPlan: executionPlan || null,
        avatarSegments: avatarSegments || null
      }
    };
    syncMaterialTask(taskStore, task, {
      videoUrl: payload.task.videoUrl,
      outputDir
    });
    const avatarState = payload.task.avatarRenderState || null;
    if (avatarState?.provider || avatarState?.taskId) {
      syncAvatarTask(taskStore, task, avatarState);
    }
    return payload;
  }

  function buildDbStatusPayload(task) {
    const metadata = task.metadata || {};
    const avatarState = metadata.avatarRenderState && typeof metadata.avatarRenderState === 'object'
      ? metadata.avatarRenderState
      : null;
    const avatarTerminalStatus = getAvatarTerminalStatus(avatarState);
    return {
      id: String(metadata.outputDir || task.id || '').replace(/^material_/, ''),
      status: avatarTerminalStatus || metadata.stage || task.status,
      currentStep: Number(metadata.currentStep || 0),
      progress: Number(task.progress || 0),
      statusText: task.message || '',
      logs: task.logs || [],
      startedAt: task.startedAt || null,
      updatedAt: task.updatedAt || null,
      completedAt: task.completedAt || null,
      error: avatarTerminalStatus === 'failed'
        ? String(avatarState?.error || metadata.error || task.message || '')
        : (metadata.error || ''),
      videoUrl: metadata.videoUrl || '',
      outputPath: metadata.outputDir || '',
      sourceMeta: metadata.sourceMeta || {},
      avatarConfig: {},
      sourcePost: null,
      avatarRenderState: avatarState,
      fromTaskStore: true,
      taskStoreId: task.id,
      taskKey: task.taskKey || ''
    };
  }

  function buildDbAvatarStatusPayload(task) {
    const metadata = task.metadata || {};
    const outputDir = String(metadata.outputDir || '').trim();
    const providerTaskId = String(metadata.providerTaskId || '').trim();
    return {
      id: providerTaskId || task.id,
      status: metadata.stage || task.status,
      currentStep: 6,
      progress: Number(task.progress || 0),
      statusText: task.message || '',
      logs: task.logs || [],
      startedAt: task.startedAt || null,
      updatedAt: task.updatedAt || null,
      completedAt: task.completedAt || null,
      error: metadata.error || '',
      videoUrl: metadata.videoUrl || '',
      outputPath: outputDir,
      sourceMeta: {},
      avatarConfig: {},
      sourcePost: null,
      avatarRenderState: {
        provider: metadata.provider || '',
        taskId: providerTaskId,
        status: metadata.stage || task.status,
        videoUrl: metadata.videoUrl || '',
        error: metadata.error || ''
      },
      fromTaskStore: true,
      taskType: 'avatar_generation',
      taskStoreId: task.id,
      taskKey: task.taskKey || ''
    };
  }

  function hasCompletedMaterialOutput(outputDir = '') {
    const safeOutputDir = String(outputDir || '').trim();
    if (!safeOutputDir) return false;
    const finalVideoPath = path.join(paths.PROJECTS_DIR, safeOutputDir, 'output_final.mp4');
    try {
      return fs.existsSync(finalVideoPath) && fs.statSync(finalVideoPath).isFile();
    } catch (_err) {
      return false;
    }
  }

  function getTaskGroupKey(payload = {}) {
    const outputPath = String(payload.outputPath || payload.outputDir || '').trim();
    if (outputPath) return `material:${outputPath}`;
    const taskKey = String(payload.taskKey || '').trim();
    if (taskKey.startsWith('material:')) return taskKey;
    if (taskKey.startsWith('runninghub:')) return `avatar:${taskKey}`;
    return `${payload.taskType || 'task'}:${payload.id || taskKey}`;
  }

  function isAvatarPayload(payload = {}) {
    return payload.taskType === 'avatar_generation' || Boolean(payload.avatarRenderState?.taskId);
  }

  function isActiveAvatarPayload(payload = {}) {
    const status = String(payload.status || '').trim().toLowerCase();
    const avatarStatus = String(payload.avatarRenderState?.status || '').trim().toLowerCase();
    return isAvatarPayload(payload) &&
      !TERMINAL_AVATAR_STATUSES.has(status) &&
      !TERMINAL_AVATAR_STATUSES.has(avatarStatus);
  }

  function mergeStatusPayload(existing, incoming) {
    if (!existing) return incoming;
    const existingIsAvatar = isAvatarPayload(existing);
    const incomingIsAvatar = isAvatarPayload(incoming);
    const primary = existingIsAvatar && !incomingIsAvatar ? incoming : existing;
    const secondary = primary === existing ? incoming : existing;
    const merged = {
      ...primary,
      logs: [
        ...(Array.isArray(primary.logs) ? primary.logs : []),
        ...(Array.isArray(secondary.logs) ? secondary.logs : [])
      ].slice(-200),
      avatarRenderState: primary.avatarRenderState || secondary.avatarRenderState || null,
      avatarTaskStoreId: primary.avatarTaskStoreId || secondary.avatarTaskStoreId || (
        secondary.taskType === 'avatar_generation' ? secondary.taskStoreId : ''
      ),
      taskKey: primary.taskKey || secondary.taskKey || '',
      updatedAt: String(primary.updatedAt || '').localeCompare(String(secondary.updatedAt || '')) >= 0
        ? primary.updatedAt
        : secondary.updatedAt
    };
    const avatarPayload = incomingIsAvatar ? incoming : (existingIsAvatar ? existing : null);
    if (avatarPayload && isActiveAvatarPayload(avatarPayload)) {
      const avatarIsNewer = String(avatarPayload.updatedAt || '').localeCompare(String(merged.updatedAt || '')) > 0;
      merged.status = 'generating_avatar';
      merged.currentStep = Math.max(Number(merged.currentStep || 0), 6);
      merged.progress = Math.max(Number(merged.progress || 0), Number(avatarPayload.progress || 0), 86);
      merged.error = '';
      merged.statusText = avatarIsNewer
        ? (avatarPayload.statusText || merged.statusText || 'RunningHub 数字人合成中')
        : (merged.statusText || avatarPayload.statusText || 'RunningHub 数字人合成中');
    }
    if (!merged.outputPath) merged.outputPath = secondary.outputPath || secondary.outputDir || '';
    if (!merged.sourceMeta || !Object.keys(merged.sourceMeta).length) {
      merged.sourceMeta = secondary.sourceMeta || {};
    }
    if (!merged.sourcePost) merged.sourcePost = secondary.sourcePost || null;
    return merged;
  }

  function putStatusPayload(tasksByGroup, payload) {
    const key = getTaskGroupKey(payload);
    if (!key) return;
    tasksByGroup.set(key, mergeStatusPayload(tasksByGroup.get(key), payload));
  }

  function listActiveStatusPayloads() {
    const tasksByGroup = new Map();
    for (const task of activeTasks.values()) {
      const payload = buildStatusPayload(task).task;
      putStatusPayload(tasksByGroup, payload);
    }

    let entries = [];
    try {
      entries = fs.readdirSync(paths.PROJECTS_DIR, { withFileTypes: true });
    } catch (_err) {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^material_[A-Za-z0-9_.-]+$/.test(entry.name)) continue;
      const recovered = buildRecoveredTaskFromDir(entry.name, { includeRecoveryLog: false });
      if (!recovered) continue;
      if (!isActiveRunningHubAvatarState(recovered.avatarRenderState)) continue;
      const payload = buildStatusPayload(recovered).task;
      putStatusPayload(tasksByGroup, payload);
    }

    if (taskStore && typeof taskStore.listActiveTasks === 'function') {
      for (const dbTask of taskStore.listActiveTasks('material_driven')) {
        const payload = buildDbStatusPayload(dbTask);
        if (!payload.outputPath) continue;
        putStatusPayload(tasksByGroup, payload);
      }
      for (const dbTask of taskStore.listActiveTasks('avatar_generation')) {
        const payload = buildDbAvatarStatusPayload(dbTask);
        if (!payload.id) continue;
        if (payload.outputPath && hasCompletedMaterialOutput(payload.outputPath)) continue;
        putStatusPayload(tasksByGroup, payload);
      }
    }

    return Array.from(tasksByGroup.values())
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function getLatestCompletedStatusPayload() {
    let entries = [];
    try {
      entries = fs.readdirSync(paths.PROJECTS_DIR, { withFileTypes: true });
    } catch (_err) {
      entries = [];
    }

    let latest = null;
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^material_[A-Za-z0-9_.-]+$/.test(entry.name)) continue;
      const recovered = buildRecoveredTaskFromDir(entry.name, { includeRecoveryLog: false });
      if (!recovered || recovered.status !== 'completed' || !recovered.videoUrl) continue;
      if (!latest || String(recovered.updatedAt || '').localeCompare(String(latest.updatedAt || '')) > 0) {
        latest = recovered;
      }
    }

    return latest ? buildStatusPayload(latest).task : null;
  }

  function attachProgressClient(jobId, req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`event: status\ndata: ${JSON.stringify({ message: '已连接' })}\n\n`);

    let clients = taskClients.get(jobId);
    if (!clients) {
      clients = new Set();
      taskClients.set(jobId, clients);
    }
    clients.add(res);

    const task = activeTasks.get(jobId);
    if (task) {
      res.write(`event: status\ndata: ${JSON.stringify({ message: task.statusText || '工作流已启动' })}\n\n`);
      if (Number.isFinite(Number(task.currentStep)) && task.currentStep > 0) {
        res.write(`event: step\ndata: ${JSON.stringify({ step: task.currentStep, message: `步骤${task.currentStep}` })}\n\n`);
      }
      res.write(`event: progress\ndata: ${JSON.stringify({ percent: Number(task.progress || 0), message: task.statusText || '' })}\n\n`);
      if (task.status === 'completed' && task.videoUrl) {
        res.write(`event: complete\ndata: ${JSON.stringify({ videoUrl: task.videoUrl })}\n\n`);
      } else if (task.status === 'failed' && task.error) {
        res.write(`event: error_event\ndata: ${JSON.stringify({ message: task.error })}\n\n`);
      }
    }

    const keepAlive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      const set = taskClients.get(jobId);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          taskClients.delete(jobId);
        }
      }
    });
  }

  return {
    persistTaskStateSnapshot,
    resolveTask,
    buildStatusPayload,
    listActiveStatusPayloads,
    getLatestCompletedStatusPayload,
    attachProgressClient
  };
}

module.exports = { createMaterialDrivenTaskRegistry, mergeSourceMeta };
