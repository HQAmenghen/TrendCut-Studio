const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { readProjectEnv } = require('../../../scripts/utils/env');
const { runCleanup, getCleanupConfig } = require('../../core/cleanup');

const SCHEDULER_TIME_ZONE = 'Asia/Shanghai';
const SCHEDULER_LOG_PATH = path.join(__dirname, '../../../data/logs/scheduler.log');
const DEFAULT_XAI_PARTITION_ID = 'crypto';
const AUTO_PILOT_PLATFORM_KEYS = ['wechatChannels', 'douyin', 'xiaohongshu', 'x'];
const DEFAULT_AUTO_PILOT_PLATFORMS = ['wechatChannels'];
const DEFAULT_AVATAR_AUDIO_PRESET = '毕.mp3';
const DEFAULT_AVATAR_IMAGE_PRESET = '毕（保守）.png';
const DEFAULT_LOGIN_CHECK_INTERVAL_MINUTES = 30;
const LOGIN_CHECK_CRON_EXPRESSION = '* * * * *';
const LOGIN_CHECK_MS_PER_MINUTE = 60 * 1000;

function normalizePositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readLoginCheckScheduleConfig(baseDir) {
  const { values } = readProjectEnv(baseDir);
  const checkInterval = normalizePositiveInteger(
    values.LOGIN_CHECK_INTERVAL_MINUTES ?? process.env.LOGIN_CHECK_INTERVAL_MINUTES,
    DEFAULT_LOGIN_CHECK_INTERVAL_MINUTES
  );
  const loginCheckEnabled = (values.LOGIN_CHECK_ENABLED ?? process.env.LOGIN_CHECK_ENABLED) !== 'false';

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

function ensureSchedulerLogDir() {
  fs.mkdirSync(path.dirname(SCHEDULER_LOG_PATH), { recursive: true });
}

function appendSchedulerLog(level, message, extra = null) {
  try {
    ensureSchedulerLogDir();
    const line = [
      `[${new Date().toISOString()}]`,
      `[${level}]`,
      message,
      extra ? JSON.stringify(extra, null, 0) : ''
    ].filter(Boolean).join(' ');
    fs.appendFileSync(SCHEDULER_LOG_PATH, `${line}\n`, 'utf8');
  } catch (_err) {}
}

function logInfo(message, extra = null) {
  console.log(message, extra || '');
  appendSchedulerLog('INFO', message, extra);
}

function logWarn(message, extra = null) {
  console.warn(message, extra || '');
  appendSchedulerLog('WARN', message, extra);
}

function logError(message, error = null, extra = null) {
  const payload = {
    ...(extra || {}),
    ...(error ? { error: error.message || String(error) } : {})
  };
  console.error(message, payload);
  appendSchedulerLog('ERROR', message, payload);
}

function getLocalParts(date = new Date(), timeZone = SCHEDULER_TIME_ZONE) {
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

function buildAutoPilotPlatformSelections(config = {}, selectedPlatforms = [], wechatAccount = null) {
  const selections = {};
  if (selectedPlatforms.includes('wechatChannels') && wechatAccount) {
    selections.wechatChannels = {
      accountId: wechatAccount.id,
      accountLabel: wechatAccount.displayName || wechatAccount.finderUserName || wechatAccount.helperAccount || ''
    };
  }
  if (selectedPlatforms.includes('x')) {
    const xAccount = Array.isArray(config?.x?.accounts) ? config.x.accounts[0] : null;
    if (xAccount) {
      selections.x = {
        accountId: xAccount.id,
        accountLabel: xAccount.displayName || xAccount.username || xAccount.userId || ''
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


function startScheduler({ publishStore, wechatRpaService, xaiService, verticalQueueService, taskStore, generatePublishDescription, publishAssetsService, loginStatusService, materialDrivenStarter }) {
  logInfo('[Scheduler] 初始化定时调度引擎 - node-cron', {
    timeZone: SCHEDULER_TIME_ZONE,
    logPath: SCHEDULER_LOG_PATH
  });

  const autoPilotJobs = new Map();
  const autoPilotAvatarJobs = new Map();
  const avatarPendingQueue = [];
  const autoPilotActiveKeys = new Set();
  const fetchState = { lastFetchedDate: '' };
  const warnedScheduledJobs = new Set();

  const SERVER_PORT = process.env.PORT || 3001;

  async function enqueueAutoPilotTopItems(config, result, nowParts, sourceMode) {
    const pipelineModes = getAutoPilotPipelineModes(config);
    for (const pipelineMode of pipelineModes) {
      await enqueueAutoPilotTopItemsForMode(config, result, nowParts, sourceMode, pipelineMode);
    }
  }

  async function enqueueAutoPilotTopItemsForMode(config, rankings, nowParts, sourceMode, pipelineMode) {
    const configCount = Math.max(1, Number(config?.global?.autoPilotCount) || 1);
    const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
    const targetAccountIds = modeSchedule.accountIds || [];
    const targetPartitionIds = modeSchedule.partitionIds || [];
    const targetSourceRanks = modeSchedule.sourceRanks || [];
    const targetPlatforms = modeSchedule.platforms || [];
    const targetAudioPresets = modeSchedule.audioPresets || [];
    const targetImagePresets = modeSchedule.imagePresets || [];
    const mappingLength = Math.max(
      targetAccountIds.length,
      targetPartitionIds.length,
      targetSourceRanks.length,
      targetPlatforms.length,
      targetAudioPresets.length,
      targetImagePresets.length
    );
    const count = Math.max(configCount, mappingLength);
    const sourceIndexByPartition = new Map();
    let rank = 0;

    while (rank < count) {
      const assignedAccountId = String(targetAccountIds[rank] || '').trim();
      const selectedPlatforms = normalizeAutoPilotPlatformSelection(targetPlatforms[rank]);
      const partitionId = getAutoPilotSlotPartitionId(config, pipelineMode, rank);
      const explicitSourceRank = Boolean(String(targetSourceRanks[rank] || '').trim());
      const configuredSourceRank = getAutoPilotSlotSourceRank(config, pipelineMode, rank);
      const result = getRankingForPartition(rankings, partitionId);
      const partition = result?.partition || { id: partitionId, label: partitionId };
      const rankingItems = Array.isArray(result?.items) ? result.items : [];

      if (targetAccountIds.length > 0 && !assignedAccountId) {
        logInfo('[AutoPilot] 检测到当前排名映射为空，已跳过该排名的渲染与发布', {
          rank: rank + 1,
          sourceMode,
          pipelineMode,
          sourcePartitionId: partitionId
        });
        rank += 1;
        continue;
      }

      if (rankingItems.length === 0) {
        logWarn('[AutoPilot] 当前分区榜单没有可用内容，已跳过该账号槽', {
          localDate: nowParts.dateStr,
          rank: rank + 1,
          sourceMode,
          pipelineMode,
          sourcePartitionId: partitionId,
          sourcePartitionLabel: partition.label || ''
        });
        rank += 1;
        continue;
      }

      let slotHandled = false;
      while (!slotHandled && (sourceIndexByPartition.get(partitionId) || 0) < rankingItems.length) {
        const sourceIndex = explicitSourceRank
          ? Math.max(configuredSourceRank - 1, sourceIndexByPartition.get(partitionId) || 0)
          : (sourceIndexByPartition.get(partitionId) || 0);
        const itemRank = sourceIndex + 1;
        const normalized = normalizeRankingItem(rankingItems[sourceIndex], partition);
        sourceIndexByPartition.set(partitionId, sourceIndex + 1);

        if (!normalized.videoUrl) {
          logWarn('[AutoPilot] 当前榜单项缺少视频地址，已跳过', {
            rank: rank + 1,
            sourceRank: itemRank,
            title: normalized.title || '',
            author: normalized.author || '',
            sourceMode,
            pipelineMode,
            sourcePartitionId: normalized.sourcePartitionId || partitionId
          });
          continue;
        }
        const activeKey = `${pipelineMode}:${createAutoPilotActiveKey(normalized, rank + 1)}`;
        if (autoPilotActiveKeys.has(activeKey)) {
          logWarn('[AutoPilot] 当前榜单项源视频已在自动流水线中，继续向后查找替补内容', {
            rank: rank + 1,
            sourceRank: itemRank,
            title: normalized.title || '',
            author: normalized.author || '',
            sourceMode,
            pipelineMode,
            activeKey,
            sourcePartitionId: normalized.sourcePartitionId || partitionId
          });
          continue;
        }

        const sourceVideoKey = normalizeSourceVideoKey(normalized.videoUrl);
        if (publishStore && typeof publishStore.readPublishJobs === 'function') {
          try {
            const payload = publishStore.readPublishJobs();
            const existingJob = findExistingAutoPilotPublishJob(payload.jobs || [], { sourceVideoKey, pipelineMode });
            if (existingJob) {
              logWarn('[AutoPilot] 当前榜单项源视频已存在发布任务，继续向后查找替补内容', {
                rank: rank + 1,
                sourceRank: itemRank,
                title: normalized.title || '',
                author: normalized.author || '',
                existingJobId: existingJob.id || '',
                sourceMode,
                sourceVideoKey,
                sourcePartitionId: normalized.sourcePartitionId || partitionId
              });
              continue;
            }
          } catch (err) {
            logWarn('[AutoPilot] 检查已有发布任务失败，继续按当前榜单项入队', {
              rank: rank + 1,
              sourceRank: itemRank,
              title: normalized.title || '',
              error: err.message
            });
          }
        }

        if (pipelineMode === 'avatar' && materialDrivenStarter && typeof materialDrivenStarter.start === 'function') {
          try {
            const avatarConfig = getAutoPilotSlotAvatarConfig(config, pipelineMode, rank);
            avatarPendingQueue.push({
              rank,
              activeKey,
              sourceMode,
              pipelineMode,
              itemRank,
              normalized,
              sourceRank: itemRank,
              platforms: selectedPlatforms,
              sourcePartitionId: normalized.sourcePartitionId || partitionId,
              sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
              avatarConfig: {
                renderProvider: 'runninghub',
                serverUrl: avatarConfig.serverUrl || '',
                runningHubBaseUrl: avatarConfig.runningHubBaseUrl || '',
                runningHubWorkflowId: avatarConfig.runningHubWorkflowId || '',
                runningHubRunPath: avatarConfig.runningHubRunPath || '',
                runningHubInstanceType: avatarConfig.runningHubInstanceType || '',
                runningHubUsePersonalQueue: avatarConfig.runningHubUsePersonalQueue === true || avatarConfig.runningHubUsePersonalQueue === 'true',
                runningHubAudioNodeId: avatarConfig.runningHubAudioNodeId || '',
                runningHubAudioFieldName: avatarConfig.runningHubAudioFieldName || '',
                runningHubImageNodeId: avatarConfig.runningHubImageNodeId || '',
                runningHubImageFieldName: avatarConfig.runningHubImageFieldName || '',
                runningHubOutputNodeId: avatarConfig.runningHubOutputNodeId || '',
                audioPreset: avatarConfig.audioPreset || DEFAULT_AVATAR_AUDIO_PRESET,
                imagePreset: avatarConfig.imagePreset || DEFAULT_AVATAR_IMAGE_PRESET,
                genText: avatarConfig.genText || ''
              }
            });
            autoPilotActiveKeys.add(activeKey);
            logInfo('[AutoPilot] 已将榜单内容送入 AI剪辑+数字人 待执行队列', {
              rank: rank + 1,
              sourceRank: itemRank,
              title: normalized.title,
              author: normalized.author,
              videoUrl: normalized.videoUrl,
              pipelineMode: 'avatar',
              sourceMode,
              sourcePartitionId: normalized.sourcePartitionId || partitionId,
              sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
              pendingCount: avatarPendingQueue.length
            });
            slotHandled = true;
          } catch (err) {
            logError('[AutoPilot] 送入队列失败，回退到竖屏直发', err, {
              rank: rank + 1,
              sourceRank: itemRank,
              title: normalized.title || '',
              pipelineMode: 'avatar'
            });
            if (verticalQueueService && typeof verticalQueueService.enqueue === 'function') {
              const vjob = verticalQueueService.enqueue({
                sourceType: sourceMode === 'current_ranking' ? 'xai_top10_cached' : 'xai_top10',
                title: normalized.title,
                summary: normalized.summary,
                videoUrl: normalized.videoUrl,
                author: normalized.author,
                postId: normalized.postId,
                postUrl: normalized.postUrl,
                sourcePartitionId: normalized.sourcePartitionId || partitionId,
                sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
                sourceRank: itemRank,
                renderOptions: {}
              });
              autoPilotJobs.set(vjob.id, {
                rank,
                activeKey,
                sourceMode,
                pipelineMode,
                platforms: selectedPlatforms,
                sourcePartitionId: normalized.sourcePartitionId || partitionId,
                sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
                sourceRank: itemRank
              });
              autoPilotActiveKeys.add(activeKey);
              logInfo('[AutoPilot] 已回退到竖屏直发模式', {
                rank: rank + 1,
                queueJobId: vjob.id,
                title: normalized.title
              });
              slotHandled = true;
            }
          }
        } else if (verticalQueueService && typeof verticalQueueService.enqueue === 'function') {
          const vjob = verticalQueueService.enqueue({
            sourceType: sourceMode === 'current_ranking' ? 'xai_top10_cached' : 'xai_top10',
            title: normalized.title,
            summary: normalized.summary,
            videoUrl: normalized.videoUrl,
            author: normalized.author,
            postId: normalized.postId,
            postUrl: normalized.postUrl,
            sourcePartitionId: normalized.sourcePartitionId || partitionId,
            sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
            sourceRank: itemRank,
            renderOptions: {}
          });
          autoPilotJobs.set(vjob.id, {
            rank,
            activeKey,
            sourceMode,
            pipelineMode,
            platforms: selectedPlatforms,
            sourcePartitionId: normalized.sourcePartitionId || partitionId,
            sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
            sourceRank: itemRank
          });
          autoPilotActiveKeys.add(activeKey);
          logInfo('[AutoPilot] 已将榜单内容送入渲染队列', {
            rank: rank + 1,
            sourceRank: itemRank,
            queueJobId: vjob.id,
            title: normalized.title,
            author: normalized.author,
            videoUrl: normalized.videoUrl,
            sourceMode,
            pipelineMode,
            platforms: selectedPlatforms,
            sourcePartitionId: normalized.sourcePartitionId || partitionId,
            sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || ''
          });
          slotHandled = true;
        }
      }

      if (!slotHandled) {
        logWarn('[AutoPilot] 分区榜单已扫描完，未找到可用于该账号槽的不重复视频', {
          requestedCount: count,
          rank: rank + 1,
          scannedCount: sourceIndexByPartition.get(partitionId) || 0,
          sourceMode
        });
        rank += 1;
      }
      rank += 1;
    }

    if (rank < count) {
      logWarn('[AutoPilot] 榜单已扫描完，未找到足够的不重复视频用于补齐账号槽位', {
        requestedCount: count,
        enqueuedCount: rank,
        scannedCount: Array.from(sourceIndexByPartition.values()).reduce((total, value) => total + value, 0),
        sourceMode
      });
    }
  }

  async function loadAutoPilotRankings(config, sourceMode, reason) {
    const partitionIds = getAutoPilotRequiredPartitionIds(config);
    const rankings = new Map();
    const dummyRes = { json: () => {}, send: () => {}, status() { return this; }, headersSent: false };

    for (const partitionId of partitionIds) {
      if (sourceMode === 'current_ranking') {
        const result = xaiService.ensureTranslatedResult(partitionId);
        rankings.set(partitionId, result);
        continue;
      }

      await xaiService.run(`autopilot-${reason}-${partitionId}`, dummyRes, partitionId);
      const result = xaiService.ensureTranslatedResult(partitionId);
      rankings.set(partitionId, result);
    }

    return rankings;
  }

  async function triggerAutoPilotNow(config = publishStore?.readPublishConfig() || {}, options = {}) {
    if (!config?.global?.autoPilotEnabled) {
      return { triggered: false, reason: 'autopilot_disabled' };
    }

    // 每次重新触发前清空上一轮未完成的队列，防止重复堆积
    const flushedVertical = autoPilotJobs.size;
    const flushedAvatar = avatarPendingQueue.length;
    const flushedActiveKeys = autoPilotActiveKeys.size;
    autoPilotJobs.clear();
    autoPilotAvatarJobs.clear();
    avatarPendingQueue.length = 0;
    autoPilotActiveKeys.clear();
    if (flushedVertical + flushedAvatar > 0) {
      logInfo('[AutoPilot] 已清空上一轮待执行队列，准备覆盖为新配置', {
        flushedVerticalJobs: flushedVertical,
        flushedAvatarPending: flushedAvatar,
        flushedActiveKeys
      });
    }

    const nowParts = getLocalParts();
    const useCurrentRanking = Boolean(config?.global?.autoPilotUseCurrentRanking);
    const sourceMode = useCurrentRanking ? 'current_ranking' : 'refresh_ranking';
    const reason = String(options.reason || 'manual').trim() || 'manual';

    logInfo('[AutoPilot] 立即触发无人值守流水线', {
      localDate: nowParts.dateStr,
      localTime: nowParts.timeStr,
      sourceMode,
      reason
    });

    const rankings = await loadAutoPilotRankings(config, sourceMode, reason);
    await enqueueAutoPilotTopItems(config, rankings, nowParts, sourceMode);
    const totalItems = Array.from(rankings.values()).reduce((sum, result) => sum + (Array.isArray(result?.items) ? result.items.length : 0), 0);
    return {
      triggered: true,
      sourceMode,
      partitionIds: Array.from(rankings.keys()),
      count: Math.min(totalItems, config?.global?.autoPilotCount || 1)
    };
  }

  cron.schedule('* * * * *', async () => {
    const config = publishStore?.readPublishConfig() || {};
    const nowParts = getLocalParts();
    const fetchTime = String(config?.global?.autoPilotFetchTime || '07:30').trim();
    const useCurrentRanking = Boolean(config?.global?.autoPilotUseCurrentRanking);
    const [targetH, targetM] = fetchTime.split(':');

    if (nowParts.hour === String(targetH || '').padStart(2, '0') && nowParts.minute === String(targetM || '').padStart(2, '0')) {
      if (fetchState.lastFetchedDate !== nowParts.dateStr) {
        fetchState.lastFetchedDate = nowParts.dateStr;
        logInfo('[Scheduler -> xAI] 到达设定的定时数据更新时间', {
          fetchTime,
          localDate: nowParts.dateStr,
          localTime: nowParts.timeStr,
          autoPilotEnabled: Boolean(config?.global?.autoPilotEnabled),
          useCurrentRanking
        });

        try {
          if (xaiService && typeof xaiService.run === 'function') {
            const dummyRes = { json: () => {}, send: () => {}, status() { return this; }, headersSent: false };

            if (config?.global?.autoPilotEnabled) {
              logInfo('[AutoPilot] 检测到托管模式开启，启动无人值守发片流水线', {
                autoPilotCount: config?.global?.autoPilotCount || 1,
                autoPilotAccountIds: config?.global?.autoPilotAccountIds || [],
                autoPilotTimes: config?.global?.autoPilotTimes || [],
                sourceMode: useCurrentRanking ? 'current_ranking' : 'refresh_ranking'
              });

              if (useCurrentRanking) {
                const rankings = await loadAutoPilotRankings(config, 'current_ranking', 'cron');
                logInfo('[AutoPilot] 已切换为使用当前榜单模式，本轮不会重新抓榜', {
                  localDate: nowParts.dateStr,
                  partitions: Array.from(rankings.keys())
                });
                await enqueueAutoPilotTopItems(config, rankings, nowParts, 'current_ranking');
              } else {
                const rankings = await loadAutoPilotRankings(config, 'refresh_ranking', 'cron');
                await enqueueAutoPilotTopItems(config, rankings, nowParts, 'refresh_ranking');
              }
            } else {
              xaiService.run('system-cron', dummyRes, config?.global?.autoPilotPartitionId || DEFAULT_XAI_PARTITION_ID);
            }
          }
        } catch (err) {
          logError('[Scheduler -> xAI] 定时拉取失败', err, {
            fetchTime,
            localDate: nowParts.dateStr
          });
        }
      }
    }

    if (materialDrivenStarter && verticalQueueService && publishStore) {
      if (autoPilotAvatarJobs.size === 0 && avatarPendingQueue.length > 0) {
        const pendingTask = avatarPendingQueue.shift();
        try {
          const { jobId: avatarJobId, outputPath: avatarOutputPath } = await materialDrivenStarter.start({
            videoUrl: pendingTask.normalized.videoUrl,
            title: pendingTask.normalized.title,
            summary: pendingTask.normalized.summary,
            author: pendingTask.normalized.author,
            postId: pendingTask.normalized.postId,
            postUrl: pendingTask.normalized.postUrl,
            sourcePartitionId: pendingTask.sourcePartitionId || pendingTask.normalized.sourcePartitionId || '',
            sourcePartitionLabel: pendingTask.sourcePartitionLabel || pendingTask.normalized.sourcePartitionLabel || '',
            sourceRank: pendingTask.sourceRank || pendingTask.itemRank || 0,
            avatarConfig: pendingTask.avatarConfig
          });
          const startedAvatarConfig = pendingTask.avatarConfig || {};
          autoPilotAvatarJobs.set(avatarJobId, {
            rank: pendingTask.rank,
            activeKey: pendingTask.activeKey,
            sourceMode: pendingTask.sourceMode,
            pipelineMode: pendingTask.pipelineMode || 'avatar',
            outputPath: avatarOutputPath,
            title: pendingTask.normalized.title,
            summary: pendingTask.normalized.summary,
            author: pendingTask.normalized.author,
            postId: pendingTask.normalized.postId,
            postUrl: pendingTask.normalized.postUrl,
            sourcePartitionId: pendingTask.sourcePartitionId || pendingTask.normalized.sourcePartitionId || '',
            sourcePartitionLabel: pendingTask.sourcePartitionLabel || pendingTask.normalized.sourcePartitionLabel || '',
            sourceRank: pendingTask.sourceRank || pendingTask.itemRank || 0,
            avatarConfig: {
              audioPreset: startedAvatarConfig.audioPreset || DEFAULT_AVATAR_AUDIO_PRESET,
              imagePreset: startedAvatarConfig.imagePreset || DEFAULT_AVATAR_IMAGE_PRESET
            },
            platforms: pendingTask.platforms || DEFAULT_AUTO_PILOT_PLATFORMS
          });
          logInfo('[AutoPilot] 调度器从队列中启动了新的 AI剪辑+数字人 任务', {
            rank: pendingTask.rank + 1,
            avatarJobId,
            outputPath: avatarOutputPath,
            title: pendingTask.normalized.title,
            pipelineMode: pendingTask.pipelineMode || 'avatar',
            audioPreset: startedAvatarConfig.audioPreset || DEFAULT_AVATAR_AUDIO_PRESET,
            imagePreset: startedAvatarConfig.imagePreset || DEFAULT_AVATAR_IMAGE_PRESET,
            remainingInQueue: avatarPendingQueue.length
          });
        } catch (err) {
          logError('[AutoPilot] 从队列启动 AI剪辑+数字人 任务失败', err, {
            rank: pendingTask.rank + 1,
            title: pendingTask.normalized.title
          });
        }
      }

      for (const [avatarJobId, meta] of Array.from(autoPilotAvatarJobs.entries())) {
        const rank = typeof meta === 'object' ? meta.rank : meta;
        const activeKey = typeof meta === 'object' ? meta.activeKey : '';
        const taskStatus = materialDrivenStarter.getStatus(avatarJobId);

        if (!taskStatus) {
          autoPilotAvatarJobs.delete(avatarJobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot:Avatar] 数字人任务状态丢失，已从监控列表移除', {
            avatarJobId,
            rank: rank + 1
          });
          continue;
        }

        if (taskStatus.status === 'failed') {
          autoPilotAvatarJobs.delete(avatarJobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot:Avatar] AI剪辑+数字人 流水线失败，停止后续自动发布', {
            avatarJobId,
            rank: rank + 1,
            error: taskStatus.error || ''
          });
          continue;
        }

        if (taskStatus.status === 'completed') {
          autoPilotAvatarJobs.delete(avatarJobId);
          logInfo('[AutoPilot:Avatar] AI剪辑+数字人 制作完成，桥接到竖屏合成', {
            avatarJobId,
            rank: rank + 1,
            outputPath: meta.outputPath || '',
            videoUrl: taskStatus.videoUrl || ''
          });

          if (verticalQueueService && typeof verticalQueueService.enqueue === 'function') {
            const outputVideoUrl = taskStatus.videoUrl
              ? `http://localhost:${SERVER_PORT}${taskStatus.videoUrl}`
              : '';
            if (!outputVideoUrl) {
              logWarn('[AutoPilot:Avatar] 未找到数字人成品视频URL，无法入队竖屏合成', {
                avatarJobId,
                rank: rank + 1
              });
              continue;
            }
            const vjob = verticalQueueService.enqueue({
              sourceType: 'material_driven_avatar',
              title: meta.title || '',
              summary: meta.summary || '',
              videoUrl: outputVideoUrl,
              sourceTaskDir: meta.outputPath ? path.basename(meta.outputPath) : '',
              author: meta.author || '',
              postId: meta.postId || '',
              postUrl: meta.postUrl || '',
              sourcePartitionId: meta.sourcePartitionId || '',
              sourcePartitionLabel: meta.sourcePartitionLabel || '',
              sourceRank: meta.sourceRank || 0,
              renderOptions: {}
            });
            autoPilotJobs.set(vjob.id, {
              rank,
              activeKey,
              sourceMode: meta.sourceMode || '',
              pipelineMode: meta.pipelineMode || 'avatar',
              platforms: meta.platforms || DEFAULT_AUTO_PILOT_PLATFORMS,
              sourcePartitionId: meta.sourcePartitionId || '',
              sourcePartitionLabel: meta.sourcePartitionLabel || '',
              sourceRank: meta.sourceRank || 0,
              avatarConfig: meta.avatarConfig || {}
            });
            logInfo('[AutoPilot:Avatar] 数字人成片已送入竖屏渲染队列', {
              avatarJobId,
              queueJobId: vjob.id,
              rank: rank + 1,
              videoUrl: outputVideoUrl
            });
          }
        }
      }
    }

    if (verticalQueueService && publishStore && generatePublishDescription && publishAssetsService) {
      for (const [vjobId, meta] of Array.from(autoPilotJobs.entries())) {
        const rank = typeof meta === 'object' ? meta.rank : meta;
        const activeKey = typeof meta === 'object' ? meta.activeKey : '';
        const pipelineMode = typeof meta === 'object' ? String(meta.pipelineMode || 'vertical').trim() || 'vertical' : 'vertical';
        const selectedPlatforms = typeof meta === 'object'
          ? normalizeAutoPilotPlatformSelection(meta.platforms)
          : [...DEFAULT_AUTO_PILOT_PLATFORMS];
        const sourcePartitionId = typeof meta === 'object' ? String(meta.sourcePartitionId || '').trim() : '';
        const sourcePartitionLabel = typeof meta === 'object' ? String(meta.sourcePartitionLabel || '').trim() : '';
        const sourceRank = typeof meta === 'object' ? normalizeAutoPilotSourceRank(meta.sourceRank, rank + 1) : rank + 1;
        const vjob = verticalQueueService.getJob(vjobId);
        if (!vjob) {
          autoPilotJobs.delete(vjobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot] 渲染队列任务不存在，已从监控列表移除', { queueJobId: vjobId, rank: rank + 1 });
          continue;
        }
        if (['cancelled', 'failed', 'skipped'].includes(vjob.status)) {
          autoPilotJobs.delete(vjobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot] 渲染任务失败、取消或跳过，停止后续自动发布', {
            queueJobId: vjobId,
            rank: rank + 1,
            status: vjob.status
          });
          continue;
        }

        if (vjob.status === 'completed') {
          autoPilotJobs.delete(vjobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logInfo('[AutoPilot] 视频渲染完毕，开始自动创建发布任务', {
            queueJobId: vjobId,
            rank: rank + 1,
            title: vjob.title || '',
            pipelineMode
          });

          publishAssetsService.resetPublishAssetsCache();
          const assets = publishAssetsService.collectPublishAssets();
          const asset = assets.find((item) => String(item.url).includes(vjobId));

          if (!asset) {
            logWarn('[AutoPilot] 无法在素材库中找到渲染成品，跳过创建发布任务', {
              queueJobId: vjobId
            });
            continue;
          }

          const sourceVideoKey = normalizeSourceVideoKey(
            asset.metadata?.videoUrl
            || asset.metadata?.sourceVideoUrl
            || asset.metadata?.originalVideoUrl
            || ''
          );
          try {
            const payload = publishStore.readPublishJobs();
            const existingJob = findExistingAutoPilotPublishJob(payload.jobs || [], {
              queueJobId: vjobId,
              sourceVideoKey,
              pipelineMode,
              asset
            });
            if (existingJob) {
              logWarn('[AutoPilot] 已存在同源视频或同成片发布任务，跳过重复创建', {
                queueJobId: vjobId,
                existingJobId: existingJob.id || '',
                rank: rank + 1,
                sourceVideoKey
              });
              continue;
            }
          } catch (err) {
            logWarn('[AutoPilot] 检查重复发布任务失败，跳过自动创建以避免重复发布', {
              queueJobId: vjobId,
              rank: rank + 1,
              error: err.message
            });
            continue;
          }

          const sourceText = asset.metadata?.sourceSummary || asset.metadata?.suggestedDescription || '';
          const desc = await generatePublishDescription(
            sourceText,
            {
              title: asset.compactLabel || asset.label,
              includeTags: true,
              allowFallback: false,
              timeoutMs: 180000
            }
          );
          if (!desc) {
            logWarn('[AutoPilot] 模型未返回有效发布描述，跳过创建发布任务', {
              queueJobId: vjobId,
              rank: rank + 1,
              title: asset.compactLabel || asset.label
            });
            continue;
          }

          const publishData = {
            title: asset.compactLabel || asset.label,
            description: desc || asset.metadata?.suggestedDescription || '',
            tagStrategy: 'model',
            tags: [],
            coverUrl: ''
          };

          const pcfg = config.wechatChannels;
          const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
          const targetAccountIds = modeSchedule.accountIds || [];
          const assignedAccountId = String(targetAccountIds[rank] || '').trim();
          const shouldPublishWechat = selectedPlatforms.includes('wechatChannels');

          let account = null;
          if (shouldPublishWechat && assignedAccountId && Array.isArray(pcfg?.accounts)) {
            account = pcfg.accounts.find((item) => item.id === assignedAccountId) || null;
          }

          if (shouldPublishWechat && !account) {
            if (targetAccountIds.length > 0) {
              logWarn('[AutoPilot] 映射表中未找到该排名对应的有效账号，已跳过创建发布任务', {
                queueJobId: vjobId,
                rank: rank + 1,
                assignedAccountId
              });
              continue;
            } else if (Array.isArray(pcfg?.accounts) && pcfg.accounts.length > 0) {
              account = pcfg.accounts[0];
            }
          }

          if (shouldPublishWechat && !account) {
            logWarn('[AutoPilot] 没有任何可用微信账号配置，发布任务将创建为空记录', {
              queueJobId: vjobId,
              rank: rank + 1
            });
          }

          const targetTimes = modeSchedule.times || [];
          const targetTime = String(targetTimes[rank] || config?.global?.autoPilotTime || '08:00').trim();
          const isoScheduledTime = buildShanghaiIso(nowParts.dateStr, targetTime);
          const scheduledAlreadyDue = new Date(isoScheduledTime).getTime() <= Date.now();

          const pJob = {
            id: publishStore.makeJobId ? publishStore.makeJobId() : `job_${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            archived: false,
            archivedAt: null,
            status: 'scheduled_wait',
            scheduledAt: isoScheduledTime,
            asset,
            publishData,
            selectedPlatforms,
            platformSelections: buildAutoPilotPlatformSelections(config, selectedPlatforms, account),
            platformErrors: [],
            autoPilot: {
              queueJobId: vjobId,
              rank: rank + 1,
              activeKey,
              pipelineMode,
              platforms: selectedPlatforms,
              sourceVideoUrl: asset.metadata?.videoUrl || asset.metadata?.sourceVideoUrl || '',
              sourcePostId: asset.metadata?.postId || asset.metadata?.sourcePostId || '',
              sourceMode: typeof meta === 'object' ? meta.sourceMode || '' : '',
              sourcePartitionId: sourcePartitionId || asset.metadata?.sourcePartitionId || '',
              sourcePartitionLabel: sourcePartitionLabel || asset.metadata?.sourcePartitionLabel || '',
              sourceRank: sourceRank || asset.metadata?.sourceRank || 0,
              ...(pipelineMode === 'avatar'
                ? {
                  avatarConfig: {
                    audioPreset: meta?.avatarConfig?.audioPreset || DEFAULT_AVATAR_AUDIO_PRESET,
                    imagePreset: meta?.avatarConfig?.imagePreset || DEFAULT_AVATAR_IMAGE_PRESET
                  }
                }
                : {})
            }
          };

          const payload = publishStore.readPublishJobs();
          const existingJobCheck = findExistingAutoPilotPublishJob(payload.jobs || [], {
            queueJobId: vjobId,
            sourceVideoKey,
            accountId: account?.id || '',
            pipelineMode,
            asset
          });
          if (existingJobCheck) {
            logWarn('[AutoPilot] 写入前发现同源视频或同成片发布任务，跳过重复创建', {
              queueJobId: vjobId,
              existingJobId: existingJobCheck.id || '',
              rank: rank + 1,
              sourceVideoKey
            });
            continue;
          }
          payload.jobs.unshift(pJob);
          publishStore.writePublishJobs(payload);
          const reconciled = publishStore.reconcileAndPersistPublishJobs(config);
          const storedJob = (reconciled.jobs || []).find((item) => item.id === pJob.id) || pJob;

          logInfo('[AutoPilot] 已创建多平台定时发布任务', {
            ...formatJobBrief(storedJob),
            queueJobId: vjobId,
            rank: rank + 1,
            pipelineMode,
            selectedPlatforms,
            localTargetDate: nowParts.dateStr,
            localTargetTime: targetTime,
            publishTimingMode: scheduledAlreadyDue ? 'catch_up_after_render' : 'scheduled',
            assignedAccountId: account?.id || '',
            assignedAccountLabel: account?.displayName || account?.finderUserName || account?.helperAccount || '',
            platformErrors: storedJob.platformErrors || [],
            wechatTaskStatus: (storedJob.platformTasks || []).find((task) => task.platform === 'wechatChannels')?.status || ''
          });

          if (scheduledAlreadyDue) {
            logInfo('[AutoPilot] 目标发布时间早于渲染完成时间，本轮会在成片后立即补发', {
              queueJobId: vjobId,
              jobId: storedJob.id,
              targetTime,
              scheduledTime: isoScheduledTime
            });
          }
        }
      }
    }

    if (!publishStore || typeof publishStore.getDueScheduledJobs !== 'function') {
      return;
    }

    let dueJobs = [];
    try {
      dueJobs = publishStore.getDueScheduledJobs(Date.now());
      if (dueJobs.length > 0) {
        logInfo('[Scheduler -> 微信发布] 查询到到期定时任务', {
          count: dueJobs.length,
          jobs: dueJobs.map((job) => formatJobBrief(job))
        });
      }
    } catch (err) {
      logError('[Scheduler -> 微信发布] 查询到期任务失败', err);
      return;
    }

    try {
      const payload = publishStore.readPublishJobs();
      for (const job of payload.jobs || []) {
        if (!job?.scheduledAt || String(job.status || '') === 'scheduled_wait') {
          continue;
        }
        if (['published', 'failed', 'cancelled', 'ready_for_manual_publish'].includes(String(job.status || ''))) {
          continue;
        }
        const warnKey = `${job.id}:${job.status}:${job.scheduledAt}`;
        if (warnedScheduledJobs.has(warnKey)) {
          continue;
        }
        warnedScheduledJobs.add(warnKey);
        logWarn('[Scheduler -> 微信发布] 发现带有 scheduledAt 但状态不是 scheduled_wait 的任务，这类任务不会被定时发送', {
          ...formatJobBrief(job),
          platformErrors: job.platformErrors || [],
          wechatTaskStatus: (job.platformTasks || []).find((task) => task.platform === 'wechatChannels')?.status || ''
        });
      }
    } catch (err) {
      logError('[Scheduler -> 微信发布] 检查异常定时任务失败', err);
    }

    for (const job of dueJobs) {
      const scheduledPlatformTasks = (job.platformTasks || []).filter((task) => String(task?.status || '') === 'scheduled_wait');
      logInfo('[Scheduler -> 多平台发布] 定时任务到期，开始启动平台自动发布', {
        ...formatJobBrief(job),
        platforms: scheduledPlatformTasks.map((task) => task.platform)
      });
      try {
        for (const task of scheduledPlatformTasks) {
          const platformKey = String(task.platform || '').trim();
          if (wechatRpaService && typeof wechatRpaService.startPlatformRpa === 'function') {
            wechatRpaService.startPlatformRpa(job.id, platformKey, 'publish').catch((err) => {
              logError('[Scheduler -> 多平台发布] 启动失败', err, { ...formatJobBrief(job), platform: platformKey });
            });
            logInfo('[Scheduler -> 多平台发布] 已触发平台自动发布', { ...formatJobBrief(job), platform: platformKey });
          } else if (platformKey === 'wechatChannels' && wechatRpaService && typeof wechatRpaService.startWechatRpa === 'function') {
            wechatRpaService.startWechatRpa(job.id, 'publish').catch((err) => {
              logError('[Scheduler -> 微信发布] 启动失败', err, formatJobBrief(job));
            });
            logInfo('[Scheduler -> 微信发布] 已触发微信自动发布', formatJobBrief(job));
          } else {
            logWarn('[Scheduler -> 多平台发布] 平台 RPA 服务不可用，无法执行定时发布', { ...formatJobBrief(job), platform: platformKey });
          }
        }
      } catch (err) {
        logError('[Scheduler -> 多平台发布] 触发任务失败', err, formatJobBrief(job));
      }
    }
  });

  // 自动归档已发布任务
  cron.schedule('* * * * *', async () => {
    if (!publishStore || typeof publishStore.getDueArchiveJobs !== 'function') {
      return;
    }

    const config = publishStore?.readPublishConfig() || {};
    const autoArchiveEnabled = config?.global?.autoArchiveEnabled !== undefined
      ? Boolean(config.global.autoArchiveEnabled)
      : process.env.AUTO_ARCHIVE_PUBLISHED !== 'false';

    if (!autoArchiveEnabled) {
      return;
    }

    let dueJobs = [];
    try {
      dueJobs = publishStore.getDueArchiveJobs(Date.now());
      if (dueJobs.length > 0) {
        logInfo('[Scheduler -> 自动归档] 查询到到期归档任务', {
          count: dueJobs.length,
          jobs: dueJobs.map((job) => ({
            jobId: job?.id || '',
            title: job?.publishData?.title || job?.asset?.label || '',
            status: job?.status || '',
            archiveDueAt: job?.archiveDueAt || null
          }))
        });
      }
    } catch (err) {
      logError('[Scheduler -> 自动归档] 查询到期归档任务失败', err);
      return;
    }

    for (const job of dueJobs) {
      try {
        publishStore.archivePublishJob(job.id, true);
        logInfo('[Scheduler -> 自动归档] 已自动归档已发布任务', {
          jobId: job.id,
          title: job?.publishData?.title || job?.asset?.label || '',
          archiveDueAt: job.archiveDueAt
        });
      } catch (err) {
        logError('[Scheduler -> 自动归档] 归档任务失败', err, {
          jobId: job.id,
          title: job?.publishData?.title || job?.asset?.label || ''
        });
      }
    }
  });

  // 自动清理旧运行产物
  const cleanupConfig = getCleanupConfig();
  if (cleanupConfig.enabled) {
    const baseDir = path.join(__dirname, '../../..');

    logInfo('[Scheduler] 启动运行产物自动清理', {
      schedule: cleanupConfig.schedule,
      dryRun: cleanupConfig.dryRun,
      rules: Object.keys(cleanupConfig.rules).filter(k => cleanupConfig.rules[k].enabled)
    });

    cron.schedule(cleanupConfig.schedule, () => {
      logInfo('[Scheduler -> 清理] 开始执行定时清理任务');

      try {
        const summary = runCleanup(baseDir, {
          dryRun: cleanupConfig.dryRun,
          taskStore,
          verticalQueueService
        });

        logInfo('[Scheduler -> 清理] 清理任务完成', {
          filesRemoved: summary.totalFilesRemoved,
          dirsRemoved: summary.totalDirsRemoved,
          taskRecordsRemoved: summary.totalTaskRecordsRemoved,
          bytesFreed: summary.totalBytesFreed,
          errors: summary.totalErrors,
          dryRun: summary.dryRun
        });

        // 如果有错误，记录详情
        if (summary.totalErrors > 0) {
          summary.results.forEach(result => {
            if (result.errors.length > 0) {
              logWarn('[Scheduler -> 清理] 清理规则执行出错', {
                rule: result.rule,
                errors: result.errors
              });
            }
          });
        }
      } catch (err) {
        logError('[Scheduler -> 清理] 清理任务失败', err);
      }
    }, {
      timezone: SCHEDULER_TIME_ZONE
    });
  } else {
    logInfo('[Scheduler] 运行产物自动清理已禁用');
  }

  // 登录状态定时检测
  if (loginStatusService) {
    const schedulerBaseDir = path.join(__dirname, '../../..');
    const initialLoginCheckConfig = readLoginCheckScheduleConfig(schedulerBaseDir);
    const loginCheckState = {
      lastStartedAt: Date.now(),
      running: false
    };

    logInfo('[Scheduler] 启动登录状态定时检测', {
      interval: `${initialLoginCheckConfig.checkInterval} 分钟`,
      cronExpression: LOGIN_CHECK_CRON_EXPRESSION,
      scheduleMode: 'elapsed_interval_gate',
      enabled: initialLoginCheckConfig.loginCheckEnabled
    });

    cron.schedule(LOGIN_CHECK_CRON_EXPRESSION, async () => {
      const { checkInterval, loginCheckEnabled } = readLoginCheckScheduleConfig(schedulerBaseDir);
      if (!loginCheckEnabled) {
        return;
      }

      if (loginCheckState.running) {
        logWarn('[Scheduler -> 登录检测] 上一次检测尚未结束，跳过本轮');
        return;
      }

      const nowMs = Date.now();
      if (!isLoginCheckDue(loginCheckState, nowMs, checkInterval)) {
        return;
      }

      loginCheckState.lastStartedAt = nowMs;
      loginCheckState.running = true;

      try {
        logInfo('[Scheduler -> 登录检测] 开始定时检测登录状态', {
          interval: `${checkInterval} 分钟`
        });
        const summary = await loginStatusService.checkAllAccounts({ notifyFeishu: false });

        logInfo('[Scheduler -> 登录检测] 检测完成', {
          checked: summary.checked,
          logged_in: summary.logged_in,
          need_login: summary.need_login,
          error: summary.error
        });

        // 登录检查只更新本地状态缓存和二维码信息，不自动推送飞书。
      } catch (err) {
        logError('[Scheduler -> 登录检测] 定时检测失败', err);
      } finally {
        loginCheckState.running = false;
      }
    }, {
      timezone: SCHEDULER_TIME_ZONE
    });
  }

  return {
    triggerAutoPilotNow
  };
}

module.exports = {
  startScheduler
};
