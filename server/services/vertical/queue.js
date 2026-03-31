const fs = require('fs');
const path = require('path');
const axios = require('axios');

function createVerticalQueueService(deps) {
  const {
    baseDir,
    pipelineDir,
    verticalQueueRoot,
    verticalPublicDir,
    ensureDir,
    makeJobId,
    slugifyText,
    sanitizeProcessLogLines,
    formatElapsedSeconds,
    stopProcessTree,
    removeDirIfExists,
    buildFallbackTitleFromSubtitles,
    spawnScript,
    writeJsonFile,
    runPythonScript,
    writeMediaMetadata,
    readMediaMetadata,
    triggerAutoReview
  } = deps;

  const verticalJobs = new Map();
  const verticalJobQueue = [];
  let verticalActiveCount = 0;
  let verticalJobConcurrency = 2;
  const verticalQueueLogPath = path.join(baseDir, 'data', 'logs', 'vertical_queue.log');

  function appendPersistentLine(filePath, line) {
    try {
      ensureDir(path.dirname(filePath));
      fs.appendFileSync(filePath, `${line}\n`, 'utf8');
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

  function ensureAsciiSafeReplacer(_key, value) {
    return value;
  }

  function summarizePythonError(error) {
    const stderrLines = sanitizeProcessLogLines(error?.stderr || '').slice(-20);
    const stdoutLines = sanitizeProcessLogLines(error?.stdout || '').slice(-12);
    return {
      message: String(error?.message || '未知错误'),
      code: String(error?.code || ''),
      stage: String(error?.stage || ''),
      details: String(error?.details || ''),
      hint: String(error?.hint || ''),
      exitCode: Number.isFinite(Number(error?.exitCode)) ? Number(error.exitCode) : null,
      stderrTail: stderrLines,
      stdoutTail: stdoutLines,
      protocol: error?.protocol || null
    };
  }

  function persistJobFailure(job, failureSummary, jobDir) {
    const payload = {
      jobId: job.id,
      status: job.status,
      sourceType: job.sourceType || '',
      author: job.author || '',
      title: job.title || '',
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
    appendPersistentLine(
      verticalQueueLogPath,
      formatPersistentLogLine(job, message)
    );
    const jobLogPath = path.join(verticalQueueRoot, job.id, 'vertical_queue.log');
    appendPersistentLine(
      jobLogPath,
      formatPersistentLogLine(job, message)
    );
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

    throw new Error(`远程视频下载失败，已重试 ${maxAttempts} 次: ${lastError?.message || 'unknown error'}`);
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
    const descriptionSource = String(job.summary || '').trim() ? 'post_summary' : 'none';

    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '任务在开始前被取消');
      return;
    }

    updateJob({ status: 'downloading', progress: 10, message: '正在下载远程视频...' }, '开始下载远程视频');
    await downloadRemoteFile(job.videoUrl, sourceVideoPath);
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '下载完成后任务被取消');
      return;
    }

    updateJob({ status: 'transcribing', progress: 35, message: '正在执行 ASR 自动打轴...' }, '进入 ASR 自动打轴阶段');
    await spawnScript(runAsrPath, ['--input', sourceVideoPath, '--allow-no-audio'], {
      cwd: jobDir,
      onSpawn: (proc) => { job.currentProc = proc; },
      onStdout: pipeProcessLogs('ASR'),
      onStderr: pipeProcessLogs('ASR', true),
      onHeartbeat: stageHeartbeat('ASR 阶段', 35, '正在执行 ASR 自动打轴...')
    });
    job.currentProc = null;
    const subtitlesPayload = path.join(jobDir, 'subtitles.json');
    const subtitlesData = fs.existsSync(subtitlesPayload) ? readJsonSafe(subtitlesPayload, []) : [];
    if (Array.isArray(subtitlesData) && subtitlesData.length > 0) {
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

    let finalTitle = String(job.title || '').trim();
    if (!finalTitle) {
      updateJob({ status: 'titling', progress: 55, message: '正在生成竖屏标题...' }, '开始自动生成竖屏标题');
      finalTitle = await generateHotTitle(jobDir, 'subtitles.json');
    }
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '标题阶段后任务被取消');
      return;
    }

    writeJsonFile(contentPath, { title: finalTitle });
    updateJob({ status: 'rendering', progress: 75, message: '正在渲染竖屏视频...' }, '进入竖屏渲染阶段');
    await spawnScript(makeVerticalPath, [
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
    job.currentProc = null;
    if (job.cancelRequested) {
      updateJob({ status: 'cancelled', progress: 100, message: '任务已取消' }, '渲染阶段后任务被取消');
      return;
    }

    fs.copyFileSync(outputPath, publicOutputPath);
    const metadata = {
      ...(typeof readMediaMetadata === 'function' ? (readMediaMetadata(publicOutputPath) || {}) : {}),
      taskType: 'xai_queue',
      taskDir: jobDir,
      sourceType: job.sourceType || 'xai_top10',
      author: job.author || '',
      postId: job.postId || '',
      postUrl: job.postUrl || '',
      sourceUrl: job.postUrl || '',
      videoUrl: job.videoUrl || '',
      title: finalTitle,
      subtitles: Array.isArray(subtitlesData) ? subtitlesData : [],
      sourceSummary: String(job.summary || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (typeof writeMediaMetadata === 'function') {
      writeMediaMetadata(publicOutputPath, metadata);
    }

    if (typeof triggerAutoReview === 'function') {
      updateJob({ status: 'reviewing', progress: 92, message: '正在执行 AI 审核...' }, '渲染完成，开始自动执行 AI 审核');
      const reviewResult = await triggerAutoReview(publicOutputPath, job.id);
      if (reviewResult) {
        appendLog(job, `AI 审核完成：${reviewResult.status || 'unknown'}，得分 ${reviewResult.overall_score ?? '-'}`);
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
          const failureSummary = summarizePythonError(error);
          persistJobFailure(job, failureSummary, path.join(verticalQueueRoot, job.id));
          appendPersistentLine(
            verticalQueueLogPath,
            formatPersistentLogLine(job, '任务失败详情已持久化', failureSummary)
          );
        })
        .finally(() => {
          job.currentProc = null;
          verticalActiveCount = Math.max(0, verticalActiveCount - 1);
          processQueue();
        });
    }
  }

  function enqueue(item) {
    const id = makeJobId();
    const job = {
      id,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: [],
      cancelRequested: false,
      currentProc: null,
      sourceType: item.sourceType || 'xai_top10',
      author: item.author || '',
      postId: item.postId || '',
      postUrl: item.postUrl || '',
      title: String(item.title || '').trim(),
      summary: String(item.summary || '').trim(),
      videoUrl: item.videoUrl,
      videoLabel: slugifyText(item.author || item.postId || item.title || 'video'),
      renderOptions: item.renderOptions || {}
    };
    appendLog(job, '任务已进入竖屏队列');
    verticalJobs.set(id, job);
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
      const error = new Error('竖屏任务不存在');
      error.status = 404;
      throw error;
    }
    if (job.status === 'completed') {
      const error = new Error('任务已完成，无法取消');
      error.status = 409;
      throw error;
    }
    if (job.status === 'failed') {
      const error = new Error('任务已失败，无法取消');
      error.status = 409;
      throw error;
    }
    if (job.status === 'cancelled') {
      const error = new Error('任务已取消');
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
    } else if (job.currentProc) {
      stopProcessTree(job.currentProc);
      job.status = 'cancelled';
      job.progress = 100;
      job.message = '正在取消任务...';
      job.updatedAt = new Date().toISOString();
      job.completedAt = job.updatedAt;
      job.durationSeconds = job.startedAt ? Math.max(0, Math.floor((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
      appendLog(job, '正在终止当前执行进程');
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
      const error = new Error('竖屏任务不存在');
      error.status = 404;
      throw error;
    }
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      const error = new Error('仅已完成、失败或已取消的任务允许删除');
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
