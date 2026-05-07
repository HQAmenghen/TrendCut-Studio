/**
 * WeChat RPA 登录检查服务
 *
 * 职责：
 * - 登录检查和会话管理
 * - 二维码扫码流程
 * - 会话清理和超时处理
 */

function createWechatLoginService(deps) {
  const {
    fs,
    path,
    spawn,
    stopProcessTree,
    publishCenterDir,
    buildWechatProfileDir,
    getActiveWechatRuntimeForAccount
  } = deps;

  const loginCheckSessions = new Map();

  /**
   * 构建登录检查响应
   */
  function buildLoginCheckResponse(session) {
    return {
      success: session.status === 'logged_in' || session.status === 'need_scan' || session.status === 'scanned' || session.status === 'starting',
      status: session.status,
      qrCodeBase64: session.qrCodeBase64 || '',
      qrCodePath: session.qrCodePath || '',
      message: session.message || '',
      error: session.error || ''
    };
  }

  /**
   * 结束登录检查会话
   */
  function finalizeLoginCheckSession(accountId, _options = {}) {
    const session = loginCheckSessions.get(accountId);
    if (!session) return;
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    loginCheckSessions.delete(accountId);
  }

  /**
   * 强制终止登录检查会话
   */
  function terminateLoginCheckSession(accountId, reason = 'manual_refresh') {
    const session = loginCheckSessions.get(accountId);
    if (!session) return false;

    console.log(`[WechatLogin] 终止登录检查会话: accountId=${accountId}, reason=${reason}`);

    try {
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
      }
      if (session.proc?.pid) {
        stopProcessTree(session.proc.pid);
      } else if (session.proc && typeof session.proc.kill === 'function') {
        session.proc.kill();
      }
    } catch (err) {
      console.warn(`[WechatLogin] 终止登录检查会话失败: accountId=${accountId}, reason=${reason}, error=${err.message}`);
    }

    loginCheckSessions.delete(accountId);
    return true;
  }

  /**
   * 调度登录检查清理
   */
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

  /**
   * 检查微信登录状态
   */
  function checkWechatLogin(accountId, options = {}) {
    return new Promise((resolve, reject) => {
      const shouldPoll = options?.poll === true;
      const forceRefresh = options?.forceRefresh === true;
      const activeAccountRuntime = getActiveWechatRuntimeForAccount(accountId);
      if (activeAccountRuntime) {
        return reject(new Error('当前账号正在执行发布任务，无法测试登录'));
      }

      // 如果会话已存在，返回当前状态
      let existingSession = loginCheckSessions.get(accountId);
      if (existingSession) {
        if (forceRefresh) {
          console.log(`[WechatLogin] 强制刷新二维码: accountId=${accountId}, oldStatus=${existingSession.status}`);
          terminateLoginCheckSession(accountId, 'force_refresh');
          existingSession = null;
        }
      }

      if (existingSession) {
        existingSession.updatedAt = new Date().toISOString();
        if (existingSession.status === 'failed' || existingSession.status === 'expired') {
          finalizeLoginCheckSession(accountId);
          return reject(new Error(existingSession.error || '扫码登录已失效，请重新点击扫码'));
        }
        if (existingSession.status === 'logged_in') {
          return resolve({ success: true, status: 'logged_in' });
        }
        return resolve(buildLoginCheckResponse(existingSession));
      }

      // 无会话 — 如果只是轮询，返回 idle
      if (shouldPoll) {
        return resolve({ success: true, status: 'idle' });
      }

      // 启动新的登录检查（有头浏览器）
      const checkScript = path.join(publishCenterDir, 'wechat_check_login.py');
      const userDataDir = buildWechatProfileDir(accountId);
      if (!fs.existsSync(checkScript)) {
        return reject(new Error('检查登录的脚本不存在'));
      }

      const args = ['--user-data-dir', userDataDir, '--account-id', accountId];

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
        qrCodePath: '',
        message: '',
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
          session.qrCodePath = String(parsed.qrCodePath || '').trim();
          session.message = String(parsed.message || '').trim();
          session.error = '';
          resolveOnce(buildLoginCheckResponse(session));
          return true;
        }

        if (parsed.status === 'logged_in') {
          session.status = 'logged_in';
          session.error = '';
          resolveOnce({ success: true, status: 'logged_in' });
          // 保持会话足够长时间让前端轮询捕获
          scheduleLoginCheckCleanup(accountId, 15000);
          return true;
        }

        if (parsed.success === false) {
          session.status = parsed.status === 'expired' ? 'expired' : 'failed';
          session.error = parsed.error || '脚本执行失败';
          if (!settled) {
            rejectOnce(new Error(session.error));
          }
          finalizeLoginCheckSession(accountId);
          return true;
        }
        return false;
      };

      proc.stdout.on('data', d => {
        const text = d.toString();
        outBuffer += text;
        for (const line of text.split(/\r?\n/)) {
          if (handleJsonLine(line)) continue;
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
          // 进程退出但仍在等待扫码 — 二维码过期
          session.status = 'expired';
          session.error = '扫码超时，请重新点击扫码';
          scheduleLoginCheckCleanup(accountId, 2000);
        } else if (session.status === 'logged_in') {
          // 已由 handleJsonLine 处理 — 不缩短计时器
          if (!session.cleanupTimer) {
            scheduleLoginCheckCleanup(accountId, 15000);
          }
        } else {
          // 回退：尝试解析最后的输出
          finalizeLoginCheckSession(accountId);
        }

        // 如果尚未结算 HTTP 响应，则结算
        if (!settled) {
          try {
            for (const line of outBuffer.split(/\r?\n/)) {
              if (line.includes('"success":')) {
                const parsed = JSON.parse(line.trim());
                if (parsed.success !== undefined) {
                  if (parsed.success) {
                    resolveOnce(parsed);
                  } else {
                    rejectOnce(new Error(parsed.error || '脚本执行失败'));
                  }
                  return;
                }
              }
            }
          } catch (_e) {}
          rejectOnce(new Error(`登录检测脚本异常退出 (code ${code})`));
        }
      });
    });
  }

  return {
    checkWechatLogin,
    buildLoginCheckResponse,
    finalizeLoginCheckSession,
    scheduleLoginCheckCleanup,
    terminateLoginCheckSession
  };
}

module.exports = { createWechatLoginService };
