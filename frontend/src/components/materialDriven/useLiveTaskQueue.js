import { computed } from 'vue';
import {
  activePublishStates,
  getAvatarTaskStatus,
  getGroupedMaterialTasks,
  getMaterialQueueKey,
  getVerticalTaskMaterialKey,
  normalizeUnifiedTaskForQueue,
  terminalPublishStates,
  waitingPublishStates
} from './dashboardTaskHelpers';

const readRef = (value, fallback = null) => {
  if (value && typeof value === 'object' && 'value' in value) return value.value;
  return value === undefined ? fallback : value;
};

const clampProgress = (value) => (
  Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null
);

const getTaskState = (task) => String(task?.runtime?.state || task?.status || '').trim();

const getMaterialTaskTitle = (task) => String(
  task?.sourcePost?.title ||
  task?.sourceMeta?.title ||
  task?.sourceMeta?.sourceAuthor ||
  task?.sourcePost?.author ||
  task?.outputPath ||
  task?.id ||
  '素材驱动任务'
).trim();

const getMaterialTaskTypeLabel = (task) => {
  const avatarStatus = getAvatarTaskStatus(task);
  if (task?.videoUrl) return '成片';
  if (task?.avatarRenderState?.taskId || avatarStatus) return '数字人';
  return '主流程';
};

const getMaterialTaskStatusLabel = (task) => {
  const status = String(task?.status || '').trim();
  const avatarStatus = getAvatarTaskStatus(task);
  if (status === 'failed' || task?.error) return '需处理';
  if (status === 'interrupted') return '中断可恢复';
  if (status === 'queued') return '等待中';
  if (task?.videoUrl || status === 'completed') return '已完成';
  if (avatarStatus === 'running' || avatarStatus === 'processing') return '数字人合成中';
  if (avatarStatus === 'succeeded' || avatarStatus === 'success') return '数字人已完成';
  return task?.currentStepLabel || `步骤 ${Number(task?.currentStep || 0) || '-'}`;
};

const getMaterialTaskDetail = (task) => {
  if (task?.error) return String(task.error);
  const avatarStatus = getAvatarTaskStatus(task);
  const runningHubTaskId = String(task?.avatarRenderState?.taskId || '').trim();
  if (['succeeded', 'success', 'completed'].includes(avatarStatus)) {
    return runningHubTaskId ? `RunningHub taskId ${runningHubTaskId} · 等待恢复结果` : '数字人结果已生成，等待恢复';
  }
  if (['failed', 'error'].includes(avatarStatus)) {
    return runningHubTaskId ? `RunningHub taskId ${runningHubTaskId} · 合成失败` : '数字人合成失败';
  }
  if (['canceled', 'cancelled'].includes(avatarStatus)) {
    return runningHubTaskId ? `RunningHub taskId ${runningHubTaskId} · 已取消` : '数字人合成已取消';
  }
  const statusTextValue = String(task?.statusText || '').trim();
  const latestLog = Array.isArray(task?.logs) ? task.logs.slice().reverse().find((item) => item?.message || item) : null;
  const latestLogText = typeof latestLog === 'string' ? latestLog : String(latestLog?.message || '').trim();
  if (runningHubTaskId && (task?.status === 'generating_avatar' || Number(task?.currentStep || 0) === 6)) {
    return `RunningHub taskId ${runningHubTaskId} · 正在查询数字人合成结果`;
  }
  return statusTextValue || latestLogText || `步骤 ${Number(task?.currentStep || 0) || '-'}`;
};

const getStandaloneTaskStatusLabel = (task) => {
  const status = String(task?.status || '').trim();
  if (status === 'queued') return '竖屏排队中';
  if (status === 'failed' || task?.errorDetails) return '竖屏失败';
  if (status === 'interrupted') return '竖屏中断';
  if (status === 'running') return '竖屏合成中';
  return status || '竖屏处理中';
};

const getStandaloneTaskDetail = (task) => {
  const message = String(task?.message || '').trim();
  const stage = String(task?.stage || '').trim();
  const errorDetails = String(task?.errorDetails || '').trim();
  if (errorDetails) return errorDetails;
  if (message) return message;
  if (stage) return stage;
  return '数据库任务状态同步中';
};

const getVerticalQueueStatusLabel = (status) => ({
  queued: '排队中',
  running: '运行中',
  transcribing: 'ASR 打轴',
  rendering: '渲染中',
  reviewing: 'AI 审核中',
  reviewed: '审核完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过'
}[String(status || '')] || String(status || '处理中'));

