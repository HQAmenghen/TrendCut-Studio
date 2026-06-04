function normalizeStatus(value) {
  const status = String(value || '').trim();
  if (!status) return 'unknown';
  if (['queued', 'pending', 'scheduled_wait'].includes(status)) return 'queued';
  if (['running', 'in_progress', 'publishing', 'draft_preparing', 'starting', 'uploading', 'editing'].includes(status)) return 'running';
  if (['completed', 'published', 'ready_for_manual_publish'].includes(status)) return 'completed';
  if (['failed', 'cancelled', 'interrupted'].includes(status)) return status;
  return status;
}

function normalizeTaskRecordStatus(row, metadata = {}) {
  if (metadata?.awaitingManualRecovery) return 'interrupted';
  return normalizeStatus(row.status);
}

function normalizeTaskRecordMessage(row, metadata = {}) {
  if (metadata?.awaitingManualRecovery && normalizeStatus(row.status) === 'running') {
    return row.message ? `等待手动恢复：${row.message}` : '等待手动恢复';
  }
  return row.message || '';
}

function taskStoreRecords(taskStore, limit) {
  if (!taskStore || typeof taskStore.db?.prepare !== 'function') return [];
  const rows = taskStore.db.prepare(`
    SELECT * FROM tasks
    WHERE status NOT IN ('completed', 'published', 'cancelled')
    ORDER BY updatedAt DESC
    LIMIT ?
  `).all(limit);
  return rows.map((row) => {
    const metadata = JSON.parse(row.metadata || '{}');
    return {
      id: row.id,
      type: row.type,
      taskKey: row.taskKey || '',
      status: normalizeTaskRecordStatus(row, metadata),
      rawStatus: row.status,
      progress: row.progress,
      message: normalizeTaskRecordMessage(row, metadata),
      title: metadata.title || metadata.outputDir || metadata.sourceTaskDir || row.taskKey || row.id,
      source: 'taskStore',
      metadata,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt
    };
  });
}

function publishTaskRecords(publishStore, limit) {
  if (!publishStore || typeof publishStore.readPublishJobs !== 'function') return [];
  const payload = publishStore.readPublishJobs();
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const records = [];
  for (const job of jobs) {
    const jobStatus = normalizeStatus(job.status);
    if (['completed', 'published', 'cancelled'].includes(jobStatus) || job.archived) continue;
    records.push({
      id: `publish:${job.id}`,
      type: 'publish',
      taskKey: `publish:${job.id}`,
      status: jobStatus,
      rawStatus: job.status || '',
      progress: 0,
      message: job.message || '',
      title: job.publishData?.title || job.asset?.compactLabel || job.asset?.label || job.id,
      source: 'publishStore',
      metadata: {
        publishJobId: job.id,
        scheduledAt: job.scheduledAt || '',
        platforms: job.platforms || []
      },
      createdAt: job.createdAt || '',
      updatedAt: job.updatedAt || ''
    });
    for (const task of job.platformTasks || []) {
      const status = normalizeStatus(task.status);
      if (['completed', 'published', 'cancelled'].includes(status)) continue;
      records.push({
        id: `publish_platform:${job.id}:${task.platform}`,
        type: 'publish_platform',
        taskKey: `publish:${job.id}:${task.platform}`,
        status,
        rawStatus: task.status || '',
        progress: Number(task.runtime?.progress || 0),
        message: task.runtime?.lastMessage || task.error || '',
        title: `${job.publishData?.title || job.id} · ${task.platform}`,
        source: 'publishStore',
        metadata: {
          publishJobId: job.id,
          platform: task.platform,
          accountId: task.accountId || '',
          accountLabel: task.accountLabel || ''
        },
        createdAt: job.createdAt || '',
        updatedAt: task.updatedAt || job.updatedAt || ''
      });
    }
  }
  return records.slice(0, limit);
}

function xaiTaskRecords(xaiService) {
  if (!xaiService || typeof xaiService.getStatus !== 'function') return [];
  const status = xaiService.getStatus('');
  if (!status?.running && !status?.loading && !status?.progressMessage) return [];
  return [{
    id: 'xai:default',
    type: 'xai_top10',
    taskKey: 'xai:default',
    status: status.running || status.loading ? 'running' : 'queued',
    rawStatus: status.status || '',
    progress: Number(status.progressPercent || status.progress || 0),
    message: status.progressMessage || status.message || '榜单任务进行中',
    title: 'XAI 热门榜单',
    source: 'xaiService',
    metadata: {
      partitionId: status.partitionId || ''
    },
    createdAt: '',
    updatedAt: status.updatedAt || ''
  }];
}

function createTimedCache(ttlMs = 800) {
  let entry = null;
  return {
    get(key) {
      if (!entry) return null;
      if (entry.key !== key) return null;
      if (Date.now() - entry.createdAt > ttlMs) return null;
      return entry.value;
    },
    set(key, value) {
      entry = { key, value, createdAt: Date.now() };
    },
    clear() {
      entry = null;
    }
  };
}

function createUnifiedTaskView({ taskStore, publishStore, xaiService } = {}) {
  const cache = createTimedCache();

  function listTasks(options = {}) {
    const limit = Math.max(1, Math.min(300, Number(options.limit || 120) || 120));
    const cacheKey = [
      limit,
      taskStore?.revision || 0,
      publishStore?.getRevision?.() || 0,
      xaiService?.getRevision?.() || ''
    ].join(':');
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const tasks = [
      ...taskStoreRecords(taskStore, limit),
      ...publishTaskRecords(publishStore, limit),
      ...xaiTaskRecords(xaiService)
    ]
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, limit);
    cache.set(cacheKey, tasks);
    return tasks;
  }

  return { listTasks, invalidate: cache.clear };
}

module.exports = {
  createUnifiedTaskView,
  normalizeStatus
};
