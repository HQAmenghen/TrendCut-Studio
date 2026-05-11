const fs = require('fs');
const path = require('path');

const TRANSLATE_TIMEOUT_MS = 300000;
const TRANSLATE_RETRY_COOLDOWN_MS = 120000;
const DEFAULT_PARTITION_ID = 'crypto';
const DEFAULT_PARTITIONS = [
  { id: 'crypto', label: '加密', description: 'Crypto / Web3 热点账号池' },
  { id: 'finance', label: '金融', description: '宏观、市场和金融账号池' },
  { id: 'tech', label: '科技', description: '科技产品和创业账号池' },
  { id: 'ai', label: 'AI', description: 'AI 模型、应用和研究账号池' }
];

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

function sanitizePartitionId(value, fallback = DEFAULT_PARTITION_ID) {
  const raw = String(value || '').trim().toLowerCase();
  const sanitized = raw
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return sanitized || fallback;
}

function sanitizePartitionLabel(value, fallback) {
  return String(value || fallback || '').trim().slice(0, 32) || fallback || '未命名分区';
}

function uniquePartitionId(candidateId, usedIds) {
  const base = sanitizePartitionId(candidateId, `partition-${usedIds.size + 1}`);
  let next = base;
  let suffix = 2;
  while (usedIds.has(next)) {
    next = sanitizePartitionId(`${base}-${suffix}`, `partition-${suffix}`);
    suffix += 1;
  }
  usedIds.add(next);
  return next;
}

function getDefaultPartitionMeta(partitionId) {
  return DEFAULT_PARTITIONS.find((item) => item.id === partitionId) || null;
}

function normalizePartitionConfig(rawPartition, index, options = {}) {
  const usedIds = options.usedIds || new Set();
  const fixedAccounts = sanitizeAccounts(options.fixedAccounts || []);
  const fallbackMeta = DEFAULT_PARTITIONS[index] || null;
  const id = uniquePartitionId(
    rawPartition?.id || rawPartition?.key || rawPartition?.slug || rawPartition?.label || fallbackMeta?.id,
    usedIds
  );
  const defaultMeta = getDefaultPartitionMeta(id) || fallbackMeta || {};
  const accountSource = Array.isArray(rawPartition?.accounts) ? rawPartition.accounts : [];
  const accounts = id === DEFAULT_PARTITION_ID
    ? sanitizeAccounts([...fixedAccounts, ...accountSource])
    : sanitizeAccounts(accountSource);

  return {
    id,
    label: sanitizePartitionLabel(rawPartition?.label || rawPartition?.name, defaultMeta.label || id),
    description: String(rawPartition?.description || defaultMeta.description || '').trim(),
    accounts
  };
}

function buildDefaultPartitions(accounts = []) {
  const fixedAccounts = sanitizeAccounts(accounts);
  const usedIds = new Set();
  return DEFAULT_PARTITIONS.map((partition, index) => normalizePartitionConfig({
    ...partition,
    accounts: index === 0 ? fixedAccounts : []
  }, index, { usedIds }));
}

function normalizeConfigPayload(payload, options = {}) {
  const fixedAccounts = sanitizeAccounts(options.fixedAccounts || []);
  const source = payload && typeof payload === 'object' ? payload : {};
  const usedIds = new Set();
  let partitions = [];

  if (Array.isArray(source.partitions)) {
    partitions = source.partitions
      .map((partition, index) => normalizePartitionConfig(partition, index, { usedIds, fixedAccounts }))
      .filter((partition) => partition.id);
  } else {
    partitions = buildDefaultPartitions(sanitizeAccounts([...(fixedAccounts || []), ...(source.accounts || [])]));
  }

  if (partitions.length === 0) {
    partitions = buildDefaultPartitions(fixedAccounts);
  }

  const requestedActive = sanitizePartitionId(source.activePartitionId || source.active_partition_id || source.partitionId || '', '');
  const activePartitionId = partitions.some((partition) => partition.id === requestedActive)
    ? requestedActive
    : partitions[0]?.id || DEFAULT_PARTITION_ID;
  const activePartition = partitions.find((partition) => partition.id === activePartitionId) || partitions[0] || null;

  return {
    activePartitionId,
    partitions,
    accounts: activePartition?.accounts || []
  };
}

