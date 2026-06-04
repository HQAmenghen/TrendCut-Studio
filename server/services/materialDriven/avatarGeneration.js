const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runPythonScript } = require('../../core/python');
const { createAvatarRenderer, resolveAvatarRenderProvider } = require('../pipeline/avatarRenderer');
const { buildRunningHubRunUrl, DEFAULT_RUNNINGHUB_BASE_URL, resolveRunningHubApiKey } = require('../pipeline/runningHub');
const { RUNNINGHUB_INFINITETALK_3INPUT } = require('../../config/runningHub');
const { QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS, prepareReferenceAudio } = require('./avatarAudio');
const {
  generateAvatarMotion,
  resolveActionPresetDir
} = require('./avatarMotion');
const { ensureSpeechAlignment } = require('./speechAlignment');
const { prepareNarrationTextForAvatarWorkflow } = require('./avatarWorkflow');
const { resolvePresetFile } = require('./presetResolver');
const { DEFAULT_OUTPUT_FILENAME, synthesizeQwenTtsSpeech } = require('./qwenTts');
const { readWorkflow } = require('../pipeline/workflow');
const runtime = require('../../config/runtime');
const { downloadToFile } = require('./materialDownload');
const { addTaskLog, emitTaskEvent } = require('./events');
const { syncAvatarTask, syncMaterialTask } = require('./taskStoreBridge');
const { normalizeAvatarConfig } = require('./taskState');
const { firstExistingFile, nowIso } = require('./utils');

const QWEN_TTS_METADATA_FILE = 'avatar_qwen3tts.json';
const AVATAR_RENDER_STATE_FILE = 'avatar_render_state.json';
const NARRATION_SPEECH_TEXT_FILE = 'narration_speech.txt';
const NARRATION_SPEECH_METADATA_FILE = 'narration_speech.json';
const SPEECH_NARRATION_SCRIPT = path.join(__dirname, '../../../python/pipeline/normalize_speech_narration.py');
const SPEECH_NARRATION_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_AVATAR_DOWNLOAD_RETRIES = 6;
const DEFAULT_AVATAR_DOWNLOAD_RETRY_DELAY_MS = 3000;
const TERMINAL_RUNNINGHUB_RENDER_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'canceled',
  'cancelled'
]);

