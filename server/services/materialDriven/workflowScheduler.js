const { activeTasks } = require('./sharedState');
const { addTaskLog, emitTaskEvent } = require('./events');
const { syncMaterialTask } = require('./taskStoreBridge');
const { nowIso } = require('./utils');

const DEFAULT_CONCURRENCY = 2;
const RUNNING_STATUSES = new Set(['running', 'generating_avatar']);

function isWorkflowRunning(task) {
  if (!task) return false;
  if (task.pipelineRun?.inFlight) return true;
  if (task.process) return true;
  return RUNNING_STATUSES.has(String(task.status || '').trim());
}

function createMaterialWorkflowScheduler(options = {}) {
  const taskStore = options.taskStore || null;
  const concurrency = Math.max(1, Math.min(4, Number(options.concurrency || DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY));
  const runningJobIds = new Set();
  const queuedEntries = [];

  function getRunningJobIds() {
    const ids = new Set(runningJobIds);
    for (const [jobId, task] of activeTasks.entries()) {
      if (isWorkflowRunning(task)) ids.add(jobId);
    }
    return ids;
  }

  function getQueuePosition(jobId) {
    const index = queuedEntries.findIndex((entry) => entry.jobId === jobId);
    return index >= 0 ? index + 1 : 0;
  }

  function updateQueuedPositions() {
    queuedEntries.forEach((entry, index) => {
      entry.task.queuePosition = index + 1;
      entry.task.queueConcurrency = concurrency;
      entry.task.updatedAt = nowIso();
      syncMaterialTask(taskStore, entry.task, {
        queuePosition: entry.task.queuePosition,
        queueConcurrency: concurrency
      });
      emitTaskEvent(entry.jobId, 'status', {
        message: `完整流程排队中，前方 ${index} 个任务`
      });
    });
  }

  function markQueued(entry) {
    entry.task.status = 'queued';
    entry.task.statusText = entry.queuedMessage || '完整流程排队中，等待空闲执行位';
    entry.task.progress = Math.max(0, Math.min(5, Number(entry.task.progress || 0) || 1));
    entry.task.queuePosition = queuedEntries.length + 1;
    entry.task.queueConcurrency = concurrency;
    entry.task.updatedAt = nowIso();
    addTaskLog(entry.task, `${entry.task.statusText}（最多 ${concurrency} 个完整流程并发）`, 'info');
    syncMaterialTask(taskStore, entry.task, {
      queuePosition: entry.task.queuePosition,
      queueConcurrency: concurrency
    });
    emitTaskEvent(entry.jobId, 'status', { message: entry.task.statusText });
    emitTaskEvent(entry.jobId, 'progress', {
      percent: entry.task.progress,
      message: entry.task.statusText
    });
  }

  function markStarting(entry) {
    entry.task.status = 'running';
    entry.task.statusText = entry.startedMessage || '完整流程开始执行';
    entry.task.queuePosition = 0;
    entry.task.queueConcurrency = concurrency;
    entry.task.startedAt = entry.task.startedAt || nowIso();
    entry.task.completedAt = null;
    entry.task.error = '';
    entry.task.updatedAt = nowIso();
    addTaskLog(entry.task, entry.task.statusText, 'info');
    syncMaterialTask(taskStore, entry.task, {
      queuePosition: 0,
      queueConcurrency: concurrency
    });
    emitTaskEvent(entry.jobId, 'status', { message: entry.task.statusText });
    emitTaskEvent(entry.jobId, 'progress', {
      percent: Number(entry.task.progress || 0),
      message: entry.task.statusText
    });
  }

  function failEntry(entry, error) {
    const message = error?.message || '完整流程启动失败';
    entry.task.status = 'failed';
    entry.task.statusText = message;
    entry.task.error = message;
    entry.task.completedAt = nowIso();
    entry.task.updatedAt = nowIso();
    entry.task.process = null;
    entry.task.pipelineRun = null;
    addTaskLog(entry.task, message, 'error');
    syncMaterialTask(taskStore, entry.task, { error: message });
    emitTaskEvent(entry.jobId, 'error_event', { message });
  }

  function startEntry(entry) {
    runningJobIds.add(entry.jobId);
    markStarting(entry);
    try {
      const result = entry.start();
      return {
        queued: false,
        alreadyRunning: Boolean(result?.alreadyRunning),
        reused: Boolean(result?.reused),
        message: entry.task.statusText,
        concurrency,
        running: getRunningJobIds().size,
        queuedCount: queuedEntries.length
      };
    } catch (error) {
      runningJobIds.delete(entry.jobId);
      failEntry(entry, error);
      processQueue();
      throw error;
    }
  }

  function processQueue() {
    while (queuedEntries.length > 0 && getRunningJobIds().size < concurrency) {
      const entry = queuedEntries.shift();
      if (!entry || !activeTasks.has(entry.jobId)) {
        updateQueuedPositions();
        continue;
      }
      startEntry(entry);
      updateQueuedPositions();
    }
  }

  function submit(jobId, task, start, options = {}) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId || !task || typeof start !== 'function') {
      throw new Error('完整流程调度参数无效');
    }

    activeTasks.set(normalizedJobId, task);
    if (isWorkflowRunning(task)) {
      const message = task.statusText || '任务已在运行，已切换为观察状态';
      emitTaskEvent(normalizedJobId, 'status', { message });
      return {
        queued: false,
        reused: true,
        alreadyRunning: true,
        concurrency,
        running: getRunningJobIds().size,
        queuedCount: queuedEntries.length,
        message
      };
    }

    const existingQueuedPosition = getQueuePosition(normalizedJobId);
    if (existingQueuedPosition) {
      return {
        queued: true,
        queuePosition: existingQueuedPosition,
        concurrency,
        running: getRunningJobIds().size,
        queuedCount: queuedEntries.length,
        message: task.statusText || '完整流程已在队列中'
      };
    }

    if (getRunningJobIds().size < concurrency) {
      return startEntry({
        jobId: normalizedJobId,
        task,
        start,
        startedMessage: options.startedMessage
      });
    }

    const entry = {
      jobId: normalizedJobId,
      task,
      start,
      queuedMessage: options.queuedMessage,
      startedMessage: options.startedMessage
    };
    queuedEntries.push(entry);
    markQueued(entry);
    updateQueuedPositions();
    return {
      queued: true,
      queuePosition: entry.task.queuePosition,
      concurrency,
      running: getRunningJobIds().size,
      queuedCount: queuedEntries.length,
      message: entry.task.statusText
    };
  }

  function release(jobId) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return;
    runningJobIds.delete(normalizedJobId);
    processQueue();
  }

  function remove(jobId) {
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId) return false;
    const index = queuedEntries.findIndex((entry) => entry.jobId === normalizedJobId);
    const removedQueued = index >= 0;
    if (removedQueued) queuedEntries.splice(index, 1);
    const removedRunning = runningJobIds.delete(normalizedJobId);
    updateQueuedPositions();
    if (removedQueued || removedRunning) processQueue();
    return removedQueued || removedRunning;
  }

  function getStatus() {
    return {
      concurrency,
      running: getRunningJobIds().size,
      queued: queuedEntries.length,
      queuedJobIds: queuedEntries.map((entry) => entry.jobId)
    };
  }

  return {
    getStatus,
    release,
    remove,
    submit
  };
}

module.exports = {
  createMaterialWorkflowScheduler,
  isWorkflowRunning
};
