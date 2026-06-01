const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  listMaterialTasks: listMaterialDrivenTasks,
  resolveMaterialTaskImportUnchecked,
  normalizeAvatarSegmentSubtitles,
  normalizeExecutionPlanSubtitles,
  normalizeExistingSubtitles,
  normalizeNarrationReferenceSubtitles
} = require('./taskImport');
const { buildMaterialDrivenPipelineArgs } = require('../materialDriven/retryPlan');
const { readTaskState } = require('../materialDriven/taskState');

const REFERENCE_AUTHORITY_ALIGNMENT_FAILED = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
const ASR_REFERENCE_AUTHORITY_MAX_ATTEMPTS = 2;
const MEDIA_VALIDATE_TIMEOUT_MS = 120000;
const MATERIAL_RERENDER_TIMEOUT_MS = 20 * 60 * 1000;
const SOURCE_MEDIA_STABLE_CHECKS = 3;
const SOURCE_MEDIA_STABLE_DELAY_MS = 700;
const STANDALONE_RENDER_PROGRESS_START = 55;
const STANDALONE_RENDER_PROGRESS_END = 96;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = options.timeoutMs
      ? setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (_err) {}
      }, options.timeoutMs)
      : null;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    proc.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
  });
}

function createStandaloneMediaError(message, options = {}) {
  const error = new Error(message);
  error.status = options.status || 422;
  error.code = options.code || 'STANDALONE_SOURCE_MEDIA_INVALID';
  error.stage = options.stage || 'standalone.media';
  error.details = options.details || message;
  error.hint = options.hint || '请重新渲染素材驱动成片后再生成竖屏';
  return error;
}

function createStandaloneUserMessage(error) {
  const code = String(error?.code || '');
  if (code === 'VERTICAL_RENDER_FAILED') {
    return '竖屏合成中断了，未生成完整视频。请重试一次；如果连续失败，请重新生成源视频后再合成。';
  }
  return String(error?.message || '竖屏任务失败');
}

function createStandaloneUserHint(error) {
  const code = String(error?.code || '');
  if (code === 'VERTICAL_RENDER_FAILED') {
    return '系统已避免保留损坏的半成品。';
  }
  return error?.hint || '请检查 ASR、SRT 转换、标题生成、片尾视频或竖屏渲染脚本日志';
}

function createStandaloneUserDetails(error) {
  const code = String(error?.code || '');
  if (code === 'VERTICAL_RENDER_FAILED') {
    return createStandaloneUserMessage(error);
  }
  return String(error?.details || error?.message || '竖屏任务失败');
}

async function waitForStableMediaFile(filePath, options = {}) {
  const checks = Math.max(1, Number(options.checks || SOURCE_MEDIA_STABLE_CHECKS));
  const delayMs = Math.max(100, Number(options.delayMs || SOURCE_MEDIA_STABLE_DELAY_MS));
  let previous = null;
  for (let attempt = 0; attempt < checks; attempt += 1) {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    const current = `${stat.size}:${stat.mtimeMs}`;
    if (previous && previous === current) return true;
    previous = current;
    if (attempt < checks - 1) await wait(delayMs);
  }
  return true;
}

function logRecoverablePythonStderr(label, chunk) {
  const text = String(chunk || '').trim();
  if (!text) return;
  if (text.includes('ReferenceAuthorityAlignmentError')) {
    const lastLine = text.split(/\r?\n/).filter(Boolean).pop() || text;
    console.warn(`[${label}] 参考字幕严格校准未通过，已进入降级流程: ${lastLine}`);
    return;
  }
  console.error(`[${label} stderr]: ${text}`);
}

function secondsFromTimestamp(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function createStandaloneRenderProgressReporter({ sse, sendProgressEvent, durationSeconds = 0, onProgress } = {}) {
  let lastPercent = 0;
  let lastSentAt = 0;

  function emit(progressRatio, messagePrefix = '正在渲染竖屏视频') {
    if (!sse || typeof sendProgressEvent !== 'function') return;
    if (!Number.isFinite(progressRatio)) return;
    const clampedRatio = Math.max(0, Math.min(1, progressRatio));
    const percent = Math.max(
      STANDALONE_RENDER_PROGRESS_START,
      Math.min(
        STANDALONE_RENDER_PROGRESS_END,
        Math.round(STANDALONE_RENDER_PROGRESS_START + clampedRatio * (STANDALONE_RENDER_PROGRESS_END - STANDALONE_RENDER_PROGRESS_START))
      )
    );
    const now = Date.now();
    if (percent <= lastPercent && now - lastSentAt < 1800) return;
    lastPercent = percent;
    lastSentAt = now;
    if (typeof onProgress === 'function') onProgress(percent, `${messagePrefix} ${percent}%`);
    sendProgressEvent(sse, {
      type: 'progress',
      percent,
      msg: `${messagePrefix} ${percent}%`
    });
  }

  function parse(chunk) {
    const text = String(chunk || '');
    const frameMatch = text.match(/frame_index:\s*(\d+)%\|.*?\|\s*(\d+)\/(\d+)/);
    if (frameMatch) {
      emit(Number(frameMatch[2]) / Math.max(1, Number(frameMatch[3])), '正在渲染竖屏视频');
      return true;
    }

    const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (timeMatch && Number(durationSeconds) > 0) {
      emit(secondsFromTimestamp(timeMatch[1]) / Number(durationSeconds), '正在编码竖屏视频');
      return true;
    }
    return false;
  }

  return { parse };
}

function createStandaloneTaskKey(sourceTaskDir) {
  const normalized = String(sourceTaskDir || '').trim();
  return normalized ? `sourceTaskDir:${normalized}` : '';
}

function getStandaloneTaskPublicUrl(metadata = {}) {
  const runtimeJobId = String(metadata.runtimeJobId || '').trim();
  if (runtimeJobId) {
    return `/runtime_jobs/${runtimeJobId}/standalone_output_vertical.mp4`;
  }
  return metadata.videoUrl || '';
}

function getStandaloneTaskOutputPath(metadata = {}) {
  return String(metadata.outputPath || metadata.publicOutputPath || '').trim();
}

function isStandaloneTaskOutputAvailable(task) {
  const outputPath = getStandaloneTaskOutputPath(task?.metadata);
  return Boolean(outputPath && fs.existsSync(outputPath) && fs.statSync(outputPath).isFile());
}

async function validateDecodableMedia(filePath) {
  const textPreview = (() => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0 && stat.size <= 4096) {
        return fs.readFileSync(filePath, 'utf8');
      }
    } catch (_err) {}
    return '';
  })();
  if (textPreview) {
    return {
      ok: !/corrupt|invalid|broken|not\s+a\s+decodable/i.test(textPreview),
      details: textPreview
    };
  }

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { ok: false, details: '文件不存在' };
  }
  const result = await runCommand('ffmpeg', [
    '-v', 'error',
    '-xerror',
    '-i', filePath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-f', 'null',
    '-'
  ], { timeoutMs: MEDIA_VALIDATE_TIMEOUT_MS });
  return {
    ok: result.code === 0,
    details: (result.stderr || result.stdout || '').trim().slice(-1600)
  };
}

