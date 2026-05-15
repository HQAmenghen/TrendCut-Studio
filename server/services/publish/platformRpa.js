const {
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError
} = require('../../core/failureSummary');

const BROWSER_RPA_PLATFORMS = {
  douyin: {
    label: '抖音',
    uploadUrl: 'https://creator.douyin.com/creator-micro/content/upload'
  },
  xiaohongshu: {
    label: '小红书',
    uploadUrl: 'https://creator.xiaohongshu.com/publish/publish'
  }
};

function createPlatformRpaService(deps) {
  const {
    fs,
    path,
    slugifyText,
    runPythonScriptCancellable,
    publishCenterDir,
    platformRpaScript,
    socialAutoUploadAdapterScript,
    platformRpaTaskDir,
    platformRpaProfileRoot,
    socialAutoUploadDir,
    socialAutoUploadPython,
    readPublishJobs,
    readPublishConfig,
    updatePublishPlatformTask,
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa
  } = deps;

  const runtimeProcesses = new Map();

  function normalizePlatformKey(platformKey) {
    return String(platformKey || '').trim();
  }

  function getPlatformDefinition(platformKey) {
    return BROWSER_RPA_PLATFORMS[normalizePlatformKey(platformKey)] || null;
  }

  function safeUpdatePublishPlatformTask(jobId, platformKey, patch) {
    try {
      updatePublishPlatformTask(jobId, platformKey, patch);
    } catch (_err) {}
  }

  function getRuntimeLogs(jobId, platformKey) {
    const payload = readPublishJobs();
    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
    const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === platformKey);
    return Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
  }

  function appendRuntimeLog(jobId, platformKey, line, publishMode, state, message, progress) {
    if (!line) return;
    safeUpdatePublishPlatformTask(jobId, platformKey, {
      runtime: {
        state,
        lastMessage: message,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress,
        logs: [...getRuntimeLogs(jobId, platformKey), line].slice(-120)
      }
    });
  }

  function parseStatusLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('STATUS|')) return null;
    const parts = text.split('|');
    if (parts.length < 4) return null;
    let extra = {};
    try {
      extra = parts[4] ? JSON.parse(parts[4]) : {};
    } catch (_err) {}
    return {
      state: parts[1],
      message: parts[3] || parts[2] || '',
      extra
    };
  }

  function parseLogLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('LOG|')) return null;
    return text.slice(4).trim();
  }

  function getStateProgress(state) {
    const map = {
      starting: 3,
      checking_login: 10,
      navigating: 12,
      need_login: 20,
      login_ready: 30,
      uploading: 48,
      uploaded: 64,
      editing: 76,
      edited: 88,
      ready_for_manual_publish: 100,
      publishing: 94,
      success: 100,
      failed: 100
    };
    return map[state] ?? 0;
  }

  function stopProcess(runtimeEntry) {
    if (!runtimeEntry?.cancel) return;
    try {
      runtimeEntry.cancel();
    } catch (_err) {}
  }

  function resolveStandaloneRuntimeVideoPath(job) {
    const taskDir = String(job?.asset?.metadata?.taskDir || '').trim();
    if (!taskDir) return '';
    const candidate = path.resolve(taskDir, 'standalone_output_vertical.mp4');
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : '';
    } catch (_err) {
      return '';
    }
  }

  function resolveJobVideoPath(job) {
    return resolveStandaloneRuntimeVideoPath(job) || String(job?.asset?.path || '').trim();
  }

  function buildProfileDir(platformKey, platformConfig = {}) {
    const accountKey = String(
      platformConfig.accountId
      || platformConfig.openId
      || platformConfig.displayName
      || platformKey
    ).trim();
    const safeAccountKey = slugifyText(accountKey, 'default');
    return path.join(platformRpaProfileRoot, platformKey, safeAccountKey);
  }

  function buildBrowserPayload(job, platformKey, platformConfig, publishMode, videoPath) {
    const definition = getPlatformDefinition(platformKey);
    return {
      platform: platformKey,
      platformLabel: definition.label,
      publishMode,
      uploadUrl: definition.uploadUrl,
      videoPath,
      userDataDir: buildProfileDir(platformKey, platformConfig),
      title: job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布',
      description: job.publishData?.description || job.asset?.metadata?.suggestedDescription || '',
      tags: Array.isArray(job.publishData?.tags) ? job.publishData.tags : [],
      accountId: platformConfig.accountId || platformConfig.openId || '',
      accountLabel: platformConfig.displayName || platformConfig.accountId || platformConfig.openId || definition.label,
      loginTimeoutSec: 180,
      headless: false
    };
  }

  function getSocialAutoUploadDir() {
    const configured = String(socialAutoUploadDir || process.env.SOCIAL_AUTO_UPLOAD_DIR || '').trim();
    if (configured) return configured;
    const candidates = [
      process.env.SOCIAL_AUTO_UPLOAD_HOME,
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'social-auto-upload') : '',
      process.env.HOME ? path.join(process.env.HOME, 'social-auto-upload') : '',
      path.resolve(process.cwd(), '..', 'social-auto-upload')
    ].map((item) => String(item || '').trim()).filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || '';
  }

  function getSocialAutoUploadPython() {
    const configured = String(socialAutoUploadPython || process.env.SOCIAL_AUTO_UPLOAD_PYTHON || '').trim();
    if (configured) return configured;
    const sauDir = getSocialAutoUploadDir();
    if (sauDir) {
      const candidates = process.platform === 'win32'
        ? [
          path.join(sauDir, '.venv', 'Scripts', 'python.exe'),
          path.join(sauDir, 'venv', 'Scripts', 'python.exe')
        ]
        : [
          path.join(sauDir, '.venv', 'bin', 'python'),
          path.join(sauDir, 'venv', 'bin', 'python')
        ];
      const discovered = candidates.find((candidate) => fs.existsSync(candidate));
      if (discovered) return discovered;
    }
    return 'python';
  }

  function getSauAccountName(platformKey, platformConfig = {}) {
    return String(
      platformConfig.sauAccountName
      || platformConfig.accountName
      || platformConfig.accountId
      || platformConfig.openId
      || platformConfig.displayName
      || platformKey
    ).trim();
  }

  function supportsSocialAutoUpload(platformKey, platformConfig = {}) {
    if (!['douyin', 'xiaohongshu'].includes(platformKey)) return false;
    if (!getSocialAutoUploadDir()) return false;
    return Boolean(getSauAccountName(platformKey, platformConfig));
  }

  function buildSocialAutoUploadPayload(platformKey, job, platformConfig, publishMode, videoPath) {
    const definition = getPlatformDefinition(platformKey);
    return {
      platformKey,
      platform: platformKey,
      platformLabel: definition.label,
      publishMode,
      accountName: getSauAccountName(platformKey, platformConfig),
      videoPath,
      title: job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布',
      description: job.publishData?.description || job.asset?.metadata?.suggestedDescription || '',
      tags: Array.isArray(job.publishData?.tags) ? job.publishData.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
      headless: false
    };
  }

  async function startBrowserPlatformRpa(jobId, platformKey, publishMode = 'draft') {
    const definition = getPlatformDefinition(platformKey);
    if (!definition) {
      throw new Error(`平台暂未接入浏览器 RPA: ${platformKey}`);
    }

    const runtimeKey = `${jobId}:${platformKey}`;
    if (runtimeProcesses.has(runtimeKey)) {
      throw new Error(`${definition.label}自动发布任务已在运行`);
    }

    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error('发布任务不存在');
    const task = (job.platformTasks || []).find((item) => item.platform === platformKey);
    if (!task) throw new Error(`该任务未选择${definition.label}`);

    const publishConfig = readPublishConfig();
    const platformConfig = publishConfig[platformKey] || { enabled: false };
    if (!platformConfig.enabled) {
      throw new Error(`${definition.label}尚未启用`);
    }

    const videoPath = resolveJobVideoPath(job);
    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error('待发布视频文件不存在');
    }
    if (!supportsSocialAutoUpload(platformKey, platformConfig) && !fs.existsSync(platformRpaScript)) {
      throw new Error('平台浏览器 RPA 脚本不存在');
    }

    if (supportsSocialAutoUpload(platformKey, platformConfig)) {
      return startSocialAutoUploadRpa(jobId, platformKey, job, platformConfig, publishMode, videoPath, task);
    }

    const browserPayload = buildBrowserPayload(job, platformKey, platformConfig, publishMode, videoPath);
    const payloadFile = path.join(platformRpaTaskDir, `${jobId}_${platformKey}.json`);
    await fs.promises.mkdir(platformRpaTaskDir, { recursive: true });
    await fs.promises.mkdir(browserPayload.userDataDir, { recursive: true });
    await fs.promises.writeFile(payloadFile, JSON.stringify(browserPayload, null, 2), 'utf-8');

    const runtimeEntry = {
      proc: null,
      cancel: null,
      jobId,
      platform: platformKey,
      publishMode,
      cancelledByUser: false,
      currentState: 'starting'
    };
    runtimeProcesses.set(runtimeKey, runtimeEntry);

    safeUpdatePublishPlatformTask(jobId, platformKey, {
      status: publishMode === 'publish' ? 'publishing' : 'draft_preparing',
      lastRunAt: new Date().toISOString(),
      lastRunMode: publishMode,
      retryCount: Number(task?.retryCount || 0),
      runtime: {
        state: 'starting',
        lastMessage: `正在启动${definition.label}自动化浏览器...`,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress: 3,
        logs: [`启动${definition.label}浏览器自动化任务`]
      }
    });

    let latestRuntimeState = 'starting';
    let latestRuntimeMessage = `正在启动${definition.label}自动化浏览器...`;
    let latestRuntimeProgress = 3;

    const handleOutput = (chunk) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const logLine = parseLogLine(line);
        if (logLine) {
          appendRuntimeLog(jobId, platformKey, logLine, publishMode, latestRuntimeState, latestRuntimeMessage, latestRuntimeProgress);
          continue;
        }
        const parsed = parseStatusLine(line);
        if (!parsed) {
          appendRuntimeLog(jobId, platformKey, line, publishMode, latestRuntimeState, latestRuntimeMessage, latestRuntimeProgress);
          continue;
        }
        latestRuntimeState = parsed.state;
        latestRuntimeMessage = parsed.message;
        latestRuntimeProgress = Number.isFinite(Number(parsed.extra?.percent)) ? Number(parsed.extra.percent) : getStateProgress(parsed.state);
        runtimeEntry.currentState = parsed.state;
        safeUpdatePublishPlatformTask(jobId, platformKey, {
          status: parsed.state === 'success'
            ? (publishMode === 'publish' ? 'published' : 'ready_for_manual_publish')
            : parsed.state,
          runtime: {
            state: parsed.state,
            lastMessage: parsed.message,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: latestRuntimeProgress,
            logs: [...getRuntimeLogs(jobId, platformKey), `[${parsed.state}] ${parsed.message}`].slice(-120),
            ...parsed.extra
          }
        });
      }
    };

    let proc;
    let promise;
    let cancel;
    try {
      ({ process: proc, promise, cancel } = runPythonScriptCancellable(
        platformRpaScript,
        ['--payload', payloadFile],
        {
          cwd: publishCenterDir,
          onStdout: (chunk) => handleOutput(chunk),
          onStderr: (chunk) => handleOutput(chunk)
        }
      ));
    } catch (err) {
      runtimeProcesses.delete(runtimeKey);
      throw err;
    }

    runtimeEntry.proc = proc;
    runtimeEntry.cancel = cancel;

    promise
      .then(() => {
        runtimeProcesses.delete(runtimeKey);
      })
      .catch((error) => {
        runtimeProcesses.delete(runtimeKey);
        if (runtimeEntry.cancelledByUser) return;

        const errorMessage = error?.code === 'PYTHON_SCRIPT_CANCELLED'
          ? `用户已取消${definition.label}自动化任务`
          : error.message;
        const failureSummary = error?.code
          ? createFailureSummaryFromPythonError(error, `publish_${platformKey}`, {
            stage: runtimeEntry.currentState || 'unknown',
            context: { jobId, platform: platformKey, publishMode }
          })
          : createFailureSummaryFromError(error, `publish_${platformKey}`, runtimeEntry.currentState || 'unknown', {
            context: { jobId, platform: platformKey, publishMode }
          });

        safeUpdatePublishPlatformTask(jobId, platformKey, {
          status: 'failed',
          lastFailureAt: new Date().toISOString(),
          failureSummary,
          runtime: {
            state: 'failed',
            lastMessage: errorMessage,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            logs: [...getRuntimeLogs(jobId, platformKey), `[error] ${errorMessage}`].slice(-120)
          }
        });
      });
  }

  async function startSocialAutoUploadRpa(jobId, platformKey, job, platformConfig, publishMode, videoPath, task) {
    const definition = getPlatformDefinition(platformKey);
    const runtimeKey = `${jobId}:${platformKey}`;
    const cwd = getSocialAutoUploadDir();
    if (!fs.existsSync(cwd)) {
      throw new Error(`social-auto-upload 目录不存在: ${cwd}`);
    }
    if (!fs.existsSync(socialAutoUploadAdapterScript)) {
      throw new Error('social-auto-upload 代码级适配脚本不存在');
    }

    const adapterPayload = buildSocialAutoUploadPayload(platformKey, job, platformConfig, publishMode, videoPath);
    const payloadFile = path.join(platformRpaTaskDir, `${jobId}_${platformKey}_social_auto_upload.json`);
    await fs.promises.mkdir(platformRpaTaskDir, { recursive: true });
    await fs.promises.writeFile(payloadFile, JSON.stringify(adapterPayload, null, 2), 'utf-8');
    const runtimeEntry = {
      proc: null,
      cancel: null,
      jobId,
      platform: platformKey,
      publishMode,
      cancelledByUser: false,
      currentState: 'starting'
    };
    runtimeProcesses.set(runtimeKey, runtimeEntry);

    safeUpdatePublishPlatformTask(jobId, platformKey, {
      status: publishMode === 'publish' ? 'publishing' : 'draft_preparing',
      lastRunAt: new Date().toISOString(),
      lastRunMode: publishMode,
      retryCount: Number(task?.retryCount || 0),
      runtime: {
        state: 'starting',
        lastMessage: `正在通过 social-auto-upload 代码级适配器启动${definition.label}${publishMode === 'publish' ? '自动发表' : '草稿填充'}...`,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress: 3,
        adapter: 'social-auto-upload-direct',
        logs: [`启动 social-auto-upload direct adapter: ${getSocialAutoUploadPython()} ${socialAutoUploadAdapterScript} --payload ${payloadFile}`]
      }
    });

    let latestRuntimeState = 'starting';
    let latestRuntimeMessage = `正在启动${definition.label}代码级适配器...`;
    let latestRuntimeProgress = 3;

    const handleOutput = (chunk) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const logLine = parseLogLine(line);
        if (logLine) {
          appendRuntimeLog(jobId, platformKey, logLine, publishMode, latestRuntimeState, latestRuntimeMessage, latestRuntimeProgress);
          continue;
        }
        const parsed = parseStatusLine(line);
        if (!parsed) {
          appendRuntimeLog(jobId, platformKey, line, publishMode, latestRuntimeState, latestRuntimeMessage, latestRuntimeProgress);
          continue;
        }
        latestRuntimeState = parsed.state;
        latestRuntimeMessage = parsed.message;
        latestRuntimeProgress = Number.isFinite(Number(parsed.extra?.percent)) ? Number(parsed.extra.percent) : getStateProgress(parsed.state);
        runtimeEntry.currentState = parsed.state;
        safeUpdatePublishPlatformTask(jobId, platformKey, {
          status: parsed.state === 'success'
            ? (publishMode === 'publish' ? 'published' : 'ready_for_manual_publish')
            : parsed.state,
          runtime: {
            state: parsed.state,
            lastMessage: parsed.message,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: latestRuntimeProgress,
            adapter: 'social-auto-upload-direct',
            logs: [...getRuntimeLogs(jobId, platformKey), `[${parsed.state}] ${parsed.message}`].slice(-120),
            ...parsed.extra
          }
        });
      }
    };

    let proc;
    let promise;
    let cancel;
    try {
      ({ process: proc, promise, cancel } = runPythonScriptCancellable(
        socialAutoUploadAdapterScript,
        ['--payload', payloadFile, '--social-auto-upload-dir', cwd],
        {
          cwd: publishCenterDir,
          command: getSocialAutoUploadPython(),
          onStdout: handleOutput,
          onStderr: handleOutput
        }
      ));
    } catch (err) {
      runtimeProcesses.delete(runtimeKey);
      throw err;
    }

    runtimeEntry.proc = proc;
    runtimeEntry.cancel = cancel;
    runtimeEntry.currentState = 'publishing';

    promise
      .then(() => {
        runtimeProcesses.delete(runtimeKey);
        safeUpdatePublishPlatformTask(jobId, platformKey, {
          status: publishMode === 'publish' ? 'published' : 'ready_for_manual_publish',
          runtime: {
            state: 'success',
            lastMessage: publishMode === 'publish'
              ? `${definition.label}已由 social-auto-upload 提交发布`
              : `${definition.label}草稿填充已结束`,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            adapter: 'social-auto-upload-direct',
            logs: [...getRuntimeLogs(jobId, platformKey), '[success] social-auto-upload direct adapter 已完成'].slice(-120)
          }
        });
      })
      .catch((error) => {
        runtimeProcesses.delete(runtimeKey);
        if (runtimeEntry.cancelledByUser) return;

        const errorMessage = error?.code === 'PYTHON_SCRIPT_CANCELLED'
          ? `用户已取消${definition.label} social-auto-upload 任务`
          : error.message;
        const failureSummary = error?.code
          ? createFailureSummaryFromPythonError(error, `publish_${platformKey}`, {
            stage: runtimeEntry.currentState || 'unknown',
            context: { jobId, platform: platformKey, publishMode, adapter: 'social-auto-upload-direct' }
          })
          : createFailureSummaryFromError(error, `publish_${platformKey}`, runtimeEntry.currentState || 'unknown', {
            context: { jobId, platform: platformKey, publishMode, adapter: 'social-auto-upload-direct' }
          });

        safeUpdatePublishPlatformTask(jobId, platformKey, {
          status: 'failed',
          lastFailureAt: new Date().toISOString(),
          failureSummary,
          runtime: {
            state: 'failed',
            lastMessage: errorMessage,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            adapter: 'social-auto-upload-direct',
            logs: [...getRuntimeLogs(jobId, platformKey), `[error] ${errorMessage}`].slice(-120)
          }
        });
      });
  }

  async function startPlatformRpa(jobId, platformKey, publishMode = 'draft') {
    const normalizedPlatform = normalizePlatformKey(platformKey);
    if (normalizedPlatform === 'wechatChannels') {
      return startWechatRpa(jobId, publishMode);
    }
    return startBrowserPlatformRpa(jobId, normalizedPlatform, publishMode);
  }

  function retryPlatformRpa(jobId, platformKey, mode = '') {
    const normalizedPlatform = normalizePlatformKey(platformKey);
    if (normalizedPlatform === 'wechatChannels') {
      return retryWechatRpa(jobId, mode);
    }
    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error('发布任务不存在');
    const task = (job.platformTasks || []).find((item) => item.platform === normalizedPlatform);
    if (!task) throw new Error(`该任务未选择${normalizedPlatform}`);
    const nextMode = ['draft', 'publish'].includes(String(mode || '').trim())
      ? String(mode).trim()
      : String(task?.runtime?.publishMode || task?.lastRunMode || 'draft').trim();
    safeUpdatePublishPlatformTask(jobId, normalizedPlatform, {
      retryCount: Number(task?.retryCount || 0) + 1,
      runtime: {
        state: 'draft_preparing',
        lastMessage: `准备重新执行${getPlatformDefinition(normalizedPlatform)?.label || normalizedPlatform}自动化...`,
        updatedAt: new Date().toISOString(),
        publishMode: nextMode,
        progress: 2,
        logs: [...(Array.isArray(task?.runtime?.logs) ? task.runtime.logs : []), `[retry] 正在按 ${nextMode} 模式重试任务`].slice(-120)
      }
    });
    startPlatformRpa(jobId, normalizedPlatform, nextMode).catch((err) => {
      console.error(`Failed to retry ${normalizedPlatform} RPA: ${err.message}`);
    });
  }

  function cancelPlatformRpa(jobId, platformKey) {
    const normalizedPlatform = normalizePlatformKey(platformKey);
    if (normalizedPlatform === 'wechatChannels') {
      return cancelWechatRpa(jobId);
    }
    const runtimeKey = `${jobId}:${normalizedPlatform}`;
    const runtimeEntry = runtimeProcesses.get(runtimeKey);
    if (!runtimeEntry) {
      throw new Error('当前没有可取消的平台运行任务');
    }
    runtimeEntry.cancelledByUser = true;
    stopProcess(runtimeEntry);
    runtimeProcesses.delete(runtimeKey);

    safeUpdatePublishPlatformTask(jobId, normalizedPlatform, {
      status: 'cancelled',
      lastCancelledAt: new Date().toISOString(),
      runtime: {
        state: 'cancelled',
        lastMessage: '用户已取消当前任务',
        updatedAt: new Date().toISOString(),
        publishMode: runtimeEntry.publishMode,
        progress: 100,
        logs: [...getRuntimeLogs(jobId, normalizedPlatform), '[cancelled] 用户手动取消了当前执行中的任务'].slice(-120)
      }
    });
  }

  return {
    startPlatformRpa,
    retryPlatformRpa,
    cancelPlatformRpa
  };
}

module.exports = {
  createPlatformRpaService,
  BROWSER_RPA_PLATFORMS
};