function readAvatarConfigFromBody(body = {}) {
  return normalizeAvatarConfig({
    genText: String(body.genText || '').trim(),
    renderProvider: String(body.renderProvider || 'comfyui').trim(),
    serverUrl: String(body.serverUrl || '').trim(),
    runningHubApiKey: String(body.runningHubApiKey || '').trim(),
    runningHubBaseUrl: String(body.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL).trim(),
    runningHubWorkflowId: String(body.runningHubWorkflowId || RUNNINGHUB_INFINITETALK_3INPUT.workflowId).trim(),
    runningHubRunPath: String(body.runningHubRunPath || '').trim(),
    runningHubAccessPassword: String(body.runningHubAccessPassword || '').trim(),
    runningHubInstanceType: String(body.runningHubInstanceType || '').trim(),
    runningHubUsePersonalQueue: body.runningHubUsePersonalQueue === true || body.runningHubUsePersonalQueue === 'true',
    runningHubRetainSeconds: Number(body.runningHubRetainSeconds || 0),
    runningHubAudioNodeId: String(body.runningHubAudioNodeId || RUNNINGHUB_INFINITETALK_3INPUT.audioNodeId).trim(),
    runningHubAudioFieldName: String(body.runningHubAudioFieldName || RUNNINGHUB_INFINITETALK_3INPUT.audioFieldName).trim(),
    runningHubImageNodeId: String(body.runningHubImageNodeId || RUNNINGHUB_INFINITETALK_3INPUT.imageNodeId).trim(),
    runningHubImageFieldName: String(body.runningHubImageFieldName || RUNNINGHUB_INFINITETALK_3INPUT.imageFieldName).trim(),
    runningHubPoseNodeId: String(body.runningHubPoseNodeId || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId).trim(),
    runningHubPoseFieldName: String(body.runningHubPoseFieldName || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName).trim(),
    runningHubOutputNodeId: String(body.runningHubOutputNodeId || RUNNINGHUB_INFINITETALK_3INPUT.outputNodeId).trim(),
    poseNodeId: String(body.poseNodeId || '').trim(),
    poseFieldName: String(body.poseFieldName || 'pose').trim(),
    avatarActionPresetDir: String(body.avatarActionPresetDir || '').trim(),
    speechAlignmentEnabled: body.speechAlignmentEnabled,
    audioPreset: String(body.audioPreset || '').trim(),
    imagePreset: String(body.imagePreset || '').trim()
  });
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

function hashText(value) {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeCachePath(filePath) {
  return path.normalize(String(filePath || '').trim()).toLowerCase();
}

function readJsonFile(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function getUsableFileStat(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0 ? stat : null;
  } catch (_err) {
    return null;
  }
}

function getQwenTtsAudioPath(outputDir) {
  return path.join(outputDir, DEFAULT_OUTPUT_FILENAME);
}

function getQwenTtsMetadataPath(outputDir) {
  return path.join(outputDir, QWEN_TTS_METADATA_FILE);
}

function isLegacyTtsCacheFresh({ audioStat, narrationPath, referenceAudioPath }) {
  const narrationStat = getUsableFileStat(narrationPath);
  if (narrationStat && audioStat.mtimeMs + 1000 < narrationStat.mtimeMs) {
    return false;
  }

  const referenceStat = getUsableFileStat(referenceAudioPath);
  if (referenceStat && audioStat.mtimeMs + 1000 < referenceStat.mtimeMs) {
    return false;
  }

  return true;
}

function getReusableQwenTtsSpeech({
  outputDir,
  narrationPath,
  narrationSignature,
  referenceAudioPath,
  sourceReferenceAudioPath = referenceAudioPath
}) {
  const outputPath = getQwenTtsAudioPath(outputDir);
  const audioStat = getUsableFileStat(outputPath);
  if (!audioStat) return null;

  const metadata = readJsonFile(getQwenTtsMetadataPath(outputDir), {});
  const metadataSignature = String(metadata?.narrationSignature || '').trim();
  const metadataReferencePath = String(metadata?.referenceAudioPath || '').trim();
  if (metadataSignature || metadataReferencePath) {
    if (metadataSignature && metadataSignature !== narrationSignature) return null;
    if (
      metadataReferencePath &&
      normalizeCachePath(metadataReferencePath) !== normalizeCachePath(referenceAudioPath)
    ) {
      return null;
    }
  } else if (!isLegacyTtsCacheFresh({ audioStat, narrationPath, referenceAudioPath: sourceReferenceAudioPath })) {
    return null;
  }

  return {
    outputPath,
    voice: String(metadata?.voice || ''),
    model: String(metadata?.model || ''),
    audioUrl: String(metadata?.audioUrl || ''),
    cached: true,
    legacyCache: !metadataSignature
  };
}

function writeQwenTtsMetadata({ outputDir, narrationSignature, referenceAudioPath, ttsResult }) {
  writeJsonFile(getQwenTtsMetadataPath(outputDir), {
    version: 1,
    narrationSignature,
    referenceAudioPath,
    outputPath: ttsResult.outputPath,
    voice: ttsResult.voice || '',
    model: ttsResult.model || '',
    audioUrl: ttsResult.audioUrl || '',
    updatedAt: nowIso()
  });
}

function resolvePositiveIntegerEnv(name, fallback) {
  const value = String(process.env[name] || '').trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLlmSpeechChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .map((item) => ({
      kind: 'llm',
      raw: String(item?.raw || '').trim(),
      reading: String(item?.reading || '').trim(),
      reason: String(item?.reason || '').trim()
    }))
    .filter((item) => item.raw && item.reading && item.raw !== item.reading);
}

function readSpeechNarrationProtocolResult(payload = {}) {
  return payload?.protocol?.result || {};
}

async function generateDeepSeekSpeechNarration({ sourceText, fallbackText, outputDir, runPython = runPythonScript }) {
  const payload = await runPython(SPEECH_NARRATION_SCRIPT, [
    '--source-text',
    sourceText,
    '--fallback-text',
    fallbackText
  ], {
    cwd: outputDir,
    timeout: Number(process.env.SPEECH_NARRATION_LLM_TIMEOUT_MS || SPEECH_NARRATION_TIMEOUT_MS)
  });
  const result = readSpeechNarrationProtocolResult(payload);
  const speechText = String(result.speechText || '').trim();
  if (!speechText) {
    throw new Error('DeepSeek 未返回可用口播专用稿');
  }
  return {
    speechText,
    provider: String(result.provider || 'deepseek'),
    model: String(result.model || process.env.DEEPSEEK_SPEECH_MODEL || process.env.DEEPSEEK_TEXT_MODEL || ''),
    normalizations: normalizeLlmSpeechChanges(result.changes)
  };
}

function writeNarrationSpeechArtifacts({ outputDir, sourceText, preparedNarrationText }) {
  const speechTextPath = path.join(outputDir, NARRATION_SPEECH_TEXT_FILE);
  const metadataPath = path.join(outputDir, NARRATION_SPEECH_METADATA_FILE);
  fs.writeFileSync(speechTextPath, preparedNarrationText.speechText, 'utf8');
  writeJsonFile(metadataPath, {
    version: 1,
    source: preparedNarrationText.source || 'rule_based_numeric_normalizer',
    provider: preparedNarrationText.provider || '',
    model: preparedNarrationText.model || '',
    displayText: preparedNarrationText.validationText,
    speechText: preparedNarrationText.speechText,
    changed: preparedNarrationText.speechTextChanged,
    normalizations: preparedNarrationText.speechNormalizations || [],
    sourceTextSignature: hashText(sourceText),
    speechTextSignature: hashText(preparedNarrationText.speechText),
    updatedAt: nowIso()
  });
  return {
    speechTextPath,
    metadataPath
  };
}

function getAvatarRenderStatePath(outputDir) {
  return path.join(outputDir, AVATAR_RENDER_STATE_FILE);
}

function readAvatarRenderState(outputDir) {
  const payload = readJsonFile(getAvatarRenderStatePath(outputDir), {});
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

function writeAvatarRenderState(outputDir, patch) {
  const statePath = getAvatarRenderStatePath(outputDir);
  const current = readAvatarRenderState(outputDir);
  const next = {
    ...current,
    ...patch,
    version: 1,
    updatedAt: nowIso()
  };
  writeJsonFile(statePath, next);
  return next;
}

function buildRunningHubRenderKey({ cfg, audioPathForUpload, imagePath, narrationSignature, motionSignature = '' }) {
  return hashText(JSON.stringify({
    provider: 'runninghub',
    baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
    workflowId: cfg.runningHubWorkflowId || RUNNINGHUB_INFINITETALK_3INPUT.workflowId,
    runPath: cfg.runningHubRunPath || '',
    audioNodeId: cfg.runningHubAudioNodeId || RUNNINGHUB_INFINITETALK_3INPUT.audioNodeId,
    audioFieldName: cfg.runningHubAudioFieldName || RUNNINGHUB_INFINITETALK_3INPUT.audioFieldName,
    imageNodeId: cfg.runningHubImageNodeId || RUNNINGHUB_INFINITETALK_3INPUT.imageNodeId,
    imageFieldName: cfg.runningHubImageFieldName || RUNNINGHUB_INFINITETALK_3INPUT.imageFieldName,
    poseNodeId: cfg.runningHubPoseNodeId || process.env.RUNNINGHUB_POSE_NODE_ID || RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId,
    poseFieldName: cfg.runningHubPoseFieldName || process.env.RUNNINGHUB_POSE_FIELD_NAME || RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName,
    outputNodeId: cfg.runningHubOutputNodeId || RUNNINGHUB_INFINITETALK_3INPUT.outputNodeId,
    speechAudioPath: normalizeCachePath(audioPathForUpload),
    imagePath: normalizeCachePath(imagePath),
    narrationSignature,
    motionSignature
  }));
}

function getReusableRunningHubState(outputDir, resumeKey) {
  const state = readAvatarRenderState(outputDir);
  if (state.provider !== 'runninghub') return null;
  if (!state.taskId) return null;
  if (TERMINAL_RUNNINGHUB_RENDER_STATUSES.has(String(state.status || '').toLowerCase())) {
    return null;
  }
  const stateResumeKey = String(state.resumeKey || '');
  if (stateResumeKey && stateResumeKey !== resumeKey) {
    return {
      ...state,
      resumeKeyMismatch: true,
      previousResumeKey: stateResumeKey
    };
  }
  return state;
}

function hasUsableAimanVideo(outputDir) {
  return Boolean(getUsableFileStat(path.join(outputDir, 'aiman.mp4')));
}

function isRunningHubStateOlderThanAudio(state, audioPath) {
  const submittedAt = Date.parse(String(state?.submittedAt || ''));
  if (!Number.isFinite(submittedAt) || !audioPath) return false;
  try {
    const audioMtime = fs.statSync(audioPath).mtimeMs;
    return Number.isFinite(audioMtime) && submittedAt + 1000 < audioMtime;
  } catch (_err) {
    return false;
  }
}

function hasRunningHubPoseInput(state = {}) {
  if (String(state?.remotePoseName || '').trim()) return true;
  const nodeInfoList = Array.isArray(state?.nodeInfoList) ? state.nodeInfoList : [];
  return nodeInfoList.some((item) => {
    const fieldName = String(item?.fieldName || '').trim().toLowerCase();
    return fieldName === 'video' && String(item?.fieldValue || '').trim();
  });
}

function getDetailedErrorMessage(error, fallback = '任务执行失败') {
  const message = String(error?.message || fallback).trim();
  const details = String(error?.details || error?.protocol?.details || '').trim();
  if (details && details !== message && !message.includes(details)) {
    return `${message}: ${details}`;
  }
  return message || fallback;
}

function buildErrorMetadata(error, detailedMessage) {
  return {
    error: detailedMessage,
    errorCode: String(error?.code || error?.protocol?.code || '').trim(),
    errorStage: String(error?.stage || error?.protocol?.stage || '').trim(),
    errorDetails: String(error?.details || error?.protocol?.details || '').trim()
  };
}

function hasCurrentRunningHubPoseSignature(state = {}, motionSignature = '') {
  const expectedSignature = String(motionSignature || '').trim();
  if (!expectedSignature) return false;
  return String(state?.remotePoseSignature || '').trim() === expectedSignature;
}

function validateMotionRenderInput({ cfg, provider, avatarMotion }) {
  const posePath = String(avatarMotion?.poseInputPath || '').trim();
  if (!getUsableFileStat(posePath)) {
    throw new Error('缺少数字人动作参考视频，已停止提交数字人合成');
  }
  if (provider === 'comfyui') {
    const poseNodeId = String(cfg.poseNodeId || process.env.AVATAR_POSE_NODE_ID || '').trim();
    if (!poseNodeId) {
      throw new Error('ComfyUI 数字人动作参考已启用，但未配置 AVATAR_POSE_NODE_ID / poseNodeId');
    }
  }
}

function validateMotionRenderResult({ renderResult }) {
  if (renderResult?.provider === 'runninghub' && !hasRunningHubPoseInput(renderResult)) {
    throw new Error('RunningHub 数字人合成未提交动作参考视频节点输入，已停止下载错误视频');
  }
}

async function downloadAvatarVideoWithRetry({
  downloadFile,
  videoUrl,
  aimanPath,
  task,
  provider,
  renderResult,
  renderResumeKey,
  remotePoseSignature = '',
  targetLabel,
  maxRetries = resolvePositiveIntegerEnv('AVATAR_DOWNLOAD_RETRIES', DEFAULT_AVATAR_DOWNLOAD_RETRIES),
  retryDelayMs = resolvePositiveIntegerEnv('AVATAR_DOWNLOAD_RETRY_DELAY_MS', DEFAULT_AVATAR_DOWNLOAD_RETRY_DELAY_MS)
}) {
  let lastError = null;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await downloadFile(videoUrl, aimanPath, {
        timeout: 180000,
        headers
      });
      return;
    } catch (error) {
      lastError = error;
      try {
        if (fs.existsSync(aimanPath)) fs.unlinkSync(aimanPath);
      } catch (_err) {}
      const message = error?.code || error?.message || String(error);
      if (attempt < maxRetries) {
        addTaskLog(task, `数字人视频下载失败，准备重试 ${attempt}/${maxRetries}: ${message}`, 'warning');
        await wait(retryDelayMs * attempt);
      }
    }
  }

  if (provider === 'runninghub') {
    writeAvatarRenderState(task.outputPath, {
      provider: 'runninghub',
      status: 'download_interrupted',
      resumeKey: renderResumeKey,
      taskId: renderResult.taskId,
      videoUrl,
      remoteAudioName: renderResult.remoteAudioName || '',
      remoteImageName: renderResult.remoteImageName || '',
      remotePoseName: renderResult.remotePoseName || '',
      remotePoseSignature,
      nodeInfoList: renderResult.nodeInfoList || [],
      targetLabel,
      error: lastError?.message || String(lastError)
    });
  }
  throw new Error(`数字人视频下载失败（已重试${maxRetries}次）: ${lastError?.code || lastError?.message || lastError}`);
}

function createAvatarGenerationService({
  paths,
  persistTaskStateSnapshot = () => {},
  rendererFactory = createAvatarRenderer,
  synthesizeSpeech = synthesizeQwenTtsSpeech,
  prepareReferenceAudioFn = prepareReferenceAudio,
  generateAvatarMotionFn = generateAvatarMotion,
  generateSpeechNarration = generateDeepSeekSpeechNarration,
  ensureSpeechAlignmentFn = ensureSpeechAlignment,
  readWorkflowFile = readWorkflow,
  downloadFile = downloadToFile,
  taskStore = null
} = {}) {
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
    const rulePreparedNarrationText = prepareNarrationTextForAvatarWorkflow(narrationText);
    if (!rulePreparedNarrationText.isUsable) {
      throw new Error('缺少可用口播文案（narration.json / genText）');
    }
    let preparedNarrationText = {
      ...rulePreparedNarrationText,
      source: 'rule_based_numeric_normalizer'
    };
    try {
      const llmSpeech = await generateSpeechNarration({
        sourceText: rulePreparedNarrationText.validationText,
        fallbackText: rulePreparedNarrationText.speechText,
        outputDir: task.outputPath
      });
      preparedNarrationText = {
        ...rulePreparedNarrationText,
        speechText: llmSpeech.speechText,
        speechNormalizations: llmSpeech.normalizations,
        speechTextChanged: rulePreparedNarrationText.validationText !== llmSpeech.speechText,
        source: 'deepseek_speech_normalizer',
        provider: llmSpeech.provider,
        model: llmSpeech.model
      };
      addTaskLog(
        task,
        `DeepSeek 已生成口播专用稿: ${llmSpeech.model || 'default'}，转换 ${llmSpeech.normalizations.length} 处`,
        'success'
      );
    } catch (error) {
      addTaskLog(
        task,
        `DeepSeek 口播专用稿生成失败，已回退规则稿: ${error?.message || error}`,
        'warning'
      );
    }
    const speechArtifacts = writeNarrationSpeechArtifacts({
      outputDir: task.outputPath,
      sourceText: narrationText,
      preparedNarrationText
    });
    if (preparedNarrationText.speechTextChanged) {
      addTaskLog(
        task,
        `已生成口播专用稿: ${path.basename(speechArtifacts.speechTextPath)}，数字/单位转换 ${preparedNarrationText.speechNormalizations.length} 处`,
        'info'
      );
    } else {
      addTaskLog(task, `已生成口播专用稿: ${path.basename(speechArtifacts.speechTextPath)}`, 'info');
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

    const preparedReferenceAudio = prepareReferenceAudioFn({
      inputPath: audioPath,
      outputDir: task.outputPath,
      limitSeconds: QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS
    });
    const referenceAudioPath = preparedReferenceAudio.audioPath;
    const narrationSignature = hashText(preparedNarrationText.speechText);

    task.status = 'generating_avatar';
    task.currentStep = 6;
    task.progress = Math.max(Number(task.progress || 0), 84);
    task.statusText = '正在准备数字人口播音频...';
    task.updatedAt = nowIso();
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

    let ttsResult = getReusableQwenTtsSpeech({
      outputDir: task.outputPath,
      narrationPath,
      narrationSignature,
      referenceAudioPath,
      sourceReferenceAudioPath: audioPath
    });
    if (ttsResult) {
      addTaskLog(task, `复用已生成的 Qwen3TTS 口播音频: ${path.basename(ttsResult.outputPath)}`, 'success');
    } else {
      task.statusText = '正在使用 Qwen3TTS 复刻音色并合成口播音频...';
      task.updatedAt = nowIso();
      addTaskLog(task, '开始调用 Qwen3TTS API 复刻音色并合成口播音频', 'info');
      addTaskLog(task, `Qwen3TTS 输入: 文案=${preparedNarrationText.speechText.length}字, 音色参考=${path.basename(referenceAudioPath)}`, 'info');
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
      emitTaskEvent(jobId, 'status', { message: task.statusText });
      ttsResult = await synthesizeSpeech({
        text: preparedNarrationText.speechText,
        referenceAudioPath,
        outputDir: task.outputPath
      });
      writeQwenTtsMetadata({
        outputDir: task.outputPath,
        narrationSignature,
        referenceAudioPath,
        ttsResult
      });
      addTaskLog(
        task,
        `Qwen3TTS 口播音频生成完成: ${path.basename(ttsResult.outputPath)}${ttsResult.model ? `, model=${ttsResult.model}` : ''}`,
        'success'
      );
    }
    const audioPathForUpload = ttsResult.outputPath;
    let speechAlignment = null;
    try {
      task.statusText = '正在生成口播 ASR 对齐缓存...';
      task.updatedAt = nowIso();
      addTaskLog(task, '开始生成可复用口播 ASR 对齐缓存', 'info');
      emitTaskEvent(jobId, 'status', { message: task.statusText });
      speechAlignment = await ensureSpeechAlignmentFn({
        outputDir: task.outputPath,
        speechAudioPath: audioPathForUpload,
        narrationTextPath: speechArtifacts.speechTextPath,
        config: cfg
      });
      if (speechAlignment?.enabled) {
        addTaskLog(
          task,
          `${speechAlignment.reused ? '复用' : '生成'}口播 ASR 对齐缓存: segments=${speechAlignment.segmentCount || 0}, words=${speechAlignment.wordCount || 0}`,
          'success'
        );
      }
    } catch (error) {
      speechAlignment = null;
      addTaskLog(task, `口播 ASR 对齐缓存生成失败，后续将使用原有时间估算: ${error?.message || error}`, 'warning');
    }
    task.statusText = '正在生成数字人动作计划...';
    task.updatedAt = nowIso();
    addTaskLog(task, '开始生成数字人动作计划与姿态序列', 'info');
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });
    let avatarMotion;
    try {
      avatarMotion = await generateAvatarMotionFn({
        outputDir: task.outputPath,
        narrationTextPath: speechArtifacts.speechTextPath,
        speechAudioPath: audioPathForUpload,
        imagePath,
        actionPresetDir: resolveActionPresetDir(cfg),
        speechAlignmentPath: speechAlignment?.alignmentPath || ''
      });
    } catch (error) {
      const detailedMessage = getDetailedErrorMessage(error, '数字人动作计划生成失败');
      task.status = 'failed';
      task.error = detailedMessage;
      task.statusText = detailedMessage;
      task.completedAt = nowIso();
      task.updatedAt = nowIso();
      addTaskLog(task, detailedMessage, 'error');
      syncMaterialTask(taskStore, task, buildErrorMetadata(error, detailedMessage));
      emitTaskEvent(jobId, 'error_event', { message: detailedMessage });
      const wrapped = new Error(detailedMessage);
      wrapped.code = error?.code;
      wrapped.stage = error?.stage;
      wrapped.details = error?.details || error?.protocol?.details || '';
      wrapped.protocol = error?.protocol || null;
      throw wrapped;
    }
    addTaskLog(
      task,
      `数字人动作源视频已生成: segments=${avatarMotion.segmentCount}, file=${path.basename(avatarMotion.motionSourcePath || avatarMotion.poseInputPath)}`,
      'success'
    );

    const provider = resolveAvatarRenderProvider(cfg);
    const workflow = readWorkflowFile(paths.WORKFLOW_PATH);
    const renderer = rendererFactory();
    const providerLabel = provider === 'runninghub' ? 'RunningHub Workflow API' : 'ComfyUI';
    const targetLabel = provider === 'runninghub'
      ? buildRunningHubRunUrl({
        baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
        workflowId: cfg.runningHubWorkflowId || RUNNINGHUB_INFINITETALK_3INPUT.workflowId,
        runPath: cfg.runningHubRunPath
      })
      : String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim().replace(/\/+$/, '');
    addTaskLog(task, `准备调用 ${providerLabel}: ${targetLabel}`, 'info');

    const renderResumeKey = provider === 'runninghub'
      ? buildRunningHubRenderKey({
        cfg,
        audioPathForUpload,
        imagePath,
        narrationSignature,
        motionSignature: avatarMotion?.motionSignature || ''
      })
      : '';
    const previousRunningHubState = renderResumeKey
      ? readAvatarRenderState(task.outputPath)
      : null;
    const previousRunningHubStatus = String(previousRunningHubState?.status || '').trim().toLowerCase();
    const previousRunningHubTaskId = String(previousRunningHubState?.taskId || '').trim();
    const previousRunningHubTerminal = previousRunningHubState?.provider === 'runninghub' &&
      previousRunningHubTaskId &&
      TERMINAL_RUNNINGHUB_RENDER_STATUSES.has(previousRunningHubStatus);
    const reusableRunningHubState = renderResumeKey
      ? getReusableRunningHubState(task.outputPath, renderResumeKey)
      : null;
    const runningHubStateOlderThanAudio = isRunningHubStateOlderThanAudio(reusableRunningHubState, audioPathForUpload);
    const runningHubStateMissingMotionPose = provider === 'runninghub' &&
      reusableRunningHubState &&
      !hasRunningHubPoseInput(reusableRunningHubState);
    const runningHubStatePoseSignatureMismatch = provider === 'runninghub' &&
      reusableRunningHubState &&
      !hasCurrentRunningHubPoseSignature(reusableRunningHubState, avatarMotion?.motionSignature);
    const canReuseRunningHubState = reusableRunningHubState &&
      !reusableRunningHubState.resumeKeyMismatch &&
      !runningHubStateOlderThanAudio &&
      !runningHubStateMissingMotionPose &&
      !runningHubStatePoseSignatureMismatch;
    const reusableAimanVideo = canReuseRunningHubState && reusableRunningHubState?.videoUrl && hasUsableAimanVideo(task.outputPath);

    task.progress = Math.max(Number(task.progress || 0), 86);
    task.statusText = '正在自动生成数字人...';
    task.updatedAt = nowIso();
    addTaskLog(task, `自动调用 ${providerLabel} 生成数字人`, 'info');
    addTaskLog(
      task,
      `自动生成人像素材: Qwen3TTS音频=${path.basename(audioPathForUpload)}, 图片=${path.basename(imagePath)}, 姿态=${path.basename(avatarMotion.poseInputPath)}, 渲染服务=${targetLabel}`,
      'info'
    );
    emitTaskEvent(jobId, 'step', { step: 6, message: '步骤6: 自动生成数字人' });
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });
    syncMaterialTask(taskStore, task);

    let renderResult;
    if (reusableAimanVideo) {
      addTaskLog(task, `复用已下载的数字人视频: aiman.mp4, taskId=${reusableRunningHubState.taskId}`, 'success');
      task.statusText = '数字人生成完成，继续执行混剪...';
      task.progress = Math.max(Number(task.progress || 0), 90);
      task.updatedAt = nowIso();
      syncAvatarTask(taskStore, task, reusableRunningHubState, { stage: 'downloaded' });
      syncMaterialTask(taskStore, task);
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
      emitTaskEvent(jobId, 'status', { message: task.statusText });
      return;
    }

    if (reusableRunningHubState?.resumeKeyMismatch) {
      addTaskLog(task, `检测到旧 RunningHub 任务与当前口播不一致，已重新提交新任务: previousTaskId=${reusableRunningHubState.taskId}`, 'warning');
    }
    if (previousRunningHubTerminal) {
      addTaskLog(task, `上次 RunningHub 任务已结束且不可恢复（status=${previousRunningHubStatus}, taskId=${previousRunningHubTaskId}），本次重试将重新提交新任务`, 'warning');
    }
    if (runningHubStateOlderThanAudio) {
      addTaskLog(task, `检测到旧 RunningHub 任务早于当前口播音频，已重新提交新任务: previousTaskId=${reusableRunningHubState.taskId}`, 'warning');
    }
    if (runningHubStateMissingMotionPose) {
      addTaskLog(task, `检测到旧 RunningHub 任务缺少动作参考视频节点输入，已重新提交新任务: previousTaskId=${reusableRunningHubState.taskId}`, 'warning');
    }
    if (runningHubStatePoseSignatureMismatch) {
      addTaskLog(task, `检测到旧 RunningHub 任务动作参考签名不匹配，已重新上传动作参考并提交新任务: previousTaskId=${reusableRunningHubState.taskId}`, 'warning');
    }

    if (canReuseRunningHubState && reusableRunningHubState?.videoUrl) {
      addTaskLog(task, `复用已完成的 RunningHub 输出: taskId=${reusableRunningHubState.taskId}`, 'success');
      renderResult = {
        provider: 'runninghub',
        taskId: reusableRunningHubState.taskId,
        status: reusableRunningHubState.status || 'completed',
        videoUrl: reusableRunningHubState.videoUrl,
        remoteAudioName: reusableRunningHubState.remoteAudioName || '',
        remoteImageName: reusableRunningHubState.remoteImageName || '',
        remotePoseName: reusableRunningHubState.remotePoseName || '',
        nodeInfoList: Array.isArray(reusableRunningHubState.nodeInfoList) ? reusableRunningHubState.nodeInfoList : [],
        resumed: true
      };
    } else {
      if (canReuseRunningHubState && reusableRunningHubState?.taskId) {
        addTaskLog(task, `检测到未完成的 RunningHub 任务，继续查询: taskId=${reusableRunningHubState.taskId}`, 'info');
      }
      try {
        validateMotionRenderInput({ cfg, provider, avatarMotion });
        renderResult = await renderer.render({
          avatarConfig: {
            ...cfg,
            serverUrl: String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim()
          },
          workflow,
          speechAudioPath: audioPathForUpload,
          referenceAudioPath,
          imagePath,
          posePath: avatarMotion.poseInputPath,
          defaultComfyBaseUrl: runtime.DEFAULT_COMFYUI_BASE_URL,
          runningHubTaskId: canReuseRunningHubState ? reusableRunningHubState?.taskId || '' : '',
          runningHubRemoteAudioName: canReuseRunningHubState ? reusableRunningHubState?.remoteAudioName || '' : '',
          runningHubRemoteImageName: canReuseRunningHubState ? reusableRunningHubState?.remoteImageName || '' : '',
          runningHubRemotePoseName: canReuseRunningHubState ? reusableRunningHubState?.remotePoseName || '' : '',
          runningHubNodeInfoList: canReuseRunningHubState ? reusableRunningHubState?.nodeInfoList || [] : [],
          onRunningHubSubmitted: (submission) => {
            const submittedState = writeAvatarRenderState(task.outputPath, {
              provider: 'runninghub',
              status: 'submitted',
              resumeKey: renderResumeKey,
              taskId: submission.taskId,
              remoteAudioName: submission.remoteAudioName || '',
              remoteImageName: submission.remoteImageName || '',
              remotePoseName: submission.remotePoseName || '',
              remotePoseSignature: avatarMotion?.motionSignature || '',
              nodeInfoList: submission.nodeInfoList || [],
              targetLabel,
              submittedAt: nowIso(),
              error: ''
            });
            syncAvatarTask(taskStore, task, submittedState, { stage: 'submitted' });
            syncMaterialTask(taskStore, task);
            addTaskLog(task, `RunningHub 工作流已提交: taskId=${submission.taskId}`, 'info');
          }
        });
      } catch (err) {
        if (provider === 'runninghub') {
          const existingState = readAvatarRenderState(task.outputPath);
          const taskId = err.runningHubTaskId || existingState.taskId || reusableRunningHubState?.taskId || '';
          if (taskId) {
            const interruptedState = writeAvatarRenderState(task.outputPath, {
              provider: 'runninghub',
              status: String(err.message || '').includes('[RunningHub 任务失败]') ? 'failed' : 'polling_interrupted',
              resumeKey: renderResumeKey,
              taskId,
              remoteAudioName: err.remoteAudioName || existingState.remoteAudioName || '',
              remoteImageName: err.remoteImageName || existingState.remoteImageName || '',
              remotePoseName: err.remotePoseName || existingState.remotePoseName || '',
              remotePoseSignature: avatarMotion?.motionSignature || existingState.remotePoseSignature || '',
              nodeInfoList: err.nodeInfoList || existingState.nodeInfoList || [],
              targetLabel,
              error: err.message || String(err)
            });
            syncAvatarTask(taskStore, task, interruptedState, { stage: interruptedState.status });
            syncMaterialTask(taskStore, task, { error: interruptedState.error });
          }
        }
        throw err;
      }
    }

    if (renderResult.provider === 'runninghub') {
      validateMotionRenderResult({ renderResult });
      const completedState = writeAvatarRenderState(task.outputPath, {
        provider: 'runninghub',
        status: 'completed',
        resumeKey: renderResumeKey,
        taskId: renderResult.taskId,
        videoUrl: renderResult.videoUrl,
        remoteAudioName: renderResult.remoteAudioName || '',
        remoteImageName: renderResult.remoteImageName || '',
        remotePoseName: renderResult.remotePoseName || '',
        remotePoseSignature: avatarMotion?.motionSignature || '',
        nodeInfoList: renderResult.nodeInfoList || [],
        targetLabel,
        completedAt: nowIso(),
        error: ''
      });
      syncAvatarTask(taskStore, task, completedState, { stage: 'completed' });
      if (renderResult.resumed) {
        addTaskLog(task, `RunningHub 任务已恢复完成: taskId=${renderResult.taskId}`, 'success');
      }
      if (Array.isArray(renderResult.nodeInfoList) && renderResult.nodeInfoList.length) {
        addTaskLog(task, `RunningHub 节点输入: ${renderResult.nodeInfoList.map((item) => `${item.nodeId}.${item.fieldName}`).join(', ')}`, 'info');
      }
    } else {
      addTaskLog(task, `素材上传到 ${providerLabel} 成功: audio=${renderResult.remoteAudioName}, image=${renderResult.remoteImageName}${renderResult.remotePoseName ? `, pose=${renderResult.remotePoseName}` : ''}`, 'success');
      addTaskLog(task, `本次数字人视频 seed 使用工作流配置: ${renderResult.seed ?? '未设置'}`, 'info');
      addTaskLog(task, `ComfyUI 工作流已提交: prompt_id=${renderResult.promptId}`, 'info');
    }
    addTaskLog(task, '当前工作流使用外部口播音频输入，数字人时长将跟随 Qwen3TTS 合成音频自动匹配', 'info');

    const videoUrl = renderResult.videoUrl;
    addTaskLog(task, `${providerLabel} 渲染完成，开始下载数字人视频`, 'info');
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    await downloadAvatarVideoWithRetry({
      downloadFile,
      videoUrl,
      aimanPath,
      task,
      provider: renderResult.provider,
      renderResult,
      renderResumeKey,
      remotePoseSignature: avatarMotion?.motionSignature || '',
      targetLabel
    });

    if (renderResult.provider === 'runninghub') {
      const downloadedState = writeAvatarRenderState(task.outputPath, {
        provider: 'runninghub',
        status: 'downloaded',
        resumeKey: renderResumeKey,
        taskId: renderResult.taskId,
        videoUrl,
        remoteAudioName: renderResult.remoteAudioName || '',
        remoteImageName: renderResult.remoteImageName || '',
        remotePoseName: renderResult.remotePoseName || '',
        remotePoseSignature: avatarMotion?.motionSignature || '',
        nodeInfoList: renderResult.nodeInfoList || [],
        downloadedAt: nowIso(),
        error: ''
      });
      syncAvatarTask(taskStore, task, downloadedState, {
        stage: 'downloaded',
        outputPath: aimanPath
      });
    }

    task.statusText = '数字人生成完成，继续执行混剪...';
    task.progress = Math.max(Number(task.progress || 0), 90);
    task.updatedAt = nowIso();
    addTaskLog(task, '数字人已生成：aiman.mp4', 'success');
    syncMaterialTask(taskStore, task);
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });
  }

  return { autoGenerateAvatar };
}

module.exports = {
  AVATAR_RENDER_STATE_FILE,
  NARRATION_SPEECH_METADATA_FILE,
  NARRATION_SPEECH_TEXT_FILE,
  QWEN_TTS_METADATA_FILE,
  createAvatarGenerationService,
  downloadAvatarVideoWithRetry,
  generateDeepSeekSpeechNarration,
  getReusableQwenTtsSpeech,
  getReusableRunningHubState,
  readAvatarRenderState,
  readAvatarConfigFromBody,
  probeRunningHubConfig,
  writeAvatarRenderState
};
