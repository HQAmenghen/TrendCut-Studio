const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { readProjectEnv } = require('../../../scripts/utils/env');
const { registerCleanupScheduler } = require('./schedulerCleanup');
const { registerLoginCheckScheduler } = require('./schedulerLoginCheck');
const { createPublishScheduler } = require('./schedulerPublish');
const {
  DEFAULT_AUTO_PILOT_PLATFORMS,
  DEFAULT_AVATAR_AUDIO_PRESET,
  DEFAULT_AVATAR_IMAGE_PRESET,
  DEFAULT_XAI_PARTITION_ID,
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
  getLocalParts,
  getPlatformAccount,
  getPlatformAccountLabel,
  getRankingForPartition,
  isLoginCheckDue,
  normalizeAutoPilotPlatformSelection,
  normalizeAutoPilotSourceRank,
  normalizeNonNegativeInteger,
  normalizeRankingItem,
  normalizeSourceVideoKey
} = require('./schedulerUtils');

const SCHEDULER_TIME_ZONE = 'Asia/Shanghai';
const SCHEDULER_LOG_PATH = path.join(__dirname, '../../../data/logs/scheduler.log');
const LOGIN_CHECK_CRON_EXPRESSION = '* * * * *';

function readLoginCheckScheduleConfig(baseDir) {
  const { values } = readProjectEnv(baseDir);
  return buildLoginCheckScheduleConfig(values);
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
  const SERVER_PORT = process.env.PORT || 3001;

  const publishScheduler = createPublishScheduler({
    cron,
    publishStore,
    wechatRpaService,
    formatJobBrief,
    logInfo,
    logWarn,
    logError
  });

  function enqueueAvatarReplacement(config, meta = {}, reason = '') {
    const rank = normalizeNonNegativeInteger(meta.rank, 0);
    const maxRetries = normalizeNonNegativeInteger(meta.maxRetries, getAutoPilotSlotRetryLimit(config));
    const retryCount = normalizeNonNegativeInteger(meta.retryCount, 0);
    const fallbackCandidates = Array.isArray(meta.fallbackCandidates) ? [...meta.fallbackCandidates] : [];
    if (retryCount >= maxRetries || fallbackCandidates.length === 0) {
      logWarn('[AutoPilot:Avatar] 该账号槽没有可用补位素材，无法继续补发', {
        rank: rank + 1,
        retryCount,
        maxRetries,
        reason
      });
      return false;
    }

    while (fallbackCandidates.length > 0) {
      const candidate = fallbackCandidates.shift();
      const normalized = candidate?.normalized || {};
      const activeKey = `${meta.pipelineMode || 'avatar'}:${createAutoPilotActiveKey(normalized, rank + 1)}`;
      if (autoPilotActiveKeys.has(activeKey)) {
        continue;
      }

      const sourceVideoKey = normalizeSourceVideoKey(normalized.videoUrl);
      if (publishStore && typeof publishStore.readPublishJobs === 'function') {
        try {
          const payload = publishStore.readPublishJobs();
          const existingJob = findExistingAutoPilotPublishJob(payload.jobs || [], {
            sourceVideoKey,
            pipelineMode: meta.pipelineMode || 'avatar'
          });
          if (existingJob) {
            continue;
          }
        } catch (err) {
          logWarn('[AutoPilot:Avatar] 检查补位素材重复任务失败，继续尝试入队', {
            rank: rank + 1,
            sourceRank: candidate.sourceRank,
            error: err.message
          });
        }
      }

      avatarPendingQueue.unshift({
        rank,
        activeKey,
        sourceMode: meta.sourceMode || '',
        pipelineMode: meta.pipelineMode || 'avatar',
        itemRank: candidate.sourceRank,
        normalized,
        sourceRank: candidate.sourceRank,
        platforms: meta.platforms || DEFAULT_AUTO_PILOT_PLATFORMS,
        sourcePartitionId: candidate.sourcePartitionId || normalized.sourcePartitionId || meta.sourcePartitionId || '',
        sourcePartitionLabel: candidate.sourcePartitionLabel || normalized.sourcePartitionLabel || meta.sourcePartitionLabel || '',
        avatarConfig: meta.avatarConfig || {},
        retryCount: retryCount + 1,
        maxRetries,
        fallbackCandidates,
        retryReason: reason
      });
      autoPilotActiveKeys.add(activeKey);
      logInfo('[AutoPilot:Avatar] 已为失败账号槽加入补位素材', {
        rank: rank + 1,
        sourceRank: candidate.sourceRank,
        title: normalized.title || '',
        author: normalized.author || '',
        retryCount: retryCount + 1,
        maxRetries,
        reason,
        pendingCount: avatarPendingQueue.length
      });
      return true;
    }

    logWarn('[AutoPilot:Avatar] 补位候选已耗尽，无法继续补发', {
      rank: rank + 1,
      retryCount,
      maxRetries,
      reason
    });
    return false;
  }

  function inferRecoveredPipelineMode(metadata = {}) {
    const explicitMode = String(metadata.pipelineMode || metadata.autoPilot?.pipelineMode || '').trim();
    if (explicitMode) return explicitMode;
    const sourceType = String(metadata.sourceType || '').trim();
    return sourceType === 'material_driven_avatar' ? 'avatar' : 'vertical';
  }

  function getRecoveredAutoPilotMeta(task, config = {}) {
    const metadata = task?.metadata || {};
    const originalItem = metadata.originalItem && typeof metadata.originalItem === 'object'
      ? metadata.originalItem
      : {};
    const autoPilot = metadata.autoPilot && typeof metadata.autoPilot === 'object'
      ? metadata.autoPilot
      : {};
    const pipelineMode = inferRecoveredPipelineMode({ ...metadata, ...originalItem, autoPilot });
    const hasSavedRank = autoPilot.rank !== undefined || metadata.rank !== undefined;
    const rank = hasSavedRank
      ? normalizeNonNegativeInteger(autoPilot.rank ?? metadata.rank, 0)
      : Math.max(0, normalizeAutoPilotSourceRank(metadata.sourceRank || originalItem.sourceRank || autoPilot.sourceRank || 1, 1) - 1);
    const sourceMode = metadata.sourceMode || autoPilot.sourceMode || '';
    const selectedPlatforms = normalizeAutoPilotPlatformSelection(
      autoPilot.platforms || metadata.platforms || [],
      getAutoPilotModeSchedule(config, pipelineMode).platforms?.[rank] || DEFAULT_AUTO_PILOT_PLATFORMS
    );
    const videoUrl = metadata.videoUrl || originalItem.videoUrl || autoPilot.sourceVideoUrl || '';
    const postId = metadata.postId || originalItem.postId || autoPilot.sourcePostId || '';
    const normalized = {
      videoUrl,
      postId,
      title: metadata.title || originalItem.title || '',
      author: metadata.author || originalItem.author || ''
    };

    return {
      rank,
      activeKey: autoPilot.activeKey || `${pipelineMode}:${createAutoPilotActiveKey(normalized, rank + 1)}`,
      sourceMode,
      pipelineMode,
      platforms: selectedPlatforms,
      sourcePartitionId: metadata.sourcePartitionId || originalItem.sourcePartitionId || autoPilot.sourcePartitionId || '',
      sourcePartitionLabel: metadata.sourcePartitionLabel || originalItem.sourcePartitionLabel || autoPilot.sourcePartitionLabel || '',
      sourceRank: normalizeAutoPilotSourceRank(metadata.sourceRank || originalItem.sourceRank || autoPilot.sourceRank || rank + 1, rank + 1),
      avatarConfig: metadata.avatarConfig || autoPilot.avatarConfig || {},
      recovered: true
    };
  }

  function recoverAutoPilotVerticalJobs(config = publishStore?.readPublishConfig() || {}) {
    if (!taskStore || typeof taskStore.listTasks !== 'function' || !verticalQueueService) {
      return { watched: 0 };
    }

    const recoverableStatuses = new Set(['queued', 'pending', 'running', 'in_progress', 'reviewing', 'interrupted']);
    const beforeRecoveryTasks = taskStore.listTasks('vertical_queue', 100);
    const recoverableTaskIds = new Set(
      beforeRecoveryTasks
        .filter((task) => recoverableStatuses.has(String(task?.status || '').trim()))
        .map((task) => task.id)
        .filter(Boolean)
    );

    if (verticalQueueService && typeof verticalQueueService.recoverPersistedJobs === 'function') {
      try {
        verticalQueueService.recoverPersistedJobs({ includeCompletedArtifacts: false });
      } catch (err) {
        logWarn('[AutoPilot:Recovery] 恢复竖屏队列内存状态失败，继续尝试监听 DB 任务', {
          error: err.message
        });
      }
    }

    const tasks = taskStore.listTasks('vertical_queue', 100);
    let watched = 0;
    for (const task of tasks) {
      if (!task || autoPilotJobs.has(task.id)) continue;
      if (!recoverableTaskIds.has(task.id)) continue;
      const metadata = task.metadata || {};
      const originalItem = metadata.originalItem || {};
      const sourceType = String(metadata.sourceType || originalItem.sourceType || '').trim();
      const sourceRank = normalizeAutoPilotSourceRank(metadata.sourceRank || originalItem.sourceRank || 0, 0);
      const isAutoPilotSource = Boolean(metadata.autoPilot)
        || sourceType === 'material_driven_avatar'
        || sourceType === 'xai_top10_cached'
        || (sourceType === 'xai_top10' && sourceRank > 0);
      if (!isAutoPilotSource && !metadata.autoPilot) continue;

      const runtimeJob = typeof verticalQueueService.getJob === 'function' ? verticalQueueService.getJob(task.id) : null;
      if (!runtimeJob || runtimeJob.status !== 'completed') continue;

      const meta = getRecoveredAutoPilotMeta(task, config);
      try {
        const sourceVideoKey = normalizeSourceVideoKey(
          metadata.videoUrl
          || originalItem.videoUrl
          || metadata.autoPilot?.sourceVideoUrl
          || ''
        );
        const payload = publishStore?.readPublishJobs ? publishStore.readPublishJobs() : { jobs: [] };
        const existingJob = findExistingAutoPilotPublishJob(payload.jobs || [], {
          queueJobId: task.id,
          sourceVideoKey,
          pipelineMode: meta.pipelineMode
        });
        if (existingJob) {
          continue;
        }
      } catch (err) {
        logWarn('[AutoPilot:Recovery] 检查已恢复任务是否已有发布单失败，暂不恢复监控以避免重复发布', {
          queueJobId: task.id,
          error: err.message
        });
        continue;
      }
      autoPilotJobs.set(task.id, meta);
      if (meta.activeKey) autoPilotActiveKeys.add(meta.activeKey);
      watched += 1;
      logInfo('[AutoPilot:Recovery] 已恢复竖屏队列任务监控', {
        queueJobId: task.id,
        status: task.status,
        rank: meta.rank + 1,
        pipelineMode: meta.pipelineMode
      });
    }
    return { watched };
  }

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
            const fallbackCandidates = collectAutoPilotFallbackCandidates({
              rankingItems,
              partition,
              partitionId,
              startIndex: sourceIndex + 1
            });
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
              retryCount: 0,
              maxRetries: getAutoPilotSlotRetryLimit(config),
              fallbackCandidates,
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
              const autoPilotMeta = {
                rank,
                activeKey,
                sourceMode,
                pipelineMode,
                platforms: selectedPlatforms,
                sourcePartitionId: normalized.sourcePartitionId || partitionId,
                sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
                sourceRank: itemRank
              };
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
                renderOptions: {},
                autoPilot: autoPilotMeta
              });
              autoPilotJobs.set(vjob.id, autoPilotMeta);
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
          const autoPilotMeta = {
            rank,
            activeKey,
            sourceMode,
            pipelineMode,
            platforms: selectedPlatforms,
            sourcePartitionId: normalized.sourcePartitionId || partitionId,
            sourcePartitionLabel: normalized.sourcePartitionLabel || partition.label || '',
            sourceRank: itemRank
          };
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
            renderOptions: {},
            autoPilot: autoPilotMeta
          });
          autoPilotJobs.set(vjob.id, autoPilotMeta);
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
            retryCount: normalizeNonNegativeInteger(pendingTask.retryCount, 0),
            maxRetries: normalizeNonNegativeInteger(pendingTask.maxRetries, getAutoPilotSlotRetryLimit(config)),
            fallbackCandidates: Array.isArray(pendingTask.fallbackCandidates) ? pendingTask.fallbackCandidates : [],
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
          if (pendingTask.activeKey) autoPilotActiveKeys.delete(pendingTask.activeKey);
          logError('[AutoPilot] 从队列启动 AI剪辑+数字人 任务失败', err, {
            rank: pendingTask.rank + 1,
            title: pendingTask.normalized.title
          });
          enqueueAvatarReplacement(config, pendingTask, 'avatar_start_failed');
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
          enqueueAvatarReplacement(config, meta, 'avatar_pipeline_failed');
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
            const autoPilotMeta = {
              rank,
              activeKey,
              sourceMode: meta.sourceMode || '',
              pipelineMode: meta.pipelineMode || 'avatar',
              platforms: meta.platforms || DEFAULT_AUTO_PILOT_PLATFORMS,
              sourcePartitionId: meta.sourcePartitionId || '',
              sourcePartitionLabel: meta.sourcePartitionLabel || '',
              sourceRank: meta.sourceRank || 0,
              avatarConfig: meta.avatarConfig || {},
              retryCount: normalizeNonNegativeInteger(meta.retryCount, 0),
              maxRetries: normalizeNonNegativeInteger(meta.maxRetries, getAutoPilotSlotRetryLimit(config)),
              fallbackCandidates: Array.isArray(meta.fallbackCandidates) ? meta.fallbackCandidates : []
            };
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
              renderOptions: {},
              autoPilot: autoPilotMeta
            });
            autoPilotJobs.set(vjob.id, autoPilotMeta);
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
      recoverAutoPilotVerticalJobs(config);
    }

    if (autoPilotJobs.size > 0 && verticalQueueService && publishStore && generatePublishDescription && publishAssetsService) {
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
          if (pipelineMode === 'avatar') {
            enqueueAvatarReplacement(config, meta, `avatar_render_${vjob.status}`);
          }
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
            autoPilotJobs.set(vjobId, meta);
            if (activeKey) autoPilotActiveKeys.add(activeKey);
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
              if (taskStore && typeof taskStore.updateTask === 'function') {
                const completedAt = new Date().toISOString();
                try {
                  taskStore.updateTask(vjobId, {
                    status: 'completed',
                    progress: 100,
                    message: '竖屏视频已完成，已存在对应发布任务',
                    completedAt
                  });
                  taskStore.appendLog(vjobId, `自动发布恢复：已存在对应发布任务 ${existingJob.id || ''}，跳过重复创建`);
                } catch (_err) {}
              }
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
            autoPilotJobs.set(vjobId, meta);
            if (activeKey) autoPilotActiveKeys.add(activeKey);
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
            autoPilotJobs.set(vjobId, meta);
            if (activeKey) autoPilotActiveKeys.add(activeKey);
            continue;
          }

          const publishData = {
            title: asset.compactLabel || asset.label,
            description: desc || asset.metadata?.suggestedDescription || '',
            tagStrategy: 'model',
            tags: [],
            coverUrl: ''
          };

          const modeSchedule = getAutoPilotModeSchedule(config, pipelineMode);
          const targetAccountIds = modeSchedule.accountIds || [];
          const assignedAccountId = String(targetAccountIds[rank] || '').trim();
          const primaryPlatform = selectedPlatforms[0] || DEFAULT_AUTO_PILOT_PLATFORMS[0];
          const account = getPlatformAccount(config, primaryPlatform, assignedAccountId);

          if (!account) {
            if (targetAccountIds.length > 0) {
              logWarn('[AutoPilot] 映射表中未找到该排名对应的有效账号，已跳过创建发布任务', {
                queueJobId: vjobId,
                rank: rank + 1,
                platform: primaryPlatform,
                assignedAccountId
              });
              autoPilotJobs.set(vjobId, meta);
              if (activeKey) autoPilotActiveKeys.add(activeKey);
              continue;
            }
          }

          if (!account) {
            logWarn('[AutoPilot] 没有任何可用平台账号配置，发布任务将创建为空记录', {
              queueJobId: vjobId,
              rank: rank + 1,
              platform: primaryPlatform
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
            platformSelections: buildAutoPilotPlatformSelections(config, selectedPlatforms, account?.id || assignedAccountId),
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
            if (taskStore && typeof taskStore.updateTask === 'function') {
              const completedAt = new Date().toISOString();
              try {
                taskStore.updateTask(vjobId, {
                  status: 'completed',
                  progress: 100,
                  message: '竖屏视频已完成，已存在对应发布任务',
                  completedAt
                });
                taskStore.appendLog(vjobId, `自动发布恢复：写入前发现对应发布任务 ${existingJobCheck.id || ''}，跳过重复创建`);
              } catch (_err) {}
            }
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
            assignedAccountLabel: getPlatformAccountLabel(primaryPlatform, account),
            platformErrors: storedJob.platformErrors || [],
            wechatTaskStatus: (storedJob.platformTasks || []).find((task) => task.platform === 'wechatChannels')?.status || ''
          });

          if (taskStore && typeof taskStore.updateTask === 'function') {
            const completedAt = new Date().toISOString();
            try {
              taskStore.updateTask(vjobId, {
                status: 'completed',
                progress: 100,
                message: `竖屏视频已完成，已创建发布任务 ${storedJob.id}`,
                completedAt
              });
              taskStore.appendLog(vjobId, `自动发布恢复：已创建发布任务 ${storedJob.id}`);
            } catch (_err) {}
          }

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

    await publishScheduler.processDueScheduledJobs();
  });

  publishScheduler.registerArchiveJob();
  registerCleanupScheduler({
    cron,
    taskStore,
    verticalQueueService,
    timeZone: SCHEDULER_TIME_ZONE,
    logInfo,
    logWarn,
    logError
  });
  registerLoginCheckScheduler({
    cron,
    loginStatusService,
    cronExpression: LOGIN_CHECK_CRON_EXPRESSION,
    timeZone: SCHEDULER_TIME_ZONE,
    readLoginCheckScheduleConfig,
    isLoginCheckDue,
    logInfo,
    logWarn,
    logError
  });

  return {
    recoverAutoPilotVerticalJobs,
    triggerAutoPilotNow
  };
}

module.exports = {
  startScheduler
};
