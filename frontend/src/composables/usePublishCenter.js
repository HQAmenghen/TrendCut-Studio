import { computed, ref, watch } from 'vue';
import axios from 'axios';

const PLATFORM_DEFS = [
  { key: 'wechatChannels', label: '微信视频号', runModes: ['draft', 'publish'] },
  { key: 'douyin', label: '抖音', runModes: [] },
  { key: 'xiaohongshu', label: '小红书', runModes: [] },
  { key: 'x', label: 'X', runModes: [] },
  { key: 'youtube', label: 'YouTube', runModes: [] }
];

const FIELD_LABELS = {
  wechatChannels: {
    enabled: '启用',
    displayName: '账号备注',
    finderUserName: '视频号 ID',
    helperAccount: '视频号助手账号',
    openPlatformAppId: '开放平台 AppID',
    appId: '应用 ID',
    appSecret: '应用密钥',
    refreshToken: '刷新令牌',
    accountId: '账号 ID'
  },
  douyin: {
    enabled: '启用',
    displayName: '账号备注',
    clientKey: '客户端 Key',
    clientSecret: '客户端密钥',
    accessToken: '访问令牌',
    openId: 'Open ID'
  },
  xiaohongshu: {
    enabled: '启用',
    displayName: '账号备注',
    appId: '应用 ID',
    appSecret: '应用密钥',
    accessToken: '访问令牌',
    accountId: '账号 ID'
  },
  x: {
    enabled: '启用',
    displayName: '账号备注',
    apiKey: 'API Key',
    apiSecret: 'API Secret',
    accessToken: '访问令牌',
    accessSecret: '访问密钥',
    bearerToken: 'Bearer Token'
  },
  youtube: {
    enabled: '启用',
    displayName: '频道备注',
    clientId: '客户端 ID',
    clientSecret: '客户端密钥',
    refreshToken: '刷新令牌',
    channelId: '频道 ID'
  }
};

