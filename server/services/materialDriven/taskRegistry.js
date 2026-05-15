const fs = require('fs');
const path = require('path');
const { activeTasks, taskClients } = require('./sharedState');
const { createDefaultAvatarConfig, normalizeSourceMeta, readTaskState, writeTaskState } = require('./taskState');
const { addTaskLog } = require('./events');
const { buildVersionedProjectFileUrl, nowIso, readJsonSafe } = require('./utils');

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

function createMaterialDrivenTaskRegistry(paths) {
  function persistTaskStateSnapshot(task) {
    if (!task?.outputPath) return;
    writeTaskState(task.outputPath, {
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      autoGenerate: task.autoGenerate,
      sourceMeta: mergeSourceMeta(task.sourceMeta, task.sourcePost),
      avatarConfig: task.avatarConfig || createDefaultAvatarConfig()
    });
  }

  function resolveTask(jobId, outputDir = '') {
    const existing = activeTasks.get(jobId);
    if (existing) return existing;

    const safeOutputDir = String(outputDir || '').trim();
    if (!safeOutputDir) return null;

    const outputPath = path.join(paths.PROJECTS_DIR, safeOutputDir);
    if (!fs.existsSync(outputPath)) return null;
    const persistedState = readTaskState(outputPath);

    const finalVideoPath = path.join(outputPath, 'output_final.mp4');
    const hasFinalVideo = fs.existsSync(finalVideoPath);
    const hasAimanVideo = fs.existsSync(path.join(outputPath, 'aiman.mp4'));
    const hasNarration = fs.existsSync(path.join(outputPath, 'narration.json'));
    const hasEditPlan = fs.existsSync(path.join(outputPath, 'edit_plan.json'));
    const hasSelectedSegments = fs.existsSync(path.join(outputPath, 'selected_segments.json'));

    let currentStep = 1;
    let progress = 0;
    let status = 'completed';
    let statusText = '已从磁盘恢复任务状态';

    if (hasFinalVideo) {
      currentStep = 7;
      progress = 100;
      status = 'completed';
      statusText = '制作完成';
    } else if (hasAimanVideo) {
      currentStep = 7;
      progress = 90;
      status = 'waiting_render';
      statusText = '数字人已就绪，等待最终渲染';
    } else if (hasNarration) {
      currentStep = 6;
      progress = 72;
      status = 'waiting_avatar';
      statusText = '脚本已生成，等待生成数字人';
    } else if (hasEditPlan) {
      currentStep = 5;
      progress = 56;
      status = 'ready_to_narration';
      statusText = '编排已完成，等待生成口播稿';
    } else if (hasSelectedSegments) {
      currentStep = 4;
      progress = 36;
      status = 'ready_to_plan';
      statusText = '切片已完成，等待编排规划';
    } else {
      currentStep = 1;
      progress = 5;
      status = 'recovered';
      statusText = '已恢复初始素材状态';
    }

    const recovered = {
      id: jobId,
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
      startedAt: null,
      updatedAt: nowIso(),
      completedAt: hasFinalVideo ? nowIso() : null,
      error: '',
      videoUrl: hasFinalVideo ? buildVersionedProjectFileUrl(safeOutputDir, finalVideoPath) : '',
      outputDir: safeOutputDir,
      lastStdout: '',
      lastStderr: '',
      sourceMeta: persistedState.sourceMeta,
      avatarConfig: persistedState.avatarConfig
    };
    addTaskLog(recovered, `任务已从项目目录恢复，识别到当前进度：步骤 ${currentStep} (${statusText})`, 'info');
    activeTasks.set(jobId, recovered);
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
    return {
      success: true,
      task: {
        id: task.id,
        status: task.status || 'unknown',
        currentStep: Number(task.currentStep || 0),
        progress: Number(task.progress || 0),
        statusText: task.statusText || '',
        logs: Array.isArray(task.logs) ? task.logs : [],
        startedAt: task.startedAt || null,
        updatedAt: task.updatedAt || null,
        completedAt: task.completedAt || null,
        error: task.error || '',
        videoUrl: finalVideoUrl || task.videoUrl || '',
        outputPath: task.outputDir || '',
        sourceMeta,
        avatarConfig: task.avatarConfig || createDefaultAvatarConfig(),
        sourcePost: sourcePost || null,
        narration: narration || null,
        scriptUnits: scriptUnits || null,
        editPlan: editPlan || null,
        executionPlan: executionPlan || null,
        avatarSegments: avatarSegments || null
      }
    };
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
    attachProgressClient
  };
}

module.exports = { createMaterialDrivenTaskRegistry, mergeSourceMeta };
