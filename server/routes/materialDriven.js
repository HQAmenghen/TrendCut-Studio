/**
 * 素材驱动工作流 API 路由
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { spawn } = require('child_process');
const { makeJobId, ensureDir } = require('../core/runtime');
const { createAvatarRenderer, resolveAvatarRenderProvider } = require('../services/pipeline/avatarRenderer');
const { buildRunningHubRunUrl, DEFAULT_RUNNINGHUB_BASE_URL, resolveRunningHubApiKey } = require('../services/pipeline/runningHub');
const { QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS, prepareReferenceAudio } = require('../services/materialDriven/avatarAudio');
const { prepareNarrationTextForAvatarWorkflow } = require('../services/materialDriven/avatarWorkflow');
const { resolvePresetFile } = require('../services/materialDriven/presetResolver');
const { synthesizeQwenTtsSpeech } = require('../services/materialDriven/qwenTts');
const { buildMaterialDrivenPipelineArgs, resolveRetryPipelinePlan } = require('../services/materialDriven/retryPlan');
const { createDefaultAvatarConfig, readTaskState, writeTaskState } = require('../services/materialDriven/taskState');
const { readWorkflow } = require('../services/pipeline/workflow');
const { activeTasks, taskClients } = require('../services/materialDriven/sharedState');
const runtime = require('../config/runtime');
const PYTHON_PROTOCOL_PREFIX = '__CODEX_PYTHON__';
const STAGE_PROGRESS_MAP = {
  prepare: { step: 1, percent: 5, message: '步骤1: 准备素材文件' },
  analyze: { step: 2, percent: 18, message: '步骤2: 分析素材内容' },
  segment: { step: 3, percent: 36, message: '步骤3: 素材切片和评分' },
  planning: { step: 4, percent: 56, message: '步骤4: 编排规划' },
  narration: { step: 5, percent: 72, message: '步骤5: 重建脚本与口播稿' },
  avatar: { step: 6, percent: 86, message: '步骤6: 生成数字人' },
  mixing: { step: 7, percent: 92, message: '步骤7: 数字人解说渲染' }
};
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function addTaskLog(task, message, type = 'info') {
  if (!task || !message) return;
  const line = {
    time: nowIso(),
    message: String(message).trim(),
    type
  };
  task.logs = Array.isArray(task.logs) ? [...task.logs, line].slice(-200) : [line];
  task.updatedAt = nowIso();
}

function collectStderr(task, chunk) {
  if (!task) return;
  const text = String(chunk || '');
  task.lastStderr = `${String(task.lastStderr || '')}${text}`.slice(-60000);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^chunk:\s*\d+/i.test(line))
    .filter((line) => !/^frame_index:\s*\d+/i.test(line))
    .slice(-6);
  for (const line of lines) {
    addTaskLog(task, line, 'warning');
  }
}

function summarizeFailureMessage(task, code) {
  const stderrTail = String(task?.lastStderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .join('\n');
  const exitMsg = `进程退出，代码: ${code}`;
  if (!stderrTail) return exitMsg;
  return `${exitMsg}\n${stderrTail.slice(-3000)}`;
}

function emitTaskEvent(jobId, eventName, payload = {}) {
  const clients = taskClients.get(jobId);
  if (!clients || clients.size === 0) return;
  const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(body);
    } catch (_err) {}
  }
}

function parsePythonProtocolLine(line) {
  const text = String(line || '').trim();
  if (!text.startsWith(PYTHON_PROTOCOL_PREFIX)) return null;
  try {
    return JSON.parse(text.slice(PYTHON_PROTOCOL_PREFIX.length));
  } catch (_err) {
    return null;
  }
}

function applyPythonProtocolEvent(jobId, task, event = {}) {
  if (!task || !event || typeof event !== 'object') return;
  const type = String(event.type || '').trim();
  if (type === 'stage') {
    const stageKey = String(event.stage || '').trim();
    const stageMeta = STAGE_PROGRESS_MAP[stageKey] || null;
    const message = String(event.message || stageMeta?.message || stageKey || '阶段切换').trim();
    if (stageMeta) {
      task.currentStep = stageMeta.step;
      task.progress = Math.max(Number(task.progress || 0), stageMeta.percent);
    }
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'info');
    if (stageMeta) {
      emitTaskEvent(jobId, 'step', { step: stageMeta.step, message });
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message });
    }
    return;
  }
  if (type === 'result') {
    const message = String(event.message || '').trim();
    if (!message) return;
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'success');
    emitTaskEvent(jobId, 'status', { message });
    return;
  }
  if (type === 'error') {
    const message = String(event.message || 'Python 脚本执行失败').trim();
    task.statusText = message;
    task.updatedAt = nowIso();
    addTaskLog(task, message, 'error');
    emitTaskEvent(jobId, 'status', { message });
  }
}

function _closeTaskClients(jobId) {
  const clients = taskClients.get(jobId);
  if (!clients) return;
  for (const res of clients) {
    try {
      res.end();
    } catch (_err) {}
  }
  taskClients.delete(jobId);
}

function firstExistingFile(candidates = []) {
  for (const file of candidates) {
    if (!file) continue;
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return file;
      }
    } catch (_err) {}
  }
  return '';
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

async function downloadToFile(url, outputPath) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 180000,
    httpsAgent: insecureHttpsAgent
  });
  response.data.pipe(writer);
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function probeComfyUI(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!normalized) {
    throw new Error('未填写 ComfyUI 地址');
  }

  const candidates = [
    `${normalized}/system_stats`,
    `${normalized}/queue`,
    `${normalized}/history`
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await axios.get(url, {
        timeout: 12000,
        httpsAgent: insecureHttpsAgent
      });
      return {
        ok: true,
        baseUrl: normalized,
        testedUrl: url,
        status: res.status
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('ComfyUI 连通性检测失败');
}

function readAvatarConfigFromBody(body = {}) {
  return {
    genText: String(body.genText || '').trim(),
    renderProvider: String(body.renderProvider || 'comfyui').trim(),
    serverUrl: String(body.serverUrl || '').trim(),
    runningHubApiKey: String(body.runningHubApiKey || '').trim(),
    runningHubBaseUrl: String(body.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL).trim(),
    runningHubWorkflowId: String(body.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706').trim(),
    runningHubRunPath: String(body.runningHubRunPath || '').trim(),
    runningHubAccessPassword: String(body.runningHubAccessPassword || '').trim(),
    runningHubInstanceType: String(body.runningHubInstanceType || '').trim(),
    runningHubUsePersonalQueue: body.runningHubUsePersonalQueue === true || body.runningHubUsePersonalQueue === 'true',
    runningHubRetainSeconds: Number(body.runningHubRetainSeconds || 0),
    runningHubAudioNodeId: String(body.runningHubAudioNodeId || '6').trim(),
    runningHubAudioFieldName: String(body.runningHubAudioFieldName || 'audio').trim(),
    runningHubImageNodeId: String(body.runningHubImageNodeId || '180').trim(),
    runningHubImageFieldName: String(body.runningHubImageFieldName || 'image').trim(),
    runningHubOutputNodeId: String(body.runningHubOutputNodeId || '').trim(),
    audioPreset: String(body.audioPreset || '').trim(),
    imagePreset: String(body.imagePreset || '').trim()
  };
}

function probeRunningHubConfig(config = {}) {
  const workflowId = String(config.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '').trim();
  const apiKey = resolveRunningHubApiKey({ apiKey: config.runningHubApiKey });
  if (!workflowId) throw new Error('未配置 RunningHub Workflow ID');
  if (!apiKey) throw new Error('未配置 RunningHub API Key');
  const testedUrl = buildRunningHubRunUrl({
    baseUrl: config.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
    workflowId,
    runPath: config.runningHubRunPath
  });
  return {
    ok: true,
    provider: 'runninghub',
    baseUrl: config.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
    testedUrl,
    status: 'configured'
  };
}

/**
 * 注册素材驱动工作流路由
 */