const SECRET_HINT_FIELDS = new Set(['appSecret', 'refreshToken', 'clientSecret', 'accessToken', 'accessSecret', 'bearerToken', 'apiSecret']);

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((item) => String(item).trim()).filter(Boolean);
  return String(tags || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeApiError(err, fallbackMessage = '请求失败') {
  const payload = err?.response?.data || {};
  return {
    message: payload?.error || err?.message || fallbackMessage,
    code: payload?.code || '',
    stage: payload?.stage || '',
    hint: payload?.hint || '',
    details: payload?.details || ''
  };
}

export function usePublishCenter() {
  const loading = ref(false);
  const error = ref('');
  const errorState = ref({ message: '', code: '', stage: '', hint: '', details: '' });
  const savingConfig = ref(false);
  const creating = ref(false);
  const generatingDescription = ref(false);
  const regeneratingDescriptionJobId = ref('');
  const assets = ref([]);
  const jobs = ref([]);
  const config = ref({});
  const selfCheck = ref(null);
  const selfCheckLoading = ref(false);
  const selectedAssetId = ref('');
  const jobFilter = ref('active');
  const recentLogs = ref([]);
  const errorLogs = ref([]);
  let autoRefreshTimer = null;

  const appendLog = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    recentLogs.value = [...recentLogs.value, line].slice(-24);
  };

  const appendError = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    errorLogs.value = [...errorLogs.value, line].slice(-12);
  };

  const setErrorState = (nextError) => {
    errorState.value = nextError || { message: '', code: '', stage: '', hint: '', details: '' };
    error.value = errorState.value.message || '';
    if (error.value) appendError(error.value);
  };

  const clearErrorState = () => {
    errorState.value = { message: '', code: '', stage: '', hint: '', details: '' };
    error.value = '';
  };

  const editor = ref({
    title: '',
    description: '',
    tagStrategy: 'system',
    tags: '',
    coverUrl: '',
    platforms: ['wechatChannels'],
    platformSelections: {
      wechatChannels: {
        accountId: ''
      }
    }
  });

  const platformDefs = PLATFORM_DEFS;

  const selectedAsset = computed(() => assets.value.find((asset) => asset.id === selectedAssetId.value) || null);

  const stats = computed(() => ({
    assetCount: assets.value.length,
    jobCount: jobs.value.length,
    enabledPlatformCount: Object.values(config.value || {}).filter((item) => item?.enabled).length
  }));

  const wechatAccounts = computed(() => Array.isArray(config.value?.wechatChannels?.accounts) ? config.value.wechatChannels.accounts : []);

  const platformCards = computed(() => platformDefs.map((platform) => {
    const item = config.value?.[platform.key] || {};
    if (platform.key === 'wechatChannels') {
      const accounts = Array.isArray(item.accounts) ? item.accounts : [];
      const filled = accounts.filter((account) => String(account.finderUserName || '').trim() && String(account.helperAccount || '').trim()).length;
      const total = accounts.length || 1;
      return {
        ...platform,
        config: item,
        percent: item.enabled ? Math.round((filled / total) * 100) : 0,
        fieldKeys: ['accounts'],
        accountCount: accounts.length
      };
    }
    const fieldKeys = Object.keys(item).filter((key) => key !== 'enabled');
    const filled = fieldKeys.filter((key) => String(item[key] ?? '').trim()).length;
    const total = fieldKeys.length || 1;
    return {
      ...platform,
      config: item,
      percent: item.enabled ? Math.round((filled / total) * 100) : 0,
      fieldKeys
    };
  }));

  const filteredJobs = computed(() => {
    if (jobFilter.value === 'all') return jobs.value;
    if (jobFilter.value === 'archived') return jobs.value.filter((job) => job.archived);
    if (jobFilter.value === 'published') return jobs.value.filter((job) => getJobTerminalState(job) === 'published');
    if (jobFilter.value === 'manual') return jobs.value.filter((job) => getJobTerminalState(job) === 'ready_for_manual_publish');
    if (jobFilter.value === 'failed') return jobs.value.filter((job) => ['failed', 'cancelled'].includes(getJobTerminalState(job)));
    return jobs.value.filter((job) => !job.archived);
  });

  const fillEditorFromAsset = (asset) => {
    if (!asset) return;
    editor.value.title = asset.metadata?.suggestedTitle || asset.compactLabel || asset.label || '';
    editor.value.description = '';
    editor.value.tagStrategy = 'system';
    editor.value.tags = normalizeTags(asset.metadata?.suggestedTags || []).join(', ');
    editor.value.coverUrl = asset.metadata?.coverUrl || '';
    if (!editor.value.platformSelections.wechatChannels.accountId && wechatAccounts.value.length) {
      editor.value.platformSelections.wechatChannels.accountId = wechatAccounts.value[0].id;
    }
  };

  const refreshJobs = async (silent = false) => {
    try {
      const res = await axios.get('/api/publish/jobs');
      jobs.value = res.data?.jobs || [];
    } catch (err) {
      const normalized = normalizeApiError(err, '读取发布任务失败');
      errorState.value = normalized;
      error.value = normalized.message;
      if (!silent) appendError(error.value);
    }
  };

  const refreshSelfCheck = async (silent = false) => {
    if (!silent) selfCheckLoading.value = true;
    try {
      const res = await axios.get('/api/system/self-check');
      selfCheck.value = res.data?.report || null;
    } catch (err) {
      selfCheck.value = null;
      if (!silent) {
        setErrorState(normalizeApiError(err, '读取启动自检失败'));
      }
    } finally {
      if (!silent) selfCheckLoading.value = false;
    }
  };

  const refresh = async (force = true, options = {}) => {
    const silent = !!options.silent;
    const preserveEditor = !!options.preserveEditor;
    if (!silent) {
      loading.value = true;
      clearErrorState();
      appendLog(force ? '强制刷新素材、任务和平台配置' : '刷新素材、任务和平台配置');
    }
    const keepId = selectedAssetId.value;
    try {
      const [assetsRes, jobsRes, configRes, selfCheckRes] = await Promise.all([
        axios.get('/api/publish/assets', { params: { refresh: force ? 1 : 0 } }),
        axios.get('/api/publish/jobs'),
        axios.get('/api/publish/config'),
        axios.get('/api/system/self-check')
      ]);
      assets.value = assetsRes.data.assets || [];
      jobs.value = jobsRes.data.jobs || [];
      config.value = configRes.data.config || {};
      selfCheck.value = selfCheckRes.data?.report || null;
      if (!editor.value.platformSelections.wechatChannels.accountId && (config.value?.wechatChannels?.accounts || []).length) {
        editor.value.platformSelections.wechatChannels.accountId = config.value.wechatChannels.accounts[0].id;
      }

      const nextSelected = assets.value.find((asset) => asset.id === keepId)?.id || assets.value[0]?.id || '';
      selectedAssetId.value = nextSelected;
      if (nextSelected && !preserveEditor) {
        fillEditorFromAsset(assets.value.find((asset) => asset.id === nextSelected) || null);
      }
    } catch (err) {
      const normalized = normalizeApiError(err, '刷新发布中心失败');
      errorState.value = normalized;
      error.value = normalized.message;
      if (!silent) appendError(error.value);
    } finally {
      if (!silent) loading.value = false;
    }
  };

  const selectAsset = async (assetId) => {
    selectedAssetId.value = assetId;
    appendLog(`切换发布素材：${assetId || '未选择'}`);
    await refresh(true);
  };

  const applySuggestedTitle = () => {
    const asset = selectedAsset.value;
    if (!asset) {
      setErrorState({ message: '请先选择素材', code: 'PUBLISH_ASSET_MISSING', stage: 'publish.editor', hint: '', details: '' });
      return;
    }
    editor.value.title = asset.metadata?.suggestedTitle || asset.compactLabel || asset.label || '';
    appendLog('已恢复推荐标题');
  };

  const applySuggestedTags = () => {
    const asset = selectedAsset.value;
    if (!asset) {
      setErrorState({ message: '请先选择素材', code: 'PUBLISH_ASSET_MISSING', stage: 'publish.editor', hint: '', details: '' });
      return;
    }
    editor.value.tags = normalizeTags(asset.metadata?.suggestedTags || []).join(', ');
    appendLog('已恢复推荐标签');
  };

  const loadJobIntoEditor = async (job) => {
    const assetId = String(job?.asset?.id || '').trim();
    if (!assetId) {
      setErrorState({ message: '当前任务缺少素材信息，无法载回编辑器', code: 'PUBLISH_ASSET_MISSING', stage: 'publish.editor', hint: '', details: '' });
      return;
    }
    selectedAssetId.value = assetId;
    editor.value.title = job?.publishData?.title || '';
    editor.value.description = job?.publishData?.description || '';
    editor.value.tagStrategy = job?.publishData?.tagStrategy === 'model' ? 'model' : 'system';
    editor.value.tags = normalizeTags(job?.publishData?.tags || []).join(', ');
    editor.value.coverUrl = job?.publishData?.coverUrl || '';
    editor.value.platforms = Array.isArray(job?.selectedPlatforms) && job.selectedPlatforms.length ? [...job.selectedPlatforms] : ['wechatChannels'];
    editor.value.platformSelections = job?.platformSelections && typeof job.platformSelections === 'object'
      ? JSON.parse(JSON.stringify(job.platformSelections))
      : { wechatChannels: { accountId: '' } };
    await refresh(false, { preserveEditor: true });
    appendLog(`已将发布任务载回编辑器：${job.id}`);
  };

  const updateConfigField = (platformKey, field, value) => {
    if (!config.value[platformKey]) return;
    if (platformKey === 'wechatChannels' && field === 'accounts') {
      config.value = {
        ...config.value,
        wechatChannels: {
          ...config.value.wechatChannels,
          accounts: Array.isArray(value) ? value : []
        }
      };
      return;
    }
    config.value = {
      ...config.value,
      [platformKey]: {
        ...config.value[platformKey],
        [field]: typeof config.value[platformKey][field] === 'boolean' ? Boolean(value) : String(value ?? '')
      }
    };
  };

  const createWechatAccount = () => ({
    id: `wechat_${Math.random().toString(36).slice(2, 10)}`,
    displayName: '',
    finderUserName: '',
    helperAccount: '',
    openPlatformAppId: '',
    appId: '',
    appSecret: '',
    refreshToken: '',
    accountId: '',
    notes: ''
  });

  const addWechatAccount = () => {
    const nextAccount = createWechatAccount();
    updateConfigField('wechatChannels', 'accounts', [...wechatAccounts.value, nextAccount]);
    if (!editor.value.platformSelections.wechatChannels.accountId) {
      editor.value.platformSelections.wechatChannels.accountId = nextAccount.id;
    }
  };

  const updateWechatAccountField = (accountId, field, value) => {
    updateConfigField(
      'wechatChannels',
      'accounts',
      wechatAccounts.value.map((account) => (account.id === accountId ? { ...account, [field]: String(value ?? '') } : account))
    );
  };

  const removeWechatAccount = (accountId) => {
    const nextAccounts = wechatAccounts.value.filter((account) => account.id !== accountId);
    updateConfigField('wechatChannels', 'accounts', nextAccounts);
    if (editor.value.platformSelections.wechatChannels.accountId === accountId) {
      editor.value.platformSelections.wechatChannels.accountId = nextAccounts[0]?.id || '';
    }
  };

  const saveConfig = async () => {
    savingConfig.value = true;
    clearErrorState();
    appendLog('保存平台配置');
    try {
      const res = await axios.post('/api/publish/config', config.value);
      config.value = res.data?.config || config.value;
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '保存平台配置失败'));
    } finally {
      savingConfig.value = false;
    }
  };

  const toggleEditorPlatform = (platformKey, checked) => {
    const current = new Set(editor.value.platforms);
    if (checked) current.add(platformKey);
    else current.delete(platformKey);
    editor.value.platforms = Array.from(current);
  };

  const createJob = async () => {
    if (!selectedAssetId.value) {
      error.value = '请先选择素材';
      appendError(error.value);
      return;
    }
    creating.value = true;
    clearErrorState();
    appendLog('创建一键发布任务');
    try {
      const res = await axios.post('/api/publish/jobs', {
        assetId: selectedAssetId.value,
        title: editor.value.title,
        description: editor.value.description,
        tagStrategy: editor.value.tagStrategy,
        tags: normalizeTags(editor.value.tags),
        coverUrl: editor.value.coverUrl,
        platforms: editor.value.platforms,
        platformSelections: editor.value.platformSelections
      });
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '创建发布任务失败'));
    } finally {
      creating.value = false;
    }
  };

  const generateEditorDescription = async () => {
    if (!selectedAssetId.value) {
      error.value = '请先选择素材';
      appendError(error.value);
      return;
    }
    generatingDescription.value = true;
    clearErrorState();
    appendLog(`生成发布描述（${editor.value.tagStrategy === 'model' ? '模型标签' : '系统标签'}）`);
    try {
      const res = await axios.post('/api/publish/description', {
        assetId: selectedAssetId.value,
        tagStrategy: editor.value.tagStrategy
      });
      editor.value.description = res.data?.description || '';
    } catch (err) {
      setErrorState(normalizeApiError(err, '生成发布描述失败'));
    } finally {
      generatingDescription.value = false;
    }
  };

  const runAllWechat = async (mode = "draft") => {
    clearErrorState();
    appendLog(`一键启动所有微信视频号任务：${mode === "publish" ? "自动发布" : "填充到待发布页"}`);
    try {
      const res = await axios.post(`/api/publish/jobs/wechat-channels/start-all`, { mode });
      jobs.value = res.data?.jobs || jobs.value;
      if (res.data?.failedCount > 0) {
        appendLog(`一键启动完成：成功启动 ${res.data.startedCount} 个，失败 ${res.data.failedCount} 个`);
        if (res.data.errors?.length) {
          appendLog(`错误详情：\n${res.data.errors.join("\n")}`);
        }
      } else {
        appendLog(`一键启动成功，共启动 ${res.data.startedCount} 个任务`);
      }
    } catch (err) {
      setErrorState(normalizeApiError(err, "一键启动所有任务失败"));
    }
  };
  const runWechat = async (job, mode = 'draft') => {
    clearErrorState();
    appendLog(`启动微信视频号任务：${mode === 'publish' ? '自动发布' : '填充到待发布页'} / ${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/wechat-channels`, { mode });
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '启动微信视频号任务失败'));
    }
  };

  const retryWechat = async (job, mode = '') => {
    clearErrorState();
    appendLog(`重试微信视频号任务：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/wechat-channels/retry`, { mode });
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '重试微信视频号任务失败'));
    }
  };

  const cancelWechat = async (job) => {
    clearErrorState();
    appendLog(`取消微信视频号任务：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/wechat-channels/cancel`);
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '取消微信视频号任务失败'));
    }
  };

  const archiveJob = async (job, archived = true) => {
    clearErrorState();
    appendLog(`${archived ? '归档' : '取消归档'}发布任务：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/${archived ? 'archive' : 'unarchive'}`);
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '归档发布任务失败'));
    }
  };

  const regenerateJobDescription = async (job) => {
    clearErrorState();
    regeneratingDescriptionJobId.value = job.id;
    appendLog(`重新生成发布描述：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/regenerate-description`);
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '重新生成发布描述失败'));
    } finally {
      regeneratingDescriptionJobId.value = '';
    }
  };

  const archiveCompleted = async () => {
    clearErrorState();
    appendLog('归档已完成任务');
    try {
      const res = await axios.post('/api/publish/jobs/archive-completed');
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '归档已完成任务失败'));
    }
  };

  const deleteJob = async (job) => {
    clearErrorState();
    appendLog(`删除发布任务：${job.id}`);
    try {
      const res = await axios.delete(`/api/publish/jobs/${job.id}`);
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '删除发布任务失败'));
    }
  };

  const clearJobs = async () => {
    clearErrorState();
    appendLog('清空发布任务列表');
    try {
      const res = await axios.delete('/api/publish/jobs');
      jobs.value = res.data?.jobs || [];
    } catch (err) {
      setErrorState(normalizeApiError(err, '清空发布任务失败'));
    }
  };

  const getFieldLabel = (platformKey, field) => FIELD_LABELS[platformKey]?.[field] || field;
  const isSecretField = (field) => SECRET_HINT_FIELDS.has(field);

  const getTask = (job, platformKey = 'wechatChannels') => (job.platformTasks || []).find((task) => task.platform === platformKey) || null;
  const getWechatAccountOptions = () => wechatAccounts.value.map((account) => ({
    id: account.id,
    label: account.displayName || account.helperAccount || account.finderUserName || account.id
  }));

  const getJobTerminalState = (job) => {
    const states = (job.platformTasks || []).map((task) => String(task.runtime?.state || task.status || ''));
    if (states.some((state) => ['published', 'success'].includes(state))) return 'published';
    if (states.some((state) => state === 'ready_for_manual_publish')) return 'ready_for_manual_publish';
    if (states.some((state) => state === 'cancelled')) return 'cancelled';
    if (states.some((state) => state === 'failed')) return 'failed';
    if (states.some((state) => ['publishing', 'editing', 'uploaded', 'processing', 'uploading', 'starting', 'navigating', 'login_ready', 'need_login', 'draft_preparing', 'edited'].includes(state))) return 'running';
    if (job.platformErrors?.length) return 'partial_ready';
    return job.status || 'ready';
  };

  const getJobStatusLabel = (job) => {
    const state = getJobTerminalState(job);
    const map = {
      published: '已成功发布',
      ready_for_manual_publish: '待人工确认',
      cancelled: '已取消',
      failed: '执行失败',
      running: '执行中',
      partial_ready: '部分待完善',
      ready: '已就绪'
    };
    return map[state] || state;
  };

  const selfCheckSummary = computed(() => selfCheck.value?.summary || { status: 'unknown', failCount: 0, warnCount: 0, okCount: 0 });
  const selfCheckHighlights = computed(() => {
    const groups = Array.isArray(selfCheck.value?.groups) ? selfCheck.value.groups : [];
    return groups
      .flatMap((group) => Array.isArray(group.items) ? group.items.map((item) => ({ ...item, groupLabel: group.label })) : [])
      .filter((item) => item.status !== 'ok')
      .slice(0, 6);
  });

  const getWechatProgress = (job) => {
    const task = getTask(job);
    return Math.max(0, Math.min(100, Number(task?.runtime?.progress || 0)));
  };

  const canRunWechat = (job) => {
    const task = getTask(job);
    return !!task && !['publishing', 'editing', 'uploaded', 'processing', 'uploading', 'starting', 'navigating'].includes(String(task.runtime?.state || task.status || ''));
  };

  const startAutoRefresh = () => {
    if (autoRefreshTimer) return;
    autoRefreshTimer = window.setInterval(() => {
      refreshJobs(true);
    }, 4000);
  };

  const stopAutoRefresh = () => {
    if (autoRefreshTimer) {
      window.clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  };

  watch(selectedAssetId, (value, oldValue) => {
    if (value && value !== oldValue) {
      const asset = assets.value.find((item) => item.id === value) || null;
      fillEditorFromAsset(asset);
    }
  });

  return {
    loading,
    error,
    errorState,
    savingConfig,
    creating,
    generatingDescription,
    regeneratingDescriptionJobId,
    assets,
    jobs,
    config,
    selfCheck,
    selfCheckLoading,
    selectedAssetId,
    selectedAsset,
    stats,
    recentLogs,
    errorLogs,
    editor,
    jobFilter,
    platformDefs,
    platformCards,
    wechatAccounts,
    filteredJobs,
    selfCheckSummary,
    selfCheckHighlights,
    refreshJobs,
    refreshSelfCheck,
    refresh,
    startAutoRefresh,
    stopAutoRefresh,
    selectAsset,
    updateConfigField,
    applySuggestedTitle,
    applySuggestedTags,
    loadJobIntoEditor,
    addWechatAccount,
    updateWechatAccountField,
    removeWechatAccount,
    saveConfig,
    toggleEditorPlatform,
    createJob,
    generateEditorDescription,
    runAllWechat,
    runWechat,
    retryWechat,
    cancelWechat,
    regenerateJobDescription,
    archiveJob,
    archiveCompleted,
    deleteJob,
    clearJobs,
    getFieldLabel,
    isSecretField,
    getTask,
    getWechatAccountOptions,
    getJobTerminalState,
    getJobStatusLabel,
    getWechatProgress,
    canRunWechat
  };
}
