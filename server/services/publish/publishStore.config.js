/**
 * Publish Store 配置管理模块
 *
 * 职责：
 * - 平台配置读写
 * - 配置规范化和验证
 * - 敏感信息掩码
 * - WeChat 账号管理
 */

function createPublishConfigService(deps) {
  const {
    publishConfigPath,
    wechatAccountFields,
    readJsonIfExists,
    writeJsonFile,
    deepClone,
    makeJobId
  } = deps;

  const autoPilotPlatformKeys = ['wechatChannels', 'douyin', 'xiaohongshu'];
  const defaultAutoPilotPlatforms = ['wechatChannels'];

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

  /**
   * 创建空的 WeChat 账号
   */
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

  /**
   * 清理 WeChat 账号列表
   */
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

  function sanitizeAutoPilotPipelineModes(value, fallback = 'vertical') {
    const allowedModes = new Set(['vertical', 'avatar']);
    const source = Array.isArray(value) ? value : [fallback];
    const modes = [];
    for (const item of source) {
      const mode = String(item || '').trim();
      if (allowedModes.has(mode) && !modes.includes(mode)) {
        modes.push(mode);
      }
    }
    return modes.length ? modes : ['vertical'];
  }

  function sanitizeAutoPilotSourceRanks(value) {
    const source = Array.isArray(value) ? value : [];
    return source.map((rank) => {
      const parsed = parseInt(rank, 10);
      if (!Number.isFinite(parsed)) return '';
      return String(Math.max(1, Math.min(10, parsed)));
    });
  }

  function trimTrailingEmptyValues(items = []) {
    const values = Array.isArray(items) ? [...items] : [];
    while (values.length > 0) {
      const last = values[values.length - 1];
      const empty = Array.isArray(last)
        ? last.length === 0
        : !String(last || '').trim();
      if (!empty) break;
      values.pop();
    }
    return values;
  }

  function sanitizeAutoPilotPlatformSelection(value, fallback = defaultAutoPilotPlatforms) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(',').map((item) => item.trim());
    const selected = [];
    for (const item of source) {
      const platformKey = String(item || '').trim();
      if (autoPilotPlatformKeys.includes(platformKey) && !selected.includes(platformKey)) {
        selected.push(platformKey);
      }
    }
    if (selected.length) return selected;
    return Array.isArray(fallback) ? [...fallback] : [...defaultAutoPilotPlatforms];
  }

  function sanitizeAutoPilotPlatformRows(value) {
    if (!Array.isArray(value)) return [];
    return trimTrailingEmptyValues(value.map((item) => sanitizeAutoPilotPlatformSelection(item, [])));
  }

  function sanitizeAutoPilotModeSchedules(value, fallback = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const schedules = {};
    for (const mode of ['vertical', 'avatar']) {
      const item = source[mode] && typeof source[mode] === 'object' ? source[mode] : {};
      const fallbackItem = fallbackSource[mode] && typeof fallbackSource[mode] === 'object' ? fallbackSource[mode] : {};
      const accountIds = Array.isArray(item.accountIds)
        ? trimTrailingEmptyValues(item.accountIds.map((accountId) => String(accountId || '').trim()))
        : (Array.isArray(fallbackItem.accountIds) ? trimTrailingEmptyValues(fallbackItem.accountIds.map((accountId) => String(accountId || '').trim())) : []);
      const times = Array.isArray(item.times)
        ? trimTrailingEmptyValues(item.times.map((time) => String(time || '').trim()))
        : (Array.isArray(fallbackItem.times) ? trimTrailingEmptyValues(fallbackItem.times.map((time) => String(time || '').trim())) : []);
      const partitionIds = Array.isArray(item.partitionIds)
        ? trimTrailingEmptyValues(item.partitionIds.map((partitionId) => String(partitionId || '').trim()))
        : (Array.isArray(fallbackItem.partitionIds) ? trimTrailingEmptyValues(fallbackItem.partitionIds.map((partitionId) => String(partitionId || '').trim())) : []);
      const sourceRanks = Array.isArray(item.sourceRanks)
        ? trimTrailingEmptyValues(sanitizeAutoPilotSourceRanks(item.sourceRanks))
        : (Array.isArray(fallbackItem.sourceRanks) ? trimTrailingEmptyValues(sanitizeAutoPilotSourceRanks(fallbackItem.sourceRanks)) : []);
      let platforms = Array.isArray(item.platforms)
        ? sanitizeAutoPilotPlatformRows(item.platforms)
        : (Array.isArray(fallbackItem.platforms) ? sanitizeAutoPilotPlatformRows(fallbackItem.platforms) : []);
      const schedule = {
        accountIds,
        times,
        partitionIds,
        sourceRanks,
        platforms
      };
      if (!schedule.sourceRanks.length) {
        const plannedCount = Math.max(schedule.accountIds.length, schedule.times.length, schedule.partitionIds.length, schedule.platforms.length);
        schedule.sourceRanks = Array.from({ length: plannedCount }, () => '1');
      }
      if (!schedule.platforms.length) {
        const plannedCount = Math.max(schedule.accountIds.length, schedule.times.length, schedule.partitionIds.length, schedule.sourceRanks.length);
        platforms = Array.from({ length: plannedCount }, () => [...defaultAutoPilotPlatforms]);
        schedule.platforms = platforms;
      }
      schedules[mode] = schedule;
    }
    return schedules;
  }

  /**
   * 规范化发布配置
   */
  function normalizePublishConfig(config) {
    const base = {
      global: {
        autoPilotEnabled: false,
        autoPilotFetchTime: '07:30',
        autoPilotTime: '08:00',
        autoPilotCount: 1,
        autoPilotAccountIds: [],
        autoPilotTimes: [],
        autoPilotModeSchedules: {
          vertical: { accountIds: [], times: [], partitionIds: [], sourceRanks: [], platforms: [] },
          avatar: { accountIds: [], times: [], partitionIds: [], sourceRanks: [], platforms: [] }
        },
        autoPilotUseCurrentRanking: false,
        autoPilotPartitionId: 'crypto',
        autoArchiveEnabled: true,
        autoArchiveDelayMinutes: 30,
        pipelineMode: 'vertical',
        autoPilotPipelineModes: ['vertical'],
        avatarPipelineConfig: {}
      },
      wechatChannels: { enabled: false, accounts: [] },
      douyin: { enabled: false, displayName: '', sauAccountName: '', clientKey: '', clientSecret: '', accessToken: '', openId: '', notes: '' },
      xiaohongshu: { enabled: false, displayName: '', sauAccountName: '', appId: '', appSecret: '', accessToken: '', accountId: '', notes: '' },
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
      next.global.pipelineMode = String(incomingGlobal.pipelineMode || 'vertical').trim() || 'vertical';
      next.global.autoPilotModeSchedules = sanitizeAutoPilotModeSchedules(incomingGlobal.autoPilotModeSchedules, {
        vertical: {
          accountIds: next.global.autoPilotAccountIds,
          times: next.global.autoPilotTimes,
          partitionIds: [],
          sourceRanks: []
        },
        avatar: {
          accountIds: next.global.pipelineMode === 'avatar' ? next.global.autoPilotAccountIds : [],
          times: next.global.pipelineMode === 'avatar' ? next.global.autoPilotTimes : [],
          partitionIds: [],
          sourceRanks: []
        }
      });
      next.global.autoPilotUseCurrentRanking = Boolean(incomingGlobal.autoPilotUseCurrentRanking);
      next.global.autoPilotPartitionId = String(incomingGlobal.autoPilotPartitionId || next.global.autoPilotPartitionId || 'crypto').trim() || 'crypto';
      next.global.autoArchiveEnabled = incomingGlobal.autoArchiveEnabled !== undefined ? Boolean(incomingGlobal.autoArchiveEnabled) : true;
      next.global.autoArchiveDelayMinutes = Math.max(0, parseInt(incomingGlobal.autoArchiveDelayMinutes || 30, 10));
      next.global.autoPilotPipelineModes = incomingGlobal.autoPilotPipelineModes !== undefined
        ? sanitizeAutoPilotPipelineModes(incomingGlobal.autoPilotPipelineModes, next.global.pipelineMode)
        : sanitizeAutoPilotPipelineModes(next.global.autoPilotPipelineModes, next.global.pipelineMode);
      if (incomingGlobal.avatarPipelineConfig && typeof incomingGlobal.avatarPipelineConfig === 'object') {
        next.global.avatarPipelineConfig = deepClone(incomingGlobal.avatarPipelineConfig);
      }
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

  /**
   * 获取 WeChat 账号映射
   */
  function getWechatAccountMap(config = readPublishConfig()) {
    const accounts = Array.isArray(config?.wechatChannels?.accounts) ? config.wechatChannels.accounts : [];
    return new Map(accounts.map((account) => [String(account.id || '').trim(), account]).filter(([id]) => id));
  }

  /**
   * 读取发布配置
   */
  function readPublishConfig() {
    const raw = readJsonIfExists(publishConfigPath, null);
    const normalized = normalizePublishConfig(raw);
    if (JSON.stringify(raw || {}) !== JSON.stringify(normalized)) {
      writeJsonFile(publishConfigPath, normalized);
    }
    return normalized;
  }

  /**
   * 写入发布配置
   */
  function writePublishConfig(config) {
    writeJsonFile(publishConfigPath, normalizePublishConfig(config));
  }

  /**
   * 掩码敏感值
   */
  function maskSecretValue(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 6) return '*'.repeat(text.length);
    return `${text.slice(0, 3)}***${text.slice(-2)}`;
  }

  /**
   * 掩码平台配置
   */
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

  /**
   * 格式化平台字段标签
   */
  function formatPlatformFieldLabel(platformKey, fieldKey) {
    return platformFieldLabels?.[platformKey]?.[fieldKey] || fieldKey;
  }

  /**
   * 收集平台验证
   */
  function collectPlatformValidation(platformKey, platformConfig, requiredFields = []) {
    const missingFields = (requiredFields || []).filter((field) => !String(platformConfig?.[field] || '').trim());
    return {
      missingFields,
      missingFieldLabels: missingFields.map((field) => formatPlatformFieldLabel(platformKey, field))
    };
  }

  /**
   * 清理平台配置输入
   */
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
      next.global.autoPilotModeSchedules = sanitizeAutoPilotModeSchedules(incomingGlobal.autoPilotModeSchedules, next.global.autoPilotModeSchedules);
      next.global.autoPilotUseCurrentRanking = Boolean(incomingGlobal.autoPilotUseCurrentRanking);
      next.global.autoPilotPartitionId = String(incomingGlobal.autoPilotPartitionId || next.global.autoPilotPartitionId || 'crypto').trim() || 'crypto';
      next.global.autoArchiveEnabled = incomingGlobal.autoArchiveEnabled !== undefined ? Boolean(incomingGlobal.autoArchiveEnabled) : next.global.autoArchiveEnabled;
      next.global.autoArchiveDelayMinutes = incomingGlobal.autoArchiveDelayMinutes !== undefined ? Math.max(0, parseInt(incomingGlobal.autoArchiveDelayMinutes, 10)) : next.global.autoArchiveDelayMinutes;
      if (incomingGlobal.pipelineMode !== undefined) {
        next.global.pipelineMode = String(incomingGlobal.pipelineMode || 'vertical').trim() || 'vertical';
      }
      next.global.autoPilotPipelineModes = incomingGlobal.autoPilotPipelineModes !== undefined
        ? sanitizeAutoPilotPipelineModes(incomingGlobal.autoPilotPipelineModes, next.global.pipelineMode)
        : sanitizeAutoPilotPipelineModes(next.global.autoPilotPipelineModes, next.global.pipelineMode);
      if (incomingGlobal.avatarPipelineConfig && typeof incomingGlobal.avatarPipelineConfig === 'object') {
        next.global.avatarPipelineConfig = deepClone(incomingGlobal.avatarPipelineConfig);
      }
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

  /**
   * 验证 WeChat 任务配置
   */
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

  return {
    createEmptyWechatAccount,
    sanitizeWechatAccounts,
    normalizePublishConfig,
    getWechatAccountMap,
    readPublishConfig,
    writePublishConfig,
    maskSecretValue,
    maskPlatformConfig,
    formatPlatformFieldLabel,
    collectPlatformValidation,
    sanitizePlatformConfigInput,
    validateWechatTaskConfig
  };
}

module.exports = { createPublishConfigService };