async function rerenderMaterialFinalVideo(options = {}) {
  const {
    taskImport,
    pipelineScriptPath,
    runPythonScript,
    validateMedia = validateDecodableMedia,
    sse,
    sendProgressEvent,
    onLog
  } = options;
  if (!taskImport?.taskPath || !taskImport?.videoPath) {
    throw createStandaloneMediaError('素材驱动任务缺少可重渲染的任务目录', {
      code: 'STANDALONE_MATERIAL_RERENDER_UNAVAILABLE',
      details: 'taskPath/videoPath missing',
      hint: '请回到素材驱动任务重新生成成片，再发起竖屏合成'
    });
  }

  const materialPath = path.join(taskImport.taskPath, 'material.mp4');
  const aimanPath = path.join(taskImport.taskPath, 'aiman.mp4');
  const executionPlanPath = path.join(taskImport.taskPath, 'execution_plan.json');
  const missing = [
    ['material.mp4', materialPath],
    ['aiman.mp4', aimanPath],
    ['execution_plan.json', executionPlanPath]
  ].filter(([, filePath]) => !fs.existsSync(filePath));

  if (missing.length > 0) {
    throw createStandaloneMediaError('素材驱动成片损坏，且缺少重渲染所需文件', {
      code: 'STANDALONE_MATERIAL_RERENDER_UNAVAILABLE',
      details: `缺少: ${missing.map(([name]) => name).join(', ')}`,
      hint: '请先在素材驱动任务中重新生成数字人/执行计划，再生成竖屏'
    });
  }

  const state = readTaskState(taskImport.taskPath);
  const args = buildMaterialDrivenPipelineArgs({
    scriptPath: pipelineScriptPath,
    materialPath,
    outputPath: taskImport.taskPath,
    startFrom: 7,
    useSmartClip: state.useSmartClip,
    useCache: state.useCache,
    allowRuleFallback: true,
    unbuffered: true
  });
  const pythonArgs = args[0] === '-u' ? args.slice(1) : args;

  if (sse) {
    sendProgressEvent(sse, {
      type: 'status',
      msg: `竖屏导入检测到 ${taskImport.outputDir} 的源成片暂不可解码，正在修复源成片...`
    });
  }

  await runPythonScript(pythonArgs[0], pythonArgs.slice(1), {
    cwd: taskImport.taskPath,
    timeout: MATERIAL_RERENDER_TIMEOUT_MS,
    onStdout: (chunk) => {
      const lastLine = chunk.toString().trim().split('\n').pop();
      if (lastLine && typeof onLog === 'function') onLog(lastLine);
      if (sse && lastLine) sendProgressEvent(sse, { type: 'status', msg: lastLine });
    },
    onStderr: (chunk) => {
      const errStr = chunk.toString();
      if (errStr.trim() && typeof onLog === 'function') onLog(errStr.trim());
      console.warn(`[standalone_source_repair stderr]: ${errStr}`);
    }
  });

  const validation = await validateMedia(taskImport.videoPath);
  if (!validation.ok) {
    throw createStandaloneMediaError('素材驱动成片重渲染后仍不可解码', {
      details: validation.details || '重渲染后的 output_final.mp4 不可解码',
      hint: '请检查素材驱动第7步混剪日志，修复后再生成竖屏'
    });
  }

  return validation;
}

