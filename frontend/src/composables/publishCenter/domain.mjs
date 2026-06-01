export const PLATFORM_DEFS = [
  { key: 'wechatChannels', label: '微信视频号', runModes: ['draft', 'publish'] },
  { key: 'douyin', label: '抖音', runModes: ['draft', 'publish'] },
  { key: 'xiaohongshu', label: '小红书', runModes: ['draft', 'publish'] },
  { key: 'x', label: 'X', runModes: ['publish'] },
  { key: 'youtube', label: 'YouTube', runModes: [] }
];

export const AUTO_PILOT_PLATFORM_KEYS = ['wechatChannels', 'douyin', 'xiaohongshu', 'x'];
export const DEFAULT_AUTO_PILOT_PLATFORMS = ['wechatChannels'];
export const SAU_PLATFORM_KEYS = ['douyin', 'xiaohongshu'];

export const AUTO_PILOT_PIPELINE_DEFS = [
  { key: 'vertical', label: '不带数字人', description: '直接生成竖屏成片并进入定时发布' },
  { key: 'avatar', label: '带数字人', description: '先生成数字人口播，再进入竖屏成片与定时发布' }
];
export const DEFAULT_XAI_PARTITION_ID = 'crypto';
export const DEFAULT_AVATAR_AUDIO_PRESET = '毕.mp3';
export const DEFAULT_AVATAR_IMAGE_PRESET = '毕（保守）.png';

export const FIELD_LABELS = {
  wechatChannels: {
    enabled: '启用',
    displayName: '账号备注',
    finderUserName: '视频号 ID',
    helperAccount: '视频号助手账号',
    openPlatformAppId: '开放平台 AppID',
    appId: '应用 ID',
    appSecret: '应用密钥',
    refreshToken: '刷新令牌',
    accountId: '账号 ID'
  },
  douyin: {
    enabled: '启用',
    displayName: '账号备注',
    sauAccountName: '登录账号别名',
    clientKey: '客户端 Key',
    clientSecret: '客户端密钥',
    accessToken: '访问令牌',
    openId: 'Open ID'
  },
  xiaohongshu: {
    enabled: '启用',
    displayName: '账号备注',
    sauAccountName: '登录账号别名',
    appId: '应用 ID',
    appSecret: '应用密钥',
    accessToken: '访问令牌',
    accountId: '账号 ID'
  },
  x: {
    enabled: '启用',
    displayName: '账号备注',
    username: 'X 用户名',
    userId: 'X 用户 ID',
    clientId: 'OAuth2 Client ID',
    clientSecret: 'OAuth2 Client Secret',
    accessToken: 'OAuth2 Access Token',
    refreshToken: 'OAuth2 Refresh Token',
    scopes: '授权范围',
    markMadeWithAi: '标记 Made with AI'
  },
  youtube: {
    enabled: '启用',
    displayName: '频道备注',
    clientId: '客户端 ID',
    clientSecret: '客户端密钥',
    refreshToken: '刷新令牌',
    channelId: '频道 ID'
  }
};

export const SECRET_HINT_FIELDS = new Set(['appSecret', 'refreshToken', 'clientSecret', 'accessToken', 'accessSecret', 'bearerToken', 'apiSecret']);

export function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((item) => String(item).trim()).filter(Boolean);
  return String(tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim());
  }
  if (value === null || value === undefined || value === '') {
    return [];
  }
  if (typeof value === 'string') {
    return [value.trim()];
  }
  return [];
}

export function normalizePlatformSelection(value, fallback = DEFAULT_AUTO_PILOT_PLATFORMS) {
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim());
  const selected = [];
  for (const item of source) {
    const platformKey = String(item || '').trim();
    if (AUTO_PILOT_PLATFORM_KEYS.includes(platformKey) && !selected.includes(platformKey)) {
      selected.push(platformKey);
    }
  }
  if (selected.length) return selected;
  return Array.isArray(fallback) ? [...fallback] : [...DEFAULT_AUTO_PILOT_PLATFORMS];
}

export function normalizeAutoPilotPlatformRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizePlatformSelection(item, []));
}

