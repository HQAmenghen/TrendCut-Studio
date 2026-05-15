const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createAvatarRenderer, resolveAvatarRenderProvider } = require('../pipeline/avatarRenderer');
const { buildRunningHubRunUrl, DEFAULT_RUNNINGHUB_BASE_URL, resolveRunningHubApiKey } = require('../pipeline/runningHub');
const { QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS, prepareReferenceAudio } = require('./avatarAudio');
const { prepareNarrationTextForAvatarWorkflow } = require('./avatarWorkflow');
const { resolvePresetFile } = require('./presetResolver');
const { DEFAULT_OUTPUT_FILENAME, synthesizeQwenTtsSpeech } = require('./qwenTts');
const { readWorkflow } = require('../pipeline/workflow');
const runtime = require('../../config/runtime');
const { downloadToFile } = require('./materialDownload');
const { addTaskLog, emitTaskEvent } = require('./events');
const { firstExistingFile, nowIso } = require('./utils');

const QWEN_TTS_METADATA_FILE = 'avatar_qwen3tts.json';
const AVATAR_RENDER_STATE_FILE = 'avatar_render_state.json';

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

function buildRunningHubRenderKey({ cfg, audioPathForUpload, imagePath, narrationSignature }) {
  return hashText(JSON.stringify({
    provider: 'runninghub',
    baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
    workflowId: cfg.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706',
    runPath: cfg.runningHubRunPath || '',
    audioNodeId: cfg.runningHubAudioNodeId || '6',
    audioFieldName: cfg.runningHubAudioFieldName || 'audio',
    imageNodeId: cfg.runningHubImageNodeId || '180',
    imageFieldName: cfg.runningHubImageFieldName || 'image',
    outputNodeId: cfg.runningHubOutputNodeId || '',
    speechAudioPath: normalizeCachePath(audioPathForUpload),
    imagePath: normalizeCachePath(imagePath),
    narrationSignature
  }));
}

function getReusableRunningHubState(outputDir, resumeKey) {
  const state = readAvatarRenderState(outputDir);
  if (state.provider !== 'runninghub') return null;
  if (String(state.resumeKey || '') !== resumeKey) return null;
  if (!state.taskId) return null;
  if (['failed', 'canceled', 'cancelled'].includes(String(state.status || '').toLowerCase())) {
    return null;
  }
  return state;
}

function hasUsableAimanVideo(outputDir) {
  return Boolean(getUsableFileStat(path.join(outputDir, 'aiman.mp4')));
}

