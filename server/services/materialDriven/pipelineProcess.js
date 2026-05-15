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
const { buildVersionedProjectFileUrl, nowIso } = require('./utils');

const SCRIPT_PATH = path.join(__dirname, '../../../python/pipeline/run_material_driven.py');

function createPythonEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    CODEX_PYTHON_PROTOCOL: 'jsonl-v1'
  };
}

function markTaskFailed(jobId, task, message) {
  task.status = 'failed';
  task.statusText = message;
  task.error = task.error || message;
  task.completedAt = nowIso();
  task.updatedAt = nowIso();
  task.process = null;
  addTaskLog(task, message, 'error');
  emitTaskEvent(jobId, 'error_event', { message });
}

function markTaskWaitingForAvatar(jobId, task) {
  task.status = 'waiting_avatar';
  task.progress = Math.max(Number(task.progress || 0), 80);
  task.currentStep = Math.max(Number(task.currentStep || 0), 5);
  task.statusText = '前置步骤完成，等待数字人素材（aiman.mp4）后继续';
  task.updatedAt = nowIso();
  task.process = null;
  addTaskLog(task, task.statusText, 'info');
  emitTaskEvent(jobId, 'status', { message: task.statusText });
  emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
}

function markTaskCompleted(jobId, task, options = {}) {
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
  emitTaskEvent(jobId, 'complete', { videoUrl });
}

function createMaterialDrivenPipelineRunner({ autoGenerateAvatar }) {
  function launchFromAvatarReady(jobId, task) {
    spawnPipeline(jobId, task, 6, {
      step: 6,
      progressValue: 88,
      statusText: '继续处理数字人映射并执行混剪',
      startLog: '数字人已就绪，从步骤6继续执行新链路',
      stepMessage: '步骤6: 生成数字人/切分映射'
    });
  }

  function runAutoAvatarThenContinue(jobId, task, fallbackMessage) {
    (async () => {
      try {
        await autoGenerateAvatar(jobId, task);
        launchFromAvatarReady(jobId, task);
      } catch (err) {
        const message = err?.message || fallbackMessage;
        task.status = 'failed';
        task.error = message;
        task.statusText = message;
        task.completedAt = nowIso();
        task.updatedAt = nowIso();
        task.process = null;
        addTaskLog(task, message, 'error');
        emitTaskEvent(jobId, 'error_event', { message });
      }
    })();
  }

  function attachPythonProcess(jobId, task, pythonProcess, options = {}) {
    const {
      step = 7,
      progressValue = 88,
      statusText = '处理中',
      startLog = '开始执行任务',
      stepMessage = `步骤${step}`
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
    emitTaskEvent(jobId, 'step', { step, message: stepMessage });
    emitTaskEvent(jobId, 'status', { message: statusText });

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output);
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.warn(`[${jobId}] WARN: ${error}`);
      collectStderr(task, error);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        markTaskCompleted(jobId, task, { checkVideoExists: false });
        return;
      }
      markTaskFailed(jobId, task, summarizeFailureMessage(task, code));
    });
  }

  function spawnPipeline(jobId, task, startFrom, extraOptions = {}) {
    const materialPath = path.join(task.outputPath, 'material.mp4');
    const args = buildMaterialDrivenPipelineArgs({
      scriptPath: SCRIPT_PATH,
      materialPath,
      outputPath: task.outputPath,
      startFrom,
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      unbuffered: true
    });
    const pythonProcess = spawn('python', args, {
      cwd: task.outputPath,
      env: createPythonEnv()
    });
    addTaskLog(task, `启动 Python 流水线: start-from=${startFrom}, smartClip=${task.useSmartClip ? 'on' : 'off'}, cache=${task.useCache ? 'on' : 'off'}`, 'info');
    attachPythonProcess(jobId, task, pythonProcess, extraOptions);
    return pythonProcess;
  }

  function startInitialPipeline(jobId, task) {
    const materialPath = path.join(task.outputPath, 'material.mp4');
    const args = [
      '-u',
      SCRIPT_PATH,
      materialPath,
      '--output-dir', task.outputPath
    ];

    if (!task.useSmartClip) {
      args.push('--no-smart-clip');
    }
    if (task.useCache) {
      args.push('--use-cache');
    }
    args.push('--end-at', '5');

    const pythonProcess = spawn('python', args, {
      cwd: task.outputPath,
      env: createPythonEnv()
    });
    task.lastStdout = '';
    task.lastStderr = '';
    task.process = pythonProcess;

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      const latest = activeTasks.get(jobId);
      if (latest) {
        latest.lastStdout = `${String(latest.lastStdout || '')}${output}`.slice(-40000);
      }
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output);
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
          markTaskWaitingForAvatar(jobId, latest);
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
          markTaskFailed(jobId, latest, message);
        } else {
          emitTaskEvent(jobId, 'error_event', { message });
        }
      }
    });

    return pythonProcess;
  }

  function startRetryPipeline(jobId, task, step) {
    if (task.process) {
      task.process.kill();
    }

    const requestedStep = Number(step);
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    if (task.autoGenerate && requestedStep === 6 && !fs.existsSync(aimanPath)) {
      task.lastStdout = '';
      task.lastStderr = '';
      task.process = null;
      task.status = 'generating_avatar';
      task.currentStep = 6;
      task.statusText = '重试步骤6：生成数字人';
      task.error = '';
      task.updatedAt = nowIso();
      addTaskLog(task, '步骤6缺少 aiman.mp4，直接进入数字人生成/恢复链路', 'info');
      emitTaskEvent(jobId, 'status', { message: '重试步骤6：生成数字人...' });
      runAutoAvatarThenContinue(jobId, task, '重试自动生成数字人失败');
      return null;
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
      unbuffered: true
    });

    const pythonProcess = spawn('python', args, {
      cwd: task.outputPath,
      env: createPythonEnv()
    });
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
    emitTaskEvent(jobId, 'status', { message: `重试步骤${step}...` });

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
      console.log(`[${jobId}] ${output}`);
      parseAndEmitProgress(jobId, output);
    });

    pythonProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.warn(`[${jobId}] WARN: ${error}`);
      collectStderr(task, error);
    });

    pythonProcess.on('close', (code) => {
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
          emitTaskEvent(jobId, 'status', { message: task.statusText });
          emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
          return;
        }
        markTaskCompleted(jobId, task);
      } else {
        const step6MissingAiman = task?.autoGenerate &&
          Number(step) === 6 &&
          String(task?.lastStdout || '').includes('数字人视频未找到');
        if (step6MissingAiman) {
          runAutoAvatarThenContinue(jobId, task, '重试自动生成数字人失败');
          return;
        }

        markTaskFailed(jobId, task, summarizeFailureMessage(task, code));
      }
    });

    return pythonProcess;
  }

  return {
    attachPythonProcess,
    spawnPipeline,
    startInitialPipeline,
    startRetryPipeline,
    launchFromAvatarReady
  };
}

module.exports = { createMaterialDrivenPipelineRunner };
