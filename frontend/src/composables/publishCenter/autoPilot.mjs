import {
  AUTO_PILOT_PIPELINE_DEFS,
  DEFAULT_AUTO_PILOT_PLATFORMS,
  DEFAULT_AVATAR_AUDIO_PRESET,
  DEFAULT_AVATAR_IMAGE_PRESET,
  DEFAULT_XAI_PARTITION_ID,
  normalizeAutoPilotModeSchedules,
  normalizeAutoPilotPlatformRows,
  normalizePlatformSelection,
  normalizeStringArray,
  normalizeXaiPartitionId
} from './domain.mjs';

export function getAvatarPresetLabel(fileName) {
  const raw = String(fileName || '').trim();
  if (!raw) return '未选择';
  return raw.replace(/\.[^.]+$/u, '');
}

export function buildAutoPilotAvatarPresetSummary(mapping = {}, options = {}) {
  if (mapping.pipelineMode !== 'avatar' && mapping.mode !== 'avatar') return '';
  const audio = mapping.audioPreset || options.defaultAudioPreset || DEFAULT_AVATAR_AUDIO_PRESET;
  const image = mapping.imagePreset || options.defaultImagePreset || DEFAULT_AVATAR_IMAGE_PRESET;
  return `${getAvatarPresetLabel(image)} / ${getAvatarPresetLabel(audio)}`;
}

export function getAutoPilotModeSchedule(global = {}, mode) {
  const schedules = normalizeAutoPilotModeSchedules(global.autoPilotModeSchedules);
  const schedule = schedules[mode] || {};
  const accountIds = normalizeStringArray(schedule.accountIds);
  const times = normalizeStringArray(schedule.times);
  const partitionIds = normalizeStringArray(schedule.partitionIds);
  const sourceRanks = normalizeStringArray(schedule.sourceRanks);
  const platforms = normalizeAutoPilotPlatformRows(schedule.platforms);
  const audioPresets = normalizeStringArray(schedule.audioPresets);
  const imagePresets = normalizeStringArray(schedule.imagePresets);
  if (accountIds.length || times.length || partitionIds.length || sourceRanks.length || platforms.length || audioPresets.length || imagePresets.length) {
    return { accountIds, times, partitionIds, sourceRanks, platforms, audioPresets, imagePresets };
  }
  return {
    accountIds: normalizeStringArray(global.autoPilotAccountIds),
    times: normalizeStringArray(global.autoPilotTimes),
    partitionIds: [],
    sourceRanks: [],
    platforms: [],
    audioPresets: [],
    imagePresets: []
  };
}

export function buildAutoPilotMappingsForMode(options = {}) {
  const {
    mode,
    global = {},
    xaiPartitionOptions = [],
    getDefaultAvatarAudioPreset = () => DEFAULT_AVATAR_AUDIO_PRESET,
    getDefaultAvatarImagePreset = () => DEFAULT_AVATAR_IMAGE_PRESET,
    getPlatformLabel = (platformKey) => platformKey,
    getPlatformLabels = (platformKeys) => normalizePlatformSelection(platformKeys)
  } = options;
  const { accountIds, times, partitionIds, sourceRanks, platforms, audioPresets, imagePresets } = getAutoPilotModeSchedule(global, mode);
  const mappings = [];
  const maxLen = Math.max(accountIds.length, times.length, partitionIds.length, sourceRanks.length, platforms.length, audioPresets.length, imagePresets.length);
  for (let i = 0; i < maxLen; i += 1) {
    const selectedPlatforms = normalizePlatformSelection(platforms[i]);
    const platformKey = selectedPlatforms[0] || DEFAULT_AUTO_PILOT_PLATFORMS[0];
    const hasConfiguredSlot = Boolean(
      String(accountIds[i] || '').trim()
      || String(times[i] || '').trim()
      || String(partitionIds[i] || '').trim()
      || String(sourceRanks[i] || '').trim()
      || String(audioPresets[i] || '').trim()
      || String(imagePresets[i] || '').trim()
      || (Array.isArray(platforms[i]) && platforms[i].length > 0)
    );
    if (!hasConfiguredSlot) continue;

    const partitionId = normalizeXaiPartitionId(partitionIds[i] || global.autoPilotPartitionId, global.autoPilotPartitionId || DEFAULT_XAI_PARTITION_ID);
    const partition = xaiPartitionOptions.find((item) => item.id === partitionId);
    const sourceRank = Math.max(1, Math.min(10, parseInt(sourceRanks[i] || '1', 10) || 1));
    const audioPreset = mode === 'avatar'
      ? String(audioPresets[i] || global.avatarPipelineConfig?.audioPreset || getDefaultAvatarAudioPreset()).trim()
      : '';
    const imagePreset = mode === 'avatar'
      ? String(imagePresets[i] || global.avatarPipelineConfig?.imagePreset || getDefaultAvatarImagePreset()).trim()
      : '';
    mappings.push({
      slot: i + 1,
      rank: i + 1,
      sourceRank,
      accountId: accountIds[i],
      time: times[i] || global.autoPilotTime || '08:00',
      partitionId,
      partitionLabel: partition?.label || partitionId,
      platforms: selectedPlatforms,
      platformKey,
      platformLabel: getPlatformLabel(platformKey),
      platformLabels: getPlatformLabels(selectedPlatforms),
      audioPreset,
      imagePreset
    });
  }
  return mappings;
}

