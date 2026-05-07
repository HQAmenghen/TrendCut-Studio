/**
 * 素材驱动工作流 - 程序化启动服务
 * 供 AutoPilot 调度器直接调用，无需经过 HTTP 路由
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { spawn } = require('child_process');
const { makeJobId, ensureDir } = require('../../core/runtime');
const { createAvatarRenderer, resolveAvatarRenderProvider } = require('../pipeline/avatarRenderer');
const { buildRunningHubRunUrl, DEFAULT_RUNNINGHUB_BASE_URL } = require('../pipeline/runningHub');
const { QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS, prepareReferenceAudio } = require('./avatarAudio');
const { prepareNarrationTextForAvatarWorkflow } = require('./avatarWorkflow');
const { resolvePresetFile } = require('./presetResolver');
const { synthesizeQwenTtsSpeech } = require('./qwenTts');
const { buildMaterialDrivenPipelineArgs } = require('./retryPlan');
const { writeTaskState } = require('./taskState');
const { readWorkflow } = require('../pipeline/workflow');
const { activeTasks } = require('./sharedState');

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
  const line = { time: nowIso(), message: String(message).trim(), type };
  task.logs = Array.isArray(task.logs) ? [...task.logs, line].slice(-200) : [line];
  task.updatedAt = nowIso();
}

function firstExistingFile(candidates = []) {
  for (const file of candidates) {
    if (!file) continue;
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    } catch (_err) {}
  }
  return '';
}

function summarizeFailureMessage(stderrTail, code) {
  const exitMsg = `进程退出，代码: ${code}`;
  if (!stderrTail) return exitMsg;
  return `${exitMsg}\n${stderrTail.slice(-3000)}`;
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

/**
 * 查询任务状态（供调度器轮询使用）
 */
function getTaskStatus(jobId) {
  const task = activeTasks.get(jobId);
  if (!task) return null;
  return {
    id: task.id,
    status: task.status,
    currentStep: task.currentStep,
    progress: task.progress,
    statusText: task.statusText,
    videoUrl: task.videoUrl,
    error: task.error,
    outputPath: task.outputPath,
    outputDir: task.outputDir
  };
}

/**
 * 以程序化方式启动素材驱动工作流
 *
 * @param {Object} paths - 路径配置对象 { PROJECT_ROOT, PROJECTS_DIR, UPLOADS_DIR, WORKFLOW_PATH }
 * @param {Object} params
 * @param {string} params.videoUrl - 源视频URL
 * @param {string} [params.title] - 来源标题
 * @param {string} [params.summary] - 来源摘要
 * @param {string} [params.author] - 来源作者
 * @param {string} [params.postId] - 来源帖子ID
 * @param {string} [params.postUrl] - 来源帖子URL
 * @param {Object} [params.avatarConfig] - 数字人配置 { serverUrl, audioPreset, imagePreset, genText }
 * @param {boolean} [params.useSmartClip=true]
 * @param {boolean} [params.useCache=true]
 * @param {boolean} [params.autoGenerate=true]
 * @returns {{ jobId: string, outputPath: string }}
 */