function getPartitionFilePath(basePath, partitionId) {
  const id = sanitizePartitionId(partitionId);
  if (id === DEFAULT_PARTITION_ID) return basePath;
  const parsed = path.parse(basePath);
  return path.join(parsed.dir, `${parsed.name}.${id}${parsed.ext}`);
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
    sendProgressEvent,
    runPythonScript
  } = deps;

  let runningPartitionId = '';
  const translationStates = new Map();

  function getConfigPayload() {
    return readJsonIfExists(accountsPath, null) || {};
  }

  function readConfig() {
    return normalizeConfigPayload(getConfigPayload(), { fixedAccounts });
  }

  function resolvePartition(partitionId) {
    const config = readConfig();
    const requested = sanitizePartitionId(partitionId || config.activePartitionId || DEFAULT_PARTITION_ID);
    const partition = config.partitions.find((item) => item.id === requested)
      || config.partitions.find((item) => item.id === config.activePartitionId)
      || config.partitions[0]
      || normalizePartitionConfig({ id: DEFAULT_PARTITION_ID, label: '加密', accounts: fixedAccounts }, 0);
    return { config, partition };
  }

  function getPathsForPartition(partitionId) {
    const id = sanitizePartitionId(partitionId);
    return {
      resultPath: getPartitionFilePath(resultPath, id),
      partialPath: getPartitionFilePath(partialPath, id),
      logPath: getPartitionFilePath(logPath, id),
      errorLogPath: getPartitionFilePath(errorLogPath, id)
    };
  }

  function getTranslationState(partitionId) {
    const id = sanitizePartitionId(partitionId);
    if (!translationStates.has(id)) {
      translationStates.set(id, {
        running: false,
        lastError: '',
        lastStartedAt: null,
        lastFinishedAt: null,
        nextAttemptAt: 0
      });
    }
    return translationStates.get(id);
  }

  function getStatus(partitionId) {
    const { config, partition } = resolvePartition(partitionId);
    const paths = getPathsForPartition(partition.id);
    const partial = readJsonIfExists(paths.partialPath, null);
    const hasResult = fs.existsSync(paths.resultPath);
    const translationState = getTranslationState(partition.id);
    return {
      running: Boolean(runningPartitionId),
      runningPartitionId: runningPartitionId || null,
      partition,
      partitions: config.partitions,
      stage: partial?.stage || null,
      partial,
      hasResult,
      resultUpdatedAt: hasResult ? fs.statSync(paths.resultPath).mtime.toISOString() : null,
      translation: {
        running: translationState.running,
        lastError: translationState.lastError || null,
        lastStartedAt: translationState.lastStartedAt,
        lastFinishedAt: translationState.lastFinishedAt,
        nextAttemptAt: translationState.nextAttemptAt ? new Date(translationState.nextAttemptAt).toISOString() : null
      },
      logTail: tailLines(readTextIfExists(paths.logPath)),
      errorTail: tailLines(readTextIfExists(paths.errorLogPath))
    };
  }

  function needsTranslation(item) {
    const sourceText = item?.author_summary || item?.summary;
    const translatedText = item?.author_summary_zh;
    return Boolean(sourceText && (!translatedText || translatedText === sourceText));
  }

  function startBackgroundTranslation(partitionId) {
    const id = sanitizePartitionId(partitionId);
    const translationState = getTranslationState(id);
    const paths = getPathsForPartition(id);
    if (translationState.running || !fs.existsSync(translateScriptPath)) return;

    const now = Date.now();
    if (translationState.nextAttemptAt && now < translationState.nextAttemptAt) return;

    translationState.running = true;
    translationState.lastError = '';
    translationState.lastStartedAt = new Date(now).toISOString();
    translationState.lastFinishedAt = null;

    let translationPromise;
    try {
      translationPromise = runPythonScript(translateScriptPath, ['--result', paths.resultPath], {
        cwd: scriptCwd,
        timeout: TRANSLATE_TIMEOUT_MS
      });
    } catch (error) {
      translationState.running = false;
      translationState.lastFinishedAt = new Date().toISOString();
      translationState.lastError = error.details || error.message;
      translationState.nextAttemptAt = Date.now() + TRANSLATE_RETRY_COOLDOWN_MS;
      console.warn('translate xai result failed:', translationState.lastError);
      return;
    }

    Promise.resolve(translationPromise)
      .then(() => {
        translationState.running = false;
        translationState.lastFinishedAt = new Date().toISOString();
        translationState.nextAttemptAt = 0;
      })
      .catch((error) => {
        translationState.running = false;
        translationState.lastFinishedAt = new Date().toISOString();
        translationState.lastError = error.details || error.message;
        translationState.nextAttemptAt = Date.now() + TRANSLATE_RETRY_COOLDOWN_MS;
        console.warn('translate xai result failed:', translationState.lastError);
      });
  }

  function ensureTranslatedResult(partitionId) {
    const { partition } = resolvePartition(partitionId);
    const paths = getPathsForPartition(partition.id);
    if (!fs.existsSync(paths.resultPath)) {
      throw new Error('result.json 不存在');
    }
    const payload = JSON.parse(fs.readFileSync(paths.resultPath, 'utf-8'));
    payload.partition = payload.partition || {
      id: partition.id,
      label: partition.label,
      description: partition.description || ''
    };
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (items.some(needsTranslation)) startBackgroundTranslation(partition.id);
    return payload;
  }

  function writeConfig(input) {
    const source = Array.isArray(input) ? { accounts: input } : (input && typeof input === 'object' ? input : {});
    const config = normalizeConfigPayload(source, { fixedAccounts });
    const hasAccounts = config.partitions.some((partition) => partition.accounts.length > 0);
    if (!hasAccounts) {
      throw new Error('账号池不能为空');
    }
    fs.writeFileSync(accountsPath, JSON.stringify({
      activePartitionId: config.activePartitionId,
      partitions: config.partitions
    }, null, 2), 'utf-8');
    return config;
  }

  async function run(clientId, res, partitionId) {
    if (!clientId) {
      return sendError(res, { status: 400, code: 'XAI_CLIENT_ID_MISSING', stage: 'xai.run', error: '缺少 clientId' });
    }
    if (runningPartitionId) {
      return sendError(res, { status: 409, code: 'XAI_ALREADY_RUNNING', stage: 'xai.run', error: '榜单任务正在运行，请稍后再试' });
    }
    if (!fs.existsSync(scriptPath)) {
      return sendError(res, { status: 500, code: 'XAI_SCRIPT_MISSING', stage: 'xai.run', error: 'run_xai_top10.py 不存在，无法启动榜单任务' });
    }
    const { partition } = resolvePartition(partitionId);
    if (!partition.accounts.length) {
      return sendError(res, { status: 400, code: 'XAI_PARTITION_ACCOUNTS_EMPTY', stage: 'xai.run', error: `分区「${partition.label}」账号池为空，请先配置账号` });
    }
    const paths = getPathsForPartition(partition.id);

    const sse = getProgressClient(clientId);
    const pushEvent = (payload) => {
      if (sse) sendProgressEvent(sse, payload);
    };

    try {
      pushEvent({ type: 'progress', percent: 5, msg: `正在启动「${partition.label}」Top10 榜单任务...` });
      runningPartitionId = partition.id;

      const handleStreamLine = (line) => {
        const text = String(line || '').trim();
        if (!text) return;
        const lower = text.toLowerCase();
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
          pushEvent({ type: 'progress', percent, msg: text });
        } else {
          pushEvent({ type: 'status', msg: text });
        }
      };

      const resultPayload = await runPythonScript(scriptPath, [
        '--partition-id',
        partition.id,
        '--result',
        paths.resultPath,
        '--partial',
        paths.partialPath,
        '--log',
        paths.logPath,
        '--error-log',
        paths.errorLogPath
      ], {
        cwd: scriptCwd,
        onStdout: (chunk) => {
          const lines = String(chunk || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            handleStreamLine(line);
          }
        },
        onStderr: (chunk) => {
          const lines = String(chunk || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            handleStreamLine(line);
          }
        }
      });

      runningPartitionId = '';

      try {
        const result = ensureTranslatedResult(partition.id);
        const protocolMessage = resultPayload.protocol?.result?.message || `🎉 「${partition.label}」Top10 榜单已生成完成！`;
        pushEvent({ type: 'progress', percent: 100, msg: protocolMessage });
        if (!res.headersSent) {
          res.json({ success: true, result, status: getStatus(partition.id) });
        }
      } catch (err) {
        if (!res.headersSent) {
          sendError(res, { status: 500, code: 'XAI_RESULT_READ_FAILED', stage: 'xai.run', error: '任务完成但读取结果失败', details: err.message });
        }
      }
    } catch (error) {
      runningPartitionId = '';
      sendError(res, {
        status: 500,
        code: error.code || 'XAI_RUN_REQUEST_FAILED',
        stage: error.stage || 'xai.run',
        error: '启动 xai 榜单任务失败',
        details: error.details || error.message,
        hint: error.hint || ''
      });
    }
  }

  return {
    ensureTranslatedResult,
    getStatus,
    getPathsForPartition,
    readConfig,
    run,
    writeConfig
  };
}

module.exports = {
  createXaiService
};