async function prepareStandaloneInputVideo(options = {}) {
  const {
    taskImport,
    uploadedFile,
    inputVideoPath,
    materialPipelineScriptPath,
    runPythonScript,
    validateMedia: injectedValidateMedia,
    validateDecodableMedia: injectedValidateDecodableMedia,
    sse,
    sendProgressEvent,
    onLog
  } = options;
  const validateMedia = injectedValidateMedia || injectedValidateDecodableMedia || validateDecodableMedia;

  if (!taskImport) {
    fs.renameSync(uploadedFile.path, inputVideoPath);
    const validation = await validateMedia(inputVideoPath);
    if (!validation.ok) {
      throw createStandaloneMediaError('上传的视频源已损坏，无法用于竖屏合成', {
        code: 'STANDALONE_UPLOADED_MEDIA_INVALID',
        details: validation.details || '上传文件不可解码',
        hint: '请重新导出或转码源视频后再上传'
      });
    }
    return { source: 'upload', repaired: false, durationSeconds: 0 };
  }

  if (!taskImport.videoPath || !fs.existsSync(taskImport.videoPath)) {
    throw createStandaloneMediaError('素材驱动任务缺少最终成片 output_final.mp4', {
      code: 'STANDALONE_TASK_VIDEO_MISSING',
      details: `缺少文件: ${taskImport.videoPath || 'output_final.mp4'}`,
      hint: '请先完成素材驱动成片，再生成竖屏'
    });
  }

  await waitForStableMediaFile(taskImport.videoPath);
  const initialValidation = await validateMedia(taskImport.videoPath);
  if (!initialValidation.ok) {
    await rerenderMaterialFinalVideo({
      taskImport,
      pipelineScriptPath: materialPipelineScriptPath,
      runPythonScript,
      validateMedia,
      sse,
      sendProgressEvent,
      onLog
    });
  }

  fs.copyFileSync(taskImport.videoPath, inputVideoPath);
  return {
    source: '素材驱动成片 output_final.mp4',
    repaired: !initialValidation.ok,
    durationSeconds: Number(taskImport.durationSeconds || 0)
  };
}

function isReferenceAuthorityAlignmentFailure(error) {
  return String(error?.code || '').trim() === REFERENCE_AUTHORITY_ALIGNMENT_FAILED ||
    String(error?.protocol?.code || '').trim() === REFERENCE_AUTHORITY_ALIGNMENT_FAILED;
}

function withoutReferenceAuthorityArgs(args) {
  const next = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--reference-text-authority') {
      continue;
    }
    if (arg === '--reference-subtitles-json') {
      index += 1;
      continue;
    }
    next.push(arg);
  }
  return next;
}

