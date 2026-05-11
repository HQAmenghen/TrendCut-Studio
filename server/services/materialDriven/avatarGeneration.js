const fs = require('fs');
const path = require('path');
const { createAvatarRenderer, resolveAvatarRenderProvider } = require('../pipeline/avatarRenderer');
const { buildRunningHubRunUrl, DEFAULT_RUNNINGHUB_BASE_URL, resolveRunningHubApiKey } = require('../pipeline/runningHub');
const { QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS, prepareReferenceAudio } = require('./avatarAudio');
const { prepareNarrationTextForAvatarWorkflow } = require('./avatarWorkflow');
const { resolvePresetFile } = require('./presetResolver');
const { synthesizeQwenTtsSpeech } = require('./qwenTts');
const { readWorkflow } = require('../pipeline/workflow');
const runtime = require('../../config/runtime');
const { downloadToFile } = require('./materialDownload');
const { addTaskLog, emitTaskEvent } = require('./events');
const { firstExistingFile, nowIso } = require('./utils');

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

function createAvatarGenerationService({ paths, persistTaskStateSnapshot = () => {} }) {
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

  return { autoGenerateAvatar };
}

module.exports = {
  createAvatarGenerationService,
  readAvatarConfigFromBody,
  probeRunningHubConfig
};
