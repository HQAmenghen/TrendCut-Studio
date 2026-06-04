const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { activeTasks } = require('./sharedState');
const { buildMaterialDrivenPipelineArgs, resolveRetryPipelinePlan } = require('./retryPlan');
const {
  addTaskLog,
  collectStderr,
  emitNarrationSummary,
  emitTaskEvent,
  parseAndEmitProgress,
  summarizeFailureMessage
} = require('./events');
const { syncMaterialTask } = require('./taskStoreBridge');
const { buildVersionedProjectFileUrl, nowIso } = require('./utils');
const {
  AVATAR_MOTION_SOURCE_FILE
} = require('./avatarMotion');

const SCRIPT_PATH = path.join(__dirname, '../../../python/pipeline/run_material_driven.py');
const DUPLICATE_ACTION_LOG_INTERVAL_MS = 10000;
const RETRYABLE_TERMINAL_AVATAR_STATUSES = new Set(['failed', 'failure', 'error', 'canceled', 'cancelled']);
const AVATAR_RENDER_STATE_FILE = 'avatar_render_state.json';

function createPythonEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    CODEX_PYTHON_PROTOCOL: 'jsonl-v1'
  };
}

function markTaskFailed(jobId, task, message, taskStore) {
  task.status = 'failed';
  task.statusText = message;
  task.error = task.error || message;
  task.completedAt = nowIso();
  task.updatedAt = nowIso();
  task.process = null;
  addTaskLog(task, message, 'error');
  syncMaterialTask(taskStore, task, { error: message });
  emitTaskEvent(jobId, 'error_event', { message });
}

function markTaskWaitingForAvatar(jobId, task, taskStore) {
  task.status = 'waiting_avatar';
  task.progress = Math.max(Number(task.progress || 0), 80);
  task.currentStep = Math.max(Number(task.currentStep || 0), 5);
  task.statusText = '前置步骤完成，等待数字人素材（aiman.mp4）后继续';
  task.updatedAt = nowIso();
  task.process = null;
  addTaskLog(task, task.statusText, 'info');
  syncMaterialTask(taskStore, task);
  emitTaskEvent(jobId, 'status', { message: task.statusText });
  emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
}

function markTaskCompleted(jobId, task, options = {}) {
  const taskStore = options.taskStore || null;
  const outputDir = path.basename(task.outputPath);
  const shouldCheckVideo = options.checkVideoExists !== false;
  const finalVideoPath = path.join(task.outputPath, 'output_final.mp4');
  const videoUrl = !shouldCheckVideo || fs.existsSync(finalVideoPath)
    ? buildVersionedProjectFileUrl(outputDir, finalVideoPath)
    : '';
  task.status = 'completed';
  task.progress = 100;
  task.currentStep = 7;
  task.statusText = '制作完成';
  task.videoUrl = videoUrl;
  task.completedAt = nowIso();
  task.updatedAt = nowIso();
  task.process = null;
  addTaskLog(task, '制作完成', 'success');
  syncMaterialTask(taskStore, task, { videoUrl });
  emitTaskEvent(jobId, 'complete', { videoUrl });
}

function isProcessActive(process) {
  if (!process) return false;
  if ('killed' in process && process.killed) return false;
  if ('exitCode' in process && process.exitCode !== null) return false;
  return true;
}

function isTaskRunInFlight(task) {
  return Boolean(task?.pipelineRun?.inFlight);
}

function noteTaskAlreadyRunning(jobId, task, taskStore, message = '任务已在运行，已切换为观察状态') {
  const now = Date.now();
  const lastLoggedAt = Number(task.lastDuplicateActionLoggedAt || 0);
  task.updatedAt = nowIso();
  if (now - lastLoggedAt > DUPLICATE_ACTION_LOG_INTERVAL_MS) {
    task.lastDuplicateActionLoggedAt = now;
    addTaskLog(task, message, 'info');
  }
  syncMaterialTask(taskStore, task);
  emitTaskEvent(jobId, 'status', { message });
  emitTaskEvent(jobId, 'progress', {
    percent: Number(task.progress || 0),
    message: task.statusText || message
  });
  return {
    reused: true,
    alreadyRunning: true,
    message,
    task
  };
}