function resolveImportedTaskAsrInput(taskImport) {
  if (!taskImport?.taskPath) return '';
  const candidates = [
    taskImport.videoPath,
    path.join(taskImport.taskPath, 'aiman.mp4'),
    path.join(taskImport.taskPath, 'avatar_qwen3tts.wav')
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

async function refreshImportedAvatarSubtitles(options = {}) {
  const {
    taskImport,
    projectsDir,
    runAsrScript,
    runPythonScript,
    sse,
    sendProgressEvent
  } = options;
  if (!taskImport?.taskPath || !taskImport?.outputDir) {
    return taskImport;
  }

  const avatarSegmentsPath = path.join(taskImport.taskPath, 'avatar_segments.json');
  const executionPlanPath = path.join(taskImport.taskPath, 'execution_plan.json');
  const narrationPath = path.join(taskImport.taskPath, 'narration.json');
  const speechSubtitlesPath = path.join(taskImport.taskPath, 'speech_subtitles.json');
  const aimanSubtitlesPath = path.join(taskImport.taskPath, 'aiman_subtitles.json');
  const aimanAudioPath = path.join(taskImport.taskPath, 'aiman_audio.json');
  const referenceSubtitlesPath = path.join(taskImport.taskPath, 'aiman_reference_subtitles.json');
  const buildReferenceSubtitleArtifacts = () => {
    if (fs.existsSync(speechSubtitlesPath)) {
      try {
        const subtitles = normalizeExistingSubtitles(JSON.parse(fs.readFileSync(speechSubtitlesPath, 'utf8')));
        if (subtitles.length > 0) {
          return {
            subtitles,
            source: 'speech_subtitles.json'
          };
        }
      } catch (_err) {}
    }

    if (fs.existsSync(narrationPath)) {
      try {
        const payload = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
        const subtitles = normalizeNarrationReferenceSubtitles(payload);
        if (subtitles.length > 0) {
          return {
            subtitles,
            source: 'narration.json'
          };
        }
      } catch (_err) {}
    }

    if (fs.existsSync(executionPlanPath)) {
      try {
        const payload = JSON.parse(fs.readFileSync(executionPlanPath, 'utf8'));
        const subtitles = normalizeExecutionPlanSubtitles(payload)
          .map((item) => ({
            ...item,
            text: item.zh
          }));
        if (subtitles.length > 0) {
          return {
            subtitles,
            source: 'execution_plan.json'
          };
        }
      } catch (_err) {}
    }

    if (fs.existsSync(avatarSegmentsPath)) {
      try {
        const payload = JSON.parse(fs.readFileSync(avatarSegmentsPath, 'utf8'));
        const subtitles = normalizeAvatarSegmentSubtitles(payload)
          .map((item) => ({
            ...item,
            text: item.zh
          }));
        if (subtitles.length > 0) {
          return {
            subtitles,
            source: 'avatar_segments.json'
          };
        }
      } catch (_err) {}
    }

    return null;
  };

  const writeReferenceSubtitles = (subtitles) => {
    if (!Array.isArray(subtitles) || subtitles.length === 0) return '';
    fs.writeFileSync(referenceSubtitlesPath, JSON.stringify(subtitles, null, 2), 'utf8');
    return referenceSubtitlesPath;
  };

  const persistAvatarSubtitles = (subtitles) => {
    try {
      fs.writeFileSync(aimanSubtitlesPath, JSON.stringify(subtitles, null, 2), 'utf8');
      fs.writeFileSync(
        aimanAudioPath,
        JSON.stringify(
          subtitles.map((item) => ({
            start: Array.isArray(item.time) ? item.time[0] : item.start,
            end: Array.isArray(item.time) ? item.time[1] : item.end,
            text: item.zh || item.text || item.en || ''
          })),
          null,
          2
        ),
        'utf8'
      );
    } catch (_err) {}
  };

  const asrInputPath = resolveImportedTaskAsrInput(taskImport);
  const subtitleArtifacts = buildReferenceSubtitleArtifacts();
  if (!asrInputPath) {
    if (subtitleArtifacts?.subtitles?.length) {
      persistAvatarSubtitles(subtitleArtifacts.subtitles);
      if (sse) {
        sendProgressEvent(sse, {
          type: 'status',
          msg: `未找到可重新 ASR 的数字人音视频，已回退使用 ${subtitleArtifacts.source} 字幕。`
        });
      }
      return resolveMaterialTaskImportUnchecked({ projectsDir, taskDir: taskImport.outputDir });
    }
    return taskImport;
  }

  const referencePath = subtitleArtifacts?.subtitles?.length
    ? writeReferenceSubtitles(subtitleArtifacts.subtitles)
    : '';

  if (sse) {
    sendProgressEvent(sse, {
      type: 'status',
      msg: referencePath
        ? `正在为任务 ${taskImport.outputDir} 的最终成片重新 ASR 打轴，并结合 ${subtitleArtifacts.source} 校准字幕...`
        : `正在为任务 ${taskImport.outputDir} 的最终成片重新识别字幕...`
    });
  }

  const asrArgs = [
    '--input', asrInputPath,
    '--audio-json', 'aiman_audio.json',
    '--subtitles-json', 'aiman_subtitles.json',
    '--speaker-scene-json', 'aiman_speaker_scene.json',
    '--refine-subtitles'
  ];
  if (referencePath) {
    asrArgs.push('--reference-subtitles-json', referencePath, '--reference-text-authority');
  }

  const maxAsrAttempts = referencePath ? ASR_REFERENCE_AUTHORITY_MAX_ATTEMPTS : 1;
  let referenceAuthorityFailed = null;
  for (let attempt = 1; attempt <= maxAsrAttempts; attempt += 1) {
    if (attempt > 1 && sse) {
      sendProgressEvent(sse, {
        type: 'status',
        msg: `参考字幕严格校验未通过，正在重新 ASR 打轴（第 ${attempt}/${maxAsrAttempts} 次）...`
      });
    }
    try {
      await runPythonScript(runAsrScript, asrArgs, {
        cwd: taskImport.taskPath,
        onStdout: (chunk) => {
          const lastLine = chunk.toString().trim().split('\n').pop();
          if (sse && lastLine) {
            sendProgressEvent(sse, { type: 'status', msg: lastLine });
          }
        },
        onStderr: (chunk) => {
          logRecoverablePythonStderr('imported_avatar_asr', chunk);
        }
      });
      referenceAuthorityFailed = null;
      break;
    } catch (error) {
      if (isReferenceAuthorityAlignmentFailure(error)) {
        referenceAuthorityFailed = error;
        if (attempt < maxAsrAttempts) {
          if (sse) {
            sendProgressEvent(sse, {
              type: 'status',
              msg: `参考字幕严格校验失败，准备重新执行 ASR：${error.details || error.message}`
            });
          }
          continue;
        }
        break;
      }
      throw error;
    }
  }

  if (referenceAuthorityFailed) {
    if (sse) {
      sendProgressEvent(sse, {
        type: 'status',
        msg: `参考字幕严格校验持续失败，改用普通 ASR 字幕继续：${referenceAuthorityFailed.details || referenceAuthorityFailed.message}`
      });
    }
    await runPythonScript(runAsrScript, withoutReferenceAuthorityArgs(asrArgs), {
      cwd: taskImport.taskPath,
      onStdout: (chunk) => {
        const lastLine = chunk.toString().trim().split('\n').pop();
        if (sse && lastLine) {
          sendProgressEvent(sse, { type: 'status', msg: lastLine });
        }
      },
      onStderr: (chunk) => {
        logRecoverablePythonStderr('imported_avatar_asr_fallback', chunk);
      }
    });
  }

  const refreshedTaskImport = resolveMaterialTaskImportUnchecked({ projectsDir, taskDir: taskImport.outputDir });
  if (refreshedTaskImport?.subtitles?.length) {
    persistAvatarSubtitles(refreshedTaskImport.subtitles);
  }
  return refreshedTaskImport;
}

function createStandaloneHandler(deps) {
  const {
    sendError,
    baseDir,
    pipelineDir,
    projectsDir,
    upload,
    getProgressClient,
    sendProgressEvent,
    createRuntimeJobDir,
    generateHotTitle,
    writeJsonFile,
    writeMediaMetadata,
    readJsonIfExists,
    runPythonScript,
    taskStore,
    validateDecodableMedia: validateMedia = validateDecodableMedia
  } = deps;

  const middleware = upload.fields([{ name: 'video' }, { name: 'srt' }, { name: 'outro' }]);

  const listMaterialTasks = (_req, res) => {
    try {
      res.json({
        success: true,
        tasks: listMaterialDrivenTasks({ projectsDir })
      });
    } catch (error) {
      sendError(res, {
        status: error.status || 500,
        code: error.code || 'STANDALONE_TASK_LIST_FAILED',
        stage: error.stage || 'standalone.task_import',
        error: error.message || '读取素材驱动任务失败',
        details: error.details || error.message,
        hint: error.hint || '请确认 projects 目录可读'
      });
    }
  };

  const listStandaloneTasks = (req, res) => {
    try {
      if (!taskStore || typeof taskStore.listTasks !== 'function') {
        return res.json({ success: true, tasks: [] });
      }
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80) || 80));
      const tasks = taskStore.listTasks('standalone_vertical', limit).map((task) => ({
        id: task.id,
        taskKey: task.taskKey || '',
        status: task.status,
        progress: task.progress,
        message: task.message,
        sourceTaskDir: task.metadata?.sourceTaskDir || '',
        runtimeJobId: task.metadata?.runtimeJobId || '',
        videoUrl: isStandaloneTaskOutputAvailable(task) ? getStandaloneTaskPublicUrl(task.metadata) : '',
        title: task.metadata?.title || '',
        stage: task.metadata?.stage || '',
        errorCode: task.metadata?.errorCode || '',
        errorDetails: task.metadata?.errorDetails || '',
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        durationSeconds: task.durationSeconds,
        logs: Array.isArray(task.logs) ? task.logs.slice(-20) : []
      }));
      res.json({ success: true, tasks });
    } catch (error) {
      sendError(res, {
        status: error.status || 500,
        code: 'STANDALONE_TASK_STATUS_READ_FAILED',
        stage: 'standalone.task_status',
        error: '读取竖屏任务状态失败',
        details: error.details || error.message
      });
    }
  };

  const handler = async (req, res) => {
    const clientId = req.body.clientId;
    if (!clientId) {
      return sendError(res, {
        status: 400,
        code: 'STANDALONE_CLIENT_ID_MISSING',
        stage: 'standalone.request',
        error: '缺少 clientId',
        hint: '请通过前端页面发起请求，确保 SSE 进度流已建立'
      });
    }
    const sse = getProgressClient(clientId);
    let storeTask = null;

    try {
      const runAsrScript = path.join(pipelineDir, 'run_asr.py');
      const convertSrtScript = path.join(pipelineDir, 'convert_srt_to_json.py');
      const makeVerticalScript = path.join(pipelineDir, 'make_vertical_video.py');
      const renderOptions = req.body.renderOptions ? JSON.parse(req.body.renderOptions) : {};
      const resolvedRenderOptions = {
        ...renderOptions,
        titleMinSize: renderOptions.titleMinSize ?? renderOptions.titleMinFontSize,
        subtitleMinSize: renderOptions.subtitleMinSize ?? renderOptions.subtitleMinFontSize,
        englishFontSize: renderOptions.englishFontSize ?? renderOptions.englishSubtitleFontSize
      };
      const sourceTaskDir = String(req.body.sourceTaskDir || '').trim();
      let taskImport = sourceTaskDir
        ? resolveMaterialTaskImportUnchecked({ projectsDir, taskDir: sourceTaskDir })
        : null;
      const standaloneTaskKey = createStandaloneTaskKey(taskImport?.outputDir || sourceTaskDir);
      if (taskStore && standaloneTaskKey) {
        const existingTask = taskStore.findTaskByKey('standalone_vertical', standaloneTaskKey);
        if (existingTask?.status === 'completed' && isStandaloneTaskOutputAvailable(existingTask)) {
          const videoUrl = getStandaloneTaskPublicUrl(existingTask.metadata);
          if (sse) {
            sendProgressEvent(sse, {
              type: 'progress',
              percent: 100,
              msg: '已检测到数据库中的竖屏成片，直接恢复任务'
            });
          }
          return res.json({
            success: true,
            reused: true,
            taskId: existingTask.id,
            status: existingTask.status,
            videoUrl: videoUrl ? `${videoUrl}?t=${Date.now()}` : '',
            title: existingTask.metadata?.title || '',
            sourceTaskDir: existingTask.metadata?.sourceTaskDir || taskImport?.outputDir || sourceTaskDir
          });
        }
        if (existingTask && ['queued', 'running'].includes(existingTask.status)) {
          if (sse) {
            sendProgressEvent(sse, {
              type: 'status',
              msg: `竖屏任务已在数据库中运行：${existingTask.message || existingTask.status}`
            });
          }
          return res.status(202).json({
            success: true,
            reused: true,
            taskId: existingTask.id,
            status: existingTask.status,
            progress: existingTask.progress,
            message: existingTask.message,
            videoUrl: isStandaloneTaskOutputAvailable(existingTask) ? `${getStandaloneTaskPublicUrl(existingTask.metadata)}?t=${Date.now()}` : '',
            sourceTaskDir: existingTask.metadata?.sourceTaskDir || taskImport?.outputDir || sourceTaskDir
          });
        }
      }

      const taskDir = createRuntimeJobDir('standalone');
      const runtimeJobId = path.basename(taskDir);
      if (taskStore) {
        const taskMetadata = {
          sourceTaskDir: taskImport?.outputDir || sourceTaskDir,
          sourceType: taskImport ? 'material_task' : 'upload',
          runtimeDir: taskDir,
          runtimeJobId,
          renderOptions: resolvedRenderOptions,
          title: String(req.body.title || taskImport?.title || '').trim()
        };
        const result = standaloneTaskKey
          ? taskStore.createOrReuseTask('standalone_vertical', standaloneTaskKey, taskMetadata, {
            status: 'queued',
            message: '竖屏任务已创建'
          })
          : { task: taskStore.createTask('standalone_vertical', taskMetadata, { message: '竖屏任务已创建' }), created: true };
        storeTask = result.task;
        taskStore.updateTask(storeTask.id, {
          status: 'running',
          progress: 5,
          message: '正在准备竖屏输入',
          startedAt: storeTask.startedAt || new Date().toISOString(),
          metadata: {
            ...storeTask.metadata,
            ...taskMetadata,
            awaitingManualRecovery: false,
            manualRecoveryRequiredAt: ''
          }
        });
        taskStore.appendLog(storeTask.id, '竖屏任务进入 standalone 流水线');
      }
      const shouldRefreshImportedTaskSubtitles = taskImport && (
        req.body.useASR === 'true' || (
          !req.files?.srt &&
          req.body.useASR !== 'false' &&
          !req.body.subtitlesPayload &&
          !taskImport.hasSubtitles
        )
      );
      if (shouldRefreshImportedTaskSubtitles) {
        if (storeTask) {
          taskStore.updateTask(storeTask.id, {
            progress: 18,
            message: '正在刷新素材任务字幕',
            metadata: { ...storeTask.metadata, stage: 'refresh_subtitles' }
          });
        }
        taskImport = await refreshImportedAvatarSubtitles({
          taskImport,
          projectsDir,
          runAsrScript,
          runPythonScript,
          sse,
          sendProgressEvent
        });
      }
      if (!req.files?.video && !taskImport) {
        return sendError(res, {
          status: 400,
          code: 'STANDALONE_VIDEO_MISSING',
          stage: 'standalone.request',
          error: '请上传需要转换的视频'
        });
      }

      const srtPath = path.join(taskDir, 'uploaded.srt');
      const contextJsonPath = path.join(taskDir, 'original_context.json');
      const narrationJsonPath = path.join(taskDir, 'narration.json');
      const contextPayload = req.body.context || taskImport?.context || '';
      if (contextPayload) {
        try {
          const parsed = typeof contextPayload === 'string' ? JSON.parse(contextPayload) : contextPayload;
          fs.writeFileSync(contextJsonPath, JSON.stringify(parsed, null, 2));
        } catch (e) {
          fs.writeFileSync(contextJsonPath, JSON.stringify({ body: contextPayload }, null, 2));
        }
      }

      const scriptPayload = req.body.script || (taskImport?.script ? { full_text: taskImport.script } : '');
      if (scriptPayload) {
        try {
          const parsed = typeof scriptPayload === 'string' ? JSON.parse(scriptPayload) : scriptPayload;
          fs.writeFileSync(narrationJsonPath, JSON.stringify(parsed, null, 2));
        } catch (e) {
          fs.writeFileSync(narrationJsonPath, JSON.stringify({ full_text: scriptPayload }, null, 2));
        }
      }

      const inputVideoPath = path.join(taskDir, 'standalone_input.mp4');
      const inputVideo = await prepareStandaloneInputVideo({
        taskImport,
        uploadedFile: req.files?.video?.[0],
        inputVideoPath,
        materialPipelineScriptPath: path.join(pipelineDir, 'run_material_driven.py'),
        runPythonScript,
        sse,
        sendProgressEvent,
        onLog: (line) => {
          if (storeTask && taskStore) taskStore.appendLog(storeTask.id, line);
        },
        validateMedia
      });
      if (storeTask) {
        taskStore.updateTask(storeTask.id, {
          progress: 25,
          message: '竖屏输入视频已准备',
          metadata: { ...storeTask.metadata, stage: 'input_ready', inputVideoPath }
        });
      }
      console.log(`[Standalone] 视频已就位: ${inputVideoPath} (${inputVideo.source})`);

      const outroPath = path.join(taskDir, 'standalone_outro.mp4');
      const hasOutro = Boolean(req.files?.outro?.[0]);
      if (hasOutro) {
        fs.renameSync(req.files.outro[0].path, outroPath);
        console.log(`[Standalone] 片尾视频已就位: ${outroPath}`);
      }

      const contentJsonPath = path.join(taskDir, 'content.json');
      const subsJsonPath = path.join(taskDir, 'subtitles.json');
      const referenceSubsJsonPath = path.join(taskDir, 'reference_subtitles.json');
      const shouldUseASR = req.body.useASR === 'true' || (
        !req.files?.srt &&
        req.body.useASR !== 'false' &&
        !req.body.subtitlesPayload &&
        !taskImport?.hasSubtitles
      );
      const runStandaloneAsr = async () => {
        if (storeTask) {
          taskStore.updateTask(storeTask.id, {
            progress: 35,
            message: '正在执行竖屏 ASR 打轴',
            metadata: { ...storeTask.metadata, stage: 'asr' }
          });
        }
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '自动 ASR 打轴已开启，正在识别视频语音...' });
        console.log('[Standalone] 启动 ASR 任务...');
        const asrArgs = ['--input', 'standalone_input.mp4', '--refine-subtitles'];
        if (fs.existsSync(referenceSubsJsonPath)) {
          asrArgs.push('--reference-subtitles-json', referenceSubsJsonPath, '--reference-text-authority');
        }
        const hasReferenceSubtitles = fs.existsSync(referenceSubsJsonPath);
        const maxAsrAttempts = hasReferenceSubtitles ? ASR_REFERENCE_AUTHORITY_MAX_ATTEMPTS : 1;
        let referenceAuthorityFailed = null;
        for (let attempt = 1; attempt <= maxAsrAttempts; attempt += 1) {
          if (attempt > 1 && sse) {
            sendProgressEvent(sse, {
              type: 'status',
              msg: `参考字幕严格校验未通过，正在重新 ASR 打轴（第 ${attempt}/${maxAsrAttempts} 次）...`
            });
          }
          try {
            await runPythonScript(runAsrScript, asrArgs, {
              cwd: taskDir,
              onStdout: (chunk) => {
                const lastLine = chunk.toString().trim().split('\n').pop();
                if (sse && lastLine) sendProgressEvent(sse, { type: 'status', msg: lastLine });
              },
              onStderr: (chunk) => {
                const errStr = chunk.toString();
                console.error(`[run_asr.py stderr]: ${errStr}`);
              }
            });
            referenceAuthorityFailed = null;
            break;
          } catch (error) {
            if (isReferenceAuthorityAlignmentFailure(error)) {
              referenceAuthorityFailed = error;
              if (attempt < maxAsrAttempts) {
                if (sse) {
                  sendProgressEvent(sse, {
                    type: 'status',
                    msg: `参考字幕严格校验失败，准备重新执行 ASR：${error.details || error.message}`
                  });
                }
                continue;
              }
              break;
            }
            throw error;
          }
        }
        if (referenceAuthorityFailed) {
          if (sse) {
            sendProgressEvent(sse, {
              type: 'status',
              msg: `参考字幕严格校验持续失败，改用普通 ASR 字幕继续：${referenceAuthorityFailed.details || referenceAuthorityFailed.message}`
            });
          }
          await runPythonScript(runAsrScript, withoutReferenceAuthorityArgs(asrArgs), {
            cwd: taskDir,
            onStdout: (chunk) => {
              const lastLine = chunk.toString().trim().split('\n').pop();
              if (sse && lastLine) sendProgressEvent(sse, { type: 'status', msg: lastLine });
            },
            onStderr: (chunk) => {
              const errStr = chunk.toString();
              console.error(`[run_asr.py fallback stderr]: ${errStr}`);
            }
          });
        }
      };

      if (req.body.subtitlesPayload && shouldUseASR) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到参考 JSON 字幕，将用于 ASR 时间轴校准...' });
        try {
          const subs = JSON.parse(req.body.subtitlesPayload);
          fs.writeFileSync(referenceSubsJsonPath, JSON.stringify(subs, null, 2), 'utf8');
          console.log(`[Standalone] 成功加载参考 JSON 字幕，包含 ${Array.isArray(subs) ? subs.length : '未知数量'} 条记录`);
        } catch (e) {
          console.error('[Standalone] 参考 JSON 字幕格式错误:', e);
          if (sse) sendProgressEvent(sse, { type: 'status', msg: '参考 JSON 字幕解析失败，将仅使用 ASR 自动打轴。' });
        }
        await runStandaloneAsr();
      } else if (req.body.subtitlesPayload) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到导入的 JSON 字幕，正在加载...' });
        try {
          // Verify valid JSON before writing
          const subs = JSON.parse(req.body.subtitlesPayload);
          fs.writeFileSync(subsJsonPath, req.body.subtitlesPayload);
          console.log(`[Standalone] 成功加载导入的 JSON 字幕，包含 ${Array.isArray(subs) ? subs.length : '未知数量'} 条记录`);
        } catch (e) {
          console.error('[Standalone] 导入的 JSON 字幕格式错误:', e);
          if (sse) sendProgressEvent(sse, { type: 'status', msg: 'JSON 字幕解析失败，将回退到无字幕方案或 ASR。' });
        }
      } else if (taskImport?.hasSubtitles) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: `已从任务 ${taskImport.outputDir} 加载 ${taskImport.subtitleSource} 字幕...` });
        fs.writeFileSync(subsJsonPath, JSON.stringify(taskImport.subtitles, null, 2));
      } else if (shouldUseASR) {
        await runStandaloneAsr();
      } else if (req.files.srt) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到 SRT 文件，正在转换为 JSON...' });
        fs.renameSync(req.files.srt[0].path, srtPath);
        await runPythonScript(convertSrtScript, [srtPath, subsJsonPath], {
          cwd: taskDir,
          onStderr: () => {}
        });
      } else {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未提供字幕文件，将生成无字幕视频。' });
        fs.writeFileSync(subsJsonPath, '[]');
      }

      let finalTitle = String(req.body.title || '').trim();
      if (storeTask) {
        taskStore.updateTask(storeTask.id, {
          progress: 50,
          message: '正在生成竖屏标题与字幕素材',
          metadata: { ...storeTask.metadata, stage: 'prepare_render_assets' }
        });
      }
      if (!finalTitle) {
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '未填写标题，正在根据字幕/背景信息自动生成热点标题...' });
        finalTitle = await generateHotTitle(taskDir, 'subtitles.json', {
          contextPath: fs.existsSync(contextJsonPath) ? contextJsonPath : null,
          scriptPath: fs.existsSync(narrationJsonPath) ? narrationJsonPath : null
        });
        if (sse) sendProgressEvent(sse, { type: 'status', msg: `自动标题：${finalTitle}` });
      }
      writeJsonFile(contentJsonPath, { title: finalTitle });

      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 55, msg: '正在渲染动态竖屏视频 55%' });
      if (storeTask) {
        taskStore.updateTask(storeTask.id, {
          progress: 55,
          message: '正在渲染动态竖屏视频',
          metadata: { ...storeTask.metadata, stage: 'render' }
        });
      }
      const outputName = 'standalone_output_vertical.mp4';
      const outputPath = path.join(taskDir, outputName);
      const renderProgress = createStandaloneRenderProgressReporter({
        sse,
        sendProgressEvent,
        durationSeconds: inputVideo.durationSeconds,
        onProgress: (percent, message) => {
          if (!storeTask || !taskStore) return;
          taskStore.updateTask(storeTask.id, {
            progress: percent,
            message,
            metadata: { ...storeTask.metadata, stage: 'render' }
          });
        }
      });

      const makeVerticalArgs = [
        '--input', inputVideoPath,
        '--content', contentJsonPath,
        '--subtitles', subsJsonPath,
        '--output', outputPath,
        '--background', path.join(taskDir, 'background_generated.png'),
        '--sub-dir', path.join(taskDir, 'subtitle_cards'),
        '--title-font-size', String(resolvedRenderOptions.titleFontSize || 104),
        '--title-min-size', String(resolvedRenderOptions.titleMinSize || 52),
        '--title-max-lines', String(resolvedRenderOptions.titleMaxLines || 2),
        '--subtitle-font-size', String(resolvedRenderOptions.subtitleFontSize || 50),
        '--subtitle-min-size', String(resolvedRenderOptions.subtitleMinSize || 28),
        '--subtitle-max-lines', String(resolvedRenderOptions.subtitleMaxLines || 2),
        '--subtitle-offset-y', String(Number.isFinite(Number(resolvedRenderOptions.subtitleOffsetY)) ? Number(resolvedRenderOptions.subtitleOffsetY) : 20),
        '--english-font-size', String(resolvedRenderOptions.englishFontSize || 52),
        '--english-min-size', String(resolvedRenderOptions.englishMinSize || 30),
        '--english-max-lines', String(resolvedRenderOptions.englishMaxLines || 2)
      ];
      if (hasOutro) {
        makeVerticalArgs.push('--outro', outroPath);
        if (sse) sendProgressEvent(sse, { type: 'status', msg: '检测到自定义片尾，竖屏渲染完成后会自动拼接。' });
      }
      await runPythonScript(makeVerticalScript, makeVerticalArgs, {
        cwd: taskDir,
        onStdout: (chunk) => {
          renderProgress.parse(chunk);
        },
        onStderr: (chunk) => {
          if (renderProgress.parse(chunk)) return;
          const text = String(chunk || '').trim();
          if (!text) return;
          if (/^(ffmpeg version|built with|configuration:|libav|Input #|Stream #|Metadata:|Duration:|Stream mapping:|Press \[q\]|Output #|Side data:|encoder\s*=|handler_name)/i.test(text)) {
            return;
          }
          console.error(`[standalone_vertical stderr]: ${text}`);
        }
      });

      const finalUrlPath = path.join(baseDir, 'public', outputName);
      fs.copyFileSync(outputPath, finalUrlPath);
      const outputMetadata = {
        taskType: 'standalone',
        taskDir,
        sourceTaskDir: taskImport?.outputDir || '',
        subtitleSource: taskImport?.subtitleSource || '',
        outroSource: hasOutro ? req.files.outro[0].originalname || 'uploaded_outro' : '',
        title: finalTitle,
        subtitles: readJsonIfExists(subsJsonPath, []),
        updatedAt: new Date().toISOString()
      };
      writeMediaMetadata(outputPath, outputMetadata);
      writeMediaMetadata(finalUrlPath, outputMetadata);
      if (storeTask) {
        const completedAt = new Date().toISOString();
        taskStore.updateTask(storeTask.id, {
          status: 'completed',
          progress: 100,
          message: '竖屏成片已完成',
          completedAt,
          metadata: {
            ...storeTask.metadata,
            ...outputMetadata,
            stage: 'completed',
            outputPath,
            publicOutputPath: finalUrlPath,
            videoUrl: `/runtime_jobs/${runtimeJobId}/${outputName}`,
            publicVideoUrl: `/${outputName}`,
            runtimeJobId
          }
        });
        taskStore.appendLog(storeTask.id, '竖屏成片已写入数据库任务记录');
      }
      if (sse) sendProgressEvent(sse, { type: 'progress', percent: 100, msg: '🎉 动态竖屏生成完毕！' });
      res.json({
        success: true,
        taskId: storeTask?.id || '',
        videoUrl: `/${outputName}?t=${Date.now()}`,
        title: finalTitle,
        sourceTaskDir: taskImport?.outputDir || ''
      });
    } catch (error) {
      console.error('Standalone vertical failed:', error);
      const userMessage = createStandaloneUserMessage(error);
      const userDetails = createStandaloneUserDetails(error);
      const userHint = createStandaloneUserHint(error);
      if (storeTask && taskStore) {
        taskStore.updateTask(storeTask.id, {
          status: 'failed',
          message: userMessage,
          completedAt: new Date().toISOString(),
          metadata: {
            ...storeTask.metadata,
            stage: error.stage || 'failed',
            errorCode: error.code || 'STANDALONE_GENERATE_FAILED',
            errorDetails: error.details || error.message
          }
        });
        taskStore.appendLog(storeTask.id, `竖屏任务失败：${userDetails}`);
      }
      sendError(res, {
        status: error.status || 500,
        code: error.code || 'STANDALONE_GENERATE_FAILED',
        stage: error.stage || 'standalone.pipeline',
        error: '单条竖屏生成失败',
        details: userDetails,
        hint: userHint
      });
    }
  };

  return { middleware, handler, listMaterialTasks, listStandaloneTasks };
}

module.exports = {
  createStandaloneHandler
};