export function buildActiveAutoPilotMappings(options = {}) {
  const { activeModes = [] } = options;
  const mappings = [];
  for (const mode of activeModes) {
    const modeDef = AUTO_PILOT_PIPELINE_DEFS.find((item) => item.key === mode);
    for (const mapping of buildAutoPilotMappingsForMode({ ...options, mode })) {
      mappings.push({
        ...mapping,
        pipelineMode: mode,
        pipelineLabel: modeDef?.label || mode
      });
    }
  }
  return mappings;
}

export function buildAutoPilotConfiguredPlans(options = {}) {
  const {
    mappings = [],
    global = {},
    getPlatformAccountLabel = (_platformKey, accountId) => accountId || '未指定账号',
    getPlatformLabel = (platformKey) => platformKey,
    getAvatarPresetSummary = buildAutoPilotAvatarPresetSummary
  } = options;
  return mappings.map((mapping) => {
    const platformKey = mapping.platformKey || mapping.platforms?.[0] || DEFAULT_AUTO_PILOT_PLATFORMS[0];
    const accountLabel = getPlatformAccountLabel(platformKey, mapping.accountId);
    return {
      id: `plan_${mapping.pipelineMode}_${mapping.slot}`,
      title: `${mapping.pipelineLabel}自动化计划`,
      rank: mapping.sourceRank,
      slot: mapping.slot,
      pipelineMode: mapping.pipelineMode,
      pipelineLabel: mapping.pipelineLabel,
      scheduledAt: '',
      scheduledLabel: `每天 ${mapping.time || global.autoPilotTime || '08:00'}`,
      status: 'configured',
      statusLabel: '计划已配置',
      accountLabel,
      platforms: mapping.platforms,
      platformKey,
      platformLabel: getPlatformLabel(platformKey),
      platformLabels: mapping.platformLabels,
      partitionId: mapping.partitionId,
      partitionLabel: mapping.partitionLabel,
      avatarPresetLabel: getAvatarPresetSummary(mapping),
      sourceMode: global.autoPilotUseCurrentRanking ? 'current_ranking' : 'refresh_ranking',
      queueJobId: ''
    };
  });
}

