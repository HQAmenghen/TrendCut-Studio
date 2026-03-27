function createPublishStore(deps) {
  const {
    publishConfigPath,
    publishJobsPath,
    wechatAccountFields,
    readJsonIfExists,
    writeJsonFile,
    deepClone,
    makeJobId,
    buildPublishTask
  } = deps;

  
  const Database = require('better-sqlite3');
  const pathLib = require('path');
  const fsLib = require('fs');

  const dbPath = publishJobsPath.replace('.json', '.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS publish_jobs_v1 (
      id TEXT PRIMARY KEY,
      data JSON,
      updatedAt TEXT
    );
  `);

  if (fsLib.existsSync(publishJobsPath)) {
    try {
      const oldPayload = readJsonIfExists(publishJobsPath, { jobs: [] });
      if (Array.isArray(oldPayload.jobs) && oldPayload.jobs.length > 0) {
        const stmt = db.prepare('INSERT OR IGNORE INTO publish_jobs_v1 (id, data, updatedAt) VALUES (?, ?, ?)');
        const insertMany = db.transaction((jobs) => {
          for (const job of jobs) {
            stmt.run(job.id, JSON.stringify(job), job.updatedAt || new Date().toISOString());
          }
        });
        insertMany(oldPayload.jobs);
      }
      fsLib.renameSync(publishJobsPath, publishJobsPath + '.bak');
      console.log('Migrated publish_jobs.json to SQLite database.');
    } catch(err) {
      console.error('Migration to SQLite failed:', err);
    }
  }

  function readPublishJobs() {
    try {
      const rows = db.prepare('SELECT data FROM publish_jobs_v1 ORDER BY updatedAt DESC').all();
      const jobs = rows.map(r => JSON.parse(r.data));
      const raw = { jobs };
      const { payload, changed } = sanitizePublishJobPayload(raw);
      if (changed) {
         writePublishJobs(payload);
      }
      return payload;
    } catch(err) {
      console.error('SQLite read error:', err);
      return { jobs: [] };
    }
  }

  function writePublishJobs(payload) {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO publish_jobs_v1 (id, data, updatedAt) VALUES (?, ?, ?)');
      const replaceAll = db.transaction((jobs) => {
        db.prepare('DELETE FROM publish_jobs_v1').run();
        for (const job of jobs) {
          stmt.run(job.id, JSON.stringify(job), job.updatedAt || new Date().toISOString());
        }
      });
      replaceAll(payload.jobs || []);
    } catch(err) {
      console.error('SQLite write error:', err);
    }
  }

  function updatePublishJob(jobId, updater) {
    let row;
    try {
      row = db.prepare('SELECT data FROM publish_jobs_v1 WHERE id = ?').get(jobId);
    } catch(e) {}
    if (!row) {
      throw new Error('发布任务不存在');
    }
    const current = JSON.parse(row.data);
    const next = updater ? updater(deepClone(current)) || current : current;
    next.updatedAt = new Date().toISOString();
    
    db.prepare('UPDATE publish_jobs_v1 SET data = ?, updatedAt = ? WHERE id = ?').run(
      JSON.stringify(next), next.updatedAt, jobId
    );
    return next;
  }


  function createEmptyWechatAccount() {
    return {
      id: makeJobId(),
      displayName: '',
      finderUserName: '',
      helperAccount: '',
      openPlatformAppId: '',
      appId: '',
      appSecret: '',
      refreshToken: '',
      accountId: '',
      notes: ''
    };
  }

  function sanitizeWechatAccounts(accounts) {
    const source = Array.isArray(accounts) ? accounts : [];
    const seen = new Set();
    const sanitized = [];
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      const next = createEmptyWechatAccount();
      const candidateId = String(item.id || '').trim() || makeJobId();
      const id = seen.has(candidateId) ? makeJobId() : candidateId;
      seen.add(id);
      next.id = id;
      for (const field of wechatAccountFields) {
        next[field] = String(item[field] ?? '').trim();
      }
      sanitized.push(next);
    }
    return sanitized;
  }

  function normalizePublishConfig(config) {
    const base = {
      global: {
        autoPilotEnabled: false,
        autoPilotFetchTime: '07:30',
        autoPilotTime: '08:00',
        autoPilotCount: 1,
        autoPilotAccountIds: [],
        autoPilotUseCurrentRanking: false
      },
      wechatChannels: { enabled: false, accounts: [] },
      douyin: { enabled: false, displayName: '', clientKey: '', clientSecret: '', accessToken: '', openId: '', notes: '' },
      xiaohongshu: { enabled: false, displayName: '', appId: '', appSecret: '', accessToken: '', accountId: '', notes: '' },
      x: { enabled: false, displayName: '', apiKey: '', apiSecret: '', accessToken: '', accessSecret: '', bearerToken: '', notes: '' },
      youtube: { enabled: false, displayName: '', clientId: '', clientSecret: '', refreshToken: '', channelId: '', notes: '' }
    };
    const source = config && typeof config === 'object' ? config : {};
    const next = deepClone(base);

    const incomingGlobal = source?.global;
    if (incomingGlobal && typeof incomingGlobal === 'object') {
      next.global.autoPilotEnabled = Boolean(incomingGlobal.autoPilotEnabled);
      next.global.autoPilotFetchTime = String(incomingGlobal.autoPilotFetchTime || '07:30').trim();
      next.global.autoPilotTime = String(incomingGlobal.autoPilotTime || '08:00').trim();
      next.global.autoPilotCount = Math.max(1, Math.min(10, parseInt(incomingGlobal.autoPilotCount || 1, 10)));
      next.global.autoPilotAccountIds = Array.isArray(incomingGlobal.autoPilotAccountIds) ? incomingGlobal.autoPilotAccountIds.map(s => String(s || '').trim()) : [];
      next.global.autoPilotTimes = Array.isArray(incomingGlobal.autoPilotTimes) ? incomingGlobal.autoPilotTimes.map(s => String(s || '').trim()) : [];
      next.global.autoPilotUseCurrentRanking = Boolean(incomingGlobal.autoPilotUseCurrentRanking);
    }

    for (const platform of ['douyin', 'xiaohongshu', 'x', 'youtube']) {
      const incoming = source?.[platform];
      if (!incoming || typeof incoming !== 'object') continue;
      for (const key of Object.keys(next[platform])) {
        if (incoming[key] === undefined) continue;
        next[platform][key] = typeof next[platform][key] === 'boolean'
          ? Boolean(incoming[key])
          : String(incoming[key] ?? '').trim();
      }
    }

    const incomingWechat = source?.wechatChannels;
    if (incomingWechat && typeof incomingWechat === 'object') {
      next.wechatChannels.enabled = Boolean(incomingWechat.enabled);
      if (Array.isArray(incomingWechat.accounts)) {
        next.wechatChannels.accounts = sanitizeWechatAccounts(incomingWechat.accounts);
      } else {
        const legacy = createEmptyWechatAccount();
        let hasLegacyValue = false;
        for (const field of wechatAccountFields) {
          const value = String(incomingWechat[field] ?? '').trim();
          legacy[field] = value;
          if (value) hasLegacyValue = true;
        }
        next.wechatChannels.accounts = hasLegacyValue ? sanitizeWechatAccounts([legacy]) : [];
      }
    }

    return next;
  }

  function getWechatAccountMap(config = readPublishConfig()) {
    const accounts = Array.isArray(config?.wechatChannels?.accounts) ? config.wechatChannels.accounts : [];
    return new Map(accounts.map((account) => [String(account.id || '').trim(), account]).filter(([id]) => id));
  }

  function readPublishConfig() {
    const raw = readJsonIfExists(publishConfigPath, null);
    const normalized = normalizePublishConfig(raw);
    if (JSON.stringify(raw || {}) !== JSON.stringify(normalized)) {
      writeJsonFile(publishConfigPath, normalized);
    }
    return normalized;
  }

  function writePublishConfig(config) {
    writeJsonFile(publishConfigPath, normalizePublishConfig(config));
  }

  function sanitizePublishDescriptionText(text, options = {}) {
    const preserveTags = options?.preserveTags === true;
    return String(text || '')
      .replace(preserveTags ? /$^/g : /\s*#[^\s#]+/g, '')
      .replace(/\n*\s*更多内容发布与分发由 AI 中台自动整理。\s*$/g, '')
      .trim();
  }

  function sanitizePublishJobPayload(payload) {
    const next = deepClone(payload || { jobs: [] });
    let changed = false;
    next.jobs = Array.isArray(next.jobs) ? next.jobs : [];
    for (const job of next.jobs) {
      const preserveTags = job?.publishData?.tagStrategy === 'model';
      const assetDescription = job?.asset?.metadata?.suggestedDescription;
      const nextAssetDescription = sanitizePublishDescriptionText(assetDescription, { preserveTags });
      if (assetDescription !== undefined && nextAssetDescription !== assetDescription) {
        job.asset.metadata.suggestedDescription = nextAssetDescription;
        changed = true;
      }

      const publishDescription = job?.publishData?.description;
      const nextPublishDescription = sanitizePublishDescriptionText(publishDescription, { preserveTags });
      if (publishDescription !== undefined && nextPublishDescription !== publishDescription) {
        job.publishData.description = nextPublishDescription;
        changed = true;
      }

      for (const task of Array.isArray(job?.platformTasks) ? job.platformTasks : []) {
        const taskDescription = task?.description;
        const nextTaskDescription = sanitizePublishDescriptionText(taskDescription, { preserveTags });
        if (taskDescription !== undefined && nextTaskDescription !== taskDescription) {
          task.description = nextTaskDescription;
          changed = true;
        }
      }
    }
    return { payload: next, changed };
  }

  
  function getJobTerminalStatus(job) {
    const tasks = Array.isArray(job?.platformTasks) ? job.platformTasks : [];
    if (!tasks.length) return job?.status || 'pending';
    const states = tasks.map((task) => String(task?.runtime?.state || task?.status || ''));
    if (states.some((state) => ['published', 'success'].includes(state))) return 'published';
    if (states.some((state) => state === 'ready_for_manual_publish')) return 'ready_for_manual_publish';
    if (states.some((state) => state === 'cancelled')) return 'cancelled';
    if (states.some((state) => state === 'failed')) return 'failed';
    if (states.some((state) => ['publishing', 'editing', 'uploaded', 'processing', 'uploading', 'starting', 'navigating', 'login_ready', 'need_login', 'draft_preparing', 'edited'].includes(state))) return 'running';
    if (job?.platformErrors?.length) return 'partial_ready';
    return job?.status || 'ready';
  }

  
  function updatePublishPlatformTask(jobId, platformKey, patch) {
    return updatePublishJob(jobId, (job) => {
      const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
      const task = tasks.find((item) => item.platform === platformKey);
      if (!task) throw new Error(`发布任务中不存在平台 ${platformKey}`);
      const nextPatch = { ...(patch || {}) };
      if (nextPatch.runtime && typeof nextPatch.runtime === 'object') {
        const previousRuntime = task.runtime && typeof task.runtime === 'object' ? task.runtime : {};
        nextPatch.runtime = {
          ...previousRuntime,
          ...nextPatch.runtime
        };
        if (nextPatch.runtime.logs === undefined && Array.isArray(previousRuntime.logs)) {
          nextPatch.runtime.logs = previousRuntime.logs;
        }
      }
      if (nextPatch.publishResult && typeof nextPatch.publishResult === 'object') {
        const previousResult = task.publishResult && typeof task.publishResult === 'object' ? task.publishResult : {};
        nextPatch.publishResult = {
          ...previousResult,
          ...nextPatch.publishResult
        };
      }
      Object.assign(task, nextPatch);
      return job;
    });
  }

  function archivePublishJob(jobId, archived = true) {
    return updatePublishJob(jobId, (job) => {
      job.archived = !!archived;
      job.archivedAt = archived ? new Date().toISOString() : null;
      return job;
    });
  }

  function archiveCompletedPublishJobs() {
    const payload = readPublishJobs();
    let changed = false;
    payload.jobs = (payload.jobs || []).map((job) => {
      if (job.archived) return job;
      const status = getJobTerminalStatus(job);
      if (['published', 'ready_for_manual_publish', 'failed', 'cancelled'].includes(status)) {
        changed = true;
        return {
          ...job,
          archived: true,
          archivedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      return job;
    });
    if (changed) writePublishJobs(payload);
    return payload;
  }

  function maskSecretValue(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 6) return '*'.repeat(text.length);
    return `${text.slice(0, 3)}***${text.slice(-2)}`;
  }

  function maskPlatformConfig(config) {
    const payload = deepClone(config);
    const secretKeys = new Set(['appSecret', 'refreshToken', 'clientSecret', 'accessToken', 'apiKey', 'apiSecret', 'accessSecret', 'bearerToken']);
    for (const platform of Object.keys(payload)) {
      if (platform === 'wechatChannels') {
        payload.wechatChannels.accounts = (payload.wechatChannels.accounts || []).map((account) => {
          const next = { ...account };
          for (const key of Object.keys(next)) {
            if (secretKeys.has(key)) {
              next[`${key}Masked`] = maskSecretValue(next[key]);
            }
          }
          return next;
        });
        continue;
      }
      for (const key of Object.keys(payload[platform] || {})) {
        if (secretKeys.has(key)) {
          payload[platform][`${key}Masked`] = maskSecretValue(payload[platform][key]);
        }
      }
    }
    return payload;
  }

  const platformFieldLabels = {
    wechatChannels: {
      finderUserName: '视频号 ID / Finder User Name',
      helperAccount: '视频号助手账号 / Helper Account',
      openPlatformAppId: '开放平台 AppID / Open Platform App ID',
      appId: '应用 ID / App ID',
      appSecret: '应用密钥 / App Secret',
      refreshToken: '刷新令牌 / Refresh Token',
      accountId: '账号 ID / Account ID'
    },
    douyin: {
      clientKey: '客户端 Key / Client Key',
      clientSecret: '客户端密钥 / Client Secret',
      accessToken: '访问令牌 / Access Token',
      openId: '用户 OpenID / Open ID'
    },
    xiaohongshu: {
      appId: '应用 ID / App ID',
      appSecret: '应用密钥 / App Secret',
      accessToken: '访问令牌 / Access Token',
      accountId: '账号 ID / Account ID'
    },
    x: {
      apiKey: 'API Key / API Key',
      apiSecret: 'API Secret / API Secret',
      accessToken: '访问令牌 / Access Token',
      accessSecret: '访问密钥 / Access Secret',
      bearerToken: 'Bearer Token / Bearer Token'
    },
    youtube: {
      clientId: '客户端 ID / Client ID',
      clientSecret: '客户端密钥 / Client Secret',
      refreshToken: '刷新令牌 / Refresh Token',
      channelId: '频道 ID / Channel ID'
    }
  };

  function formatPlatformFieldLabel(platformKey, fieldKey) {
    return platformFieldLabels?.[platformKey]?.[fieldKey] || fieldKey;
  }

  function collectPlatformValidation(platformKey, platformConfig, requiredFields = []) {
    const missingFields = (requiredFields || []).filter((field) => !String(platformConfig?.[field] || '').trim());
    return {
      missingFields,
      missingFieldLabels: missingFields.map((field) => formatPlatformFieldLabel(platformKey, field))
    };
  }

  function sanitizePlatformConfigInput(input) {
    const current = readPublishConfig();
    const next = deepClone(current);
    const incomingGlobal = input?.global;
    if (incomingGlobal && typeof incomingGlobal === 'object') {
      next.global.autoPilotEnabled = Boolean(incomingGlobal.autoPilotEnabled);
      next.global.autoPilotFetchTime = String(incomingGlobal.autoPilotFetchTime || next.global.autoPilotFetchTime || '07:30').trim();
      next.global.autoPilotTime = String(incomingGlobal.autoPilotTime || next.global.autoPilotTime || '08:00').trim();
      next.global.autoPilotCount = Math.max(1, Math.min(10, parseInt(incomingGlobal.autoPilotCount || next.global.autoPilotCount || 1, 10)));
      next.global.autoPilotAccountIds = Array.isArray(incomingGlobal.autoPilotAccountIds)
        ? incomingGlobal.autoPilotAccountIds.map((item) => String(item || '').trim())
        : [];
      next.global.autoPilotTimes = Array.isArray(incomingGlobal.autoPilotTimes)
        ? incomingGlobal.autoPilotTimes.map((item) => String(item || '').trim())
        : [];
      next.global.autoPilotUseCurrentRanking = Boolean(incomingGlobal.autoPilotUseCurrentRanking);
    }
    for (const platform of Object.keys(next)) {
      if (platform === 'global') continue;
      const source = input?.[platform];
      if (!source || typeof source !== 'object') continue;
      if (platform === 'wechatChannels') {
        next.wechatChannels.enabled = Boolean(source.enabled);
        next.wechatChannels.accounts = sanitizeWechatAccounts(source.accounts);
        continue;
      }
      for (const key of Object.keys(next[platform])) {
        if (source[key] === undefined) continue;
        next[platform][key] = typeof next[platform][key] === 'boolean'
          ? Boolean(source[key])
          : String(source[key] ?? '').trim();
      }
    }
    return next;
  }

  function validateWechatTaskConfig(platformConfig, task) {
    const accountId = String(task?.accountId || '').trim();
    if (!accountId) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const accountMap = getWechatAccountMap({ wechatChannels: platformConfig });
    const account = accountMap.get(accountId) || null;
    if (!account) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const baseValidation = collectPlatformValidation('wechatChannels', account, task.requiredFields || []);
    return {
      ...baseValidation,
      account
    };
  }

  function reconcilePlatformTask(platformKey, existingTask, publishData, assetUrl, platformConfig, selection = {}) {
    const preservedOptions = platformKey === 'wechatChannels'
      ? {
          accountId: String(selection?.accountId || existingTask?.accountId || '').trim(),
          accountLabel: String(selection?.accountLabel || existingTask?.accountLabel || '').trim()
        }
      : {};
    const rebuiltTask = buildPublishTask(platformKey, publishData, assetUrl, platformConfig, preservedOptions);
    const validation = platformKey === 'wechatChannels'
      ? validateWechatTaskConfig(platformConfig, rebuiltTask)
      : collectPlatformValidation(platformKey, platformConfig, rebuiltTask.requiredFields || []);
    const activeStatuses = new Set(['draft_preparing', 'publishing', 'need_login', 'uploading', 'processing', 'ready_to_publish', 'success', 'scheduled_wait']);

    if (validation.missingFields.length > 0) {
      rebuiltTask.status = 'config_missing';
    } else if (existingTask?.status && activeStatuses.has(existingTask.status)) {
      rebuiltTask.status = existingTask.status;
    }

    if (platformKey === 'wechatChannels' && validation.account) {
      rebuiltTask.accountLabel = validation.account.displayName || validation.account.helperAccount || validation.account.finderUserName || rebuiltTask.accountLabel || '';
    }
    rebuiltTask.runtime = existingTask?.runtime || rebuiltTask.runtime || null;
    rebuiltTask.validation = validation;
    return rebuiltTask;
  }

  function reconcilePublishJob(job, config) {
    const platformTasks = [];
    const platformErrors = [];
    const selectedPlatforms = Array.isArray(job.selectedPlatforms) ? job.selectedPlatforms : [];
    const platformSelections = job.platformSelections && typeof job.platformSelections === 'object' ? job.platformSelections : {};

    for (const platformKey of selectedPlatforms) {
      const platformConfig = config?.[platformKey];
      const existingTask = (job.platformTasks || []).find((item) => item.platform === platformKey);

      if (!platformConfig) {
        platformErrors.push({ platform: platformKey, error: '未知平台', missingFields: [], missingFieldLabels: [] });
        continue;
      }

      if (!platformConfig.enabled) {
        platformErrors.push({ platform: platformKey, error: '该平台尚未启用', missingFields: [], missingFieldLabels: [] });
        if (existingTask) {
          platformTasks.push({ ...existingTask, status: 'disabled' });
        }
        continue;
      }

      const selection = platformSelections?.[platformKey] || {};
      const baseTask = existingTask
        ? { ...existingTask, accountId: selection.accountId || existingTask.accountId || '', accountLabel: selection.accountLabel || existingTask.accountLabel || '' }
        : existingTask;
      const task = reconcilePlatformTask(platformKey, baseTask, job.publishData || {}, job.asset?.url || '', platformConfig, selection);
      if (task.validation?.missingFields?.length) {
        platformErrors.push({
          platform: platformKey,
          error: `缺少配置字段：${task.validation.missingFieldLabels.join('，')}`,
          missingFields: task.validation.missingFields,
          missingFieldLabels: task.validation.missingFieldLabels
        });
      }
      platformTasks.push(task);
    }

    const nextStatus = (
      String(job?.status || '').trim() === 'scheduled_wait'
      && !platformErrors.length
      && job?.scheduledTime
    )
      ? 'scheduled_wait'
      : (platformErrors.length > 0 ? 'partial_ready' : 'ready');

    return {
      ...job,
      updatedAt: new Date().toISOString(),
      status: nextStatus,
      platformTasks,
      platformErrors
    };
  }

  function reconcileAndPersistPublishJobs(config) {
    const payload = readPublishJobs();
    payload.jobs = (payload.jobs || []).map((job) => reconcilePublishJob(job, config));
    writePublishJobs(payload);
    return payload;
  }

  function getDueScheduledJobs(timestamp) {
    try {
      const dbDate = new Date(timestamp).toISOString();
      const rows = db.prepare(`
        SELECT data FROM publish_jobs_v1 
        WHERE json_extract(data, '$.status') = 'scheduled_wait' 
          AND datetime(json_extract(data, '$.scheduledTime')) <= datetime(?)
      `).all(dbDate);
      return rows.map(r => JSON.parse(r.data));
    } catch(err) {
      console.error('SQLite query error for scheduled jobs:', err);
      return [];
    }
  }

  return {
    getWechatAccountMap,
    readPublishConfig,
    writePublishConfig,
    readPublishJobs,
    writePublishJobs,
    updatePublishJob,
    updatePublishPlatformTask,
    archivePublishJob,
    archiveCompletedPublishJobs,
    maskPlatformConfig,
    collectPlatformValidation,
    sanitizePlatformConfigInput,
    validateWechatTaskConfig,
    reconcileAndPersistPublishJobs,
    getDueScheduledJobs,
    makeJobId
  };
}

module.exports = {
  createPublishStore
};