function registerMaterialDrivenRoutes(app, paths) {
  const upload = multer({ dest: paths.UPLOADS_DIR });

  function persistTaskStateSnapshot(task) {
    if (!task?.outputPath) return;
    writeTaskState(task.outputPath, {
      useSmartClip: task.useSmartClip,
      useCache: task.useCache,
      autoGenerate: task.autoGenerate,
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

    // 智能判断当前进度
    const hasFinalVideo = fs.existsSync(path.join(outputPath, 'output_final.mp4'));
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
      status: status,
      currentStep: currentStep,
      progress: progress,
      statusText: statusText,
      logs: [],
      startedAt: null,
      updatedAt: nowIso(),
      completedAt: hasFinalVideo ? nowIso() : null,
      error: '',
      videoUrl: hasFinalVideo ? `/projects/${safeOutputDir}/output_final.mp4` : '',
      outputDir: safeOutputDir,
      lastStdout: '',
      avatarConfig: persistedState.avatarConfig
    };
    addTaskLog(recovered, `任务已从项目目录恢复，识别到当前进度：步骤 ${currentStep} (${statusText})`, 'info');
    activeTasks.set(jobId, recovered);
    return recovered;
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
        const outputDir = path.basename(task.outputPath);
        const videoUrl = fs.existsSync(path.join(task.outputPath, 'output_final.mp4'))
          ? `/projects/${outputDir}/output_final.mp4`
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
        return;
      }
      const message = summarizeFailureMessage(task, code);
      task.status = 'failed';
      task.statusText = message;
      task.error = task.error || message;
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      task.process = null;
      addTaskLog(task, message, 'error');
      emitTaskEvent(jobId, 'error_event', { message });
    });
  }

  function spawnPipeline(jobId, task, startFrom, extraOptions = {}) {
    const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
    const materialPath = path.join(task.outputPath, 'material.mp4');
    const args = [
      '-u',
      scriptPath,
      materialPath,
      '--output-dir', task.outputPath,
      '--start-from', String(startFrom)
    ];
    if (!task.useSmartClip) {
      args.push('--no-smart-clip');
    }
    if (task.useCache) {
      args.push('--use-cache');
    }
    const pythonProcess = spawn('python', args, {
      cwd: task.outputPath,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CODEX_PYTHON_PROTOCOL: 'jsonl-v1' }
    });
    addTaskLog(task, `启动 Python 流水线: start-from=${startFrom}, smartClip=${task.useSmartClip ? 'on' : 'off'}, cache=${task.useCache ? 'on' : 'off'}`, 'info');
    attachPythonProcess(jobId, task, pythonProcess, extraOptions);
  }

  app.post('/api/material-driven/test-comfy', async (req, res) => {
    try {
      const cfg = readAvatarConfigFromBody(req.body || {});
      const provider = resolveAvatarRenderProvider(cfg);
      const result = provider === 'runninghub'
        ? probeRunningHubConfig(cfg)
        : await probeComfyUI(String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL || '').trim());
      res.json({
        success: true,
        ...result,
        message: provider === 'runninghub' ? 'RunningHub 配置有效' : 'ComfyUI 连通正常'
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error?.message || '渲染服务连通性检测失败'
      });
    }
  });

  async function autoGenerateAvatar(jobId, task) {
    const cfg = task.avatarConfig || {};
    const narrationPath = path.join(task.outputPath, 'narration.json');
    let narrationText = String(cfg.genText || '').trim();
    try {
      if (fs.existsSync(narrationPath)) {
        const payload = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
        const fromFile = String(payload?.full_text || '').trim();
        if (fromFile) narrationText = fromFile;
      }
    } catch (_err) {}
    const preparedNarrationText = prepareNarrationTextForAvatarWorkflow(narrationText);
    if (!preparedNarrationText.isUsable) {
      throw new Error('缺少可用口播文案（narration.json / genText）');
    }

    const audioPresetDir = path.join(paths.PROJECT_ROOT, 'public', 'presets', 'audio');
    const imagePresetDir = path.join(paths.PROJECT_ROOT, 'public', 'presets', 'image');
    const resolvedAudioPreset = resolvePresetFile(audioPresetDir, cfg.audioPreset);
    const resolvedImagePreset = resolvePresetFile(imagePresetDir, cfg.imagePreset);

    if (!cfg.audioUploadPath && cfg.audioPreset && !resolvedAudioPreset.path) {
      throw new Error(`未找到指定音频预设: ${cfg.audioPreset}`);
    }
    if (!cfg.imageUploadPath && cfg.imagePreset && !resolvedImagePreset.path) {
      throw new Error(`未找到指定人物预设: ${cfg.imagePreset}`);
    }

    const audioPath = firstExistingFile([
      cfg.audioUploadPath,
      resolvedAudioPreset.path
    ]);
    const imagePath = firstExistingFile([
      cfg.imageUploadPath,
      resolvedImagePreset.path
    ]);

    if (!audioPath) throw new Error('未找到可用音频素材（audio preset/upload）');
    if (!imagePath) throw new Error('未找到可用人物图片（image preset/upload）');

    if (!cfg.audioUploadPath && resolvedAudioPreset.matchType === 'stem' && resolvedAudioPreset.resolvedName) {
      addTaskLog(task, `音频预设 ${cfg.audioPreset} 不存在，已自动映射到 ${resolvedAudioPreset.resolvedName}`, 'warning');
      task.avatarConfig = {
        ...cfg,
        audioPreset: resolvedAudioPreset.resolvedName
      };
      persistTaskStateSnapshot(task);
    }
    if (!cfg.imageUploadPath && resolvedImagePreset.matchType === 'stem' && resolvedImagePreset.resolvedName) {
      addTaskLog(task, `人物预设 ${cfg.imagePreset} 不存在，已自动映射到 ${resolvedImagePreset.resolvedName}`, 'warning');
      task.avatarConfig = {
        ...(task.avatarConfig || cfg),
        imagePreset: resolvedImagePreset.resolvedName
      };
      persistTaskStateSnapshot(task);
    }

    const preparedReferenceAudio = prepareReferenceAudio({
      inputPath: audioPath,
      outputDir: task.outputPath,
      limitSeconds: QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS
    });
    const referenceAudioPath = preparedReferenceAudio.audioPath;

    task.status = 'generating_avatar';
    task.currentStep = 6;
    task.progress = Math.max(Number(task.progress || 0), 84);
    task.statusText = '正在使用 Qwen3TTS 复刻音色并合成口播音频...';
    task.updatedAt = nowIso();
    addTaskLog(task, '开始调用 Qwen3TTS API 复刻音色并合成口播音频', 'info');
    addTaskLog(task, `Qwen3TTS 输入: 文案=${preparedNarrationText.validationText.length}字, 音色参考=${path.basename(referenceAudioPath)}`, 'info');
    if (preparedReferenceAudio.wasTrimmed) {
      const durationLabel = preparedReferenceAudio.durationSeconds
        ? `${preparedReferenceAudio.durationSeconds.toFixed(1)}s`
        : '未知时长';
      addTaskLog(
        task,
        `音色参考音频超过 Qwen3TTS 推荐范围，已自动裁剪到 ${QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS}s 内（原始时长 ${durationLabel}）`,
        'warning'
      );
    }
    emitTaskEvent(jobId, 'step', { step: 6, message: '步骤6: 生成数字人口播音频' });
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });

    const ttsResult = await synthesizeQwenTtsSpeech({
      text: preparedNarrationText.validationText,
      referenceAudioPath,
      outputDir: task.outputPath
    });
    const audioPathForUpload = ttsResult.outputPath;
    addTaskLog(
      task,
      `Qwen3TTS 口播音频生成完成: ${path.basename(audioPathForUpload)}${ttsResult.model ? `, model=${ttsResult.model}` : ''}`,
      'success'
    );

    const provider = resolveAvatarRenderProvider(cfg);
    const workflow = readWorkflow(paths.WORKFLOW_PATH);
    const renderer = createAvatarRenderer();
    const providerLabel = provider === 'runninghub' ? 'RunningHub Workflow API' : 'ComfyUI';
    const targetLabel = provider === 'runninghub'
      ? buildRunningHubRunUrl({
        baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
        workflowId: cfg.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706',
        runPath: cfg.runningHubRunPath
      })
      : String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim().replace(/\/+$/, '');
    addTaskLog(task, `准备调用 ${providerLabel}: ${targetLabel}`, 'info');

    task.progress = Math.max(Number(task.progress || 0), 86);
    task.statusText = '正在自动生成数字人...';
    task.updatedAt = nowIso();
    addTaskLog(task, `自动调用 ${providerLabel} 生成数字人`, 'info');
    addTaskLog(task, `自动生成人像素材: Qwen3TTS音频=${path.basename(audioPathForUpload)}, 图片=${path.basename(imagePath)}, 渲染服务=${targetLabel}`, 'info');
    emitTaskEvent(jobId, 'step', { step: 6, message: '步骤6: 自动生成数字人' });
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });

    const renderResult = await renderer.render({
      avatarConfig: {
        ...cfg,
        serverUrl: String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim()
      },
      workflow,
      speechAudioPath: audioPathForUpload,
      referenceAudioPath,
      imagePath,
      defaultComfyBaseUrl: runtime.DEFAULT_COMFYUI_BASE_URL
    });
    addTaskLog(task, `素材上传到 ${providerLabel} 成功: audio=${renderResult.remoteAudioName}, image=${renderResult.remoteImageName}`, 'success');

    if (renderResult.provider === 'runninghub') {
      addTaskLog(task, `RunningHub 工作流已提交: taskId=${renderResult.taskId}`, 'info');
      addTaskLog(task, `RunningHub 节点输入: ${renderResult.nodeInfoList.map((item) => `${item.nodeId}.${item.fieldName}`).join(', ')}`, 'info');
    } else {
      addTaskLog(task, `本次数字人视频 seed 使用工作流配置: ${renderResult.seed ?? '未设置'}`, 'info');
      addTaskLog(task, `ComfyUI 工作流已提交: prompt_id=${renderResult.promptId}`, 'info');
    }
    addTaskLog(task, '当前工作流使用外部口播音频输入，数字人时长将跟随 Qwen3TTS 合成音频自动匹配', 'info');

    const videoUrl = renderResult.videoUrl;
    addTaskLog(task, `${providerLabel} 渲染完成，开始下载数字人视频`, 'info');
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    await downloadToFile(videoUrl, aimanPath);

    task.statusText = '数字人生成完成，继续执行混剪...';
    task.progress = Math.max(Number(task.progress || 0), 90);
    task.updatedAt = nowIso();
    addTaskLog(task, '数字人已生成：aiman.mp4', 'success');
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });
  }

  function launchFromAvatarReady(jobId, task) {
    spawnPipeline(jobId, task, 6, {
      step: 6,
      progressValue: 88,
      statusText: '继续处理数字人映射并执行混剪',
      startLog: '数字人已就绪，从步骤6继续执行新链路',
      stepMessage: '步骤6: 生成数字人/切分映射'
    });
  }

  // 启动素材驱动工作流
  app.post('/api/material-driven/start', upload.fields([
    { name: 'material', maxCount: 1 },
    { name: 'audioFile', maxCount: 1 },
    { name: 'imageFile', maxCount: 1 }
  ]), async (req, res) => {
    try {
      const materialFile = req.files?.material?.[0];
      const audioUploadFile = req.files?.audioFile?.[0];
      const imageUploadFile = req.files?.imageFile?.[0];
      const materialUrl = req.body.materialUrl;

      if (!materialFile && !materialUrl) {
        return res.status(400).json({ error: '未上传素材文件或外部链接' });
      }

      const jobId = makeJobId();
      const useSmartClip = req.body.useSmartClip === 'true';
      const useCache = req.body.useCache !== 'false';
      const manualScript = String(req.body.manualScript || '').trim();
      const autoGenerate = req.body.autoGenerate === 'true';
      const outputDir = req.body.outputDir || `material_${jobId}`;
      const sourceTitle = String(req.body.sourceTitle || req.body.title || req.body.postTitle || '').trim();
      const sourceBody = String(
        req.body.sourceBody
                || req.body.sourceSummary
                || req.body.summary
                || req.body.postText
                || req.body.text
                || ''
      ).trim();
      const sourcePostUrl = String(req.body.sourcePostUrl || '').trim();

      // 创建输出目录
      const outputPath = path.join(paths.PROJECTS_DIR, outputDir);
      await ensureDir(outputPath);

      if (manualScript) {
        fs.writeFileSync(path.join(outputPath, 'manual_narration.txt'), manualScript, 'utf-8');
      }

      const sourcePostPayload = {
        title: sourceTitle,
        body: sourceBody,
        postUrl: sourcePostUrl,
        materialUrl: String(materialUrl || '').trim(),
        savedAt: nowIso()
      };
      try {
        fs.writeFileSync(
          path.join(outputPath, 'source_post.json'),
          JSON.stringify(sourcePostPayload, null, 2),
          'utf8'
        );
      } catch (_err) {
        // ignore source post persistence errors
      }

      // 移动素材文件到输出目录或下载视频
      const materialPath = path.join(outputPath, 'material.mp4');
      if (materialFile) {
        console.log(`[material-driven] ${jobId} received upload: ${materialFile.originalname} (${formatBytes(materialFile.size)})`);
        fs.renameSync(materialFile.path, materialPath);
      } else if (materialUrl) {
        console.log(`[material-driven] ${jobId} downloading material from URL: ${materialUrl}`);
        const maxRetries = 3;
        let lastDownloadErr = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const writer = fs.createWriteStream(materialPath);
            const response = await axios({
              url: materialUrl,
              method: 'GET',
              responseType: 'stream',
              timeout: 120000,
              httpsAgent: insecureHttpsAgent,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });
            lastDownloadErr = null;
            break;
          } catch (dlErr) {
            lastDownloadErr = dlErr;
            console.warn(`[download] attempt ${attempt}/${maxRetries} failed: ${dlErr.code || dlErr.message}`);
            // clean up partial file
            try { if (fs.existsSync(materialPath)) fs.unlinkSync(materialPath); } catch (_) {}
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 2000 * attempt));
            }
          }
        }
        if (lastDownloadErr) {
          throw new Error(`素材视频下载失败（已重试${maxRetries}次）: ${lastDownloadErr.code || lastDownloadErr.message}`);
        }
      }

      // 启动Python脚本
      const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
      const args = [
        '-u',
        scriptPath,
        materialPath,
        '--output-dir', outputPath
      ];

      if (!useSmartClip) {
        args.push('--no-smart-clip');
      }
      if (useCache) {
        args.push('--use-cache');
      }

      // 统一先执行到步骤5：
      // - autoGenerate=true: 由 Node 自动调 ComfyUI 生成数字人后再从步骤7续跑
      // - autoGenerate=false: 保持人工生成数字人后继续
      args.push('--end-at', '5');

      const pythonProcess = spawn('python', args, {
        cwd: outputPath,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CODEX_PYTHON_PROTOCOL: 'jsonl-v1' }
      });

      // 存储任务信息
      const task = {
        id: jobId,
        process: pythonProcess,
        outputPath,
        useSmartClip,
        useCache,
        autoGenerate,
        status: 'running',
        currentStep: 0,
        progress: 0,
        statusText: '工作流已启动',
        logs: [],
        startedAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
        error: '',
        videoUrl: '',
        outputDir,
        lastStdout: '',
        avatarConfig: {
          ...readAvatarConfigFromBody(req.body),
          audioUploadPath: audioUploadFile?.path || '',
          imageUploadPath: imageUploadFile?.path || ''
        },
        sourcePost: sourcePostPayload
      };
      persistTaskStateSnapshot(task);
      task.currentStep = 1;
      task.progress = 2;
      task.statusText = '素材已接收，准备启动工作流';
      addTaskLog(task, '工作流已启动');
      addTaskLog(task, `任务目录: ${outputDir}`, 'info');
      addTaskLog(task, `素材文件已就位: ${path.basename(materialPath)} (${formatBytes(fs.statSync(materialPath).size)})`, 'success');
      addTaskLog(task, `启动参数: smartClip=${useSmartClip ? 'on' : 'off'}, cache=${useCache ? 'on' : 'off'}, autoGenerate=${autoGenerate ? 'on' : 'off'}, manualScript=${manualScript ? 'on' : 'off'}`, 'info');
      if (sourceTitle) {
        addTaskLog(task, `素材来源标题: ${sourceTitle.slice(0, 80)}`, 'info');
      }
      if (sourcePostUrl) {
        addTaskLog(task, `素材来源链接: ${sourcePostUrl}`, 'info');
      }
      activeTasks.set(jobId, task);

      // 处理输出
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
          const hasFinalVideo = latest ? fs.existsSync(path.join(latest.outputPath, 'output_final.mp4')) : false;
          if (latest && latest.autoGenerate && !hasFinalVideo) {
            (async () => {
              try {
                await autoGenerateAvatar(jobId, latest);
                launchFromAvatarReady(jobId, latest);
              } catch (err) {
                latest.status = 'failed';
                latest.error = err?.message || '自动生成数字人失败';
                latest.statusText = latest.error;
                latest.completedAt = nowIso();
                latest.updatedAt = nowIso();
                latest.process = null;
                addTaskLog(latest, latest.error, 'error');
                emitTaskEvent(jobId, 'error_event', { message: latest.error });
              }
            })();
            return;
          }
          if (latest) {
            latest.status = 'waiting_avatar';
            latest.progress = Math.max(Number(latest.progress || 0), 80);
            latest.currentStep = Math.max(Number(latest.currentStep || 0), 5);
            latest.statusText = '前置步骤完成，等待数字人素材（aiman.mp4）后继续';
            latest.updatedAt = nowIso();
            latest.process = null;
            addTaskLog(latest, latest.statusText, 'info');
            emitTaskEvent(jobId, 'status', { message: latest.statusText });
            emitTaskEvent(jobId, 'progress', { percent: latest.progress, message: latest.statusText });
          }
        } else {
          const step6MissingAiman = latest?.autoGenerate &&
                        String(latest?.lastStdout || '').includes('数字人视频未找到');
          if (latest && step6MissingAiman) {
            (async () => {
              try {
                await autoGenerateAvatar(jobId, latest);
                launchFromAvatarReady(jobId, latest);
              } catch (err) {
                latest.status = 'failed';
                latest.error = err?.message || '自动生成数字人失败';
                latest.statusText = latest.error;
                latest.completedAt = nowIso();
                latest.updatedAt = nowIso();
                latest.process = null;
                addTaskLog(latest, latest.error, 'error');
                emitTaskEvent(jobId, 'error_event', { message: latest.error });
              }
            })();
            return;
          }
          const message = summarizeFailureMessage(latest, code);
          if (latest) {
            latest.status = 'failed';
            latest.statusText = message;
            latest.error = latest.error || message;
            latest.completedAt = nowIso();
            latest.updatedAt = nowIso();
            latest.process = null;
            addTaskLog(latest, message, 'error');
          }
          emitTaskEvent(jobId, 'error_event', { message });
        }
      });

      res.json({
        jobId,
        outputPath: outputDir,
        message: '工作流已启动'
      });

    } catch (error) {
      console.error('启动工作流失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 查询任务状态（支持刷新后恢复）
  app.get('/api/material-driven/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const task = resolveTask(jobId, req.query?.outputPath);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }
    const sourcePost = readJsonSafe(path.join(task.outputPath, 'source_post.json'), task.sourcePost || null);
    const narration = readJsonSafe(path.join(task.outputPath, 'narration.json'), null);
    const scriptUnits = readJsonSafe(path.join(task.outputPath, 'script_units.json'), null);
    const editPlan = readJsonSafe(path.join(task.outputPath, 'edit_plan.json'), null);
    const executionPlan = readJsonSafe(path.join(task.outputPath, 'execution_plan.json'), null);
    const avatarSegments = readJsonSafe(path.join(task.outputPath, 'avatar_segments.json'), null);
    res.json({
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
        videoUrl: task.videoUrl || '',
        outputPath: task.outputDir || '',
        avatarConfig: task.avatarConfig || createDefaultAvatarConfig(),
        sourcePost: sourcePost || null,
        narration: narration || null,
        scriptUnits: scriptUnits || null,
        editPlan: editPlan || null,
        executionPlan: executionPlan || null,
        avatarSegments: avatarSegments || null
      }
    });
  });

  // SSE进度监听
  app.get('/api/material-driven/progress/:jobId', (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 发送初始连接消息
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

    // 保持连接
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
  });

  // 继续工作流（从步骤6开始，确保先生成 avatar_segments / execution_plan）
  app.post('/api/material-driven/continue/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = resolveTask(jobId, req.body?.outputPath);

      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }

      spawnPipeline(jobId, task, 6, {
        step: 6,
        progressValue: 80,
        statusText: '继续处理数字人映射并执行混剪',
        startLog: '从步骤6继续执行新链路',
        stepMessage: '步骤6: 生成数字人/切分映射'
      });

      res.json({ message: '继续执行' });

    } catch (error) {
      console.error('继续工作流失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // 重试步骤
  app.post('/api/material-driven/retry/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const { step } = req.body;
      const task = resolveTask(jobId, req.body?.outputPath);

      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }

      // 更新配置（关键修复：允许重试时更换节点或参数）
      if (req.body.avatarConfig) {
        task.avatarConfig = { ...(task.avatarConfig || {}), ...req.body.avatarConfig };
        persistTaskStateSnapshot(task);
        addTaskLog(task, `重试配置已更新: ${req.body.avatarConfig.serverUrl || '保持原地址'}`, 'info');
      }

      // 停止当前进程
      if (task.process) {
        task.process.kill();
      }

      // 重新启动从指定步骤
      const scriptPath = path.join(__dirname, '../../python/pipeline/run_material_driven.py');
      const materialPath = path.join(task.outputPath, 'material.mp4');
      const retryPlan = resolveRetryPipelinePlan(step);
      const args = buildMaterialDrivenPipelineArgs({
        scriptPath,
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
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CODEX_PYTHON_PROTOCOL: 'jsonl-v1' }
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

      // 处理输出
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
            const hasFinalVideo = fs.existsSync(path.join(task.outputPath, 'output_final.mp4'));
            if (task.autoGenerate && !hasFinalVideo) {
              (async () => {
                try {
                  await autoGenerateAvatar(jobId, task);
                  launchFromAvatarReady(jobId, task);
                } catch (err) {
                  task.status = 'failed';
                  task.error = err?.message || '重试自动生成数字人失败';
                  task.statusText = task.error;
                  task.completedAt = nowIso();
                  task.updatedAt = nowIso();
                  task.process = null;
                  addTaskLog(task, task.error, 'error');
                  emitTaskEvent(jobId, 'error_event', { message: task.error });
                }
              })();
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
          const outputDir = path.basename(task.outputPath);
          const videoUrl = `/projects/${outputDir}/output_final.mp4`;
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
        } else {
          // 重试步骤6时，如果 aiman.mp4 不存在且开启了自动生成，
          // 自动触发 ComfyUI 生成数字人，和首次启动行为一致
          const step6MissingAiman = task?.autoGenerate &&
                        Number(step) === 6 &&
                        String(task?.lastStdout || '').includes('数字人视频未找到');
          if (step6MissingAiman) {
            (async () => {
              try {
                await autoGenerateAvatar(jobId, task);
                launchFromAvatarReady(jobId, task);
              } catch (err) {
                task.status = 'failed';
                task.error = err?.message || '重试自动生成数字人失败';
                task.statusText = task.error;
                task.completedAt = nowIso();
                task.updatedAt = nowIso();
                task.process = null;
                addTaskLog(task, task.error, 'error');
                emitTaskEvent(jobId, 'error_event', { message: task.error });
              }
            })();
            return;
          }

          const message = summarizeFailureMessage(task, code);
          task.status = 'failed';
          task.statusText = message;
          task.error = task.error || message;
          task.completedAt = nowIso();
          task.updatedAt = nowIso();
          task.process = null;
          addTaskLog(task, message, 'error');
          emitTaskEvent(jobId, 'error_event', { message });
        }
      });

      res.json({ message: '重试已启动' });

    } catch (error) {
      console.error('重试失败:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/material-driven/rebuild/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = resolveTask(jobId, req.body?.outputPath);
      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }
      task.useCache = req.body?.useCache !== false && req.body?.useCache !== 'false';
      spawnPipeline(jobId, task, 5, {
        step: 5,
        progressValue: 76,
        statusText: '正在从口播脚本开始重建剪辑计划',
        startLog: '手动触发：从步骤5重建脚本、映射与执行计划',
        stepMessage: '步骤5: 重建脚本与执行计划'
      });
      res.json({ success: true, message: '已开始重建剪辑计划' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/material-driven/rerender/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      const task = resolveTask(jobId, req.body?.outputPath);
      if (!task) {
        return res.status(404).json({ error: '任务不存在' });
      }
      task.useCache = req.body?.useCache !== false && req.body?.useCache !== 'false';
      spawnPipeline(jobId, task, 7, {
        step: 7,
        progressValue: 90,
        statusText: '正在根据当前执行计划重新渲染',
        startLog: '手动触发：重新渲染成片',
        stepMessage: '步骤7: 重新渲染成片'
      });
      res.json({ success: true, message: '已开始重新渲染成片' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}

/**
 * 解析Python输出并发送SSE事件
 */
function parseAndEmitProgress(jobId, output) {
  const task = activeTasks.get(jobId);
  const lines = output.split('\n');

  for (const line of lines) {
    const message = line.trim();
    if (!message) continue;
    const protocolEvent = parsePythonProtocolLine(message);
    if (protocolEvent) {
      applyPythonProtocolEvent(jobId, task, protocolEvent);
      continue;
    }
    if (task) {
      task.statusText = message;
      task.updatedAt = nowIso();
      addTaskLog(task, message, 'info');
    }

    // 解析步骤
    const stepMatch = line.match(/步骤(\d+):/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1]);
      if (task) {
        task.currentStep = step;
        const mappedPercent = Object.values(STAGE_PROGRESS_MAP).find((item) => item.step === step)?.percent;
        if (Number.isFinite(mappedPercent)) {
          task.progress = Math.max(Number(task.progress || 0), mappedPercent);
        }
      }
      emitTaskEvent(jobId, 'step', {
        step,
        message
      });
      if (task) {
        emitTaskEvent(jobId, 'progress', {
          percent: Number(task.progress || 0),
          message
        });
      }
      continue;
    }

    // 解析进度
    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      const percent = parseInt(progressMatch[1]);
      if (task) task.progress = percent;
      emitTaskEvent(jobId, 'progress', {
        percent,
        message
      });
      continue;
    }

    // 解析规划摘要
    if (line.includes('规划摘要') || line.includes('编排摘要')) {
      // 尝试从后续行解析
      const summaryMatch = output.match(/总时长:\s*([\d.]+)秒.*素材占比:\s*([\d.]+)%.*数字人占比:\s*([\d.]+)%/s);
      if (summaryMatch) {
        emitTaskEvent(jobId, 'plan_summary', {
          totalDuration: parseFloat(summaryMatch[1]),
          materialRatio: parseFloat(summaryMatch[2]),
          aimanRatio: parseFloat(summaryMatch[3])
        });
      } else {
        const segmentSummaryMatch = output.match(/已选素材段数:\s*(\d+).*素材总时长:\s*([\d.]+)秒/s);
        if (segmentSummaryMatch) {
          emitTaskEvent(jobId, 'plan_summary', {
            totalDuration: parseFloat(segmentSummaryMatch[2]),
            materialRatio: null,
            aimanRatio: null,
            segmentCount: parseInt(segmentSummaryMatch[1], 10)
          });
        }
      }
      continue;
    }

    // 解析解说词摘要
    if (line.includes('解说词摘要')) {
      const summaryMatch = output.match(/目标时长:\s*([\d.]+)秒.*字数:\s*(\d+)字.*语速:\s*([\d.]+)字\/秒/s);
      if (summaryMatch) {
        let fullText = '';
        try {
          const narrationPath = path.join(task?.outputPath || '', 'narration.json');
          const narration = readJsonSafe(narrationPath, {});
          fullText = String(narration?.full_text || '').trim();
        } catch (_err) {}
        emitTaskEvent(jobId, 'narration_summary', {
          targetDuration: parseFloat(summaryMatch[1]),
          charCount: parseInt(summaryMatch[2]),
          speed: parseFloat(summaryMatch[3]),
          fullText
        });
      }
      continue;
    }

    // 普通状态消息
    emitTaskEvent(jobId, 'status', { message });
  }
}

module.exports = { registerMaterialDrivenRoutes };