function createAvatarGenerationService({
  paths,
  persistTaskStateSnapshot = () => {},
  rendererFactory = createAvatarRenderer,
  synthesizeSpeech = synthesizeQwenTtsSpeech,
  prepareReferenceAudioFn = prepareReferenceAudio,
  readWorkflowFile = readWorkflow,
  downloadFile = downloadToFile
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

    const provider = resolveAvatarRenderProvider(cfg);
    const workflow = readWorkflowFile(paths.WORKFLOW_PATH);
    const renderer = rendererFactory();
    const providerLabel = provider === 'runninghub' ? 'RunningHub Workflow API' : 'ComfyUI';
    const targetLabel = provider === 'runninghub'
      ? buildRunningHubRunUrl({
        baseUrl: cfg.runningHubBaseUrl || DEFAULT_RUNNINGHUB_BASE_URL,
        workflowId: cfg.runningHubWorkflowId || process.env.RUNNINGHUB_WORKFLOW_ID || '2051840324212936706',
        runPath: cfg.runningHubRunPath
      })
      : String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim().replace(/\/+$/, '');
    addTaskLog(task, `准备调用 ${providerLabel}: ${targetLabel}`, 'info');

    const renderResumeKey = provider === 'runninghub'
      ? buildRunningHubRenderKey({ cfg, audioPathForUpload, imagePath, narrationSignature })
      : '';
    const reusableRunningHubState = renderResumeKey
      ? getReusableRunningHubState(task.outputPath, renderResumeKey)
      : null;
    const reusableAimanVideo = reusableRunningHubState?.videoUrl && hasUsableAimanVideo(task.outputPath);

    task.progress = Math.max(Number(task.progress || 0), 86);
    task.statusText = '正在自动生成数字人...';
    task.updatedAt = nowIso();
    addTaskLog(task, `自动调用 ${providerLabel} 生成数字人`, 'info');
    addTaskLog(task, `自动生成人像素材: Qwen3TTS音频=${path.basename(audioPathForUpload)}, 图片=${path.basename(imagePath)}, 渲染服务=${targetLabel}`, 'info');
    emitTaskEvent(jobId, 'step', { step: 6, message: '步骤6: 自动生成数字人' });
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });

    let renderResult;
    if (reusableAimanVideo) {
      addTaskLog(task, `复用已下载的数字人视频: aiman.mp4, taskId=${reusableRunningHubState.taskId}`, 'success');
      task.statusText = '数字人生成完成，继续执行混剪...';
      task.progress = Math.max(Number(task.progress || 0), 90);
      task.updatedAt = nowIso();
      emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
      emitTaskEvent(jobId, 'status', { message: task.statusText });
      return;
    }

    if (reusableRunningHubState?.videoUrl) {
      addTaskLog(task, `复用已完成的 RunningHub 输出: taskId=${reusableRunningHubState.taskId}`, 'success');
      renderResult = {
        provider: 'runninghub',
        taskId: reusableRunningHubState.taskId,
        status: reusableRunningHubState.status || 'completed',
        videoUrl: reusableRunningHubState.videoUrl,
        remoteAudioName: reusableRunningHubState.remoteAudioName || '',
        remoteImageName: reusableRunningHubState.remoteImageName || '',
        nodeInfoList: Array.isArray(reusableRunningHubState.nodeInfoList) ? reusableRunningHubState.nodeInfoList : [],
        resumed: true
      };
    } else {
      if (reusableRunningHubState?.taskId) {
        addTaskLog(task, `检测到未完成的 RunningHub 任务，继续查询: taskId=${reusableRunningHubState.taskId}`, 'info');
      }
      try {
        renderResult = await renderer.render({
          avatarConfig: {
            ...cfg,
            serverUrl: String(cfg.serverUrl || runtime.DEFAULT_COMFYUI_BASE_URL).trim()
          },
          workflow,
          speechAudioPath: audioPathForUpload,
          referenceAudioPath,
          imagePath,
          defaultComfyBaseUrl: runtime.DEFAULT_COMFYUI_BASE_URL,
          runningHubTaskId: reusableRunningHubState?.taskId || '',
          runningHubRemoteAudioName: reusableRunningHubState?.remoteAudioName || '',
          runningHubRemoteImageName: reusableRunningHubState?.remoteImageName || '',
          runningHubNodeInfoList: reusableRunningHubState?.nodeInfoList || [],
          onRunningHubSubmitted: (submission) => {
            writeAvatarRenderState(task.outputPath, {
              provider: 'runninghub',
              status: 'submitted',
              resumeKey: renderResumeKey,
              taskId: submission.taskId,
              remoteAudioName: submission.remoteAudioName || '',
              remoteImageName: submission.remoteImageName || '',
              nodeInfoList: submission.nodeInfoList || [],
              targetLabel,
              submittedAt: nowIso(),
              error: ''
            });
            addTaskLog(task, `RunningHub 工作流已提交: taskId=${submission.taskId}`, 'info');
          }
        });
      } catch (err) {
        if (provider === 'runninghub') {
          const existingState = readAvatarRenderState(task.outputPath);
          const taskId = err.runningHubTaskId || existingState.taskId || reusableRunningHubState?.taskId || '';
          if (taskId) {
            writeAvatarRenderState(task.outputPath, {
              provider: 'runninghub',
              status: String(err.message || '').includes('[RunningHub 任务失败]') ? 'failed' : 'polling_interrupted',
              resumeKey: renderResumeKey,
              taskId,
              remoteAudioName: err.remoteAudioName || existingState.remoteAudioName || '',
              remoteImageName: err.remoteImageName || existingState.remoteImageName || '',
              nodeInfoList: err.nodeInfoList || existingState.nodeInfoList || [],
              targetLabel,
              error: err.message || String(err)
            });
          }
        }
        throw err;
      }
    }

    if (renderResult.provider === 'runninghub') {
      writeAvatarRenderState(task.outputPath, {
        provider: 'runninghub',
        status: 'completed',
        resumeKey: renderResumeKey,
        taskId: renderResult.taskId,
        videoUrl: renderResult.videoUrl,
        remoteAudioName: renderResult.remoteAudioName || '',
        remoteImageName: renderResult.remoteImageName || '',
        nodeInfoList: renderResult.nodeInfoList || [],
        targetLabel,
        completedAt: nowIso(),
        error: ''
      });
      if (renderResult.resumed) {
        addTaskLog(task, `RunningHub 任务已恢复完成: taskId=${renderResult.taskId}`, 'success');
      }
      if (Array.isArray(renderResult.nodeInfoList) && renderResult.nodeInfoList.length) {
        addTaskLog(task, `RunningHub 节点输入: ${renderResult.nodeInfoList.map((item) => `${item.nodeId}.${item.fieldName}`).join(', ')}`, 'info');
      }
    } else {
      addTaskLog(task, `素材上传到 ${providerLabel} 成功: audio=${renderResult.remoteAudioName}, image=${renderResult.remoteImageName}`, 'success');
      addTaskLog(task, `本次数字人视频 seed 使用工作流配置: ${renderResult.seed ?? '未设置'}`, 'info');
      addTaskLog(task, `ComfyUI 工作流已提交: prompt_id=${renderResult.promptId}`, 'info');
    }
    addTaskLog(task, '当前工作流使用外部口播音频输入，数字人时长将跟随 Qwen3TTS 合成音频自动匹配', 'info');

    const videoUrl = renderResult.videoUrl;
    addTaskLog(task, `${providerLabel} 渲染完成，开始下载数字人视频`, 'info');
    const aimanPath = path.join(task.outputPath, 'aiman.mp4');
    await downloadFile(videoUrl, aimanPath);

    if (renderResult.provider === 'runninghub') {
      writeAvatarRenderState(task.outputPath, {
        provider: 'runninghub',
        status: 'downloaded',
        resumeKey: renderResumeKey,
        taskId: renderResult.taskId,
        videoUrl,
        downloadedAt: nowIso(),
        error: ''
      });
    }

    task.statusText = '数字人生成完成，继续执行混剪...';
    task.progress = Math.max(Number(task.progress || 0), 90);
    task.updatedAt = nowIso();
    addTaskLog(task, '数字人已生成：aiman.mp4', 'success');
    emitTaskEvent(jobId, 'progress', { percent: task.progress, message: task.statusText });
    emitTaskEvent(jobId, 'status', { message: task.statusText });
  }

  return { autoGenerateAvatar };
}

module.exports = {
  AVATAR_RENDER_STATE_FILE,
  QWEN_TTS_METADATA_FILE,
  createAvatarGenerationService,
  getReusableQwenTtsSpeech,
  readAvatarRenderState,
  readAvatarConfigFromBody,
  probeRunningHubConfig,
  writeAvatarRenderState
};