async function startMaterialDrivenFromUrl(paths, params = {}) {
  const {
    videoUrl,
    title = '',
    summary = '',
    author = '',
    postId = '',
    postUrl: sourcePostUrl = '',
    avatarConfig: rawAvatarConfig = {},
    useSmartClip = true,
    useCache = true,
    autoGenerate = true
  } = params;

  if (!videoUrl) {
    throw new Error('缺少视频URL');
  }

  const jobId = makeJobId();
  const outputDir = `material_${jobId}`;
  const outputPath = path.join(paths.PROJECTS_DIR, outputDir);
  await ensureDir(outputPath);

  const avatarConfig = {
    genText: String(rawAvatarConfig.genText || '').trim(),
    renderProvider: String(rawAvatarConfig.renderProvider || 'comfyui').trim(),
    serverUrl: String(rawAvatarConfig.serverUrl || '').trim(),
    runningHubApiKey: String(rawAvatarConfig.runningHubApiKey || '').trim(),
    runningHubBaseUrl: String(rawAvatarConfig.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL).trim(),
    runningHubWorkflowId: String(rawAvatarConfig.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706').trim(),
    runningHubRunPath: String(rawAvatarConfig.runningHubRunPath || '').trim(),
    runningHubAccessPassword: String(rawAvatarConfig.runningHubAccessPassword || '').trim(),
    runningHubInstanceType: String(rawAvatarConfig.runningHubInstanceType || '').trim(),
    runningHubUsePersonalQueue: rawAvatarConfig.runningHubUsePersonalQueue === true || rawAvatarConfig.runningHubUsePersonalQueue === 'true',
    runningHubRetainSeconds: Number(rawAvatarConfig.runningHubRetainSeconds || 0),
    runningHubAudioNodeId: String(rawAvatarConfig.runningHubAudioNodeId || '6').trim(),
    runningHubAudioFieldName: String(rawAvatarConfig.runningHubAudioFieldName || 'audio').trim(),
    runningHubImageNodeId: String(rawAvatarConfig.runningHubImageNodeId || '180').trim(),
    runningHubImageFieldName: String(rawAvatarConfig.runningHubImageFieldName || 'image').trim(),
    runningHubOutputNodeId: String(rawAvatarConfig.runningHubOutputNodeId || '').trim(),
    audioPreset: String(rawAvatarConfig.audioPreset || '').trim(),
    imagePreset: String(rawAvatarConfig.imagePreset || '').trim(),
    audioUploadPath: '',
    imageUploadPath: ''
  };

  // 保存来源信息
  const sourcePostPayload = {
    title,
    body: summary,
    author,
    postId,
    postUrl: sourcePostUrl,
    materialUrl: videoUrl,
    savedAt: nowIso()
  };
  try {
    fs.writeFileSync(
      path.join(outputPath, 'source_post.json'),
      JSON.stringify(sourcePostPayload, null, 2),
      'utf8'
    );
  } catch (_err) {}

  // 下载视频
  const materialPath = path.join(outputPath, 'material.mp4');
  console.log(`[autoStart] ${jobId} downloading material from: ${videoUrl}`);
  const maxRetries = 3;
  let lastDownloadErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const writer = fs.createWriteStream(materialPath);
      const response = await axios({
        url: videoUrl,
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
      console.warn(`[autoStart] download attempt ${attempt}/${maxRetries} failed: ${dlErr.code || dlErr.message}`);
      try { if (fs.existsSync(materialPath)) fs.unlinkSync(materialPath); } catch (_) {}
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  if (lastDownloadErr) {
    throw new Error(`素材视频下载失败（已重试${maxRetries}次）: ${lastDownloadErr.code || lastDownloadErr.message}`);
  }

  // 创建任务对象
  const task = {
    id: jobId,
    process: null,
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
    lastStderr: '',
    avatarConfig,
    sourcePost: sourcePostPayload
  };

  writeTaskState(outputPath, {
    useSmartClip,
    useCache,
    autoGenerate,
    avatarConfig
  });

  task.currentStep = 1;
  task.progress = 2;
  task.statusText = '素材已接收，准备启动工作流';
  addTaskLog(task, '[AutoPilot] 自动启动素材驱动工作流');
  addTaskLog(task, `任务目录: ${outputDir}`, 'info');
  addTaskLog(task, `素材文件已就位: material.mp4 (${formatBytes(fs.statSync(materialPath).size)})`, 'success');
  addTaskLog(task, 'AutoPilot 模式: smartClip=on, cache=on, autoGenerate=on', 'info');
  if (title) addTaskLog(task, `素材来源: ${title.slice(0, 80)}`, 'info');

  activeTasks.set(jobId, task);

  // 启动 Python 流水线 (步骤 1-5)
  const scriptPath = path.join(paths.PROJECT_ROOT, 'python/pipeline/run_material_driven.py');
  const args = [
    '-u',
    scriptPath,
    materialPath,
    '--output-dir', outputPath,
    '--end-at', '5'
  ];
  if (!useSmartClip) args.push('--no-smart-clip');
  if (useCache) args.push('--use-cache');

  const pythonProcess = spawn('python', args, {
    cwd: outputPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CODEX_PYTHON_PROTOCOL: 'jsonl-v1' }
  });

  task.process = pythonProcess;
  task.status = 'running';
  task.currentStep = 1;
  task.progress = 5;
  addTaskLog(task, '启动 Python 流水线: start-from=1, end-at=5', 'info');

  let stderrBuffer = '';

  pythonProcess.stdout.on('data', (data) => {
    const output = data.toString();
    task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
    console.log(`[autoStart:${jobId}] ${output.trim()}`);
    // 解析进度
    const lines = output.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // 解析 Python 协议事件
      if (trimmed.startsWith(PYTHON_PROTOCOL_PREFIX)) {
        try {
          const event = JSON.parse(trimmed.slice(PYTHON_PROTOCOL_PREFIX.length));
          if (event.type === 'stage' && event.stage) {
            const stageMeta = STAGE_PROGRESS_MAP[event.stage];
            if (stageMeta) {
              task.currentStep = stageMeta.step;
              task.progress = Math.max(task.progress || 0, stageMeta.percent);
              task.statusText = event.message || stageMeta.message;
            }
          }
        } catch (_) {}
      }
      // 解析步骤标记
      const stepMatch = trimmed.match(/步骤(\d+):/);
      if (stepMatch) {
        task.currentStep = parseInt(stepMatch[1]);
        const mappedPercent = Object.values(STAGE_PROGRESS_MAP).find(item => item.step === task.currentStep)?.percent;
        if (mappedPercent) task.progress = Math.max(task.progress || 0, mappedPercent);
      }
      addTaskLog(task, trimmed, 'info');
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const text = String(data || '');
    stderrBuffer = `${stderrBuffer}${text}`.slice(-60000);
    console.warn(`[autoStart:${jobId}] ${text.trim()}`);
  });

  pythonProcess.on('close', async (code) => {
    task.process = null;
    if (code === 0) {
      task.progress = Math.max(task.progress || 0, 80);
      task.currentStep = 5;
      task.statusText = '前置步骤完成，开始自动生成数字人...';
      addTaskLog(task, '步骤1-5完成，自动触发数字人生成', 'success');

      // 自动生成数字人
      try {
        await generateAvatar(paths, jobId, task);
        // 从步骤6继续
        launchFromStep6(paths, jobId, task);
      } catch (err) {
        task.status = 'failed';
        task.error = err?.message || '自动生成数字人失败';
        task.statusText = task.error;
        task.completedAt = nowIso();
        task.updatedAt = nowIso();
        addTaskLog(task, task.error, 'error');
        console.error(`[autoStart:${jobId}] 数字人生成失败:`, err.message);
      }
    } else {
      const message = summarizeFailureMessage(stderrBuffer, code);
      task.status = 'failed';
      task.statusText = message;
      task.error = task.error || message;
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      addTaskLog(task, message, 'error');
      console.error(`[autoStart:${jobId}] 流水线失败:`, message);
    }
  });

  return { jobId, outputPath: outputDir };
}

/**
 * 自动生成数字人 (ComfyUI + Qwen3TTS)
 */
async function generateAvatar(paths, jobId, task) {
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

  const audioPath = firstExistingFile([resolvedAudioPreset.path]);
  const imagePath = firstExistingFile([resolvedImagePreset.path]);

  if (!audioPath) throw new Error('未找到可用音频素材（audio preset）');
  if (!imagePath) throw new Error('未找到可用人物图片（image preset）');

  const referenceAudio = prepareReferenceAudio({
    inputPath: audioPath,
    outputDir: task.outputPath,
    limitSeconds: QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS
  });

  task.status = 'generating_avatar';
  task.currentStep = 6;
  task.progress = Math.max(task.progress || 0, 84);
  task.statusText = '正在使用 Qwen3TTS 复刻音色并合成口播音频...';
  task.updatedAt = nowIso();
  addTaskLog(task, '开始调用 Qwen3TTS API 复刻音色并合成口播音频', 'info');

  const ttsResult = await synthesizeQwenTtsSpeech({
    text: preparedNarrationText.validationText,
    referenceAudioPath: referenceAudio.audioPath,
    outputDir: task.outputPath
  });
  addTaskLog(task, `Qwen3TTS 口播音频生成完成: ${path.basename(ttsResult.outputPath)}`, 'success');

  const provider = resolveAvatarRenderProvider(cfg);
  const providerLabel = provider === 'runninghub' ? 'RunningHub Workflow API' : 'ComfyUI';
  const targetLabel = provider === 'runninghub'
    ? buildRunningHubRunUrl({
      baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
      workflowId: cfg.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706',
      runPath: cfg.runningHubRunPath
    })
    : String(cfg.serverUrl || '').trim().replace(/\/+$/, '');
  addTaskLog(task, `准备调用 ${providerLabel}: ${targetLabel}`, 'info');
  task.progress = Math.max(task.progress || 0, 86);
  task.statusText = '正在自动生成数字人...';
  task.updatedAt = nowIso();

  const workflow = readWorkflow(paths.WORKFLOW_PATH);
  const renderResult = await createAvatarRenderer().render({
    avatarConfig: cfg,
    workflow,
    speechAudioPath: ttsResult.outputPath,
    referenceAudioPath: referenceAudio.audioPath,
    imagePath,
    defaultComfyBaseUrl: ''
  });
  addTaskLog(task, `素材上传到 ${providerLabel} 成功: audio=${renderResult.remoteAudioName}, image=${renderResult.remoteImageName}`, 'success');
  if (renderResult.provider === 'runninghub') {
    addTaskLog(task, `RunningHub 工作流已提交: taskId=${renderResult.taskId}`, 'info');
  } else {
    addTaskLog(task, `ComfyUI 工作流已提交: prompt_id=${renderResult.promptId}`, 'info');
  }

  const aimanVideoUrl = renderResult.videoUrl;
  addTaskLog(task, `${providerLabel} 渲染完成，开始下载数字人视频`, 'info');
  const aimanPath = path.join(task.outputPath, 'aiman.mp4');
  await downloadToFile(aimanVideoUrl, aimanPath);

  task.statusText = '数字人生成完成，继续执行混剪...';
  task.progress = Math.max(task.progress || 0, 90);
  task.updatedAt = nowIso();
  addTaskLog(task, '数字人已生成：aiman.mp4', 'success');
}

/**
 * 从步骤6继续执行（数字人映射 + 混剪）
 */
function launchFromStep6(paths, jobId, task) {
  const scriptPath = path.join(paths.PROJECT_ROOT, 'python/pipeline/run_material_driven.py');
  const materialPath = path.join(task.outputPath, 'material.mp4');
  const args = buildMaterialDrivenPipelineArgs({
    scriptPath,
    materialPath,
    outputPath: task.outputPath,
    startFrom: 6,
    endAt: null,
    useSmartClip: task.useSmartClip,
    useCache: task.useCache,
    unbuffered: true
  });

  const pythonProcess = spawn('python', args, {
    cwd: task.outputPath,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', CODEX_PYTHON_PROTOCOL: 'jsonl-v1' }
  });

  task.process = pythonProcess;
  task.status = 'running';
  task.currentStep = 6;
  task.progress = Math.max(task.progress || 0, 88);
  task.statusText = '继续处理数字人映射并执行混剪';
  task.updatedAt = nowIso();
  addTaskLog(task, '从步骤6继续执行：数字人映射 + 智能混剪', 'info');

  let stderrBuffer = '';

  pythonProcess.stdout.on('data', (data) => {
    const output = data.toString();
    task.lastStdout = `${String(task.lastStdout || '')}${output}`.slice(-40000);
    console.log(`[autoStart:${jobId}:step6] ${output.trim()}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    const text = String(data || '');
    stderrBuffer = `${stderrBuffer}${text}`.slice(-60000);
  });

  pythonProcess.on('close', (code) => {
    task.process = null;
    if (code === 0) {
      const outputDir = path.basename(task.outputPath);
      const finalVideoPath = path.join(task.outputPath, 'output_final.mp4');
      const videoUrl = fs.existsSync(finalVideoPath)
        ? `/projects/${outputDir}/output_final.mp4`
        : '';
      task.status = 'completed';
      task.progress = 100;
      task.currentStep = 7;
      task.statusText = '制作完成';
      task.videoUrl = videoUrl;
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      addTaskLog(task, '[AutoPilot] 素材驱动工作流全部完成', 'success');
      console.log(`[autoStart:${jobId}] 制作完成, videoUrl=${videoUrl}`);
    } else {
      const message = summarizeFailureMessage(stderrBuffer, code);
      task.status = 'failed';
      task.statusText = message;
      task.error = task.error || message;
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      addTaskLog(task, message, 'error');
      console.error(`[autoStart:${jobId}] 步骤6-7失败:`, message);
    }
  });
}

module.exports = { startMaterialDrivenFromUrl, getTaskStatus };
