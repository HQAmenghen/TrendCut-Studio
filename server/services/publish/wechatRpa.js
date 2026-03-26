function createWechatRpaService(deps) {
  const {
    fs,
    path,
    spawn,
    stopProcessTree,
    slugifyText,
    publishCenterDir,
    wechatRpaScript,
    wechatRpaTaskDir,
    wechatRpaProfileRoot,
    buildShortTitle,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    updatePublishPlatformTask
  } = deps;

  const publishRuntimeProcesses = new Map();
  const keepAliveProcesses = new Map();
  const loginCheckSessions = new Map();

  // Keep-alive has been removed to avoid process competition and allow pure headless mode.

  function buildLoginCheckResponse(session) {
    return {
      success: session.status === 'logged_in' || session.status === 'need_scan' || session.status === 'scanned' || session.status === 'starting',
      status: session.status,
      qrCodeBase64: session.qrCodeBase64 || '',
      message: session.message || '',
      error: session.error || ''
    };
  }

  function finalizeLoginCheckSession(accountId, options = {}) {
    const session = loginCheckSessions.get(accountId);
    if (!session) return;
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    loginCheckSessions.delete(accountId);
  }

  function scheduleLoginCheckCleanup(accountId, delayMs = 30000) {
    const session = loginCheckSessions.get(accountId);
    if (!session) return;
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    session.cleanupTimer = setTimeout(() => {
      finalizeLoginCheckSession(accountId, { restartKeepAlive: true });
    }, delayMs);
  }

  function safeUpdatePublishPlatformTask(jobId, platform, patch) {
    try {
      updatePublishPlatformTask(jobId, platform, patch);
    } catch (err) {
      // console.warn(`Ignore update for deleted job ${jobId}`);
    }
  }

  function buildWechatProfileDir(accountId) {
    const safeAccountId = slugifyText(accountId || '', 'default');
    return path.join(wechatRpaProfileRoot, safeAccountId);
  }

  function buildWechatPublishPayload(job, wechatAccount) {
    const tagStrategy = job.publishData?.tagStrategy === 'model' ? 'model' : 'system';
    const tags = tagStrategy === 'model'
      ? []
      : (Array.isArray(job.publishData?.tags) ? job.publishData.tags : []);
    return {
      title: job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布',
      shortTitle: job.publishData?.shortTitle || job.asset?.metadata?.suggestedShortTitle || buildShortTitle(job.publishData?.title || job.asset?.metadata?.suggestedTitle || job.asset?.label || '视频发布'),
      description: job.publishData?.description || job.asset?.metadata?.suggestedDescription || '',
      tags,
      originalDeclaration: true,
      publishMode: 'draft',
      videoPath: job.asset?.path,
      userDataDir: buildWechatProfileDir(wechatAccount?.id),
      loginTimeoutSec: 240,
      headless: false,
      finderUserName: wechatAccount?.finderUserName || '',
      helperAccount: wechatAccount?.helperAccount || '',
      accountId: wechatAccount?.id || '',
      accountLabel: wechatAccount?.displayName || wechatAccount?.helperAccount || wechatAccount?.finderUserName || ''
    };
  }

  function parseWechatRpaLine(line) {
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

  function parseWechatLogLine(line) {
    const text = String(line || '').trim();
    if (!text.startsWith('LOG|')) return null;
    return text.slice(4).trim();
  }

  function getWechatStateProgress(state) {
    const map = {
      starting: 3,
      navigating: 8,
      need_login: 15,
      login_ready: 24,
      uploading: 42,
      uploaded: 58,
      editing: 72,
      edited: 86,
      ready_for_manual_publish: 100,
      publishing: 94,
      success: 100,
      failed: 100
    };
    return map[state] ?? 0;
  }

  function readWechatRuntimeLogs(jobId) {
    const payload = readPublishJobs();
    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
    const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
    return Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
  }

  function appendWechatRuntimeLog(jobId, line, publishMode, state, message, progress) {
    if (!line) return;
    safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
      runtime: {
        state,
        lastMessage: message,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress,
        logs: [...readWechatRuntimeLogs(jobId), line].slice(-120)
      }
    });
  }

  function stopWechatRpaProcess(runtimeEntry) {
    if (!runtimeEntry?.proc || runtimeEntry.proc.killed) return;
    try {
      stopProcessTree(runtimeEntry.proc);
    } catch (_err) {}
  }

  function getActiveWechatRuntimeForAccount(accountId) {
    for (const entry of publishRuntimeProcesses.values()) {
      if (entry?.platform === 'wechatChannels' && String(entry.accountId || '').trim() === String(accountId || '').trim()) {
        return entry;
      }
    }
    return null;
  }

  function startWechatRpa(jobId, publishMode = 'draft') {
    const runtimeKey = `${jobId}:wechatChannels`;
    if (publishRuntimeProcesses.has(runtimeKey)) {
      throw new Error('视频号自动发布任务已在运行');
    }

    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error('发布任务不存在');
    const task = (job.platformTasks || []).find((item) => item.platform === 'wechatChannels');
    if (!task) throw new Error('该任务未选择微信视频号');
    const publishConfig = readPublishConfig();
    const wechatConfig = publishConfig.wechatChannels || { enabled: false, accounts: [] };
    const validation = validateWechatTaskConfig(wechatConfig, task);
    const missingFields = validation.missingFields;
    if (missingFields.length > 0) {
      throw new Error(`微信视频号配置不完整，缺少：${validation.missingFieldLabels.join('，')}`);
    }
    const wechatAccount = validation.account;
    if (!wechatAccount) {
      throw new Error('未找到对应的视频号发布账号');
    }
    const activeAccountRuntime = getActiveWechatRuntimeForAccount(wechatAccount.id);
    if (activeAccountRuntime && activeAccountRuntime.jobId !== jobId) {
      throw new Error(`账号 ${wechatAccount.displayName || wechatAccount.helperAccount || wechatAccount.finderUserName || wechatAccount.id} 当前已有发布任务在运行，请稍后再试`);
    }
    if (!job.asset?.path || !fs.existsSync(job.asset.path)) {
      throw new Error('待发布视频文件不存在');
    }
    if (!fs.existsSync(wechatRpaScript)) {
      throw new Error('视频号 RPA 脚本不存在');
    }


    // Removed stopKeepAlive to avoid process competition in headless mode

    const rpaPayload = {
      ...buildWechatPublishPayload(job, wechatAccount),
      publishMode
    };
    const payloadFile = path.join(wechatRpaTaskDir, `${jobId}_wechatChannels.json`);
    fs.writeFileSync(payloadFile, JSON.stringify(rpaPayload, null, 2), 'utf-8');

    safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
      status: publishMode === 'publish' ? 'publishing' : 'draft_preparing',
      lastRunAt: new Date().toISOString(),
      lastRunMode: publishMode,
      retryCount: Number(task?.retryCount || 0),
      accountId: wechatAccount.id,
      accountLabel: wechatAccount.displayName || wechatAccount.helperAccount || wechatAccount.finderUserName || task?.accountLabel || '',
      runtime: {
        state: 'starting',
        lastMessage: `正在启动视频号自动化浏览器 (${wechatAccount.displayName || wechatAccount.helperAccount || wechatAccount.finderUserName || wechatAccount.id})...`,
        updatedAt: new Date().toISOString(),
        publishMode,
        progress: 3,
        logs: ['启动视频号自动化任务']
      }
    });

    const proc = spawn('python', [wechatRpaScript, '--payload', payloadFile], {
      cwd: publishCenterDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8'
      }
    });
    const runtimeEntry = {
      proc,
      jobId,
      platform: 'wechatChannels',
      accountId: wechatAccount.id,
      publishMode,
      cancelledByUser: false
    };
    publishRuntimeProcesses.set(runtimeKey, runtimeEntry);
    let latestRuntimeState = 'starting';
    let latestRuntimeMessage = '正在启动视频号自动化浏览器...';
    let latestRuntimeProgress = 3;
    const appendLog = (line) => {
      appendWechatRuntimeLog(jobId, line, publishMode, latestRuntimeState, latestRuntimeMessage, latestRuntimeProgress);
    };

    const handleOutput = (chunk) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        const logLine = parseWechatLogLine(line);
        if (logLine) {
          appendLog(logLine);
          continue;
        }
        const parsed = parseWechatRpaLine(line);
        if (!parsed) {
          appendLog(line);
          continue;
        }
        latestRuntimeState = parsed.state;
        latestRuntimeMessage = parsed.message;
        latestRuntimeProgress = Number.isFinite(Number(parsed.extra?.percent)) ? Number(parsed.extra.percent) : getWechatStateProgress(parsed.state);
        safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
          status: parsed.state === 'success' ? (publishMode === 'publish' ? 'published' : 'ready_for_manual_publish') : parsed.state,
          runtime: {
            state: parsed.state,
            lastMessage: parsed.message,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: latestRuntimeProgress,
            logs: [...readWechatRuntimeLogs(jobId), `[${parsed.state}] ${parsed.message}`].slice(-120),
            ...parsed.extra
          }
        });
      }
    };

    proc.stdout.on('data', (data) => handleOutput(data.toString()));
    proc.stderr.on('data', (data) => handleOutput(data.toString()));
    proc.on('error', (error) => {
      publishRuntimeProcesses.delete(runtimeKey);
      if (runtimeEntry.cancelledByUser) return;
      safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
        status: 'failed',
        lastFailureAt: new Date().toISOString(),
        runtime: {
          state: 'failed',
          lastMessage: error.message,
          updatedAt: new Date().toISOString(),
          publishMode,
          progress: 100,
          logs: [...readWechatRuntimeLogs(jobId), `[error] ${error.message}`].slice(-120)
        }
      });
    });
    proc.on('close', (code) => {
      publishRuntimeProcesses.delete(runtimeKey);
      
      setTimeout(() => {
        const dir = buildWechatProfileDir(wechatAccount.id);
        startKeepAlive(wechatAccount.id, dir);
      }, 5000);

      if (runtimeEntry.cancelledByUser) {
        appendWechatRuntimeLog(jobId, '[cancelled] 用户已取消视频号自动化任务', publishMode, 'cancelled', '用户已取消当前任务', 100);
        return;
      }
      if (code !== 0) {
        safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
          status: 'failed',
          lastFailureAt: new Date().toISOString(),
          runtime: {
            state: 'failed',
            lastMessage: latestRuntimeState === 'failed' ? latestRuntimeMessage : `视频号自动化任务异常结束（退出码 ${code}）`,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            logs: [...readWechatRuntimeLogs(jobId), `[close] 任务以退出码 ${code} 结束`].slice(-120)
          }
        });
      } else {
        const payload = readPublishJobs();
        const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
        const currentTask = (currentJob?.platformTasks || []).find((item) => item.platform === 'wechatChannels');
        const existingLogs = Array.isArray(currentTask?.runtime?.logs) ? currentTask.runtime.logs : [];
        safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
          status: publishMode === 'publish' ? 'published' : 'ready_for_manual_publish',
          publishResult: {
            lastCompletedAt: new Date().toISOString(),
            lastMode: publishMode,
            publishedAt: publishMode === 'publish' ? new Date().toISOString() : currentTask?.publishResult?.publishedAt || null,
            needsManualConfirm: publishMode !== 'publish'
          },
          runtime: {
            state: publishMode === 'publish' ? 'published' : 'ready_for_manual_publish',
            lastMessage: publishMode === 'publish' ? '视频号已自动发表并完成结果回写' : '内容已自动填好，等待你在浏览器里确认发布',
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            logs: [...existingLogs, publishMode === 'publish' ? '[published] 视频号自动发表流程已完成，并已回写任务状态' : '[ready_for_manual_publish] 内容已自动填好，等待人工确认发布'].slice(-120)
          }
        });
      }
    });
  }

  function retryWechatRpa(jobId, mode = '') {
    const payload = readPublishJobs();
    const job = (payload.jobs || []).find((item) => item.id === jobId);
    if (!job) throw new Error('发布任务不存在');
    const task = (job.platformTasks || []).find((item) => item.platform === 'wechatChannels');
    if (!task) throw new Error('该任务未选择微信视频号');
    const nextMode = ['draft', 'publish'].includes(String(mode || '').trim())
      ? String(mode).trim()
      : String(task?.runtime?.publishMode || task?.lastRunMode || 'draft').trim();
    safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
      retryCount: Number(task?.retryCount || 0) + 1,
      runtime: {
        state: 'draft_preparing',
        lastMessage: nextMode === 'publish' ? '准备重新执行自动发表...' : '准备重新填充到待发布页...',
        updatedAt: new Date().toISOString(),
        publishMode: nextMode,
        progress: 2,
        logs: [...(Array.isArray(task?.runtime?.logs) ? task.runtime.logs : []), `[retry] 正在按 ${nextMode} 模式重试任务`].slice(-120)
      }
    });
    startWechatRpa(jobId, nextMode);
  }

  function cancelWechatRpa(jobId) {
    const runtimeKey = `${jobId}:wechatChannels`;
    const runtimeEntry = publishRuntimeProcesses.get(runtimeKey);
    if (!runtimeEntry) {
      throw new Error('当前没有可取消的视频号运行任务');
    }
    runtimeEntry.cancelledByUser = true;
    stopWechatRpaProcess(runtimeEntry);
    
    setTimeout(() => {
      const dir = buildWechatProfileDir(runtimeEntry.accountId);
      startKeepAlive(runtimeEntry.accountId, dir);
    }, 5000);
    
    safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
      status: 'cancelled',
      lastCancelledAt: new Date().toISOString(),
      runtime: {
        state: 'cancelled',
        lastMessage: '用户已取消当前任务',
        updatedAt: new Date().toISOString(),
        publishMode: runtimeEntry.publishMode,
        progress: 100,
        logs: [...readWechatRuntimeLogs(jobId), '[cancelled] 用户手动取消了当前执行中的任务'].slice(-120)
      }
    });
  }


  function checkWechatLogin(accountId, options = {}) {
    return new Promise((resolve, reject) => {
      const shouldPoll = options?.poll === true;
      const activeAccountRuntime = getActiveWechatRuntimeForAccount(accountId);
      if (activeAccountRuntime) {
        return reject(new Error('当前账号正在执行发布任务，无法测试登录'));
      }

      const existingSession = loginCheckSessions.get(accountId);
      if (existingSession) {
        existingSession.updatedAt = new Date().toISOString();
        if (existingSession.status === 'failed' || existingSession.status === 'expired') {
          finalizeLoginCheckSession(accountId);
          return reject(new Error(existingSession.error || '扫码登录已失效，请重新获取二维码'));
        }
        if (existingSession.status === 'logged_in') {
          finalizeLoginCheckSession(accountId);
          return resolve({ success: true, status: 'logged_in' });
        }
        return resolve(buildLoginCheckResponse(existingSession));
      }

      if (shouldPoll) {
        return resolve({ success: true, status: 'idle' });
      }


      const checkScript = path.join(publishCenterDir, 'wechat_check_login.py');
      const userDataDir = buildWechatProfileDir(accountId);
      if (!fs.existsSync(checkScript)) {
        return reject(new Error('检查登录的脚本不存在'));
      }

      const args = ['--user-data-dir', userDataDir, '--account-id', accountId];
      
      const feishuAppId = (process.env.FEISHU_APP_ID || '').trim();
      const feishuAppSecret = (process.env.FEISHU_APP_SECRET || '').trim();
      const feishuWebhook = (process.env.FEISHU_WEBHOOK || '').trim();

      if (feishuAppId) args.push('--feishu-app-id', feishuAppId);
      if (feishuAppSecret) args.push('--feishu-app-secret', feishuAppSecret);
      if (feishuWebhook) args.push('--feishu-webhook', feishuWebhook);

      const proc = spawn('python', [checkScript, ...args], {
        cwd: publishCenterDir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });

      const session = {
        proc,
        accountId,
        userDataDir,
        status: 'starting',
        qrCodeBase64: '',
        error: '',
        updatedAt: new Date().toISOString(),
        cleanupTimer: null
      };
      loginCheckSessions.set(accountId, session);

      let outBuffer = '';
      let errBuffer = '';
      let settled = false;

      const resolveOnce = (payload) => {
        if (settled) return;
        settled = true;
        resolve(payload);
      };

      const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      const handleJsonLine = (line) => {
        let parsed = null;
        try {
          parsed = JSON.parse(line.trim());
        } catch (_err) {
          return false;
        }
        if (parsed.success === undefined) return false;
        session.updatedAt = new Date().toISOString();
        if (parsed.status === 'need_scan') {
          session.status = 'need_scan';
          session.qrCodeBase64 = String(parsed.qrCodeBase64 || '').trim();
          session.error = '';
          resolveOnce(buildLoginCheckResponse(session));
          return true;
        }
        if (parsed.status === 'logged_in') {
          session.status = 'logged_in';
          session.error = '';
          resolveOnce({ success: true, status: 'logged_in' });
          // Ensure we give the python script enough time to flush its session (currently has a 5s sleep)
          scheduleLoginCheckCleanup(accountId, 8000);
          return true;
        }
        if (parsed.status === 'scanned') {
          session.status = 'scanned';
          session.message = parsed.message || '已扫码，请在手机上确认';
          session.error = '';
          // Resolve for immediate frontend feedback if needed, 
          // though usually the next poll will get this.
          resolveOnce(buildLoginCheckResponse(session));
          return true;
        }
        if (parsed.success === false) {
          session.status = parsed.status === 'expired' ? 'expired' : 'failed';
          session.error = parsed.error || '脚本执行失败';
          if (!settled) {
            rejectOnce(new Error(session.error));
            finalizeLoginCheckSession(accountId);
          }
          return true;
        }
        return false;
      };
      
      proc.stdout.on('data', d => {
          const text = d.toString();
          outBuffer += text;
          const lines = text.split(/\r?\n/);
          for (const line of lines) {
              if (handleJsonLine(line)) {
                  continue;
              }
              if (line.includes('WECHAT_LOGIN_CHECK|')) {
                  console.log(line.trim());
              }
          }
      });
      proc.stderr.on('data', d => errBuffer += d.toString());

      proc.on('error', err => {
        finalizeLoginCheckSession(accountId);
        rejectOnce(err);
      });

      proc.on('close', code => {
        session.updatedAt = new Date().toISOString();
        if (session.status === 'need_scan') {
          session.status = 'expired';
          session.error = '二维码已过期，请重新扫码';
          scheduleLoginCheckCleanup(accountId, 1000);
        } else if (session.status === 'logged_in') {
          scheduleLoginCheckCleanup(accountId, 1000);
        } else {
          finalizeLoginCheckSession(accountId);
        }
        try {
          const lines = outBuffer.split(/\r?\n/);
          let resultJson = null;
          for (const line of lines) {
            if (line.includes('"success":')) {
              try {
                const parsed = JSON.parse(line.trim());
                if (parsed.success !== undefined) {
                  resultJson = parsed;
                  break;
                }
              } catch(e){}
            }
          }
          if (resultJson) {
            if (resultJson.success) {
                resolveOnce(resultJson);
            } else if (!settled) {
                rejectOnce(new Error(resultJson.error || '脚本执行失败'));
            }
          } else if (!settled) {
            rejectOnce(new Error(`解析脚本输出失败 (Exit ${code}): \nstdout: ${outBuffer}\nstderr: ${errBuffer}`));
          }
        } catch (e) {
          rejectOnce(e);
        }
      });
    });
  }

  return {
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa,
    checkWechatLogin
  };
}

module.exports = {
  createWechatRpaService
};
