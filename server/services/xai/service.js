const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

function sanitizeAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  const seen = new Set();
  return accounts
    .map((account) => String(account || '').trim().replace(/^@+/, ''))
    .filter((account) => {
      if (!account) return false;
      if (seen.has(account)) return false;
      seen.add(account);
      return true;
    });
}

function createXaiService(deps) {
  const {
    sendError,
    resultPath,
    partialPath,
    logPath,
    errorLogPath,
    accountsPath,
    scriptPath,
    translateScriptPath,
    scriptCwd,
    fixedAccounts,
    readJsonIfExists,
    readTextIfExists,
    tailLines,
    getProgressClient,
    sendProgressEvent
  } = deps;

  let xaiTop10Process = null;

  function mergeAccounts(accounts) {
    return sanitizeAccounts([...(fixedAccounts || []), ...(Array.isArray(accounts) ? accounts : [])]);
  }

  function getStatus() {
    const partial = readJsonIfExists(partialPath, null);
    const hasResult = fs.existsSync(resultPath);
    return {
      running: !!xaiTop10Process,
      stage: partial?.stage || null,
      partial,
      hasResult,
      resultUpdatedAt: hasResult ? fs.statSync(resultPath).mtime.toISOString() : null,
      logTail: tailLines(readTextIfExists(logPath)),
      errorTail: tailLines(readTextIfExists(errorLogPath))
    };
  }

  function ensureTranslatedResult() {
    if (!fs.existsSync(resultPath)) {
      throw new Error('result.json 不存在');
    }
    const payload = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const needsTranslation = items.some((item) => (item?.author_summary || item?.summary) && !item?.author_summary_zh);
    if (!needsTranslation) return payload;
    if (!fs.existsSync(translateScriptPath)) return payload;

    const proc = spawnSync('python', [translateScriptPath, '--result', resultPath], {
      cwd: scriptCwd,
      encoding: 'utf-8'
    });

    if (proc.status !== 0) {
      console.warn('translate xai result failed:', proc.stderr || proc.stdout);
      return payload;
    }
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }

  function readConfig() {
    const payload = readJsonIfExists(accountsPath, { accounts: [] }) || { accounts: [] };
    return { accounts: mergeAccounts(payload.accounts || []) };
  }

  function writeConfig(inputAccounts) {
    const accounts = mergeAccounts(inputAccounts || []);
    if (accounts.length === 0) {
      throw new Error('账号池不能为空');
    }
    fs.writeFileSync(accountsPath, JSON.stringify({ accounts }, null, 2), 'utf-8');
    return { accounts };
  }

  async function run(clientId, res) {
    if (!clientId) {
      return sendError(res, { status: 400, code: 'XAI_CLIENT_ID_MISSING', stage: 'xai.run', error: '缺少 clientId' });
    }
    if (xaiTop10Process) {
      return sendError(res, { status: 409, code: 'XAI_ALREADY_RUNNING', stage: 'xai.run', error: '榜单任务正在运行，请稍后再试' });
    }
    if (!fs.existsSync(scriptPath)) {
      return sendError(res, { status: 500, code: 'XAI_SCRIPT_MISSING', stage: 'xai.run', error: 'run_xai_top10.py 不存在，无法启动榜单任务' });
    }

    const sse = getProgressClient(clientId);
    const pushEvent = (payload) => {
      if (sse) sendProgressEvent(sse, payload);
    };

    try {
      pushEvent({ type: 'progress', percent: 5, msg: '正在启动 XAI Top10 榜单任务...' });
      xaiTop10Process = spawn('python', [scriptPath], { cwd: scriptCwd });

      let stdout = '';
      let stderr = '';

      xaiTop10Process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      xaiTop10Process.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          const lower = line.toLowerCase();
          const percent = lower.includes('candidate scan complete')
            ? 35
            : lower.includes('starting enrich stage')
              ? 45
              : lower.includes('enrich ')
                ? 60
                : lower.includes('starting followers stage')
                  ? 80
                  : lower.includes('run finished')
                    ? 100
                    : null;
          if (percent !== null) {
            pushEvent({ type: 'progress', percent, msg: line });
          } else {
            pushEvent({ type: 'status', msg: line });
          }
        }
      });

      xaiTop10Process.on('error', (error) => {
        xaiTop10Process = null;
        console.error('xai top10 spawn error:', error);
        if (!res.headersSent) {
          sendError(res, { status: 500, code: 'XAI_SPAWN_FAILED', stage: 'xai.run', error: 'XAI 榜单任务启动失败', details: error.message });
        }
      });

      xaiTop10Process.on('close', (code) => {
        xaiTop10Process = null;
        if (code !== 0) {
          console.error('xai top10 failed:', stderr || stdout);
          if (!res.headersSent) {
            sendError(res, { status: 500, code: 'XAI_RUN_FAILED', stage: 'xai.run', error: 'xai top10 执行失败', details: stderr.trim() || stdout.trim() });
          }
          return;
        }

        try {
          const result = ensureTranslatedResult();
          pushEvent({ type: 'progress', percent: 100, msg: '🎉 Top10 榜单已生成完成！' });
          if (!res.headersSent) {
            res.json({ success: true, result, status: getStatus() });
          }
        } catch (err) {
          if (!res.headersSent) {
            sendError(res, { status: 500, code: 'XAI_RESULT_READ_FAILED', stage: 'xai.run', error: '任务完成但读取结果失败', details: err.message });
          }
        }
      });
    } catch (error) {
      xaiTop10Process = null;
      sendError(res, { status: 500, code: 'XAI_RUN_REQUEST_FAILED', stage: 'xai.run', error: '启动 xai 榜单任务失败', details: error.message });
    }
  }

  return {
    ensureTranslatedResult,
    getStatus,
    readConfig,
    run,
    writeConfig
  };
}

module.exports = {
  createXaiService
};