function beginTaskRun(jobId, task, taskStore, runKey, busyMessage) {
  if (isProcessActive(task.process) || isTaskRunInFlight(task)) {
    return noteTaskAlreadyRunning(jobId, task, taskStore, busyMessage);
  }
  task.pipelineRun = {
    inFlight: true,
    runKey,
    startedAt: nowIso()
  };
  task.updatedAt = nowIso();
  syncMaterialTask(taskStore, task);
  return null;
}

function clearTaskRun(task, runKey) {
  if (!task?.pipelineRun) return;
  if (!runKey || task.pipelineRun.runKey === runKey) {
    task.pipelineRun = null;
  }
}

function resetTerminalAvatarStateForRetry(task) {
  const state = task?.avatarRenderState;
  const status = String(state?.status || '').trim().toLowerCase();
  if (!state?.taskId || !RETRYABLE_TERMINAL_AVATAR_STATUSES.has(status)) return null;
  const previousTaskId = String(state.taskId || '').trim();
  const previousError = String(state.error || '').trim();
  task.avatarRenderState = {
    provider: state.provider || 'runninghub',
    status: 'retrying',
    previousTaskId,
    previousStatus: status,
    previousError,
    taskId: '',
    error: '',
    retryStartedAt: nowIso()
  };
  return { previousTaskId, previousStatus: status };
}

function readAvatarRenderState(outputPath) {
  if (!outputPath) return null;
  const statePath = path.join(outputPath, AVATAR_RENDER_STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

function hasPoseNodeInput(state = {}) {
  if (String(state?.remotePoseName || '').trim()) return true;
  const nodeInfoList = Array.isArray(state?.nodeInfoList) ? state.nodeInfoList : [];
  return nodeInfoList.some((item) => {
    const fieldName = String(item?.fieldName || '').trim().toLowerCase();
    return fieldName === 'video' && String(item?.fieldValue || '').trim();
  });
}

function hasUsableFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_err) {
    return false;
  }
}

function hasRequiredMotionControlledAvatar(task) {
  const motionSourcePath = path.join(task.outputPath, AVATAR_MOTION_SOURCE_FILE);
  if (!hasUsableFile(motionSourcePath)) return false;
  const renderState = readAvatarRenderState(task.outputPath) || task.avatarRenderState || {};
  const provider = String(renderState?.provider || task?.avatarConfig?.renderProvider || '').trim().toLowerCase();
  if (provider === 'runninghub') {
    return hasPoseNodeInput(renderState);
  }
  return true;
}