export function normalizeAutoPilotPipelineModes(value, fallback = 'vertical') {
  const allowedModes = new Set(AUTO_PILOT_PIPELINE_DEFS.map((item) => item.key));
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

export function normalizeAutoPilotModeSchedules(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const schedules = {};
  for (const mode of AUTO_PILOT_PIPELINE_DEFS.map((item) => item.key)) {
    const item = source[mode] && typeof source[mode] === 'object' ? source[mode] : {};
    schedules[mode] = {
      accountIds: normalizeStringArray(item.accountIds),
      times: normalizeStringArray(item.times),
      partitionIds: normalizeStringArray(item.partitionIds),
      sourceRanks: normalizeStringArray(item.sourceRanks),
      platforms: normalizeAutoPilotPlatformRows(item.platforms),
      audioPresets: normalizeStringArray(item.audioPresets),
      imagePresets: normalizeStringArray(item.imagePresets)
    };
  }
  return schedules;
}

export function normalizePresetPayload(payload = {}) {
  return {
    audio: Array.isArray(payload.audio) ? payload.audio.map((item) => String(item || '').trim()).filter(Boolean) : [],
    image: Array.isArray(payload.image) ? payload.image.map((item) => String(item || '').trim()).filter(Boolean) : []
  };
}

export function normalizeXaiPartitionId(value, fallback = DEFAULT_XAI_PARTITION_ID) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

export function normalizeApiError(err, fallbackMessage = '请求失败') {
  const payload = err?.response?.data || {};
  return {
    message: payload?.error || err?.message || fallbackMessage,
    code: payload?.code || '',
    stage: payload?.stage || '',
    hint: payload?.hint || '',
    details: payload?.details || ''
  };
}

export function pickPublishTitleFromAsset(asset = {}) {
  return String(
    asset?.metadata?.suggestedTitle
    || asset?.metadata?.title
    || asset?.metadata?.suggestedShortTitle
    || asset?.compactLabel
    || asset?.displayLabel
    || asset?.label
    || ''
  ).trim();
}

export function pickAccountFields(source = {}, fields = []) {
  return fields.reduce((acc, field) => {
    if (source[field] !== undefined) {
      acc[field] = String(source[field] ?? '');
    }
    return acc;
  }, {});
}

export function createWechatAccount(initial = {}) {
  return {
    id: `wechat_${Math.random().toString(36).slice(2, 10)}`,
    displayName: '',
    finderUserName: '',
    helperAccount: '',
    openPlatformAppId: '',
    appId: '',
    appSecret: '',
    refreshToken: '',
    accountId: '',
    notes: '',
    ...pickAccountFields(initial, ['displayName', 'finderUserName', 'helperAccount', 'openPlatformAppId', 'appId', 'appSecret', 'refreshToken', 'accountId', 'notes'])
  };
}

export function createSauAccount(platformKey, initial = {}) {
  return {
    id: `${platformKey}_${Math.random().toString(36).slice(2, 10)}`,
    displayName: '',
    sauAccountName: '',
    openId: '',
    accountId: '',
    notes: '',
    ...pickAccountFields(initial, ['displayName', 'sauAccountName', 'openId', 'accountId', 'notes'])
  };
}

export function createXAccount(initial = {}) {
  return {
    id: `x_${Math.random().toString(36).slice(2, 10)}`,
    displayName: '',
    username: '',
    userId: '',
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    scopes: 'tweet.read users.read tweet.write media.write offline.access',
    markMadeWithAi: true,
    notes: '',
    ...pickAccountFields(initial, ['displayName', 'username', 'userId', 'clientId', 'clientSecret', 'accessToken', 'refreshToken', 'scopes', 'notes']),
    markMadeWithAi: initial.markMadeWithAi !== undefined ? Boolean(initial.markMadeWithAi) : true
  };
}

export function getPlatformAccounts(config = {}, platformKey) {
  const accounts = config?.[platformKey]?.accounts;
  return Array.isArray(accounts) ? accounts : [];
}

export function buildPlatformAccountOptions(config = {}, platformKey) {
  const accounts = getPlatformAccounts(config, platformKey);
  if (platformKey === 'wechatChannels') {
    return accounts.map((account) => ({
      id: account.id,
      label: account.displayName || account.helperAccount || account.finderUserName || account.id
    }));
  }
  if (SAU_PLATFORM_KEYS.includes(platformKey)) {
    return accounts.map((account) => ({
      id: account.id,
      label: account.displayName || account.sauAccountName || account.accountId || account.openId || account.id
    }));
  }
  if (platformKey === 'x') {
    return accounts.map((account) => ({
      id: account.id,
      label: account.displayName || account.username || account.userId || account.id
    }));
  }
  return [];
}

export function resolvePlatformAccountLabel(config = {}, platformKey, accountId) {
  const normalizedId = String(accountId || '').trim();
  if (!normalizedId) return '未指定账号';
  const account = buildPlatformAccountOptions(config, platformKey).find((item) => item.id === normalizedId);
  return account?.label || normalizedId;
}

export function buildPlatformCard(platform, configItem = {}) {
  const item = configItem || {};
  if (platform.key === 'wechatChannels') {
    const accounts = Array.isArray(item.accounts) ? item.accounts : [];
    const filled = accounts.filter((account) => String(account.finderUserName || '').trim() && String(account.helperAccount || '').trim()).length;
    const total = accounts.length || 1;
    return {
      ...platform,
      config: item,
      percent: item.enabled ? Math.round((filled / total) * 100) : 0,
      fieldKeys: ['accounts'],
      accountCount: accounts.length
    };
  }
  if (SAU_PLATFORM_KEYS.includes(platform.key)) {
    const accounts = Array.isArray(item.accounts) ? item.accounts : [];
    const filled = accounts.filter((account) => String(account.sauAccountName || '').trim()).length;
    const total = accounts.length || 1;
    return {
      ...platform,
      config: item,
      percent: item.enabled ? Math.round((filled / total) * 100) : 0,
      fieldKeys: ['accounts'],
      accountCount: accounts.length
    };
  }
  if (platform.key === 'x') {
    const accounts = Array.isArray(item.accounts) ? item.accounts : [];
    const filled = accounts.filter((account) => String(account.accessToken || '').trim()).length;
    const total = accounts.length || 1;
    return {
      ...platform,
      config: item,
      percent: item.enabled ? Math.round((filled / total) * 100) : 0,
      fieldKeys: ['accounts'],
      accountCount: accounts.length
    };
  }
  const fieldKeys = Object.keys(item).filter((key) => key !== 'enabled');
  const filled = fieldKeys.filter((key) => String(item[key] ?? '').trim()).length;
  const total = fieldKeys.length || 1;
  return {
    ...platform,
    config: item,
    percent: item.enabled ? Math.round((filled / total) * 100) : 0,
    fieldKeys
  };
}

export function buildPlatformCards(config = {}, platformDefs = PLATFORM_DEFS) {
  return platformDefs.map((platform) => buildPlatformCard(platform, config?.[platform.key] || {}));
}
