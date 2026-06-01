const DEFAULT_XAI_PARTITION_ID = 'crypto';
const AUTO_PILOT_PLATFORM_KEYS = ['wechatChannels', 'douyin', 'xiaohongshu', 'x'];
const DEFAULT_AUTO_PILOT_PLATFORMS = ['wechatChannels'];
const DEFAULT_AVATAR_AUDIO_PRESET = '毕.mp3';
const DEFAULT_AVATAR_IMAGE_PRESET = '毕（保守）.png';
const DEFAULT_LOGIN_CHECK_INTERVAL_MINUTES = 30;
const DEFAULT_AUTO_PILOT_SLOT_RETRY_LIMIT = 5;
const LOGIN_CHECK_MS_PER_MINUTE = 60 * 1000;

function normalizePositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildLoginCheckScheduleConfig(values = {}, env = process.env) {
  const checkInterval = normalizePositiveInteger(
    values.LOGIN_CHECK_INTERVAL_MINUTES ?? env.LOGIN_CHECK_INTERVAL_MINUTES,
    DEFAULT_LOGIN_CHECK_INTERVAL_MINUTES
  );
  const loginCheckEnabled = (values.LOGIN_CHECK_ENABLED ?? env.LOGIN_CHECK_ENABLED) !== 'false';

  return {
    checkInterval,
    loginCheckEnabled
  };
}

function isLoginCheckDue(state, nowMs, checkInterval) {
  const intervalMs = checkInterval * LOGIN_CHECK_MS_PER_MINUTE;
  return nowMs - state.lastStartedAt >= intervalMs;
}

function normalizeXaiPartitionId(value, fallback = DEFAULT_XAI_PARTITION_ID) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