const formatRelativeTaskTime = (value, formatTime) => {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const diffSeconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds || 1} 秒前`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return formatTime(value);
};

const getPlatformDisplayLabel = (platformDefs, platformKey) => {
  const platform = platformDefs.find((item) => item.key === platformKey);
  return platform?.label || platformKey || '平台';
};

const getPublishTaskDetail = (job, task, state, platformDefs) => {
  const platformLabel = getPlatformDisplayLabel(platformDefs, task?.platform);
  const accountLabel = task?.accountLabel || task?.accountId || job?.platformSelections?.[task?.platform]?.accountLabel || '';
  const message = String(task?.runtime?.lastMessage || task?.runtime?.message || '').trim();
  if (message) return `${platformLabel} · ${message}`;
  if (state === 'scheduled_wait') return `${platformLabel} · 等待定时触发`;
  if (state === 'need_login' || state === 'login_ready') return `${platformLabel} · 等待登录确认`;
  if (accountLabel) return `${platformLabel} · ${accountLabel}`;
  return platformLabel;
};

export function useLiveTaskQueue(sources) {
  const getDbVerticalQueueTasks = () => {
    const verticalQueueStatus = readRef(sources.verticalQueueStatus, null);
    const unifiedDbTasks = readRef(sources.unifiedDbTasks, []);
    const inMemoryJobs = Array.isArray(verticalQueueStatus?.jobs) ? verticalQueueStatus.jobs : [];
    const byId = new Map(inMemoryJobs.map((job) => [String(job.id || ''), job]));
    for (const task of unifiedDbTasks) {
      if (task?.type !== 'vertical_queue') continue;
      const normalized = normalizeUnifiedTaskForQueue(task);
      if (!normalized?.id || byId.has(String(normalized.id))) continue;
      byId.set(String(normalized.id), normalized);
    }
    return Array.from(byId.values());
  };

  const getDbStandaloneTasks = () => {
    const standaloneDbTasks = readRef(sources.standaloneDbTasks, []);
    const unifiedDbTasks = readRef(sources.unifiedDbTasks, []);
    const byId = new Map((Array.isArray(standaloneDbTasks) ? standaloneDbTasks : []).map((task) => [String(task.id || ''), task]));
    for (const task of unifiedDbTasks) {
      if (task?.type !== 'standalone_vertical') continue;
      const normalized = normalizeUnifiedTaskForQueue(task);
      if (!normalized?.id || byId.has(String(normalized.id))) continue;
      byId.set(String(normalized.id), normalized);
    }
    return Array.from(byId.values());
  };

  const liveTaskItems = computed(() => {
    const items = [];
    const jobId = readRef(sources.jobId, '');
    const outputPath = readRef(sources.outputPath, '');
    const browserMaterialJobId = String(jobId || '').trim();
    const browserMaterialOutputPath = String(outputPath || '').trim();
    const browserMaterialKey = browserMaterialOutputPath ? `material:${browserMaterialOutputPath}` : '';
    const activeMaterialTasks = readRef(sources.activeMaterialTasks, []);
    const backgroundMaterialTasks = getGroupedMaterialTasks(activeMaterialTasks);
    const verticalTasksByMaterialKey = new Map();
    const mergedStandaloneTasks = getDbStandaloneTasks();

    for (const task of mergedStandaloneTasks) {
      const status = String(task?.status || '').trim();
      if (!['queued', 'running', 'failed', 'interrupted'].includes(status)) continue;
      const materialKey = getVerticalTaskMaterialKey(task);
      if (!materialKey) continue;
      const existing = verticalTasksByMaterialKey.get(materialKey);
      if (!existing || String(task.updatedAt || '').localeCompare(String(existing.updatedAt || '')) > 0) {
        verticalTasksByMaterialKey.set(materialKey, task);
      }
    }

    const hasCurrentTaskInBackground = backgroundMaterialTasks.some((task) => {
      const taskId = String(task?.id || '').trim();
      const taskKey = getMaterialQueueKey(task);
      return (browserMaterialJobId && taskId === browserMaterialJobId) ||
        (browserMaterialKey && (taskKey === browserMaterialKey || verticalTasksByMaterialKey.has(browserMaterialKey)));
    }) || Boolean(browserMaterialKey && verticalTasksByMaterialKey.has(browserMaterialKey));
    const materialWorkflowActive = Boolean(
      readRef(sources.uploading, false) ||
      readRef(sources.rebuildingPlan, false) ||
      readRef(sources.rerenderingVideo, false) ||
      (jobId && !readRef(sources.finalVideoUrl, ''))
    );
    const pushedBrowserMaterialCard = materialWorkflowActive && !hasCurrentTaskInBackground;

    if (pushedBrowserMaterialCard) {
      const selectedFile = readRef(sources.selectedFile, null);
      items.push({
        id: `material-${jobId || 'draft'}`,
        type: '主流程',
        title: readRef(sources.materialSourceLabel, '') || selectedFile?.name || outputPath || '素材驱动生产',
        statusLabel: readRef(sources.combinedErrorText, '') ? '需处理' : readRef(sources.currentStepLabel, ''),
        detail: readRef(sources.productionStatusText, '') || readRef(sources.statusText, '') || '正在推进素材驱动流程',
        progress: readRef(sources.displayProgress, 0),
        meta: jobId ? `任务 ${jobId}` : '本地任务',
        state: readRef(sources.combinedErrorText, '') ? 'danger' : 'running',
        order: readRef(sources.combinedErrorText, '') ? 0 : 10
      });
    }

    for (const task of backgroundMaterialTasks) {
      const taskId = String(task?.id || '').trim();
      const taskKey = getMaterialQueueKey(task);
      if (!taskId) continue;
      if (
        pushedBrowserMaterialCard &&
        ((browserMaterialJobId && taskId === browserMaterialJobId) || (browserMaterialKey && taskKey === browserMaterialKey))
      ) {
        continue;
      }
      const status = String(task?.status || '').trim();
      if (['completed', 'cancelled', 'published'].includes(status)) continue;
      const taskProgress = Number(task?.progress);
      const taskStep = Number(task?.currentStep || 0);
      const isResuming = readRef(sources.materialResumingTaskIds, []).includes(taskId);
      const verticalTask = verticalTasksByMaterialKey.get(taskKey);
      const verticalStatus = String(verticalTask?.status || '').trim();
      const hasVerticalTask = Boolean(verticalTask);
      const mergedStatus = hasVerticalTask ? verticalStatus : status;
      const mergedProgress = hasVerticalTask && Number.isFinite(Number(verticalTask.progress))
        ? Math.max(Number(taskProgress || 0), Number(verticalTask.progress || 0))
        : taskProgress;
      items.push({
        id: `material-active-${taskId}`,
        taskId,
        outputPath: task?.outputPath || task?.outputDir || '',
        type: hasVerticalTask ? '竖屏' : getMaterialTaskTypeLabel(task),
        title: getMaterialTaskTitle(task),
        statusLabel: hasVerticalTask ? getStandaloneTaskStatusLabel(verticalTask) : getMaterialTaskStatusLabel(task),
        detail: isResuming ? '正在恢复 RunningHub 结果并准备进入下一步' : (
          hasVerticalTask ? getStandaloneTaskDetail(verticalTask) : getMaterialTaskDetail(task)
        ),
        progress: Number.isFinite(mergedProgress) ? Math.max(0, Math.min(100, isResuming ? Math.max(mergedProgress, 87) : mergedProgress)) : null,
        meta: hasVerticalTask
          ? (verticalTask.runtimeJobId || formatRelativeTaskTime(verticalTask.updatedAt || verticalTask.startedAt, sources.formatTime))
          : (taskId ? `任务 ${taskId}` : formatRelativeTaskTime(task?.updatedAt || task?.startedAt, sources.formatTime)),
        state: mergedStatus === 'failed' || task?.error || verticalTask?.errorDetails ? 'danger' : (mergedStatus === 'queued' ? 'waiting' : 'running'),
        action: !hasVerticalTask && task?.avatarRenderState?.taskId && !task?.videoUrl ? 'resume-material' : '',
        actionBusy: isResuming,
        order: mergedStatus === 'failed' || task?.error ? 0 : (hasVerticalTask ? 30 : 12 + Math.max(0, taskStep))
      });
    }

    if (readRef(sources.xaiLoading, false)) {
      items.push({
        id: `xai-${readRef(sources.activePartitionId, '') || 'default'}`,
        type: '抓榜',
        title: `${readRef(sources.activePartitionLabel, '默认分区')} 热门榜单`,
        statusLabel: '抓取中',
        detail: readRef(sources.xaiProgressMessage, ''),
        progress: readRef(sources.xaiProgressPercent, 0),
        meta: readRef(sources.xaiProgressLabel, ''),
        state: 'running',
        order: 20
      });
    }

    if (readRef(sources.verticalLoading, false)) {
      items.push({
        id: 'standalone-current',
        type: '竖屏',
        title: readRef(sources.verticalSourceTaskDir, '') || '单条竖屏合成',
        statusLabel: readRef(sources.verticalErrorText, '') ? '需处理' : '合成中',
        detail: readRef(sources.verticalStatusText, '') || '正在生成竖屏版本',
        progress: readRef(sources.verticalProgress, 0),
        meta: readRef(sources.standaloneActiveDurationLabel, '') || '运行中',
        state: readRef(sources.verticalErrorText, '') ? 'danger' : 'running',
        order: readRef(sources.verticalErrorText, '') ? 1 : 30
      });
    }

    for (const task of readRef(sources.standaloneDbTasks, [])) {
      const status = String(task?.status || '').trim();
      if (!['queued', 'running', 'failed', 'interrupted'].includes(status)) continue;
      const materialKey = getVerticalTaskMaterialKey(task);
      const alreadyMergedIntoMaterial = Boolean(materialKey && (
        backgroundMaterialTasks.some((materialTask) => getMaterialQueueKey(materialTask) === materialKey) ||
        browserMaterialKey === materialKey
      ));
      if (alreadyMergedIntoMaterial) continue;
      items.push({
        id: `standalone-db-${task.id}`,
        type: '竖屏',
        title: task.sourceTaskDir || task.title || task.id,
        statusLabel: getStandaloneTaskStatusLabel(task),
        detail: getStandaloneTaskDetail(task),
        progress: clampProgress(task.progress),
        meta: task.runtimeJobId || formatRelativeTaskTime(task.updatedAt || task.startedAt, sources.formatTime),
        state: status === 'queued' ? 'waiting' : (status === 'failed' ? 'danger' : 'running'),
        order: status === 'failed' ? 1 : 32
      });
    }

    const queueJobs = getDbVerticalQueueTasks();
    for (const job of queueJobs) {
      const status = String(job?.status || '').trim();
      if (!['queued', 'running', 'transcribing', 'rendering', 'reviewing', 'reviewed', 'failed', 'cancelled', 'skipped'].includes(status)) {
        continue;
      }
      items.push({
        id: `vertical-${job.id}`,
        type: '渲染队列',
        title: job.title || job.author || job.id,
        statusLabel: getVerticalQueueStatusLabel(status),
        detail: job.message || getVerticalQueueStatusLabel(status),
        progress: clampProgress(job.progress),
        meta: formatRelativeTaskTime(job.updatedAt || job.startedAt || job.createdAt, sources.formatTime),
        state: ['failed', 'cancelled', 'skipped'].includes(status) ? 'danger' : (status === 'queued' ? 'waiting' : 'running'),
        order: status === 'queued' ? 45 : 35
      });
    }

    const platformDefs = readRef(sources.platformDefs, []);
    for (const job of readRef(sources.publishJobs, []).filter((item) => !item.archived)) {
      const tasks = Array.isArray(job.platformTasks) ? job.platformTasks : [];
      const states = tasks.map((task) => getTaskState(task)).filter(Boolean);
      const jobState = String(job.status || '').trim();
      const activeState = states.find((state) => activePublishStates.has(state));
      const waitingState = states.find((state) => waitingPublishStates.has(state)) || (waitingPublishStates.has(jobState) ? jobState : '');
      const terminalState = states.find((state) => terminalPublishStates.has(state)) || (terminalPublishStates.has(jobState) ? jobState : '');
      const failedState = terminalState === 'failed' ? terminalState : '';
      const chosenState = activeState || failedState || waitingState || terminalState;
      if (!chosenState || chosenState === 'published') {
        continue;
      }

      const nextTask = tasks.find((task) => getTaskState(task) === chosenState) || tasks[0] || null;
      const progressValue = Number(nextTask?.runtime?.progress ?? 0);
      const scheduledAt = job.scheduledAt || '';
      items.push({
        id: `publish-${job.id}-${nextTask?.platform || 'job'}`,
        type: '发布',
        title: job.publishData?.title || job.asset?.compactLabel || job.asset?.label || job.id,
        statusLabel: sources.getPublishJobLabel(job),
        detail: getPublishTaskDetail(job, nextTask, chosenState, platformDefs),
        progress: activeState && Number.isFinite(progressValue) ? Math.max(0, Math.min(100, progressValue)) : null,
        meta: scheduledAt ? sources.formatTime(scheduledAt) : formatRelativeTaskTime(job.updatedAt || job.createdAt, sources.formatTime),
        state: chosenState === 'failed' ? 'danger' : (activeState ? 'running' : 'waiting'),
        order: chosenState === 'failed' ? 2 : (activeState ? 25 : 60)
      });
    }

    return items
      .sort((a, b) => a.order - b.order || String(a.meta || '').localeCompare(String(b.meta || '')))
      .slice(0, 10);
  });

  const createResumePayload = (item) => {
    const taskId = String(item?.taskId || '').trim();
    if (!taskId) return null;
    return {
      jobId: taskId,
      outputPath: item?.outputPath || ''
    };
  };

  return {
    liveTaskItems,
    createResumePayload
  };
}
