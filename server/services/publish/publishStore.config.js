/**
 * Publish Store 配置管理模块
 *
 * 职责：
 * - 平台配置读写
 * - 配置规范化和验证
 * - 敏感信息掩码
 * - WeChat / social-auto-upload 账号管理
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

  const autoPilotPlatformKeys = ['wechatChannels', 'douyin', 'xiaohongshu', 'x'];
  const defaultAutoPilotPlatforms = ['wechatChannels'];
  const sauPlatformKeys = ['douyin', 'xiaohongshu'];
  const defaultAvatarAudioPreset = '毕.mp3';
  const defaultAvatarImagePreset = '毕（保守）.png';

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
      accountId: '账号 ID / Account ID',
      title: '发布标题 / Publish Title'
    },
    x: {
      clientId: 'OAuth2 Client ID / OAuth2 Client ID',
      clientSecret: 'OAuth2 Client Secret / OAuth2 Client Secret',
      accessToken: 'OAuth2 Access Token / OAuth2 Access Token',
      refreshToken: 'OAuth2 Refresh Token / OAuth2 Refresh Token',
      username: 'X 用户名 / X Username',
      userId: 'X 用户 ID / X User ID',
      scopes: '授权范围 / OAuth Scopes',
      accountId: '账号 ID / Account ID'
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
      if (!wechatAccountFields.some((field) => field !== 'notes' && String(item[field] ?? '').trim())) continue;
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

  function createEmptySauAccount(platformKey) {
    const generatedId = typeof makeJobId === 'function'
      ? String(makeJobId() || '').trim()
      : `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const account = {
      id: `${platformKey}_${generatedId}`,
      displayName: '',
      sauAccountName: '',
      notes: ''
    };
    if (platformKey === 'douyin') {
      account.openId = '';
    } else if (platformKey === 'xiaohongshu') {
      account.accountId = '';
    }
    return account;
  }

  function getSauAccountFields(platformKey) {
    return platformKey === 'douyin'
      ? ['displayName', 'sauAccountName', 'openId', 'notes']
      : ['displayName', 'sauAccountName', 'accountId', 'notes'];
  }

  function hasSauAccountValue(platformKey, account = {}) {
    return getSauAccountFields(platformKey).some((field) => field !== 'notes' && String(account?.[field] ?? '').trim());
  }

  function hasSauLegacyValue(platformKey, source = {}) {
    const fields = getSauAccountFields(platformKey);
    return fields.some((field) => String(source?.[field] ?? '').trim());
  }

  function createLegacySauAccount(platformKey, source = {}) {
    const account = createEmptySauAccount(platformKey);
    account.id = `${platformKey}_main`;
    for (const field of getSauAccountFields(platformKey)) {
      account[field] = String(source?.[field] ?? '').trim();
    }
    return account;
  }

  function sanitizeSauAccounts(platformKey, accounts, legacySource = {}) {
    const source = Array.isArray(accounts)
      ? accounts
      : (hasSauLegacyValue(platformKey, legacySource) ? [createLegacySauAccount(platformKey, legacySource)] : []);
    const seen = new Set();
    const sanitized = [];
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      if (!hasSauAccountValue(platformKey, item)) continue;
      const next = createEmptySauAccount(platformKey);
      const candidateId = String(item.id || '').trim() || next.id;
      const id = seen.has(candidateId) ? createEmptySauAccount(platformKey).id : candidateId;
      seen.add(id);
      next.id = id;
      for (const field of getSauAccountFields(platformKey)) {
        next[field] = String(item[field] ?? '').trim();
      }
      sanitized.push(next);
    }
    return sanitized;
  }

  function syncSauTopLevelFromAccounts(platformKey, platformConfig) {
    const accounts = Array.isArray(platformConfig?.accounts) ? platformConfig.accounts : [];
    const primary = accounts[0] || null;
    if (!primary) return platformConfig;
    const next = platformConfig;
    for (const field of getSauAccountFields(platformKey)) {
      if (!String(next[field] ?? '').trim()) {
        next[field] = String(primary[field] ?? '').trim();
      }
    }
    return next;
  }

  function createEmptyXAccount() {
    const generatedId = typeof makeJobId === 'function'
      ? String(makeJobId() || '').trim()
      : `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    return {
      id: `x_${generatedId}`,
      displayName: '',
      username: '',
      userId: '',
      clientId: '',
      clientSecret: '',
      accessToken: '',
      refreshToken: '',
      scopes: 'tweet.read users.read tweet.write media.write offline.access',
      markMadeWithAi: true,
      notes: ''
    };
  }

  function getXAccountFields() {
    return ['displayName', 'username', 'userId', 'clientId', 'clientSecret', 'accessToken', 'refreshToken', 'scopes', 'notes'];
  }

  function hasXAccountValue(account = {}) {
    return ['displayName', 'username', 'userId', 'clientId', 'clientSecret', 'accessToken', 'refreshToken']
      .some((field) => String(account?.[field] ?? '').trim());
  }

  function hasXLegacyValue(source = {}) {
    return [
      'displayName',
      'apiKey',
      'apiSecret',
      'accessToken',
      'accessSecret',
      'bearerToken',
      'clientId',
      'clientSecret',
      'refreshToken',
      'username',
      'userId',
      'accountId',
      'notes'
    ].some((field) => String(source?.[field] ?? '').trim());
  }

  function createLegacyXAccount(source = {}) {
    const account = createEmptyXAccount();
    account.id = 'x_main';
    account.displayName = String(source.displayName || source.username || source.accountId || 'X Main').trim();
    account.username = String(source.username || source.accountId || '').trim().replace(/^@+/, '');
    account.userId = String(source.userId || '').trim();
    account.clientId = String(source.clientId || source.apiKey || '').trim();
    account.clientSecret = String(source.clientSecret || source.apiSecret || '').trim();
    account.accessToken = String(source.accessToken || source.bearerToken || '').trim();
    account.refreshToken = String(source.refreshToken || '').trim();
    account.scopes = String(source.scopes || account.scopes).trim();
    account.notes = String(source.notes || '').trim();
    return account;
  }

  function sanitizeXAccounts(accounts, legacySource = {}) {
    const source = Array.isArray(accounts)
      ? accounts
      : (hasXLegacyValue(legacySource) ? [createLegacyXAccount(legacySource)] : []);
    const seen = new Set();
    const sanitized = [];
    for (const item of source) {
      if (!item || typeof item !== 'object') continue;
      if (!hasXAccountValue(item)) continue;
      const next = createEmptyXAccount();
      const candidateId = String(item.id || '').trim() || next.id;
      const id = seen.has(candidateId) ? createEmptyXAccount().id : candidateId;
      seen.add(id);
      next.id = id;
      for (const field of getXAccountFields()) {
        next[field] = String(item[field] ?? '').trim();
      }
      next.username = next.username.replace(/^@+/, '');
      next.markMadeWithAi = item.markMadeWithAi !== undefined ? Boolean(item.markMadeWithAi) : true;
      sanitized.push(next);
    }
    return sanitized;
  }

  function syncXTopLevelFromAccounts(platformConfig) {
    const accounts = Array.isArray(platformConfig?.accounts) ? platformConfig.accounts : [];
    const primary = accounts[0] || null;
    if (!primary) return platformConfig;
    const next = platformConfig;
    for (const field of getXAccountFields()) {
      if (!String(next[field] ?? '').trim()) {
        next[field] = String(primary[field] ?? '').trim();
      }
    }
    next.accountId = next.accountId || primary.id || '';
    next.markMadeWithAi = primary.markMadeWithAi !== false;
    return next;
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
      const audioPresets = Array.isArray(item.audioPresets)
        ? trimTrailingEmptyValues(item.audioPresets.map((preset) => String(preset || '').trim()))
        : (Array.isArray(fallbackItem.audioPresets) ? trimTrailingEmptyValues(fallbackItem.audioPresets.map((preset) => String(preset || '').trim())) : []);
      const imagePresets = Array.isArray(item.imagePresets)
        ? trimTrailingEmptyValues(item.imagePresets.map((preset) => String(preset || '').trim()))
        : (Array.isArray(fallbackItem.imagePresets) ? trimTrailingEmptyValues(fallbackItem.imagePresets.map((preset) => String(preset || '').trim())) : []);
      const schedule = {
        accountIds,
        times,
        partitionIds,
        sourceRanks,
        platforms,
        audioPresets,
        imagePresets
      };
      if (!schedule.sourceRanks.length) {
        const plannedCount = Math.max(schedule.accountIds.length, schedule.times.length, schedule.partitionIds.length, schedule.platforms.length, schedule.audioPresets.length, schedule.imagePresets.length);
        schedule.sourceRanks = Array.from({ length: plannedCount }, () => '1');
      }
      if (!schedule.platforms.length) {
        const plannedCount = Math.max(schedule.accountIds.length, schedule.times.length, schedule.partitionIds.length, schedule.sourceRanks.length, schedule.audioPresets.length, schedule.imagePresets.length);
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
          vertical: { accountIds: [], times: [], partitionIds: [], sourceRanks: [], platforms: [], audioPresets: [], imagePresets: [] },
          avatar: { accountIds: [], times: [], partitionIds: [], sourceRanks: [], platforms: [], audioPresets: [], imagePresets: [] }
        },
        autoPilotUseCurrentRanking: false,
        autoPilotPartitionId: 'crypto',
        autoArchiveEnabled: true,
        autoArchiveDelayMinutes: 30,
        pipelineMode: 'vertical',
        autoPilotPipelineModes: ['vertical'],
        avatarPipelineConfig: {
          audioPreset: defaultAvatarAudioPreset,
          imagePreset: defaultAvatarImagePreset
        }
      },
      wechatChannels: { enabled: false, accounts: [] },
      douyin: { enabled: false, displayName: '', sauAccountName: '', accounts: [], clientKey: '', clientSecret: '', accessToken: '', openId: '', notes: '' },
      xiaohongshu: { enabled: false, displayName: '', sauAccountName: '', accounts: [], appId: '', appSecret: '', accessToken: '', accountId: '', notes: '' },
      x: {
        enabled: false,
        displayName: '',
        username: '',
        userId: '',
        clientId: '',
        clientSecret: '',
        accessToken: '',
        refreshToken: '',
        scopes: 'tweet.read users.read tweet.write media.write offline.access',
        accountId: '',
        markMadeWithAi: true,
        accounts: [],
        notes: ''
      },
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
      if (!String(next.global.avatarPipelineConfig.audioPreset || '').trim()) {
        next.global.avatarPipelineConfig.audioPreset = defaultAvatarAudioPreset;
      }
      if (!String(next.global.avatarPipelineConfig.imagePreset || '').trim() || next.global.avatarPipelineConfig.imagePreset === '毕.png') {
        next.global.avatarPipelineConfig.imagePreset = defaultAvatarImagePreset;
      }
    }

    for (const platform of ['douyin', 'xiaohongshu', 'x', 'youtube']) {
      const incoming = source?.[platform];
      if (!incoming || typeof incoming !== 'object') continue;
      for (const key of Object.keys(next[platform])) {
        if (key === 'accounts') continue;
        if (incoming[key] === undefined) continue;
        next[platform][key] = typeof next[platform][key] === 'boolean'
          ? Boolean(incoming[key])
          : String(incoming[key] ?? '').trim();
      }
      if (sauPlatformKeys.includes(platform)) {
        next[platform].accounts = sanitizeSauAccounts(platform, incoming.accounts, incoming);
        syncSauTopLevelFromAccounts(platform, next[platform]);
      } else if (platform === 'x') {
        next.x.accounts = sanitizeXAccounts(incoming.accounts, incoming);
        syncXTopLevelFromAccounts(next.x);
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

  function getSauPlatformAccounts(platformKey, config = readPublishConfig()) {
    if (!sauPlatformKeys.includes(platformKey)) return [];
    return Array.isArray(config?.[platformKey]?.accounts) ? config[platformKey].accounts : [];
  }

  function getSauAccountMap(platformKey, config = readPublishConfig()) {
    const accounts = getSauPlatformAccounts(platformKey, config);
    return new Map(accounts.map((account) => [String(account.id || '').trim(), account]).filter(([id]) => id));
  }

  function getXAccounts(config = readPublishConfig()) {
    return Array.isArray(config?.x?.accounts) ? config.x.accounts : [];
  }

  function getXAccountMap(config = readPublishConfig()) {
    const accounts = getXAccounts(config);
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
      if ((sauPlatformKeys.includes(platform) || platform === 'x') && Array.isArray(payload[platform]?.accounts)) {
        payload[platform].accounts = payload[platform].accounts.map((account) => {
          const next = { ...account };
          for (const key of Object.keys(next)) {
            if (secretKeys.has(key)) {
              next[`${key}Masked`] = maskSecretValue(next[key]);
            }
          }
          return next;
        });
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
      if (!String(next.global.avatarPipelineConfig.audioPreset || '').trim()) {
        next.global.avatarPipelineConfig.audioPreset = defaultAvatarAudioPreset;
      }
      if (!String(next.global.avatarPipelineConfig.imagePreset || '').trim() || next.global.avatarPipelineConfig.imagePreset === '毕.png') {
        next.global.avatarPipelineConfig.imagePreset = defaultAvatarImagePreset;
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
        if (key === 'accounts') continue;
        if (source[key] === undefined) continue;
        next[platform][key] = typeof next[platform][key] === 'boolean'
          ? Boolean(source[key])
          : String(source[key] ?? '').trim();
      }
      if (sauPlatformKeys.includes(platform)) {
        next[platform].accounts = Array.isArray(source.accounts)
          ? sanitizeSauAccounts(platform, source.accounts, source)
          : sanitizeSauAccounts(platform, next[platform].accounts, next[platform]);
        syncSauTopLevelFromAccounts(platform, next[platform]);
      } else if (platform === 'x') {
        next.x.accounts = Array.isArray(source.accounts)
          ? sanitizeXAccounts(source.accounts, source)
          : sanitizeXAccounts(next.x.accounts, next.x);
        syncXTopLevelFromAccounts(next.x);
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

  function validateSauTaskConfig(platformKey, platformConfig, task) {
    const accountId = String(task?.accountId || '').trim();
    if (!accountId) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const accountMap = getSauAccountMap(platformKey, { [platformKey]: platformConfig });
    const account = accountMap.get(accountId) || null;
    if (!account) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const baseValidation = collectPlatformValidation(platformKey, account, task.requiredFields || []);
    if (platformKey === 'xiaohongshu' && !String(task?.title || '').trim() && !baseValidation.missingFields.includes('title')) {
      baseValidation.missingFields = [...baseValidation.missingFields, 'title'];
      baseValidation.missingFieldLabels = baseValidation.missingFields.map((field) => formatPlatformFieldLabel(platformKey, field));
    }
    return {
      ...baseValidation,
      account
    };
  }

  function validateXTaskConfig(platformConfig, task) {
    const accountId = String(task?.accountId || '').trim();
    if (!accountId) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const accountMap = getXAccountMap({ x: platformConfig });
    const account = accountMap.get(accountId) || null;
    if (!account) {
      return {
        missingFields: ['selectedAccount'],
        missingFieldLabels: ['发布账号 / Publish Account'],
        account: null
      };
    }
    const baseValidation = collectPlatformValidation('x', account, task.requiredFields || []);
    if (baseValidation.missingFields.includes('accessToken') && String(account.refreshToken || '').trim()) {
      baseValidation.missingFields = baseValidation.missingFields.filter((field) => field !== 'accessToken');
      baseValidation.missingFieldLabels = baseValidation.missingFields.map((field) => formatPlatformFieldLabel('x', field));
    }
    return {
      ...baseValidation,
      account
    };
  }

  return {
    createEmptyWechatAccount,
    sanitizeWechatAccounts,
    createEmptySauAccount,
    sanitizeSauAccounts,
    createEmptyXAccount,
    sanitizeXAccounts,
    getSauPlatformAccounts,
    getXAccounts,
    normalizePublishConfig,
    getWechatAccountMap,
    getSauAccountMap,
    getXAccountMap,
    readPublishConfig,
    writePublishConfig,
    maskSecretValue,
    maskPlatformConfig,
    formatPlatformFieldLabel,
    collectPlatformValidation,
    sanitizePlatformConfigInput,
    validateWechatTaskConfig,
    validateSauTaskConfig,
    validateXTaskConfig
  };
}

module.exports = { createPublishConfigService };
