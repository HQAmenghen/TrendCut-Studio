function createPublishScheduler({
  cron,
  publishStore,
  wechatRpaService,
  formatJobBrief,
  logInfo,
  logWarn,
  logError
}) {
  const warnedScheduledJobs = new Set();
  const scheduledStartKeys = new Set();

  function getScheduledPlatformTask(job, platformKey) {
    return (Array.isArray(job?.platformTasks) ? job.platformTasks : [])
      .find((task) => String(task?.platform || '').trim() === platformKey) || null;
  }

  function claimScheduledPlatformTask(jobId, platformKey) {
    if (!publishStore || typeof publishStore.updatePublishPlatformTask !== 'function') {
      return true;
    }

    const payload = typeof publishStore.readPublishJobs === 'function'
      ? publishStore.readPublishJobs()
      : { jobs: [] };
    const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
    const currentTask = getScheduledPlatformTask(currentJob, platformKey);
    if (String(currentTask?.status || '') !== 'scheduled_wait') {
      return false;
    }

    publishStore.updatePublishPlatformTask(jobId, platformKey, {
      status: 'publishing',
      lastRunAt: new Date().toISOString(),
      lastRunMode: 'publish',
      runtime: {
        ...(currentTask.runtime || {}),
        state: 'scheduled_starting',
        lastMessage: '定时发布已到期，正在启动自动发布...',
        updatedAt: new Date().toISOString(),
        publishMode: 'publish',
        progress: Number(currentTask.runtime?.progress || 0) > 0 ? currentTask.runtime.progress : 2,
        logs: [...(Array.isArray(currentTask.runtime?.logs) ? currentTask.runtime.logs : []), '[scheduled] 定时发布已占用，准备启动自动发布'].slice(-120)
      }
    });
    return true;
  }

  function releaseScheduledPlatformTask(jobId, platformKey, error) {
    if (!publishStore || typeof publishStore.updatePublishPlatformTask !== 'function') {
      return;
    }

    try {
      const payload = typeof publishStore.readPublishJobs === 'function'
        ? publishStore.readPublishJobs()
        : { jobs: [] };
      const currentJob = (payload.jobs || []).find((item) => item.id === jobId);
      const currentTask = getScheduledPlatformTask(currentJob, platformKey);
      if (!['publishing', 'scheduled_starting'].includes(String(currentTask?.status || ''))) {
        return;
      }
      publishStore.updatePublishPlatformTask(jobId, platformKey, {
        status: 'scheduled_wait',
        runtime: {
          ...(currentTask.runtime || {}),
          state: 'scheduled_wait',
          lastMessage: `定时发布启动失败，已恢复等待下次重试：${error?.message || String(error || '')}`,
          updatedAt: new Date().toISOString(),
          publishMode: 'publish',
          progress: 0,
          logs: [...(Array.isArray(currentTask.runtime?.logs) ? currentTask.runtime.logs : []), `[scheduled] 启动失败，恢复等待：${error?.message || String(error || '')}`].slice(-120)
        }
      });
    } catch (err) {
      logError('[Scheduler -> 多平台发布] 恢复定时任务等待状态失败', err, { jobId, platform: platformKey });
    }
  }

  async function processDueScheduledJobs() {
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
        if (['publishing', 'published', 'failed', 'cancelled', 'ready_for_manual_publish'].includes(String(job.status || ''))) {
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
          const startKey = `${job.id}:${platformKey}`;
          if (scheduledStartKeys.has(startKey)) {
            logWarn('[Scheduler -> 多平台发布] 定时任务已在启动中，跳过重复触发', { ...formatJobBrief(job), platform: platformKey });
            continue;
          }
          const claimed = claimScheduledPlatformTask(job.id, platformKey);
          if (!claimed) {
            logWarn('[Scheduler -> 多平台发布] 定时任务已被其他调度占用，跳过重复触发', { ...formatJobBrief(job), platform: platformKey });
            continue;
          }
          scheduledStartKeys.add(startKey);
          if (wechatRpaService && typeof wechatRpaService.startPlatformRpa === 'function') {
            Promise.resolve()
              .then(() => wechatRpaService.startPlatformRpa(job.id, platformKey, 'publish'))
              .catch((err) => {
                releaseScheduledPlatformTask(job.id, platformKey, err);
                logError('[Scheduler -> 多平台发布] 启动失败', err, { ...formatJobBrief(job), platform: platformKey });
              })
              .finally(() => {
                scheduledStartKeys.delete(startKey);
              });
            logInfo('[Scheduler -> 多平台发布] 已触发平台自动发布', { ...formatJobBrief(job), platform: platformKey });
          } else if (platformKey === 'wechatChannels' && wechatRpaService && typeof wechatRpaService.startWechatRpa === 'function') {
            Promise.resolve()
              .then(() => wechatRpaService.startWechatRpa(job.id, 'publish'))
              .catch((err) => {
                releaseScheduledPlatformTask(job.id, platformKey, err);
                logError('[Scheduler -> 微信发布] 启动失败', err, formatJobBrief(job));
              })
              .finally(() => {
                scheduledStartKeys.delete(startKey);
              });
            logInfo('[Scheduler -> 微信发布] 已触发微信自动发布', formatJobBrief(job));
          } else {
            scheduledStartKeys.delete(startKey);
            releaseScheduledPlatformTask(job.id, platformKey, new Error('平台 RPA 服务不可用'));
            logWarn('[Scheduler -> 多平台发布] 平台 RPA 服务不可用，无法执行定时发布', { ...formatJobBrief(job), platform: platformKey });
          }
        }
      } catch (err) {
        logError('[Scheduler -> 多平台发布] 触发任务失败', err, formatJobBrief(job));
      }
    }
  }

  function registerArchiveJob() {
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
  }

  return {
    processDueScheduledJobs,
    registerArchiveJob
  };
}

module.exports = {
  createPublishScheduler
};
