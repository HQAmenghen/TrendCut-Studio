const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { createError } = require('../../core/errorCodes');
const {
  createTaskInput,
  writeTaskInput,
  readTaskOutput,
  resolveArtifactPaths
} = require('../../core/taskProtocol');
const {
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError
} = require('../../core/failureSummary');
const {
  normalizeAvatarSegmentSubtitles,
  normalizeExecutionPlanSubtitles
} = require('./taskImport');

const MATERIAL_TASK_DIR_PATTERN = /^material_[A-Za-z0-9_.-]+$/;

function createVerticalQueueService(deps) {
  const {
    baseDir,
    pipelineDir,
    projectsDir,
    verticalQueueRoot,
    verticalPublicDir,
    taskStore,
    ensureDir,
    makeJobId,
    slugifyText,
    sanitizeProcessLogLines,
    formatElapsedSeconds,
    stopProcessTree,
    removeDirIfExists,
    buildFallbackTitleFromSubtitles: _buildFallbackTitleFromSubtitles,
    spawnScript: _spawnScript,
    spawnScriptCancellable,
    writeJsonFile,
    runPythonScript,
    summarizePythonError: _summarizePythonError,
    writeMediaMetadata,
    readMediaMetadata,
    triggerAutoReview
  } = deps;

  const verticalJobs = new Map();
  const verticalJobQueue = [];
  let verticalActiveCount = 0;
  let verticalJobConcurrency = 2;
  const verticalQueueLogPath = path.join(baseDir, 'data', 'logs', 'vertical_queue.log');
  const REFERENCE_AUTHORITY_ALIGNMENT_FAILED = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
  const ASR_REFERENCE_AUTHORITY_MAX_ATTEMPTS = 2;

  function isPublicHttpUrl(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      const hostname = String(parsed.hostname || '').toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname === '[::1]' ||
        hostname.startsWith('127.')
      ) {
        return false;
      }
      if (/^10\./.test(hostname) || /^192\.168\./.test(hostname)) {
        return false;
      }
      const private172 = hostname.match(/^172\.(\d+)\./);
      if (private172) {
        const secondOctet = Number(private172[1]);
        if (secondOctet >= 16 && secondOctet <= 31) return false;
      }
      return true;
    } catch (_err) {
      return false;
    }
  }

  function appendPersistentLine(filePath, line) {
    try {
      ensureDir(path.dirname(filePath));
      fs.appendFile(filePath, `${line}\n`, 'utf8', (_err) => {
        // 静默失败
      });
    } catch (_error) {}
  }

  function formatPersistentLogLine(job, message, extra = null) {
    const payload = {
      timestamp: new Date().toISOString(),
      jobId: job?.id || '',
      status: job?.status || '',
      progress: Number.isFinite(Number(job?.progress)) ? Number(job.progress) : null,
      message: String(message || '').trim()
    };
    if (extra && typeof extra === 'object' && Object.keys(extra).length) {
      payload.extra = extra;
    }
    return JSON.stringify(payload, ensureAsciiSafeReplacer);
  }

  function getSubtitleText(item) {
    if (!item || typeof item !== 'object') return '';
    return String(item.zh || item.text || item.en || '').replace(/\s+/g, '').trim();
  }

  function hasUsableSubtitleContent(subtitles) {
    return Array.isArray(subtitles) && subtitles.some((item) => getSubtitleText(item));
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

  function pickString(...values) {
    for (const value of values) {
      const text = String(value || '').trim();
      if (text) return text;
    }
    return '';
  }

  function mergeTitleFields(target, ...sources) {
    const next = { ...(target || {}) };
    const title = pickString(
      next.title,
      ...sources.map((source) => source?.title),
      next.suggestedTitle,
      ...sources.map((source) => source?.suggestedTitle),
      next.suggestedShortTitle,
      ...sources.map((source) => source?.suggestedShortTitle)
    );
    if (title) {
      next.title = title;
      if (!pickString(next.suggestedTitle)) next.suggestedTitle = title;
      if (!pickString(next.suggestedShortTitle)) next.suggestedShortTitle = title;
    }
    return next;
  }

  function normalizeExistingSubtitles(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return [];
    return payload
      .map((item) => {
        const time = Array.isArray(item?.time) ? item.time : [item?.start, item?.end];
        const start = Number(time?.[0]);
        const end = Number(time?.[1]);
        const zh = pickString(item?.zh, item?.text, item?.subtitle_text, item?.subtitle);
        const en = pickString(item?.en, item?.english, item?.subtitle_en);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (!zh && !en)) {
          return null;
        }
        const normalized = { time: [start, end] };
        if (zh) {
          normalized.zh = zh;
          normalized.text = zh;
        } else if (en) {
          normalized.text = en;
        }
        if (en) normalized.en = en;
        return normalized;
      })
      .filter(Boolean);
  }

  function extractMaterialProjectDir(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let sample = raw;
    try {
      sample = new URL(raw).pathname || raw;
    } catch (_err) {}
    try {
      sample = decodeURIComponent(sample);
    } catch (_err) {}
    sample = sample.split('?')[0].split('#')[0];

    for (const part of sample.split(/[\\/]+/)) {
      if (MATERIAL_TASK_DIR_PATTERN.test(part)) return part;
    }
    const baseName = path.basename(sample);
    return MATERIAL_TASK_DIR_PATTERN.test(baseName) ? baseName : '';
  }

  function resolveMaterialProjectPath(job) {
    const configuredProjectsDir = projectsDir || path.join(baseDir, 'projects');
    const candidates = [
      job.sourceTaskDir,
      job.materialTaskDir,
      job.sourceMaterialTaskDir,
      job.renderOptions?.sourceTaskDir,
      job.renderOptions?.materialTaskDir,
      job.renderOptions?.sourceMaterialTaskDir,
      job.renderOptions?.originalVideoPath,
      job.videoUrl
    ];
    const taskDir = candidates.map(extractMaterialProjectDir).find(Boolean) || '';
    if (!taskDir) {
      return '';
    }

    const root = path.resolve(configuredProjectsDir);
    const resolved = path.resolve(root, taskDir);
    const rootKey = root.toLowerCase();
    const resolvedKey = resolved.toLowerCase();
    if (resolvedKey !== rootKey && !resolvedKey.startsWith(`${rootKey}${path.sep}`)) return '';
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return '';
    job.materialTaskDir = taskDir;
    job.sourceTaskDir = job.sourceTaskDir || taskDir;
    return resolved;
  }

  function readMaterialReferenceSubtitles(job) {
    const explicit = normalizeExistingSubtitles(job.referenceSubtitles);
    if (explicit.length > 0) {
      return {
        subtitles: explicit,
        source: 'job.referenceSubtitles'
      };
    }

    const materialProjectPath = resolveMaterialProjectPath(job);
    if (!materialProjectPath) return null;

    const candidates = [
      {
        fileName: 'aiman_subtitles.json',
        normalize: normalizeExistingSubtitles
      },
      {
        fileName: 'execution_plan.json',
        normalize: (payload) => normalizeExecutionPlanSubtitles(payload)
          .map((item) => ({ ...item, text: item.zh || item.text || '' }))
      },
      {
        fileName: 'avatar_segments.json',
        normalize: (payload) => normalizeAvatarSegmentSubtitles(payload)
          .map((item) => ({ ...item, text: item.zh || item.text || '' }))
      },
      {
        fileName: 'narration.json',
        normalize: (payload) => {
          const sections = Array.isArray(payload?.script_sections)
            ? payload.script_sections.map((section) => pickString(section?.text)).filter(Boolean)
            : [];
          const script = pickString(payload?.full_text, payload?.fullText);
          const lines = sections.length ? sections : (script ? [script] : []);
          if (!lines.length) return [];

          const totalChars = Math.max(1, lines.reduce((sum, text) => sum + text.length, 0));
          const configuredDuration = Number(payload?.target_duration_sec);
          const totalDuration = Number.isFinite(configuredDuration) && configuredDuration > 0
            ? configuredDuration
            : Math.max(lines.length * 6, Math.ceil(totalChars / 4));
          let cursor = 0;
          return lines.map((text, index) => {
            const isLast = index === lines.length - 1;
            const duration = isLast
              ? Math.max(0.4, totalDuration - cursor)
              : Math.max(0.4, totalDuration * (text.length / totalChars));
            const start = Number(cursor.toFixed(2));
            const end = Number((cursor + duration).toFixed(2));
            cursor += duration;
            return { time: [start, end], zh: text, text };
          });
        }
      }
    ];

    for (const candidate of candidates) {
      const payload = readJsonSafe(path.join(materialProjectPath, candidate.fileName), null);
      const subtitles = candidate.normalize(payload);
      if (subtitles.length > 0) {
        return {
          subtitles,
          source: candidate.fileName
        };
      }
    }

    return null;
  }

  function writeReferenceSubtitlesForJob(job, jobDir) {
    const reference = readMaterialReferenceSubtitles(job);
    if (!reference?.subtitles?.length) return '';

    const referencePath = path.join(jobDir, 'reference_subtitles.json');
    writeJsonFile(referencePath, reference.subtitles);
    job.referenceSubtitleSource = job.materialTaskDir
      ? `${job.materialTaskDir}/${reference.source}`
      : reference.source;
    appendLog(job, `已加载参考口播字幕用于 ASR 校准: ${job.referenceSubtitleSource}`);
    return referencePath;
  }

  function ensureAsciiSafeReplacer(_key, value) {
    return value;
  }

  function persistJobFailure(job, failureSummary, jobDir) {
    const content = readJsonSafe(path.join(jobDir, 'content.json'), {});
    const publicVideoPath = path.join(verticalPublicDir, job.id, 'vertical_output.mp4');
    const publicMetadata = typeof readMediaMetadata === 'function' ? (readMediaMetadata(publicVideoPath) || {}) : {};
    const resolvedTitle = pickString(job.title, content?.title, publicMetadata.title, publicMetadata.suggestedTitle);
    const payload = {
      jobId: job.id,
      status: job.status,
      sourceType: job.sourceType || '',
      author: job.author || '',
      title: resolvedTitle,
      videoUrl: job.videoUrl || '',
      createdAt: job.createdAt || '',
      startedAt: job.startedAt || '',
      completedAt: job.completedAt || '',
      updatedAt: job.updatedAt || '',
      failure: failureSummary,
      recentLogs: Array.isArray(job.logs) ? job.logs.slice(-80) : []
    };
    writeJsonFile(path.join(jobDir, 'failure.json'), payload);
    appendPersistentLine(
      path.join(jobDir, 'vertical_queue.log'),
      JSON.stringify(payload, null, 2)
    );
  }

  function listJobs() {
    return Array.from(verticalJobs.values())
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 50);
  }

  function getJob(jobId) {
    return verticalJobs.get(String(jobId || '').trim()) || null;
  }

  function appendLog(job, message) {
    if (!job || !message) return;
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message).trim()}`;
    job.logs = [...(Array.isArray(job.logs) ? job.logs : []), line].slice(-120);
    job.updatedAt = new Date().toISOString();

    // 写入文件日志
    appendPersistentLine(
      verticalQueueLogPath,
      formatPersistentLogLine(job, message)
    );
    const jobLogPath = path.join(verticalQueueRoot, job.id, 'vertical_queue.log');
    appendPersistentLine(
      jobLogPath,
      formatPersistentLogLine(job, message)
    );

    // 同步到 taskStore
    if (taskStore) {
      try {
        taskStore.appendLog(job.id, message);
      } catch (err) {
        // 静默失败
      }
    }
  }

  function syncJobToTaskStore(job) {
    if (!taskStore) return;
    try {
      taskStore.updateTask(job.id, {
        status: job.status,
        progress: job.progress,
        message: job.message || '',
        startedAt: job.startedAt || null,
        completedAt: job.completedAt || null
      });
    } catch (err) {
      // 静默失败
    }
  }

  function getStatus() {
    return {
      concurrency: verticalJobConcurrency,
      running: verticalActiveCount,
      queued: verticalJobQueue.length,
      jobs: listJobs()
    };
  }

  async function downloadRemoteFile(url, destinationPath) {
    ensureDir(path.dirname(destinationPath));
    const maxAttempts = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await axios({
          method: 'get',
          url,
          responseType: 'stream',
          maxRedirects: 5,
          timeout: 120000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(destinationPath);
          response.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        return;
      } catch (error) {
        lastError = error;
        try {
          if (fs.existsSync(destinationPath)) fs.unlinkSync(destinationPath);
        } catch (_err) {}
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
    }

    throw createError('VERTICAL_QUEUE_VIDEO_DOWNLOAD_FAILED', `已重试 ${maxAttempts} 次: ${lastError?.message || 'unknown error'}`);
  }

  async function generateHotTitle(jobDir, subtitlesFileName = 'subtitles.json') {
    const subtitlesPath = path.join(jobDir, subtitlesFileName);
    const generateTitlePath = path.join(pipelineDir, 'generate_title.py');
    try {
      const result = await runPythonScript(generateTitlePath, ['--subtitles', subtitlesPath], { cwd: pipelineDir });
      const title = String(result.protocol?.result?.title || result.stdout || '').trim();
      if (title) return title;
      throw new Error('generate_title.py 未输出有效标题');
    } catch (error) {
      const reason = error?.details || error?.message || 'generate_title.py 未输出有效标题';
      console.error(`generate_title.py failed: ${reason}`);
      throw new Error(`自动标题生成失败: ${reason}`);
    }
  }

  function buildSafeFallbackTitle(job, jobDir, subtitlesFileName = 'subtitles.json') {
    const subtitlesPath = path.join(jobDir, subtitlesFileName);
    const fallback = typeof _buildFallbackTitleFromSubtitles === 'function'
      ? _buildFallbackTitleFromSubtitles(subtitlesPath)
      : '';
    return pickString(
      fallback,
      job.title,
      job.summary,
      job.author ? `${job.author} 的视频` : '',
      '这条消息可能正在改变支付格局'
    );
  }

  async function runJob(job) {
    const runAsrPath = path.join(pipelineDir, 'run_asr.py');
    const makeVerticalPath = path.join(pipelineDir, 'make_vertical_video.py');
    const jobDir = path.join(verticalQueueRoot, job.id);
    const publicOutputDir = path.join(verticalPublicDir, job.id);
    ensureDir(jobDir);
    ensureDir(publicOutputDir);

    const sourceVideoPath = path.join(jobDir, 'source.mp4');
    const subtitlesPath = path.join(jobDir, 'subtitles.json');
    const contentPath = path.join(jobDir, 'content.json');
    const outputPath = path.join(jobDir, 'vertical_output.mp4');
    const publicOutputPath = path.join(publicOutputDir, 'vertical_output.mp4');

    const updateJob = (patch, logMessage = '') => {
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      if (logMessage) appendLog(job, logMessage);
      syncJobToTaskStore(job); // 同步到 taskStore
    };
    const updateStage = (stage, patch, logMessage = '') => {
      job.currentStage = stage;
      updateJob(patch, logMessage);
    };
    const stageHeartbeat = (stageLabel, progress, baseMessage) => (elapsedSeconds) => {
      const elapsedLabel = formatElapsedSeconds(elapsedSeconds);
      job.message = `${baseMessage}（已用时 ${elapsedLabel}）`;
      job.progress = progress;
      job.updatedAt = new Date().toISOString();
      if (elapsedSeconds > 0) {
        appendLog(job, `${stageLabel} 持续执行中，已用时 ${elapsedLabel}`);
      }
    };
    const pipeProcessLogs = (label, isError = false) => (chunk) => {
      const lines = sanitizeProcessLogLines(chunk);
      for (const line of lines.slice(-8)) {
        appendLog(job, `${label}${isError ? ' stderr' : ''}: ${line}`);
      }
    };
    const renderOptions = job.renderOptions || {};
    const asrOptions = renderOptions.asrOptions || {};
    const descriptionSource = String(job.summary || '').trim() ? 'post_summary' : 'none';

    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '任务在开始前被取消');
      return;
    }

    // 如果是重新生成任务且提供了原始视频路径，直接复制本地文件
    if (renderOptions.originalVideoPath && fs.existsSync(renderOptions.originalVideoPath)) {
      updateStage('prepare', { status: 'preparing', progress: 10, message: '正在准备源视频...' }, '使用本地视频文件（重新生成任务）');
      try {
        fs.copyFileSync(renderOptions.originalVideoPath, sourceVideoPath);
        appendLog(job, `已复制本地视频: ${renderOptions.originalVideoPath}`);
      } catch (err) {
        throw createError('VERTICAL_QUEUE_VIDEO_COPY_FAILED', `复制本地视频失败: ${err.message}`);
      }
    } else {
      // 正常下载流程
      updateStage('download', { status: 'downloading', progress: 10, message: '正在下载远程视频...' }, '开始下载远程视频');
      await downloadRemoteFile(job.videoUrl, sourceVideoPath);
    }

    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '准备完成后任务被取消');
      return;
    }

    if (renderOptions.isRegeneration) {
      const repairProfile = String(renderOptions.repairProfile || 'balanced');
      const focusText = Array.isArray(renderOptions.repairFocus) && renderOptions.repairFocus.length
        ? renderOptions.repairFocus.join(', ')
        : 'general';
      appendLog(job, `已启用按建议修补模式，策略=${repairProfile}，修补重点=${focusText}`);
      if (Array.isArray(renderOptions.repairSummary)) {
        for (const item of renderOptions.repairSummary.slice(0, 4)) {
          appendLog(job, `修补计划: ${item}`);
        }
      }
    }

    updateStage('transcribe', { status: 'transcribing', progress: 35, message: '正在执行 ASR 自动打轴...' }, '进入 ASR 自动打轴阶段');
    const referenceSubtitlesPath = writeReferenceSubtitlesForJob(job, jobDir);

    // 写入任务协议输入（可选，脚本可以选择使用或忽略）
    try {
      const asrTaskInput = createTaskInput(job.id, 'asr', {
        inputFile: sourceVideoPath,
        allowNoAudio: true,
        referenceSubtitlesFile: referenceSubtitlesPath || undefined
      }, jobDir);
      writeTaskInput(jobDir, asrTaskInput);
    } catch (_err) {
      // 任务协议写入失败不影响主流程
    }

    const asrArgs = ['--input', sourceVideoPath, '--allow-no-audio'];
    if (referenceSubtitlesPath) {
      asrArgs.push('--reference-subtitles-json', referenceSubtitlesPath, '--reference-text-authority');
    }
    if (isPublicHttpUrl(job.videoUrl)) {
      asrArgs.push('--file-url', String(job.videoUrl).trim());
    }
    if (Number.isFinite(Number(asrOptions.maxChunkDuration))) {
      asrArgs.push('--max-chunk-duration', String(Number(asrOptions.maxChunkDuration)));
    }
    if (Number.isFinite(Number(asrOptions.softChunkDuration))) {
      asrArgs.push('--soft-chunk-duration', String(Number(asrOptions.softChunkDuration)));
    }
    if (Number.isFinite(Number(asrOptions.maxVisibleChars))) {
      asrArgs.push('--max-visible-chars', String(Number(asrOptions.maxVisibleChars)));
    }
    if (Number.isFinite(Number(asrOptions.maxWordsPerChunk))) {
      asrArgs.push('--max-words-per-chunk', String(Number(asrOptions.maxWordsPerChunk)));
    }
    if (Number.isFinite(Number(asrOptions.pauseThreshold))) {
      asrArgs.push('--pause-threshold', String(Number(asrOptions.pauseThreshold)));
    }
    if (asrOptions.forceEnglishRescue) {
      asrArgs.push('--force-english-rescue');
    }
    if (asrOptions.translateSubtitles !== false) {
      asrArgs.push('--translate-subtitles');
    }
    if (asrOptions.refineSubtitles !== false) {
      asrArgs.push('--refine-subtitles');
    }

    const maxAsrAttempts = referenceSubtitlesPath ? ASR_REFERENCE_AUTHORITY_MAX_ATTEMPTS : 1;
    let referenceAuthorityFailed = null;
    for (let attempt = 1; attempt <= maxAsrAttempts; attempt += 1) {
      if (attempt > 1) {
        updateStage(
          'transcribe',
          {
            status: 'transcribing',
            progress: 35,
            message: `参考字幕严格校验未通过，正在重新 ASR 打轴（第 ${attempt}/${maxAsrAttempts} 次）...`
          },
          `参考字幕严格校验未通过，重试 ASR 阶段 ${attempt}/${maxAsrAttempts}`
        );
      }
      const asrHandle = spawnScriptCancellable(runAsrPath, asrArgs, {
        cwd: jobDir,
        onSpawn: (proc) => { job.currentProc = proc; },
        onStdout: pipeProcessLogs(`ASR${attempt > 1 ? ` retry ${attempt}` : ''}`),
        onStderr: pipeProcessLogs(`ASR${attempt > 1 ? ` retry ${attempt}` : ''}`, true),
        onHeartbeat: stageHeartbeat('ASR 阶段', 35, '正在执行 ASR 自动打轴...')
      });
      job.currentCancelHandle = asrHandle.cancel;
      try {
        await asrHandle.promise;
        referenceAuthorityFailed = null;
        break;
      } catch (error) {
        if (isReferenceAuthorityAlignmentFailure(error) && !job.cancelRequested) {
          referenceAuthorityFailed = error;
          if (attempt < maxAsrAttempts) {
            appendLog(job, `参考字幕严格校验失败，准备重新执行 ASR：${error.details || error.message}`);
            continue;
          }
          appendLog(job, `参考字幕严格校验持续失败，降级为普通 ASR 字幕继续成片：${error.details || error.message}`);
          break;
        }
        throw error;
      } finally {
        job.currentProc = null;
        job.currentCancelHandle = null;
      }
    }

    if (referenceAuthorityFailed && !job.cancelRequested) {
      updateStage(
        'transcribe',
        {
          status: 'transcribing',
          progress: 35,
          message: '参考字幕严格校验失败，正在使用普通 ASR 字幕降级继续...'
        },
        '参考字幕严格校验失败，改用普通 ASR 字幕重新打轴'
      );
      const fallbackAsrArgs = withoutReferenceAuthorityArgs(asrArgs);
      const fallbackAsrHandle = spawnScriptCancellable(runAsrPath, fallbackAsrArgs, {
        cwd: jobDir,
        onSpawn: (proc) => { job.currentProc = proc; },
        onStdout: pipeProcessLogs('ASR fallback'),
        onStderr: pipeProcessLogs('ASR fallback', true),
        onHeartbeat: stageHeartbeat('ASR 降级阶段', 35, '正在使用普通 ASR 字幕降级继续...')
      });
      job.currentCancelHandle = fallbackAsrHandle.cancel;
      try {
        await fallbackAsrHandle.promise;
        job.referenceSubtitleFallbackUsed = true;
      } finally {
        job.currentProc = null;
        job.currentCancelHandle = null;
      }
    }

    // 尝试读取任务协议输出（可选，回退到文件假设）
    const asrOutput = readTaskOutput(jobDir);
    let subtitlesData = [];
    if (asrOutput && asrOutput.status === 'success' && asrOutput.artifacts?.subtitles) {
      // 使用任务协议输出
      const artifacts = resolveArtifactPaths(jobDir, asrOutput.artifacts);
      const subtitlesFile = artifacts.subtitles;
      if (fs.existsSync(subtitlesFile)) {
        subtitlesData = readJsonSafe(subtitlesFile, []);
        appendLog(job, '已从任务协议输出读取字幕文件');
      }
    } else {
      // 回退到文件假设（向后兼容）
      const subtitlesPayload = path.join(jobDir, 'subtitles.json');
      subtitlesData = fs.existsSync(subtitlesPayload) ? readJsonSafe(subtitlesPayload, []) : [];
    }

    const hasSpokenSubtitleContent = hasUsableSubtitleContent(subtitlesData);
    if (hasSpokenSubtitleContent) {
      appendLog(job, '发布描述来源已切换为字幕内容');
    } else if (descriptionSource === 'post_summary') {
      appendLog(job, '检测到视频无有效字幕，发布描述将回退到帖子摘要');
    } else {
      appendLog(job, '检测到视频无有效字幕，且帖子摘要为空，后续描述信息会较弱');
    }
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, 'ASR 阶段后任务被取消');
      return;
    }

    if (!hasSpokenSubtitleContent) {
      const completedAt = new Date().toISOString();
      updateJob({
        status: 'skipped',
        progress: 100,
        message: '源视频无音轨或未识别到有效口播字幕，已跳过自动发布',
        completedAt,
        durationSeconds: job.startedAt ? Math.max(0, Math.floor((new Date(completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null
      }, '源视频无音轨或未识别到有效口播字幕，停止竖屏渲染与自动发布任务创建');
      return;
    }

    const existingPublicMetadata = typeof readMediaMetadata === 'function' ? (readMediaMetadata(publicOutputPath) || {}) : {};
    const existingContent = readJsonSafe(contentPath, {});
    let finalTitle = pickString(
      job.title,
      existingContent?.title,
      existingPublicMetadata.title,
      existingPublicMetadata.suggestedTitle,
      existingPublicMetadata.suggestedShortTitle
    );
    if (!finalTitle) {
      updateJob({ status: 'titling', progress: 55, message: '正在生成竖屏标题...' }, '开始自动生成竖屏标题');
      try {
        finalTitle = await generateHotTitle(jobDir, 'subtitles.json');
      } catch (error) {
        finalTitle = buildSafeFallbackTitle(job, jobDir, 'subtitles.json');
        appendLog(job, `自动标题生成失败，已使用本地兜底标题继续渲染：${error.message}`);
      }
    }
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '标题阶段后任务被取消');
      return;
    }

    writeJsonFile(contentPath, { title: finalTitle });
    updateStage('render', { status: 'rendering', progress: 75, message: '正在渲染竖屏视频...' }, '进入竖屏渲染阶段');

    // 写入任务协议输入（可选）
    try {
      const renderTaskInput = createTaskInput(job.id, 'render_vertical', {
        inputFile: sourceVideoPath,
        contentFile: contentPath,
        subtitlesFile: subtitlesPath,
        outputFile: outputPath,
        renderOptions
      }, jobDir);
      writeTaskInput(jobDir, renderTaskInput);
    } catch (_err) {
      // 任务协议写入失败不影响主流程
    }

    const renderHandle = spawnScriptCancellable(makeVerticalPath, [
      '--input', sourceVideoPath,
      '--content', contentPath,
      '--subtitles', subtitlesPath,
      '--output', outputPath,
      '--background', path.join(jobDir, 'background_generated.png'),
      '--sub-dir', path.join(jobDir, 'subtitle_cards'),
      '--title-font-size', String(renderOptions.titleFontSize || 104),
      '--title-min-size', String(renderOptions.titleMinSize || 52),
      '--title-max-lines', String(renderOptions.titleMaxLines || 2),
      '--subtitle-font-size', String(renderOptions.subtitleFontSize || 50),
      '--subtitle-min-size', String(renderOptions.subtitleMinSize || 28),
      '--subtitle-max-lines', String(renderOptions.subtitleMaxLines || 2),
      '--subtitle-offset-y', String(Number.isFinite(Number(renderOptions.subtitleOffsetY)) ? Number(renderOptions.subtitleOffsetY) : 20),
      '--english-font-size', String(renderOptions.englishFontSize || 52),
      '--english-min-size', String(renderOptions.englishMinSize || 30),
      '--english-max-lines', String(renderOptions.englishMaxLines || 2)
    ], {
      cwd: jobDir,
      onSpawn: (proc) => { job.currentProc = proc; },
      onStdout: pipeProcessLogs('竖屏渲染'),
      onStderr: pipeProcessLogs('竖屏渲染', true),
      onHeartbeat: stageHeartbeat('竖屏渲染阶段', 75, '正在渲染竖屏视频...')
    });
    job.currentCancelHandle = renderHandle.cancel;
    try {
      await renderHandle.promise;
    } finally {
      job.currentProc = null;
      job.currentCancelHandle = null;
    }
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '渲染阶段后任务被取消');
      return;
    }

    // 尝试读取任务协议输出（可选，回退到文件假设）
    const renderOutput = readTaskOutput(jobDir);
    let finalOutputPath = outputPath;
    if (renderOutput && renderOutput.status === 'success' && renderOutput.artifacts?.video) {
      // 使用任务协议输出
      const artifacts = resolveArtifactPaths(jobDir, renderOutput.artifacts);
      finalOutputPath = artifacts.video;
      if (fs.existsSync(finalOutputPath)) {
        appendLog(job, '已从任务协议输出读取视频文件');
      } else {
        // 回退到默认路径
        finalOutputPath = outputPath;
      }
    }

    fs.copyFileSync(finalOutputPath, publicOutputPath);
    const renderedSubtitles = fs.existsSync(subtitlesPath)
      ? readJsonSafe(subtitlesPath, subtitlesData)
      : subtitlesData;
    const metadata = mergeTitleFields({
      ...existingPublicMetadata,
      taskType: 'xai_queue',
      taskDir: jobDir,
      sourceType: job.sourceType || 'xai_top10',
      sourcePartitionId: job.sourcePartitionId || '',
      sourcePartitionLabel: job.sourcePartitionLabel || '',
      sourceRank: job.sourceRank || 0,
      author: job.author || '',
      postId: job.postId || '',
      postUrl: job.postUrl || '',
      sourceUrl: job.postUrl || '',
      videoUrl: job.videoUrl || '',
      title: finalTitle,
      sourceMaterialTaskDir: job.materialTaskDir || job.sourceTaskDir || '',
      referenceSubtitleSource: job.referenceSubtitleSource || '',
      referenceSubtitleFallbackUsed: Boolean(job.referenceSubtitleFallbackUsed),
      subtitles: Array.isArray(renderedSubtitles) ? renderedSubtitles : [],
      sourceSummary: String(job.summary || '').trim(),
      regeneration: renderOptions.isRegeneration ? {
        status: 'completed',
        sourceReviewId: renderOptions.previousReviewId || '',
        repairProfile: renderOptions.repairProfile || 'balanced',
        repairFocus: Array.isArray(renderOptions.repairFocus) ? renderOptions.repairFocus : [],
        repairSummary: Array.isArray(renderOptions.repairSummary) ? renderOptions.repairSummary : [],
        appliedSuggestions: Array.isArray(renderOptions.appliedSuggestions) ? renderOptions.appliedSuggestions : [],
        completedAt: new Date().toISOString()
      } : undefined,
      updatedAt: new Date().toISOString()
    }, existingContent);
    if (typeof writeMediaMetadata === 'function') {
      writeMediaMetadata(publicOutputPath, metadata);
    }

    if (typeof triggerAutoReview === 'function') {
      updateJob({ status: 'reviewing', progress: 92, message: '正在执行 AI 审核...' }, '渲染完成，开始自动执行 AI 审核');
      const reviewResult = await triggerAutoReview(publicOutputPath, job.id);
      if (reviewResult) {
        appendLog(job, `AI 审核完成：${reviewResult.status || 'unknown'}，得分 ${reviewResult.overall_score ?? '-'}`);
        if (renderOptions.isRegeneration && typeof readMediaMetadata === 'function') {
          const latestMetadata = readMediaMetadata(publicOutputPath) || {};
          const previousScore = Number(renderOptions.previousReviewScore);
          const previousScores = renderOptions.previousReviewScores || {};
          const currentScores = reviewResult.scores || {};
          const scoreComparison = {
            previousOverallScore: Number.isFinite(previousScore) ? previousScore : null,
            currentOverallScore: Number.isFinite(Number(reviewResult.overall_score)) ? Number(reviewResult.overall_score) : null,
            overallDelta: Number.isFinite(previousScore) && Number.isFinite(Number(reviewResult.overall_score))
              ? Number(reviewResult.overall_score) - previousScore
              : null,
            previousScores: {
              content: Number.isFinite(Number(previousScores.content)) ? Number(previousScores.content) : null,
              subtitle: Number.isFinite(Number(previousScores.subtitle)) ? Number(previousScores.subtitle) : null,
              title: Number.isFinite(Number(previousScores.title)) ? Number(previousScores.title) : null,
              editing: Number.isFinite(Number(previousScores.editing)) ? Number(previousScores.editing) : null
            },
            currentScores: {
              content: Number.isFinite(Number(currentScores.content)) ? Number(currentScores.content) : null,
              subtitle: Number.isFinite(Number(currentScores.subtitle)) ? Number(currentScores.subtitle) : null,
              title: Number.isFinite(Number(currentScores.title)) ? Number(currentScores.title) : null,
              editing: Number.isFinite(Number(currentScores.editing)) ? Number(currentScores.editing) : null
            },
            deltas: {
              content: Number.isFinite(Number(previousScores.content)) && Number.isFinite(Number(currentScores.content))
                ? Number(currentScores.content) - Number(previousScores.content)
                : null,
              subtitle: Number.isFinite(Number(previousScores.subtitle)) && Number.isFinite(Number(currentScores.subtitle))
                ? Number(currentScores.subtitle) - Number(previousScores.subtitle)
                : null,
              title: Number.isFinite(Number(previousScores.title)) && Number.isFinite(Number(currentScores.title))
                ? Number(currentScores.title) - Number(previousScores.title)
                : null,
              editing: Number.isFinite(Number(previousScores.editing)) && Number.isFinite(Number(currentScores.editing))
                ? Number(currentScores.editing) - Number(previousScores.editing)
                : null
            },
            comparedAt: new Date().toISOString()
          };
          latestMetadata.regeneration = {
            ...(latestMetadata.regeneration || {}),
            status: reviewResult.status === 'passed' ? 'improved_passed' : 'reviewed',
            sourceReviewId: renderOptions.previousReviewId || '',
            repairProfile: renderOptions.repairProfile || 'balanced',
            repairFocus: Array.isArray(renderOptions.repairFocus) ? renderOptions.repairFocus : [],
            repairSummary: Array.isArray(renderOptions.repairSummary) ? renderOptions.repairSummary : [],
            appliedSuggestions: Array.isArray(renderOptions.appliedSuggestions) ? renderOptions.appliedSuggestions : [],
            scoreComparison,
            completedAt: new Date().toISOString()
          };
          writeMediaMetadata(publicOutputPath, latestMetadata);
          if (Number.isFinite(scoreComparison.overallDelta)) {
            appendLog(job, `修补前后总分对比：${scoreComparison.previousOverallScore} -> ${scoreComparison.currentOverallScore}（${scoreComparison.overallDelta >= 0 ? '+' : ''}${scoreComparison.overallDelta}）`);
          }
        }
      } else {
        appendLog(job, 'AI 审核未返回结果，后续可在审核中心手动处理');
      }
    }

    const completedAt = new Date().toISOString();
    updateJob({
      status: 'completed',
      progress: 100,
      title: finalTitle,
      message: '竖屏视频已完成',
      resultVideoUrl: `/xai_vertical_queue/${job.id}/vertical_output.mp4?t=${Date.now()}`,
      completedAt,
      durationSeconds: job.startedAt ? Math.max(0, Math.floor((new Date(completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null
    }, `竖屏视频已完成，用时结果已生成：${finalTitle}`);
  }

  function readJsonSafe(filePath, fallbackValue) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
      return fallbackValue;
    }
  }

  async function processQueue() {
    while (verticalActiveCount < verticalJobConcurrency && verticalJobQueue.length > 0) {
      const job = verticalJobQueue.shift();
      if (!job) return;
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.progress = 100;
        job.message = '任务已取消';
        job.completedAt = new Date().toISOString();
        job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
        appendLog(job, '任务在排队阶段被取消');
        continue;
      }

      verticalActiveCount += 1;
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.updatedAt = job.startedAt;
      appendLog(job, '任务开始执行');

      runJob(job)
        .catch((error) => {
          if (job.cancelRequested) {
            job.status = 'cancelled';
            job.progress = 100;
            job.message = '任务已取消';
            job.updatedAt = new Date().toISOString();
            job.completedAt = job.updatedAt;
            job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
            appendLog(job, '任务在执行过程中被取消');
            syncJobToTaskStore(job);
            return;
          }
          job.status = 'failed';
          job.progress = 100;
          job.message = error.message;
          job.error = error.message;
          job.updatedAt = new Date().toISOString();
          job.completedAt = job.updatedAt;
          job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
          appendLog(job, `任务失败：${error.message}`);

          // 使用统一的失败摘要结构
          const failureSummary = error?.code
            ? createFailureSummaryFromPythonError(error, 'vertical_queue', {
              stage: job.currentStage || 'unknown',
              context: {
                jobId: job.id,
                sourceType: job.sourceType,
                videoUrl: job.videoUrl
              }
            })
            : createFailureSummaryFromError(error, 'vertical_queue', job.currentStage || 'unknown', {
              context: {
                jobId: job.id,
                sourceType: job.sourceType,
                videoUrl: job.videoUrl
              }
            });

          job.failureSummary = failureSummary;
          persistJobFailure(job, failureSummary, path.join(verticalQueueRoot, job.id));
          appendPersistentLine(
            verticalQueueLogPath,
            formatPersistentLogLine(job, '任务失败详情已持久化', failureSummary)
          );
          syncJobToTaskStore(job);
        })
        .finally(() => {
          job.currentProc = null;
          job.currentCancelHandle = null;
          verticalActiveCount = Math.max(0, verticalActiveCount - 1);
          processQueue();
        });
    }
  }

  function enqueue(item) {
    // 先在 taskStore 中创建任务，使用其生成的 ID
    let taskId;
    if (taskStore) {
      const task = taskStore.createTask('vertical_queue', {
        sourceType: item.sourceType || 'xai_top10',
        author: item.author || '',
        postId: item.postId || '',
        postUrl: item.postUrl || '',
        sourcePartitionId: item.sourcePartitionId || '',
        sourcePartitionLabel: item.sourcePartitionLabel || '',
        sourceRank: item.sourceRank || 0,
        title: String(item.title || '').trim(),
        summary: String(item.summary || '').trim(),
        videoUrl: item.videoUrl,
        videoLabel: slugifyText(item.author || item.postId || item.title || 'video'),
        renderOptions: item.renderOptions || {},
        sourceTaskDir: item.sourceTaskDir || item.materialTaskDir || '',
        materialTaskDir: item.materialTaskDir || item.sourceTaskDir || '',
        referenceSubtitles: Array.isArray(item.referenceSubtitles) ? item.referenceSubtitles : [],
        // 保存原始参数用于恢复
        originalItem: {
          sourceType: item.sourceType,
          author: item.author,
          postId: item.postId,
          postUrl: item.postUrl,
          sourcePartitionId: item.sourcePartitionId,
          sourcePartitionLabel: item.sourcePartitionLabel,
          sourceRank: item.sourceRank,
          title: item.title,
          summary: item.summary,
          videoUrl: item.videoUrl,
          sourceTaskDir: item.sourceTaskDir,
          materialTaskDir: item.materialTaskDir,
          referenceSubtitles: Array.isArray(item.referenceSubtitles) ? item.referenceSubtitles : [],
          renderOptions: item.renderOptions
        }
      });
      taskId = task.id;
      taskStore.appendLog(taskId, '任务已进入竖屏队列');
    } else {
      taskId = makeJobId();
    }

    // 创建内存 job 对象（用于快速访问）
    const job = {
      id: taskId,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: [],
      cancelRequested: false,
      currentProc: null,
      currentCancelHandle: null,
      sourceType: item.sourceType || 'xai_top10',
      sourcePartitionId: item.sourcePartitionId || '',
      sourcePartitionLabel: item.sourcePartitionLabel || '',
      sourceRank: item.sourceRank || 0,
      author: item.author || '',
      postId: item.postId || '',
      postUrl: item.postUrl || '',
      title: String(item.title || '').trim(),
      summary: String(item.summary || '').trim(),
      videoUrl: item.videoUrl,
      sourceTaskDir: item.sourceTaskDir || item.materialTaskDir || '',
      materialTaskDir: item.materialTaskDir || item.sourceTaskDir || '',
      referenceSubtitles: Array.isArray(item.referenceSubtitles) ? item.referenceSubtitles : [],
      videoLabel: slugifyText(item.author || item.postId || item.title || 'video'),
      renderOptions: item.renderOptions || {}
    };

    if (!taskStore) {
      appendLog(job, '任务已进入竖屏队列');
    }

    verticalJobs.set(taskId, job);
    verticalJobQueue.push(job);
    processQueue();
    return job;
  }

  function setConcurrency(value) {
    const requested = Number(value);
    if (Number.isFinite(requested) && requested > 0) {
      verticalJobConcurrency = Math.max(1, Math.min(4, Math.floor(requested)));
    }
    return verticalJobConcurrency;
  }

  function cancel(jobId) {
    const job = verticalJobs.get(String(jobId || '').trim());
    if (!job) {
      const error = createError('VERTICAL_QUEUE_CANCEL_FAILED', '任务不存在');
      error.status = 404;
      throw error;
    }
    if (job.status === 'completed') {
      const error = createError('VERTICAL_QUEUE_CANCEL_FAILED', '任务已完成，无法取消');
      error.status = 409;
      throw error;
    }
    if (job.status === 'failed') {
      const error = createError('VERTICAL_QUEUE_CANCEL_FAILED', '任务已失败，无法取消');
      error.status = 409;
      throw error;
    }
    if (job.status === 'cancelled') {
      const error = createError('VERTICAL_QUEUE_CANCEL_FAILED', '任务已取消');
      error.status = 409;
      throw error;
    }

    job.cancelRequested = true;
    appendLog(job, '用户请求取消当前任务');

    if (job.status === 'queued') {
      const index = verticalJobQueue.findIndex((item) => item.id === job.id);
      if (index >= 0) verticalJobQueue.splice(index, 1);
      job.status = 'cancelled';
      job.progress = 100;
      job.message = '任务已取消';
      job.updatedAt = new Date().toISOString();
      job.completedAt = job.updatedAt;
      job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
      appendLog(job, '排队任务已取消');
      syncJobToTaskStore(job);
    } else if (job.currentCancelHandle) {
      job.currentCancelHandle();
      job.status = 'cancelled';
      job.progress = 100;
      job.message = '正在取消任务...';
      job.updatedAt = new Date().toISOString();
      job.completedAt = job.updatedAt;
      job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
      appendLog(job, '正在终止当前执行进程');
      syncJobToTaskStore(job);
    } else if (job.currentProc) {
      stopProcessTree(job.currentProc);
      job.status = 'cancelled';
      job.progress = 100;
      job.message = '正在取消任务...';
      job.updatedAt = new Date().toISOString();
      job.completedAt = job.updatedAt;
      job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
      appendLog(job, '正在终止当前执行进程');
      syncJobToTaskStore(job);
    } else {
      job.status = 'cancelled';
      job.progress = 100;
      job.message = '任务已取消';
      job.updatedAt = new Date().toISOString();
      job.completedAt = job.updatedAt;
      job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
      appendLog(job, '任务已取消');
    }
  }

  function remove(jobId) {
    const normalizedJobId = String(jobId || '').trim();
    const job = verticalJobs.get(normalizedJobId);
    if (!job) {
      const error = createError('VERTICAL_QUEUE_REMOVE_FAILED', '任务不存在');
      error.status = 404;
      throw error;
    }
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      const error = createError('VERTICAL_QUEUE_REMOVE_FAILED', '仅已完成、失败或已取消的任务允许删除');
      error.status = 409;
      throw error;
    }

    verticalJobs.delete(normalizedJobId);
    removeDirIfExists(path.join(verticalQueueRoot, normalizedJobId));
    removeDirIfExists(path.join(verticalPublicDir, normalizedJobId));
  }

  return {
    cancel,
    enqueue,
    getJob,
    getStatus,
    remove,
    setConcurrency
  };
}

module.exports = {
  createVerticalQueueService
};
