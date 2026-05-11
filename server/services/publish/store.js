/**
 * Publish Store 服务 - 组装模块
 *
 * 将三个子模块组装成统一的服务接口：
 * - publishStore.migrations - 数据库迁移
 * - publishStore.config - 配置管理
 * - publishStore.jobs - 任务管理（待拆分，当前内联）
 */

const { createPublishDatabase } = require('./publishStore.migrations');
const { createPublishConfigService } = require('./publishStore.config');

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

  // 创建数据库
  const { db } = createPublishDatabase(publishJobsPath, readJsonIfExists);

  // 创建配置服务
  const configService = createPublishConfigService({
    publishConfigPath,
    wechatAccountFields,
    readJsonIfExists,
    writeJsonFile,
    deepClone,
    makeJobId
  });

  function createPublishJobId() {
    const generated = typeof makeJobId === 'function' ? String(makeJobId() || '').trim() : '';
    if (generated) return generated;
    return `job_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  // ========== 任务管理函数（待拆分到 publishStore.jobs.js） ==========

  function getAutoArchiveDelayMinutes(config = null) {
    // 优先使用配置中的设置
    if (config?.global?.autoArchiveDelayMinutes !== undefined) {
      return Math.max(0, parseInt(config.global.autoArchiveDelayMinutes, 10));
    }
    // 回退到环境变量
    const envValue = process.env.AUTO_ARCHIVE_DELAY_MINUTES;
    const minutes = parseInt(envValue, 10);
    return isNaN(minutes) || minutes < 0 ? 30 : minutes;
  }

  function isAutoArchiveEnabled(config = null) {
    // 优先使用配置中的设置
    if (config?.global?.autoArchiveEnabled !== undefined) {
      return Boolean(config.global.autoArchiveEnabled);
    }
    // 回退到环境变量
    return process.env.AUTO_ARCHIVE_PUBLISHED !== 'false';
  }

  function calculateArchiveDueAt(delayMinutes = null, config = null) {
    const delay = delayMinutes !== null ? delayMinutes : getAutoArchiveDelayMinutes(config);
    const dueTime = new Date(Date.now() + delay * 60 * 1000);
    return dueTime.toISOString();
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

  const SCHEDULABLE_PLATFORM_TASK_STATUSES = new Set([
    'pending',
    'pending_integration',
    'ready',
    'rpa_available',
    'scheduled_wait'
  ]);

  function isSchedulablePlatformTask(task) {
    return SCHEDULABLE_PLATFORM_TASK_STATUSES.has(String(task?.status || '').trim());
  }

  function normalizeScheduledPlatformTasks(job) {
    if (!job || !job.scheduledAt) {
      return { job, changed: false };
    }

    const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
    if (tasks.length === 0) {
      return { job, changed: false };
    }

    let changed = false;
    const updatedAt = new Date().toISOString();
    const platformTasks = tasks.map((task) => {
      if (!isSchedulablePlatformTask(task) || String(task?.status || '') === 'scheduled_wait') {
        return task;
      }
      changed = true;
      return {
        ...task,
        status: 'scheduled_wait',
        updatedAt
      };
    });
    const status = getJobTerminalStatus({ ...job, platformTasks });
    if (String(job.status || '') !== status) {
      changed = true;
    }

    if (!changed) {
      return { job, changed: false };
    }

    return {
      job: {
        ...job,
        platformTasks,
        status,
        updatedAt
      },
      changed: true
    };
  }

  function readPublishJobs() {
    try {
      const rows = db.prepare('SELECT data FROM publish_jobs_v1 ORDER BY updatedAt DESC').all();
      const jobs = rows.map(r => JSON.parse(r.data));
      const raw = { jobs };
      const { payload, changed } = sanitizePublishJobPayload(raw);
      let normalizedChanged = false;
      const normalizedPayload = {
        jobs: (payload.jobs || []).map((job) => {
          const normalized = normalizeScheduledJobStatus(job);
          if (normalized.changed) normalizedChanged = true;
          return normalized.job;
        })
      };
      if (changed || normalizedChanged) {
        writePublishJobs(normalizedPayload);
      }
      return normalizedPayload;
    } catch (err) {
      console.error('SQLite read error:', err);
      return { jobs: [] };
    }
  }

  function writePublishJobs(payload) {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO publish_jobs_v1 (id, data, updatedAt, archiveDueAt) VALUES (?, ?, ?, ?)');
      const replaceAll = db.transaction((jobs) => {
        db.prepare('DELETE FROM publish_jobs_v1').run();
        for (const job of jobs) {
          stmt.run(
            job.id,
            JSON.stringify(job),
            job.updatedAt || new Date().toISOString(),
            job.archiveDueAt || null
          );
        }
      });
      replaceAll(payload.jobs || []);
    } catch (err) {
      console.error('SQLite write error:', err);
    }
  }

  function updatePublishJob(jobId, updater) {
    let row;
    try {
      row = db.prepare('SELECT data FROM publish_jobs_v1 WHERE id = ?').get(jobId);
    } catch (e) {}
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

  function hasScheduledWaitingTask(job) {
    const tasks = Array.isArray(job?.platformTasks) ? job.platformTasks : [];
    return tasks.some((task) => String(task?.status || '') === 'scheduled_wait');
  }

  function normalizeScheduledJobStatus(job) {
    const normalizedTasks = normalizeScheduledPlatformTasks(job);
    if (normalizedTasks.changed) {
      return normalizedTasks;
    }

    if (!job || !job.scheduledAt || !hasScheduledWaitingTask(job)) {
      return { job, changed: false };
    }
    const nextStatus = getJobTerminalStatus(job);
    if (String(job.status || '') === nextStatus) {
      return { job, changed: false };
    }
    return {
      job: {
        ...job,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      },
      changed: true
    };
  }

  function getJobTerminalStatus(job) {
    const tasks = Array.isArray(job?.platformTasks) ? job.platformTasks : [];
    if (tasks.length === 0) return job?.status || 'pending';
    const allPublished = tasks.every((task) => task.status === 'published');
    if (allPublished) return 'published';
    const anyFailed = tasks.some((task) => task.status === 'failed');
    if (anyFailed) return 'failed';
    const anyPublishing = tasks.some((task) => ['publishing', 'draft_preparing'].includes(task.status));
    if (anyPublishing) return 'publishing';
    if (job?.scheduledAt && hasScheduledWaitingTask(job)) return 'scheduled_wait';
    return 'pending';
  }

  function updatePublishPlatformTask(jobId, platformKey, patch) {
    return updatePublishJob(jobId, (job) => {
      const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
      const taskIndex = tasks.findIndex((item) => item.platform === platformKey);
      if (taskIndex === -1) {
        throw new Error(`平台任务不存在: ${platformKey}`);
      }
      const currentTask = tasks[taskIndex];
      const nextTask = { ...currentTask, ...patch, updatedAt: new Date().toISOString() };
      tasks[taskIndex] = nextTask;
      job.platformTasks = tasks;
      const previousStatus = job.status;
      job.status = getJobTerminalStatus(job);

      // 如果任务状态变为 published 且启用了自动归档，设置归档到期时间
      if (job.status === 'published' && previousStatus !== 'published') {
        const config = configService.readPublishConfig();
        if (isAutoArchiveEnabled(config)) {
          if (!job.archiveDueAt) {
            job.archiveDueAt = calculateArchiveDueAt(null, config);
          }
        }
      }

      return job;
    });
  }

  function archivePublishJob(jobId, archived = true) {
    return updatePublishJob(jobId, (job) => {
      job.archived = Boolean(archived);
      // 取消归档时清空 archiveDueAt，避免下一轮调度重新归档
      if (!archived) {
        job.archiveDueAt = null;
      }
      return job;
    });
  }

  function archiveCompletedPublishJobs() {
    const payload = readPublishJobs();
    let archivedCount = 0;
    for (const job of payload.jobs || []) {
      if (job.archived) continue;
      const terminalStatus = getJobTerminalStatus(job);
      if (terminalStatus === 'published' || terminalStatus === 'failed') {
        try {
          archivePublishJob(job.id, true);
          archivedCount++;
        } catch (_err) {}
      }
    }
    // 返回更新后的任务列表和归档数量
    const updatedPayload = readPublishJobs();
    return {
      jobs: updatedPayload.jobs || [],
      archivedCount
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
    const preservedRuntime = existingTask?.runtime || {};
    const preservedResult = existingTask?.publishResult || {};
    return {
      ...rebuiltTask,
      status: existingTask?.status || rebuiltTask.status,
      lastRunAt: existingTask?.lastRunAt || null,
      lastRunMode: existingTask?.lastRunMode || null,
      lastFailureAt: existingTask?.lastFailureAt || null,
      lastCancelledAt: existingTask?.lastCancelledAt || null,
      retryCount: Number(existingTask?.retryCount || 0),
      runtime: preservedRuntime,
      publishResult: preservedResult,
      updatedAt: new Date().toISOString()
    };
  }

  function reconcilePublishJob(job, config) {
    const publishData = job?.publishData || {};
    const assetUrl = job?.asset?.url || '';
    const platformConfig = config || configService.readPublishConfig();
    const existingTasks = Array.isArray(job?.platformTasks) ? job.platformTasks : [];
    const existingTaskMap = new Map(existingTasks.map((task) => [task.platform, task]));
    const selectedPlatforms = Array.isArray(job?.selectedPlatforms) ? job.selectedPlatforms : [];
    const nextTasks = [];
    for (const platformKey of selectedPlatforms) {
      const existingTask = existingTaskMap.get(platformKey);
      const selection = job?.platformSelections?.[platformKey] || {};
      const nextTask = reconcilePlatformTask(platformKey, existingTask, publishData, assetUrl, platformConfig, selection);
      if (job?.scheduledAt && isSchedulablePlatformTask(nextTask)) {
        nextTask.status = 'scheduled_wait';
      }
      nextTasks.push(nextTask);
    }
    return {
      ...job,
      platformTasks: nextTasks,
      status: getJobTerminalStatus({ ...job, platformTasks: nextTasks }),
      updatedAt: new Date().toISOString()
    };
  }

  function reconcileAndPersistPublishJobs(config) {
    const payload = readPublishJobs();
    const nextJobs = (payload.jobs || []).map((job) => reconcilePublishJob(job, config));
    writePublishJobs({ jobs: nextJobs });
    return { jobs: nextJobs };
  }

  function getDueScheduledJobs(timestamp) {
    const payload = readPublishJobs();
    const now = timestamp || Date.now();
    return (payload.jobs || []).filter((job) => {
      if (job.archived) return false;
      if (!job.scheduledAt) return false;
      const normalizedStatus = getJobTerminalStatus(job);
      if (normalizedStatus !== 'scheduled_wait') return false;
      const scheduledTime = new Date(job.scheduledAt).getTime();
      return scheduledTime <= now;
    });
  }

  function getDueArchiveJobs(timestamp) {
    const payload = readPublishJobs();
    const now = timestamp || Date.now();
    return (payload.jobs || []).filter((job) => {
      if (job.archived) return false;
      if (!job.archiveDueAt) return false;
      if (job.status !== 'published') return false;
      const dueTime = new Date(job.archiveDueAt).getTime();
      return dueTime <= now;
    });
  }

  // 导出统一接口
  return {
    // 配置服务
    ...configService,
    // 任务管理
    makeJobId: createPublishJobId,
    readPublishJobs,
    writePublishJobs,
    updatePublishJob,
    updatePublishPlatformTask,
    archivePublishJob,
    archiveCompletedPublishJobs,
    reconcilePlatformTask,
    reconcilePublishJob,
    reconcileAndPersistPublishJobs,
    getDueScheduledJobs,
    getDueArchiveJobs,
    sanitizePublishJobPayload,
    getJobTerminalStatus
  };
}

module.exports = {
  createPublishStore
};
