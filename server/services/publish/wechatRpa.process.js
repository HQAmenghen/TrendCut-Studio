/**
 * WeChat RPA 进程管理服务
 *
 * 职责：
 * - RPA 进程启动、重试、取消
 * - 进程生命周期管理
 * - 输出解析和状态更新
 */

const {
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError
} = require('../../core/failureSummary');

function createWechatProcessService(deps) {
  const {
    fs,
    path,
    runPythonScriptCancellable,
    publishCenterDir,
    wechatRpaScript,
    wechatRpaTaskDir,
    readPublishJobs,
    readPublishConfig,
    validateWechatTaskConfig,
    // Runtime service functions
    buildWechatPublishPayload,
    parseWechatRpaLine,
    parseWechatLogLine,
    getWechatStateProgress,
    readWechatRuntimeLogs,
    appendWechatRuntimeLog,
    safeUpdatePublishPlatformTask
  } = deps;

  const publishRuntimeProcesses = new Map();

  /**
   * 停止 WeChat RPA 进程
   */
  function stopWechatRpaProcess(runtimeEntry) {
    if (!runtimeEntry?.cancel) return;
    try {
      runtimeEntry.cancel();
    } catch (_err) {}
  }

  /**
   * 获取账号的活跃运行时
   */
  function getActiveWechatRuntimeForAccount(accountId) {
    for (const entry of publishRuntimeProcesses.values()) {
      if (entry?.platform === 'wechatChannels' && String(entry.accountId || '').trim() === String(accountId || '').trim()) {
        return entry;
      }
    }
    return null;
  }

  /**
   * 启动 WeChat RPA
   */
  async function startWechatRpa(jobId, publishMode = 'draft') {
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

    const rpaPayload = {
      ...buildWechatPublishPayload(job, wechatAccount),
      publishMode
    };
    const payloadFile = path.join(wechatRpaTaskDir, `${jobId}_wechatChannels.json`);
    await fs.promises.writeFile(payloadFile, JSON.stringify(rpaPayload, null, 2), 'utf-8');

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

    const { process: proc, promise, cancel } = runPythonScriptCancellable(
      wechatRpaScript,
      ['--payload', payloadFile],
      {
        cwd: publishCenterDir,
        onStdout: (chunk) => handleOutput(chunk),
        onStderr: (chunk) => handleOutput(chunk)
      }
    );

    const runtimeEntry = {
      proc,
      cancel,
      jobId,
      platform: 'wechatChannels',
      accountId: wechatAccount.id,
      publishMode,
      cancelledByUser: false,
      currentState: 'starting'
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
        runtimeEntry.currentState = parsed.state; // 跟踪当前状态
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

    // Handle promise resolution/rejection
    promise
      .then(() => {
        publishRuntimeProcesses.delete(runtimeKey);
      })
      .catch((error) => {
        publishRuntimeProcesses.delete(runtimeKey);
        if (runtimeEntry.cancelledByUser) return;

        const errorMessage = error?.code === 'PYTHON_SCRIPT_CANCELLED'
          ? '用户已取消视频号自动化任务'
          : error.message;

        // 创建失败摘要
        const failureSummary = error?.code
          ? createFailureSummaryFromPythonError(error, 'publish_wechat', {
            stage: runtimeEntry.currentState || 'unknown',
            context: {
              jobId,
              accountId: task?.accountId || '',
              publishMode
            }
          })
          : createFailureSummaryFromError(error, 'publish_wechat', runtimeEntry.currentState || 'unknown', {
            context: {
              jobId,
              accountId: task?.accountId || '',
              publishMode
            }
          });

        safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
          status: 'failed',
          lastFailureAt: new Date().toISOString(),
          failureSummary,
          runtime: {
            state: 'failed',
            lastMessage: errorMessage,
            updatedAt: new Date().toISOString(),
            publishMode,
            progress: 100,
            logs: [...readWechatRuntimeLogs(jobId), `[error] ${errorMessage}`].slice(-120)
          }
        });
      });
  }

  /**
   * 重试 WeChat RPA
   */
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
    startWechatRpa(jobId, nextMode).catch((err) => {
      console.error(`Failed to retry wechat RPA: ${err.message}`);
    });
  }

  /**
   * 取消 WeChat RPA
   */
  function cancelWechatRpa(jobId) {
    const runtimeKey = `${jobId}:wechatChannels`;
    const runtimeEntry = publishRuntimeProcesses.get(runtimeKey);
    if (!runtimeEntry) {
      throw new Error('当前没有可取消的视频号运行任务');
    }
    runtimeEntry.cancelledByUser = true;
    stopWechatRpaProcess(runtimeEntry);

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

  return {
    startWechatRpa,
    retryWechatRpa,
    cancelWechatRpa,
    stopWechatRpaProcess,
    getActiveWechatRuntimeForAccount
  };
}

module.exports = { createWechatProcessService };