export function buildGeneratedAutoPilotJobs(options = {}) {
  const {
    jobs = [],
    getJobTerminalState = (job) => job.status || 'ready',
    getJobStatusLabel = (job) => getJobTerminalState(job),
    getPlatformLabels = (platformKeys) => normalizePlatformSelection(platformKeys),
    getAvatarPresetSummary = buildAutoPilotAvatarPresetSummary
  } = options;
  return jobs
    .filter((job) => job?.autoPilot && !job.archived)
    .map((job) => {
      const task = (Array.isArray(job.platformTasks) ? job.platformTasks : []).find((item) => item.platform === 'wechatChannels') || null;
      const pipelineMode = String(job?.autoPilot?.pipelineMode || job?.autoPilot?.mode || 'vertical').trim() || 'vertical';
      const modeDef = AUTO_PILOT_PIPELINE_DEFS.find((item) => item.key === pipelineMode);
      const platforms = Array.isArray(job?.selectedPlatforms) && job.selectedPlatforms.length ? job.selectedPlatforms : ['wechatChannels'];
      return {
        id: job.id,
        title: job.publishData?.title || job.asset?.label || '自动化任务',
        rank: Number(job?.autoPilot?.rank || 0),
        sourceRank: Number(job?.autoPilot?.sourceRank || job?.asset?.metadata?.sourceRank || job?.autoPilot?.rank || 0),
        pipelineMode,
        pipelineLabel: modeDef?.label || pipelineMode,
        scheduledAt: job.scheduledAt || '',
        scheduledLabel: '',
        status: getJobTerminalState(job),
        statusLabel: getJobStatusLabel(job),
        accountLabel: task?.accountLabel || task?.accountId || job?.platformSelections?.wechatChannels?.accountLabel || job?.platformSelections?.wechatChannels?.accountId || '未指定账号',
        platforms,
        platformLabels: getPlatformLabels(platforms),
        partitionId: job?.autoPilot?.sourcePartitionId || job?.asset?.metadata?.sourcePartitionId || '',
        partitionLabel: job?.autoPilot?.sourcePartitionLabel || job?.asset?.metadata?.sourcePartitionLabel || '',
        avatarPresetLabel: getAvatarPresetSummary(job?.autoPilot || {}),
        sourceMode: job?.autoPilot?.sourceMode || '',
        queueJobId: job?.autoPilot?.queueJobId || ''
      };
    })
    .sort((a, b) => {
      const aTime = new Date(a.scheduledAt || 0).getTime() || 0;
      const bTime = new Date(b.scheduledAt || 0).getTime() || 0;
      if (aTime !== bTime) return aTime - bTime;
      return String(b.id).localeCompare(String(a.id));
    });
}

export function formatAutoPilotJobTime(value) {
  if (!value) return '未设定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function buildAutoPilotSummaryItems(options = {}) {
  const {
    global = {},
    activeModes = [],
    activeMappings = [],
    getPlatformAccountLabel = (_platformKey, accountId) => accountId || '未指定账号',
    getPlatformLabel = (platformKey) => platformKey,
    getAvatarPresetSummary = buildAutoPilotAvatarPresetSummary,
    now = new Date()
  } = options;
  const enabled = Boolean(global.autoPilotEnabled);
  const fetchTime = String(global.autoPilotFetchTime || '07:30').trim();
  const useCurrentRanking = Boolean(global.autoPilotUseCurrentRanking);
  const pipelineLabels = AUTO_PILOT_PIPELINE_DEFS
    .filter((item) => activeModes.includes(item.key))
    .map((item) => item.label);

  const assignedAccounts = activeMappings.map((mapping) => {
    const platformKey = mapping.platformKey || mapping.platforms?.[0] || DEFAULT_AUTO_PILOT_PLATFORMS[0];
    const target = getPlatformAccountLabel(platformKey, mapping.accountId);
    const avatarPreset = mapping.pipelineMode === 'avatar' ? ` -> ${getAvatarPresetSummary(mapping)}` : '';
    return `${mapping.pipelineLabel}: ${mapping.partitionLabel || '默认分区'} Top ${mapping.sourceRank || 1} -> ${getPlatformLabel(platformKey)} -> ${target}${avatarPreset} @ ${mapping.time}`;
  });

  if (!assignedAccounts.length) {
    assignedAccounts.push('未配置任何映射 (将使用默认策略)');
  }

  const nextTrigger = new Date(now);
  const [hour, minute] = fetchTime.split(':').map((item) => Number(item || 0));
  nextTrigger.setHours(hour || 0, minute || 0, 0, 0);
  if (nextTrigger.getTime() <= now.getTime()) {
    nextTrigger.setDate(nextTrigger.getDate() + 1);
  }

  return [
    { label: '托管状态', value: enabled ? '已开启' : '未开启' },
    { label: '制作模式', value: pipelineLabels.join(' + ') || '不带数字人' },
    { label: '榜单来源', value: useCurrentRanking ? '使用当前榜单' : '到点重新抓榜' },
    { label: '抓榜时间', value: useCurrentRanking ? '保存配置即触发' : fetchTime },
    { label: '触发计划', value: enabled ? (useCurrentRanking ? '保存配置时立即检测任务' : `周期性触发 (下次: ${nextTrigger.toLocaleString('zh-CN', { hour12: false })})`) : '托管关闭' },
    { label: '分发策略', value: assignedAccounts.join(' | ') }
  ];
}