function createMaterialDrivenPipelineRunner({ autoGenerateAvatar, taskStore = null, onTaskSettled = null } = {}) {
  function settleTask(jobId, task, reason) {
    if (typeof onTaskSettled === 'function') {
      onTaskSettled(jobId, task, reason);
    }
  }

  function launchFromAvatarReady(jobId, task) {
    return spawnPipeline(jobId, task, 6, {
      step: 6,
      progressValue: 88,
      statusText: '继续处理数字人映射并执行混剪',
      startLog: '数字人已就绪，从步骤6继续执行新链路',
      stepMessage: '步骤6: 生成数字人/切分映射'
    });
  }

  function continueFromAvatarStep(jobId, task) {
    const busy = beginTaskRun(jobId, task, taskStore, `continue:${jobId}`, '任务已在继续执行，已切换为观察状态');
    if (busy) return busy;
    clearTaskRun(task, `continue:${jobId}`);
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    const hasAimanVideo = fs.existsSync(aimanPath);
    const shouldRegenerateForMotion = task.autoGenerate && hasAimanVideo && !hasRequiredMotionControlledAvatar(task);
    if (task.autoGenerate && (!hasAimanVideo || shouldRegenerateForMotion)) {
      task.lastStdout = '';
      task.lastStderr = '';
      task.process = null;
      task.status = 'generating_avatar';
      task.currentStep = 6;
      task.progress = Math.max(Number(task.progress || 0), 86);
      task.statusText = shouldRegenerateForMotion
        ? '正在强制生成动作参考并重新合成数字人...'
        : '正在恢复数字人合成结果...';
      task.error = '';
      task.updatedAt = nowIso();
      addTaskLog(
        task,
        shouldRegenerateForMotion
          ? '检测到现有数字人缺少强制动作参考输入，重新生成动作参考视频并提交姿态节点'
          : '步骤6缺少 aiman.mp4，先恢复数字人生成结果再继续混剪',
        'info'
      );
      emitTaskEvent(jobId, 'status', { message: task.statusText });
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
      syncMaterialTask(taskStore, task);
      return runAutoAvatarThenContinue(jobId, task, '继续自动生成数字人失败');
    }
    return launchFromAvatarReady(jobId, task);
  }

  function runAutoAvatarThenContinue(jobId, task, fallbackMessage) {
    const runKey = `avatar:${jobId}`;
    const busy = beginTaskRun(jobId, task, taskStore, runKey, '数字人恢复任务已在运行，已切换为观察状态');
    if (busy) return busy;
    (async () => {
      try {
        await autoGenerateAvatar(jobId, task);
        clearTaskRun(task, runKey);
        launchFromAvatarReady(jobId, task);
      } catch (err) {
        clearTaskRun(task, runKey);
        const message = err?.message || fallbackMessage;
        task.status = 'failed';
        task.error = message;
        task.statusText = message;
        task.completedAt = nowIso();
        task.updatedAt = nowIso();
        task.process = null;
        addTaskLog(task, message, 'error');
        syncMaterialTask(taskStore, task, { error: message });
        emitTaskEvent(jobId, 'error_event', { message });
        settleTask(jobId, task, 'avatar_failed');
      }
    })();
    return {
      reused: false,
      alreadyRunning: false,
      message: task.statusText || '数字人恢复任务已启动',
      task
    };
  }

  function attachPythonProcess(jobId, task, pythonProcess, options = {}) {
    const {
      step = 7,
      progressValue = 88,
      statusText = '处理中',
      startLog = '开始执行任务',
      stepMessage = `步骤${step}`,
      runKey = ''
    } = options;

    task.lastStdout = '';
    task.lastStderr = '';
    task.process = pythonProcess;
    task.status = 'running';
    task.currentStep = step;
    task.progress = Math.max(Number(task.progress || 0), progressValue);
    task.statusText = statusText;
    task.error = '';
    task.updatedAt = nowIso();
    addTaskLog(task, startLog, 'info');
    syncMaterialTask(taskStore, task);
    emitTaskEvent(jobId, 'step', { step, message: stepMessage });
    emitTaskEvent(jobId, 'status', { message: statusText });

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output, {
        syncTaskState: (latestTask, extraMetadata) => syncMaterialTask(taskStore, latestTask, extraMetadata)
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.warn(`[${jobId}] WARN: ${error}`);
      collectStderr(task, error);
    });

    pythonProcess.on('close', (code) => {
      clearTaskRun(task, runKey);
      if (code === 0) {
        markTaskCompleted(jobId, task, { checkVideoExists: false, taskStore });
        settleTask(jobId, task, 'completed');
        return;
      }
      markTaskFailed(jobId, task, summarizeFailureMessage(task, code), taskStore);
      settleTask(jobId, task, 'failed');
    });
  }

  function spawnPipeline(jobId, task, startFrom, extraOptions = {}) {
    const runKey = extraOptions.runKey || `pipeline:${jobId}:${startFrom}`;
    const busy = beginTaskRun(jobId, task, taskStore, runKey, '任务已有本地渲染进程在运行，已切换为观察状态');
    if (busy) return busy;
    const materialPath = path.join(task.outputPath, 'material.mp4');
    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: SCRIPT_PATH,
      materialPath,
      outputPath: task.outputPath,
      startFrom,
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      allowRuleFallback: task.allowRuleFallback,
      unbuffered: true
    });
    let pythonProcess;
    try {
      pythonProcess = spawn('python', args, {
        cwd: task.outputPath,
        env: createPythonEnv()
      });
    } catch (err) {
      clearTaskRun(task, runKey);
      throw err;
    }
    addTaskLog(task, `启动 Python 流水线: start-from=${startFrom}, smartClip=${task.useSmartClip ? 'on' : 'off'}, cache=${task.useCache ? 'on' : 'off'}`, 'info');
    syncMaterialTask(taskStore, task);
    attachPythonProcess(jobId, task, pythonProcess, { ...extraOptions, runKey });
    return pythonProcess;
  }

  function startInitialPipeline(jobId, task) {
    const runKey = `initial:${jobId}`;
    const busy = beginTaskRun(jobId, task, taskStore, runKey, '任务已在启动，已切换为观察状态');
    if (busy) return busy;
    const materialPath = path.join(task.outputPath, 'material.mp4');
    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: SCRIPT_PATH,
      materialPath,
      outputPath: task.outputPath,
      startFrom: 1,
      endAt: 5,
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      allowRuleFallback: task.allowRuleFallback,
      unbuffered: true
    });

    let pythonProcess;
    try {
      pythonProcess = spawn('python', args, {
        cwd: task.outputPath,
        env: createPythonEnv()
      });
    } catch (err) {
      clearTaskRun(task, runKey);
      throw err;
    }
    task.lastStdout = '';
    task.lastStderr = '';
    task.process = pythonProcess;
    syncMaterialTask(taskStore, task);

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const latest = activeTasks.get(jobId);
      if (latest) {
        latest.lastStdout = `${String(latest.lastStdout || '')}${output}`.slice(-40000);
      }
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output, {
        syncTaskState: (latestTask, extraMetadata) => syncMaterialTask(taskStore, latestTask, extraMetadata)
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.warn(`[${jobId}] WARN: ${error}`);
      const latest = activeTasks.get(jobId);
      if (latest) {
        collectStderr(latest, error);
      }
    });

    pythonProcess.on('close', (code) => {
      clearTaskRun(task, runKey);
      const latest = activeTasks.get(jobId);
      if (code === 0) {
        if (latest) {
          emitNarrationSummary(jobId, latest);
        }
        const hasFinalVideo = latest ? fs.existsSync(path.join(latest.outputPath, 'output_final.mp4')) : false;
        if (latest && latest.autoGenerate && !hasFinalVideo) {
          runAutoAvatarThenContinue(jobId, latest, '自动生成数字人失败');
          return;
        }
        if (latest) {
          markTaskWaitingForAvatar(jobId, latest, taskStore);
          settleTask(jobId, latest, 'waiting_avatar');
        }
      } else {
        const step6MissingAiman = latest?.autoGenerate &&
          String(latest?.lastStdout || '').includes('数字人视频未找到');
        if (latest && step6MissingAiman) {
          runAutoAvatarThenContinue(jobId, latest, '自动生成数字人失败');
          return;
        }
        const message = summarizeFailureMessage(latest, code);
        if (latest) {
          markTaskFailed(jobId, latest, message, taskStore);
          settleTask(jobId, latest, 'failed');
        } else {
          emitTaskEvent(jobId, 'error_event', { message });
          settleTask(jobId, task, 'failed');
        }
      }
    });

    return pythonProcess;
  }

  function startRetryPipeline(jobId, task, step) {
    const runKey = `retry:${jobId}:${step}`;
    const busy = beginTaskRun(jobId, task, taskStore, runKey, '任务正在执行中，本次重试未新建进程');
    if (busy) return busy;
    clearTaskRun(task, runKey);

    const requestedStep = Number(step);
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    const hasAimanVideo = fs.existsSync(aimanPath);
    const shouldRegenerateForMotion = task.autoGenerate && hasAimanVideo && !hasRequiredMotionControlledAvatar(task);
    if (task.autoGenerate && requestedStep === 6 && (!hasAimanVideo || shouldRegenerateForMotion)) {
      const resetAvatar = resetTerminalAvatarStateForRetry(task);
      task.lastStdout = '';
      task.lastStderr = '';
      task.process = null;
      task.status = 'generating_avatar';
      task.currentStep = 6;
      task.progress = Math.max(Number(task.progress || 0), 86);
      task.statusText = shouldRegenerateForMotion
        ? '重试步骤6：强制生成动作参考并重新合成数字人'
        : '重试步骤6：生成数字人';
      task.error = '';
      task.completedAt = null;
      task.updatedAt = nowIso();
      if (resetAvatar) {
        addTaskLog(task, `上次 RunningHub 任务已失败，本次重试将重新提交新任务: previousTaskId=${resetAvatar.previousTaskId}`, 'warning');
      }
      addTaskLog(
        task,
        shouldRegenerateForMotion
          ? '重试步骤6检测到现有数字人缺少强制动作参考输入，重新生成动作参考视频并提交姿态节点'
          : '步骤6缺少 aiman.mp4，直接进入数字人生成/恢复链路',
        'info'
      );
      emitTaskEvent(jobId, 'status', { message: `${task.statusText}...` });
      syncMaterialTask(taskStore, task);
      return runAutoAvatarThenContinue(jobId, task, '重试自动生成数字人失败');
    }

    const materialPath = path.join(task.outputPath, 'material.mp4');
    const retryPlan = resolveRetryPipelinePlan(step);
    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: SCRIPT_PATH,
      materialPath,
      outputPath: task.outputPath,
      startFrom: retryPlan.startFrom,
      endAt: retryPlan.endAt,
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      allowRuleFallback: task.allowRuleFallback,
      unbuffered: true
    });

    const retryRunKey = `retry-pipeline:${jobId}:${step}`;
    const retryBusy = beginTaskRun(jobId, task, taskStore, retryRunKey, '任务正在执行中，本次重试未新建进程');
    if (retryBusy) return retryBusy;
    let pythonProcess;
    try {
      pythonProcess = spawn('python', args, {
        cwd: task.outputPath,
        env: createPythonEnv()
      });
    } catch (err) {
      clearTaskRun(task, retryRunKey);
      throw err;
    }
    addTaskLog(
      task,
      `重试启动 Python 流水线: start-from=${retryPlan.startFrom}${retryPlan.endAt ? `, end-at=${retryPlan.endAt}` : ''}, smartClip=${task.useSmartClip ? 'on' : 'off'}, cache=${task.useCache ? 'on' : 'off'}`,
      'info'
    );

    task.lastStdout = '';
    task.lastStderr = '';
    task.process = pythonProcess;
    task.status = 'running';
    task.currentStep = retryPlan.startFrom;
    task.statusText = `重试步骤${step}`;
    task.error = '';
    task.updatedAt = nowIso();
    addTaskLog(task, `开始重试步骤${step}`, 'info');
    syncMaterialTask(taskStore, task);
    emitTaskEvent(jobId, 'status', { message: `重试步骤${step}...` });

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output, {
        syncTaskState: (latestTask, extraMetadata) => syncMaterialTask(taskStore, latestTask, extraMetadata)
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.warn(`[${jobId}] WARN: ${error}`);
      collectStderr(task, error);
    });

    pythonProcess.on('close', (code) => {
      clearTaskRun(task, retryRunKey);
      if (code === 0) {
        if (retryPlan.stopAfterNarration) {
          emitNarrationSummary(jobId, task);
          const hasFinalVideo = fs.existsSync(path.join(task.outputPath, 'output_final.mp4'));
          if (task.autoGenerate && !hasFinalVideo) {
            runAutoAvatarThenContinue(jobId, task, '重试自动生成数字人失败');
            return;
          }
          task.status = 'waiting_avatar';
          task.progress = Math.max(Number(task.progress || 0), 80);
          task.currentStep = 5;
          task.statusText = '前置步骤完成，等待数字人素材（aiman.mp4）后继续';
          task.updatedAt = nowIso();
          task.process = null;
          addTaskLog(task, task.statusText, 'info');
          syncMaterialTask(taskStore, task);
          emitTaskEvent(jobId, 'status', { message: task.statusText });
          emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
          settleTask(jobId, task, 'waiting_avatar');
          return;
        }
        markTaskCompleted(jobId, task, { taskStore });
        settleTask(jobId, task, 'completed');
      } else {
        const step6MissingAiman = task?.autoGenerate &&
          Number(step) === 6 &&
          String(task?.lastStdout || '').includes('数字人视频未找到');
        if (step6MissingAiman) {
          runAutoAvatarThenContinue(jobId, task, '重试自动生成数字人失败');
          return;
        }

        markTaskFailed(jobId, task, summarizeFailureMessage(task, code), taskStore);
        settleTask(jobId, task, 'failed');
      }
    });

    return pythonProcess;
  }

  return {
    attachPythonProcess,
    continueFromAvatarStep,
    spawnPipeline,
    startInitialPipeline,
    startRetryPipeline,
    launchFromAvatarReady
  };
}

module.exports = { createMaterialDrivenPipelineRunner };