function getLocalParts(date = new Date(), timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = Object.create(null);
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}:${map.second}`
  };
}

function buildShanghaiIso(dateStr, timeStr) {
  const [year, month, day] = String(dateStr).split('-').map((value) => parseInt(value, 10));
  const [hour, minute] = String(timeStr || '08:00').split(':').map((value) => parseInt(value, 10));
  const utcMs = Date.UTC(year, month - 1, day, (hour || 0) - 8, minute || 0, 0);
  return new Date(utcMs).toISOString();
}

function formatJobBrief(job) {
  return {
    jobId: job?.id || '',
    title: job?.publishData?.title || job?.asset?.label || '',
    status: job?.status || '',
    scheduledAt: job?.scheduledAt || null
  };
}

function normalizeRankingItem(item = {}, partition = {}) {
  return {
    title: item.title,
    summary: item.author_summary_zh || item.author_summary || item.summary,
    videoUrl: item.video_url || item.videoUrl,
    author: item.author,
    postId: item.post_id || item.postId,
    postUrl: item.post_url || item.postUrl,
    sourcePartitionId: item.source_partition_id || item.sourcePartitionId || partition.id || '',
    sourcePartitionLabel: item.source_partition_label || item.sourcePartitionLabel || partition.label || ''
  };
}

function normalizeSourceVideoKey(videoUrl) {
  const raw = String(videoUrl || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    if (String(parsed.hostname || '').toLowerCase() === 'video.twimg.com') {
      parsed.search = '';
    }
    return parsed.toString();
  } catch (_err) {
    return raw;
  }
}

function createAutoPilotActiveKey(normalized, rank) {
  const videoKey = normalizeSourceVideoKey(normalized?.videoUrl);
  if (videoKey) return `video:${videoKey}`;

  const postId = String(normalized?.postId || '').trim();
  if (postId) return `post:${postId}`;

  return `rank:${rank}`;
}

function getAutoPilotPipelineModes(config = {}) {
  const allowedModes = new Set(['vertical', 'avatar']);
  const fallback = String(config?.global?.pipelineMode || 'vertical').trim() || 'vertical';
  const source = Array.isArray(config?.global?.autoPilotPipelineModes)
    ? config.global.autoPilotPipelineModes
    : [fallback];
  const modes = [];
  for (const item of source) {
    const mode = String(item || '').trim();
    if (allowedModes.has(mode) && !modes.includes(mode)) {
      modes.push(mode);
    }
  }
  return modes.length ? modes : ['vertical'];
}

function getAutoPilotSlotRetryLimit(config = {}, env = process.env) {
  return normalizeNonNegativeInteger(
    config?.global?.autoPilotSlotRetryLimit ?? env.AUTO_PILOT_SLOT_RETRY_LIMIT,
    DEFAULT_AUTO_PILOT_SLOT_RETRY_LIMIT
  );
}

function trimTrailingEmptyStrings(items = []) {
  const values = Array.isArray(items) ? items.map((item) => String(item || '').trim()) : [];
  while (values.length > 0 && !values[values.length - 1]) {
    values.pop();
  }
  return values;
}

function normalizeAutoPilotPlatformSelection(value, fallback = DEFAULT_AUTO_PILOT_PLATFORMS) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',').map((item) => item.trim());
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

function trimTrailingEmptyPlatformRows(items = []) {
  const values = Array.isArray(items)
    ? items.map((item) => normalizeAutoPilotPlatformSelection(item, []))
    : [];
  while (values.length > 0 && values[values.length - 1].length === 0) {
    values.pop();
  }
  return values;
}

function getAutoPilotModeSchedule(config = {}, pipelineMode = 'vertical') {
  const mode = String(pipelineMode || 'vertical').trim() || 'vertical';
  const schedule = config?.global?.autoPilotModeSchedules?.[mode] || {};
  const accountIds = Array.isArray(schedule.accountIds)
    ? trimTrailingEmptyStrings(schedule.accountIds)
    : [];
  const times = Array.isArray(schedule.times)
    ? trimTrailingEmptyStrings(schedule.times)
    : [];
  const partitionIds = Array.isArray(schedule.partitionIds)
    ? trimTrailingEmptyStrings(schedule.partitionIds)
    : [];
  const sourceRanks = Array.isArray(schedule.sourceRanks)
    ? trimTrailingEmptyStrings(schedule.sourceRanks)
    : [];
  const platforms = Array.isArray(schedule.platforms)
    ? trimTrailingEmptyPlatformRows(schedule.platforms)
    : [];
  const audioPresets = Array.isArray(schedule.audioPresets)
    ? trimTrailingEmptyStrings(schedule.audioPresets)
    : [];
  const imagePresets = Array.isArray(schedule.imagePresets)
    ? trimTrailingEmptyStrings(schedule.imagePresets)
    : [];

  if (accountIds.length || times.length || partitionIds.length || sourceRanks.length || platforms.length || audioPresets.length || imagePresets.length) {
    return { accountIds, times, partitionIds, sourceRanks, platforms, audioPresets, imagePresets };
  }

  return {
    accountIds: Array.isArray(config?.global?.autoPilotAccountIds)
      ? trimTrailingEmptyStrings(config.global.autoPilotAccountIds)
      : [],
    times: Array.isArray(config?.global?.autoPilotTimes)
      ? trimTrailingEmptyStrings(config.global.autoPilotTimes)
      : [],
    partitionIds: [],
    sourceRanks: [],
    platforms: [],
    audioPresets: [],
    imagePresets: []
  };
}

function getAutoPilotSlotPartitionId(config = {}, pipelineMode = 'vertical', rankIndex = 0) {
  const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
  return normalizeXaiPartitionId(
    modeSchedule.partitionIds?.[rankIndex]
    || config?.global?.autoPilotPartitionId
    || DEFAULT_XAI_PARTITION_ID
  );
}

function normalizeAutoPilotSourceRank(value, fallback = 1) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(10, parsed));
}

function getAutoPilotSlotSourceRank(config = {}, pipelineMode = 'vertical', rankIndex = 0) {
  const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
  return normalizeAutoPilotSourceRank(modeSchedule.sourceRanks?.[rankIndex], rankIndex + 1);
}

function getAutoPilotSlotAvatarConfig(config = {}, pipelineMode = 'vertical', rankIndex = 0) {
  const base = config?.global?.avatarPipelineConfig || {};
  const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
  if (String(pipelineMode || '').trim() !== 'avatar') {
    return { ...base };
  }
  return {
    ...base,
    audioPreset: String(modeSchedule.audioPresets?.[rankIndex] || base.audioPreset || DEFAULT_AVATAR_AUDIO_PRESET).trim(),
    imagePreset: String(modeSchedule.imagePresets?.[rankIndex] || base.imagePreset || DEFAULT_AVATAR_IMAGE_PRESET).trim()
  };
}

function getAutoPilotRequiredPartitionIds(config = {}) {
  const partitionIds = new Set();
  const configCount = Math.max(1, Number(config?.global?.autoPilotCount) || 1);
  for (const pipelineMode of getAutoPilotPipelineModes(config)) {
    const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
    const count = Math.max(
      configCount,
      modeSchedule.accountIds?.length || 0,
      modeSchedule.partitionIds?.length || 0,
      modeSchedule.sourceRanks?.length || 0,
      modeSchedule.platforms?.length || 0,
      modeSchedule.audioPresets?.length || 0,
      modeSchedule.imagePresets?.length || 0
    );
    for (let index = 0; index < count; index += 1) {
      partitionIds.add(getAutoPilotSlotPartitionId(config, pipelineMode, index));
    }
  }
  return Array.from(partitionIds);
}

function getRankingForPartition(rankings, partitionId) {
  const id = normalizeXaiPartitionId(partitionId);
  if (!rankings) return null;
  if (rankings instanceof Map) {
    return rankings.get(id) || rankings.get(DEFAULT_XAI_PARTITION_ID) || null;
  }
  if (rankings[id]) return rankings[id];
  if (Array.isArray(rankings.items)) return rankings;
  return null;
}

function getJobAutoPilotPipelineMode(job) {
  return String(job?.autoPilot?.pipelineMode || job?.autoPilot?.mode || 'vertical').trim() || 'vertical';
}

function getWechatAccountId(job) {
  return String(
    job?.platformSelections?.wechatChannels?.accountId
    || (job?.platformTasks || []).find((task) => task.platform === 'wechatChannels')?.accountId
    || ''
  ).trim();
}

function getPlatformAccount(config = {}, platformKey = '', accountId = '') {
  const accounts = Array.isArray(config?.[platformKey]?.accounts) ? config[platformKey].accounts : [];
  const requestedId = String(accountId || '').trim();
  if (requestedId) {
    return accounts.find((item) => String(item.id || '').trim() === requestedId) || null;
  }
  return accounts[0] || null;
}

function getPlatformAccountLabel(platformKey = '', account = null) {
  if (!account) return '';
  if (platformKey === 'wechatChannels') {
    return account.displayName || account.finderUserName || account.helperAccount || '';
  }
  if (platformKey === 'x') {
    return account.displayName || account.username || account.userId || '';
  }
  return account.displayName || account.sauAccountName || account.accountId || account.openId || '';
}

function buildAutoPilotPlatformSelections(config = {}, selectedPlatforms = [], accountId = '') {
  const selections = {};
  for (const platformKey of selectedPlatforms) {
    const account = getPlatformAccount(config, platformKey, accountId);
    if (account) {
      selections[platformKey] = {
        accountId: account.id,
        accountLabel: getPlatformAccountLabel(platformKey, account)
      };
    }
  }
  return selections;
}

function getJobSourceVideoKey(job) {
  return normalizeSourceVideoKey(
    job?.autoPilot?.sourceVideoUrl
    || job?.asset?.metadata?.videoUrl
    || job?.asset?.metadata?.sourceVideoUrl
    || job?.asset?.metadata?.originalVideoUrl
    || ''
  );
}

function hasSameAssetReference(job, queueJobId, asset) {
  const id = String(queueJobId || '').trim();
  const jobAssetPath = String(job?.asset?.path || '').trim();
  const jobAssetUrl = String(job?.asset?.url || '').trim();
  const assetPath = String(asset?.path || '').trim();
  const assetUrl = String(asset?.url || '').trim();

  if (id && (String(job?.autoPilot?.queueJobId || '') === id || jobAssetPath.includes(id) || jobAssetUrl.includes(id))) {
    return true;
  }

  return Boolean(
    (assetPath && jobAssetPath === assetPath)
    || (assetUrl && jobAssetUrl === assetUrl)
  );
}

function findExistingAutoPilotPublishJob(jobs, identity) {
  const queueJobId = String(identity?.queueJobId || '').trim();
  const sourceVideoKey = String(identity?.sourceVideoKey || '').trim();
  const accountId = String(identity?.accountId || '').trim();
  const pipelineMode = String(identity?.pipelineMode || '').trim();

  return (jobs || []).find((job) => {
    if (!job || job.archived) return false;
    if (pipelineMode && getJobAutoPilotPipelineMode(job) !== pipelineMode) return false;

    if (hasSameAssetReference(job, queueJobId, identity?.asset)) {
      return true;
    }

    if (sourceVideoKey && getJobSourceVideoKey(job) === sourceVideoKey) {
      return true;
    }

    if (!accountId) return false;
    return getWechatAccountId(job) === accountId && hasSameAssetReference(job, queueJobId, identity?.asset);
  }) || null;
}

function collectAutoPilotFallbackCandidates({ rankingItems = [], partition = {}, partitionId = '', startIndex = 0 }) {
  const candidates = [];
  for (let index = startIndex; index < rankingItems.length; index += 1) {
    const normalized = normalizeRankingItem(rankingItems[index], partition);
    if (!normalized.videoUrl) continue;
    candidates.push({
      normalized,
      sourceRank: index + 1,
      sourcePartitionId: normalized.sourcePartitionId || partitionId,
      sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || ''
    });
  }
  return candidates;
}

module.exports = {
  AUTO_PILOT_PLATFORM_KEYS,
  DEFAULT_AUTO_PILOT_PLATFORMS,
  DEFAULT_AUTO_PILOT_SLOT_RETRY_LIMIT,
  DEFAULT_AVATAR_AUDIO_PRESET,
  DEFAULT_AVATAR_IMAGE_PRESET,
  DEFAULT_LOGIN_CHECK_INTERVAL_MINUTES,
  DEFAULT_XAI_PARTITION_ID,
  LOGIN_CHECK_MS_PER_MINUTE,
  buildAutoPilotPlatformSelections,
  buildLoginCheckScheduleConfig,
  buildShanghaiIso,
  collectAutoPilotFallbackCandidates,
  createAutoPilotActiveKey,
  findExistingAutoPilotPublishJob,
  formatJobBrief,
  getAutoPilotModeSchedule,
  getAutoPilotPipelineModes,
  getAutoPilotRequiredPartitionIds,
  getAutoPilotSlotAvatarConfig,
  getAutoPilotSlotPartitionId,
  getAutoPilotSlotRetryLimit,
  getAutoPilotSlotSourceRank,
  getJobAutoPilotPipelineMode,
  getJobSourceVideoKey,
  getLocalParts,
  getPlatformAccount,
  getPlatformAccountLabel,
  getRankingForPartition,
  getWechatAccountId,
  hasSameAssetReference,
  isLoginCheckDue,
  normalizeAutoPilotPlatformSelection,
  normalizeAutoPilotSourceRank,
  normalizeNonNegativeInteger,
  normalizePositiveInteger,
  normalizeRankingItem,
  normalizeSourceVideoKey,
  normalizeXaiPartitionId,
  trimTrailingEmptyPlatformRows,
  trimTrailingEmptyStrings
};
