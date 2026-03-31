const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { readProjectEnv } = require('../../../scripts/utils/env');
const { enqueueRegenerationFromReview } = require('../review/regenerate');

const SCHEDULER_TIME_ZONE = 'Asia/Shanghai';
const SCHEDULER_LOG_PATH = path.join(__dirname, '../../../data/logs/scheduler.log');

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
    scheduledTime: job?.scheduledTime || null
  };
}

function normalizeRankingItem(item = {}) {
  return {
    title: item.title,
    summary: item.author_summary_zh || item.author_summary || item.summary,
    videoUrl: item.video_url || item.videoUrl,
    author: item.author,
    postId: item.post_id || item.postId,
    postUrl: item.post_url || item.postUrl
  };
}

function startScheduler({ publishStore, wechatRpaService, xaiService, verticalQueueService, generatePublishDescription, publishAssetsService, loginStatusService, feishuService, writeMediaMetadata }) {
  logInfo('[Scheduler] 初始化定时调度引擎 - node-cron', {
    timeZone: SCHEDULER_TIME_ZONE,
    logPath: SCHEDULER_LOG_PATH
  });

  const autoPilotJobs = new Map();
  const autoPilotActiveKeys = new Set();
  const fetchState = { lastFetchedDate: '' };
  const warnedScheduledJobs = new Set();

  async function enqueueAutoPilotTopItems(config, result, nowParts, sourceMode) {
    const configCount = Math.max(1, Number(config?.global?.autoPilotCount) || 1);
    const mappingLength = (config?.global?.autoPilotAccountIds || []).length;
    const count = Math.max(configCount, mappingLength);
    const topItems = (result?.items || []).slice(0, count);
    if (topItems.length === 0) {
      logWarn('[AutoPilot] 当前榜单没有可用内容，结束本轮流水线', {
        localDate: nowParts.dateStr,
        sourceMode
      });
      return;
    }

    for (let i = 0; i < topItems.length; i += 1) {
      const normalized = normalizeRankingItem(topItems[i]);

      // 检查该排名是否在映射列表中被明确禁用了（比如填了空字符串）
      const targetAccountIds = config?.global?.autoPilotAccountIds || [];
      const assignedAccountId = String(targetAccountIds[i] || '').trim();
      
      // 如果映射列表不为空，且当前排名对应的 ID 是空的，说明用户想跳过这个排名
      if (targetAccountIds.length > 0 && !assignedAccountId) {
        logInfo('[AutoPilot] 检测到当前排名映射为空，已跳过该排名的渲染与发布', {
          rank: i + 1,
          title: normalized.title || '',
          sourceMode
        });
        continue;
      }
      const activeKey = String(normalized.postId || normalized.videoUrl || `rank_${i + 1}`).trim();
      if (!normalized.videoUrl) {
        logWarn('[AutoPilot] 当前榜单项缺少视频地址，已跳过', {
          rank: i + 1,
          title: normalized.title || '',
          author: normalized.author || '',
          sourceMode
        });
        continue;
      }
      if (autoPilotActiveKeys.has(activeKey)) {
        logWarn('[AutoPilot] 当前榜单项已在自动流水线中，跳过重复入队', {
          rank: i + 1,
          title: normalized.title || '',
          author: normalized.author || '',
          sourceMode,
          activeKey
        });
        continue;
      }
      if (verticalQueueService && typeof verticalQueueService.enqueue === 'function') {
        const vjob = verticalQueueService.enqueue({
          sourceType: sourceMode === 'current_ranking' ? 'xai_top10_cached' : 'xai_top10',
          title: normalized.title,
          summary: normalized.summary,
          videoUrl: normalized.videoUrl,
          author: normalized.author,
          postId: normalized.postId,
          postUrl: normalized.postUrl,
          renderOptions: {}
        });
        autoPilotJobs.set(vjob.id, { rank: i, activeKey, sourceMode });
        autoPilotActiveKeys.add(activeKey);
        logInfo('[AutoPilot] 已将榜单内容送入渲染队列', {
          rank: i + 1,
          queueJobId: vjob.id,
          title: normalized.title,
          author: normalized.author,
          videoUrl: normalized.videoUrl,
          sourceMode
        });
      }
    }
  }

  async function triggerAutoPilotNow(config = publishStore?.readPublishConfig() || {}, options = {}) {
    if (!config?.global?.autoPilotEnabled) {
      return { triggered: false, reason: 'autopilot_disabled' };
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

    if (useCurrentRanking) {
      const result = xaiService.ensureTranslatedResult();
      await enqueueAutoPilotTopItems(config, result, nowParts, sourceMode);
      return { triggered: true, sourceMode, count: Math.min((result?.items || []).length, config?.global?.autoPilotCount || 1) };
    }

    const dummyRes = { json: () => {}, send: () => {}, status() { return this; }, headersSent: false };
    await xaiService.run(`autopilot-${reason}`, dummyRes);
    const result = xaiService.ensureTranslatedResult();
    await enqueueAutoPilotTopItems(config, result, nowParts, sourceMode);
    return { triggered: true, sourceMode, count: Math.min((result?.items || []).length, config?.global?.autoPilotCount || 1) };
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
                const result = xaiService.ensureTranslatedResult();
                logInfo('[AutoPilot] 已切换为使用当前榜单模式，本轮不会重新抓榜', {
                  localDate: nowParts.dateStr,
                  resultUpdatedAt: xaiService.getStatus?.().resultUpdatedAt || null
                });
                await enqueueAutoPilotTopItems(config, result, nowParts, 'current_ranking');
              } else {
                await xaiService.run('autopilot-cron', dummyRes);
                const result = xaiService.ensureTranslatedResult();
                await enqueueAutoPilotTopItems(config, result, nowParts, 'refresh_ranking');
              }
            } else {
              xaiService.run('system-cron', dummyRes);
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

    if (verticalQueueService && publishStore && generatePublishDescription && publishAssetsService) {
      for (const [vjobId, meta] of Array.from(autoPilotJobs.entries())) {
        const rank = typeof meta === 'object' ? meta.rank : meta;
        const activeKey = typeof meta === 'object' ? meta.activeKey : '';
        const vjob = verticalQueueService.getJob(vjobId);
        if (!vjob) {
          autoPilotJobs.delete(vjobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot] 渲染队列任务不存在，已从监控列表移除', { queueJobId: vjobId, rank: rank + 1 });
          continue;
        }
        if (['cancelled', 'failed'].includes(vjob.status)) {
          autoPilotJobs.delete(vjobId);
          if (activeKey) autoPilotActiveKeys.delete(activeKey);
          logWarn('[AutoPilot] 渲染任务失败或取消，停止后续自动发布', {
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
            title: vjob.title || ''
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

          // 检查 AI 审核状态
          try {
            const { readReviewConfig } = require('../../services/review/store');
            const reviewConfig = readReviewConfig();

            if (reviewConfig.enabled && reviewConfig.require_manual_confirm) {
              const aiReview = asset.metadata?.aiReview;

              // 如果未审核或正在审核中，跳过
              if (!aiReview || aiReview.status === 'pending' || aiReview.status === 'reviewing') {
                logWarn('[AutoPilot] 视频尚未完成 AI 审核，跳过创建发布任务', {
                  queueJobId: vjobId,
                  rank: rank + 1,
                  reviewStatus: aiReview?.status || 'not_reviewed',
                  hint: '视频将保留在素材库中，可手动审核后发布'
                });
                continue;
              }

              // 如果审核未通过且未手动跳过，跳过
              if (aiReview.status === 'failed' && !aiReview.manuallySkipped) {
                const regenerationMeta = asset.metadata?.regeneration || {};
                const alreadyRetried = Number(regenerationMeta.attemptCount || 0) >= 1
                  && String(regenerationMeta.previousReviewId || '') === String(aiReview.reviewId || '');

                if (!alreadyRetried && Array.isArray(aiReview.fixSuggestions) && aiReview.fixSuggestions.length > 0) {
                  try {
                    const { job: regeneratedJob, adjustments } = enqueueRegenerationFromReview({
                      videoPath: asset.path,
                      metadata: asset.metadata || {},
                      verticalQueueService,
                      writeMediaMetadata,
                      trigger: 'autopilot',
                      sourceReview: aiReview
                    });
                    autoPilotJobs.set(regeneratedJob.id, { rank, activeKey });
                    logInfo('[AutoPilot] 视频审核未达标，已按修改建议自动重新生成', {
                      previousQueueJobId: vjobId,
                      regeneratedQueueJobId: regeneratedJob.id,
                      rank: rank + 1,
                      overallScore: aiReview.overallScore || 0,
                      appliedSuggestionsCount: adjustments.highPrioritySuggestions.length
                    });
                    continue;
                  } catch (regenErr) {
                    logWarn('[AutoPilot] 自动按建议重做失败，回退为跳过创建发布任务', {
                      queueJobId: vjobId,
                      rank: rank + 1,
                      error: regenErr.message
                    });
                  }
                }

                logWarn('[AutoPilot] 视频 AI 审核未通过，跳过创建发布任务', {
                  queueJobId: vjobId,
                  rank: rank + 1,
                  overallScore: aiReview.overallScore || 0,
                  minPassScore: reviewConfig.min_pass_score || 70,
                  hint: alreadyRetried
                    ? '该视频已自动重做过一次，仍未达标，请在审核中心人工处理'
                    : '可在审核中心查看修复建议或手动跳过审核'
                });
                continue;
              }

              logInfo('[AutoPilot] 视频已通过 AI 审核，继续创建发布任务', {
                queueJobId: vjobId,
                rank: rank + 1,
                reviewStatus: aiReview.status,
                overallScore: aiReview.overallScore || 0
              });
            }
          } catch (reviewCheckErr) {
            logWarn('[AutoPilot] 审核状态检查失败，继续创建发布任务', {
              queueJobId: vjobId,
              error: reviewCheckErr.message
            });
          }

          const desc = generatePublishDescription(
            asset.metadata?.sourceSummary || asset.metadata?.suggestedDescription || '',
            { title: asset.compactLabel || asset.label, includeTags: false }
          );

          const publishData = {
            title: asset.compactLabel || asset.label,
            description: desc || asset.metadata?.suggestedDescription || '',
            tagStrategy: 'system',
            tags: ['热点速递', '每日快讯'],
            coverUrl: ''
          };

          const pcfg = config.wechatChannels;
          const targetAccountIds = config?.global?.autoPilotAccountIds || [];
          const assignedAccountId = String(targetAccountIds[rank] || '').trim();

          let account = null;
          if (assignedAccountId && Array.isArray(pcfg?.accounts)) {
            account = pcfg.accounts.find((item) => item.id === assignedAccountId) || null;
          }
          
          // 改进后的判定：
          // 1. 如果映射表里有这个 ID 且找到了账号，那是最好的。
          // 2. 如果映射表里这个位置是空的，或者 ID 不存在（且映射表本身不为空），直接跳过此项。
          // 3. 只有当映射表完全没配置（长度为 0）时，才回退到第一个账号（兼容旧版简单模式）。
          if (!account) {
            if (targetAccountIds.length > 0) {
              logWarn('[AutoPilot] 映射表中未找到该排名对应的有效账号，已跳过创建发布任务', {
                queueJobId: vjobId,
                rank: rank + 1,
                assignedAccountId
              });
              continue;
            } else if (Array.isArray(pcfg?.accounts) && pcfg.accounts.length > 0) {
              // 简单兼容模式：没有映射表时回退到第一个
              account = pcfg.accounts[0];
            }
          }

          if (!account) {
            logWarn('[AutoPilot] 没有任何可用微信账号配置，发布任务将创建为空记录', {
              queueJobId: vjobId,
              rank: rank + 1
            });
          }

          const targetTimes = config?.global?.autoPilotTimes || [];
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
            scheduledTime: isoScheduledTime,
            asset,
            publishData,
            selectedPlatforms: ['wechatChannels'],
            platformSelections: {
              wechatChannels: account
                ? { accountId: account.id, accountLabel: account.displayName || account.finderUserName || account.helperAccount || '' }
                : {}
            },
            platformTasks: account
              ? [{
                  platform: 'wechatChannels',
                  title: publishData.title,
                  description: publishData.description,
                  tags: publishData.tags,
                  coverUrl: publishData.coverUrl,
                  videoUrl: asset.url,
                  status: 'scheduled_wait',
                  accountId: account.id,
                  accountLabel: account.displayName || account.finderUserName || account.helperAccount || '',
                  runtime: {
                    state: 'scheduled_wait',
                    lastMessage: scheduledAlreadyDue
                      ? `发布时间已过 (${targetTime})，渲染完成后将立即补发`
                      : `等待定时发布 (${targetTime})`,
                    updatedAt: new Date().toISOString()
                  }
                }]
              : [],
            platformErrors: []
          };

          const payload = publishStore.readPublishJobs();
          payload.jobs.unshift(pJob);
          publishStore.writePublishJobs(payload);
          const reconciled = publishStore.reconcileAndPersistPublishJobs(config);
          const storedJob = (reconciled.jobs || []).find((item) => item.id === pJob.id) || pJob;

          logInfo('[AutoPilot] 已创建微信定时发布任务', {
            ...formatJobBrief(storedJob),
            queueJobId: vjobId,
            rank: rank + 1,
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
        if (!job?.scheduledTime || String(job.status || '') === 'scheduled_wait') {
          continue;
        }
        if (['published', 'failed', 'cancelled', 'ready_for_manual_publish'].includes(String(job.status || ''))) {
          continue;
        }
        const warnKey = `${job.id}:${job.status}:${job.scheduledTime}`;
        if (warnedScheduledJobs.has(warnKey)) {
          continue;
        }
        warnedScheduledJobs.add(warnKey);
        logWarn('[Scheduler -> 微信发布] 发现带有 scheduledTime 但状态不是 scheduled_wait 的任务，这类任务不会被定时发送', {
          ...formatJobBrief(job),
          platformErrors: job.platformErrors || [],
          wechatTaskStatus: (job.platformTasks || []).find((task) => task.platform === 'wechatChannels')?.status || ''
        });
      }
    } catch (err) {
      logError('[Scheduler -> 微信发布] 检查异常定时任务失败', err);
    }

    for (const job of dueJobs) {
      logInfo('[Scheduler -> 微信发布] 定时任务到期，开始启动微信自动发布', formatJobBrief(job));
      try {
        publishStore.updatePublishJob(job.id, (current) => {
          current.status = 'ready';
          if (Array.isArray(current.platformTasks)) {
            for (const task of current.platformTasks) {
              if (task.platform === 'wechatChannels') {
                task.status = 'ready';
                task.runtime = {
                  ...(task.runtime || {}),
                  state: 'ready',
                  lastMessage: '定时任务已到期，准备启动微信自动发布',
                  updatedAt: new Date().toISOString()
                };
              }
            }
          }
          return current;
        });

        if (wechatRpaService && typeof wechatRpaService.startWechatRpa === 'function') {
          wechatRpaService.startWechatRpa(job.id, 'publish');
          logInfo('[Scheduler -> 微信发布] 已触发微信自动发布', formatJobBrief(job));
        } else {
          logWarn('[Scheduler -> 微信发布] wechatRpaService.startWechatRpa 不可用，无法执行定时发布', formatJobBrief(job));
        }
      } catch (err) {
        logError(`[Scheduler -> 微信发布] 触发任务失败`, err, formatJobBrief(job));
      }
    }
  });

  // 登录状态定时检测
  if (loginStatusService) {
    const { values } = readProjectEnv(path.join(__dirname, '../../..'));
    const checkInterval = parseInt(values.LOGIN_CHECK_INTERVAL_MINUTES ?? process.env.LOGIN_CHECK_INTERVAL_MINUTES, 10) || 30;
    const loginCheckEnabled = (values.LOGIN_CHECK_ENABLED ?? process.env.LOGIN_CHECK_ENABLED) !== 'false';
    const cronExpression = `*/${checkInterval} * * * *`; // 每N分钟执行一次

    logInfo('[Scheduler] 启动登录状态定时检测', {
      interval: `${checkInterval} 分钟`,
      cronExpression,
      enabled: loginCheckEnabled
    });

    cron.schedule(cronExpression, async () => {
      try {
        logInfo('[Scheduler -> 登录检测] 开始定时检测登录状态');
        const summary = await loginStatusService.checkAllAccounts();

        logInfo('[Scheduler -> 登录检测] 检测完成', {
          checked: summary.checked,
          logged_in: summary.logged_in,
          need_login: summary.need_login,
          error: summary.error
        });

        // 如果有账号需要登录，发送汇总通知
        if (summary.need_login > 0 && feishuService && process.env.FEISHU_NOTIFY_LOGIN_STATUS !== 'false') {
          const needLoginAccounts = summary.results.filter(r => r.status === 'need_login');
          const accountNames = needLoginAccounts.map(r => r.accountLabel).join('、');

          await feishuService.sendText(
            `⚠️ 登录状态检测：${summary.need_login} 个账号需要重新登录\n` +
            `账号：${accountNames}\n` +
            `请及时处理以确保自动发布功能正常运行`
          );
        }
      } catch (err) {
        logError('[Scheduler -> 登录检测] 定时检测失败', err);
      }
    }, {
      timezone: SCHEDULER_TIME_ZONE,
      scheduled: loginCheckEnabled
    });
  }

  return {
    triggerAutoPilotNow
  };
}

module.exports = {
  startScheduler
};
