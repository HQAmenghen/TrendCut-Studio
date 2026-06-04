import { computed, ref, watch } from 'vue';
import axios from 'axios';
import {
  buildActiveAutoPilotMappings,
  buildAutoPilotAvatarPresetSummary,
  buildAutoPilotConfiguredPlans,
  buildAutoPilotMappingsForMode,
  buildAutoPilotSummaryItems,
  buildGeneratedAutoPilotJobs,
  formatAutoPilotJobTime,
  getAutoPilotModeSchedule as getAutoPilotModeScheduleFromGlobal,
  getAvatarPresetLabel
} from './publishCenter/autoPilot.mjs';
import {
  AUTO_PILOT_PIPELINE_DEFS,
  AUTO_PILOT_PLATFORM_KEYS,
  DEFAULT_AUTO_PILOT_PLATFORMS,
  DEFAULT_AVATAR_AUDIO_PRESET,
  DEFAULT_AVATAR_IMAGE_PRESET,
  DEFAULT_XAI_PARTITION_ID,
  FIELD_LABELS,
  PLATFORM_DEFS,
  SAU_PLATFORM_KEYS,
  SECRET_HINT_FIELDS,
  buildPlatformAccountOptions,
  buildPlatformCards,
  createSauAccount,
  createWechatAccount,
  createXAccount,
  getPlatformAccounts,
  normalizeApiError,
  normalizeAutoPilotModeSchedules,
  normalizeAutoPilotPipelineModes,
  normalizeAutoPilotPlatformRows,
  normalizePlatformSelection,
  normalizePresetPayload,
  normalizeStringArray,
  normalizeTags,
  normalizeXaiPartitionId,
  pickPublishTitleFromAsset,
  resolvePlatformAccountLabel
} from './publishCenter/domain.mjs';

export function usePublishCenter() {
  const loading = ref(false);
  const error = ref('');
  const errorState = ref({ message: '', code: '', stage: '', hint: '', details: '' });
  const savingConfig = ref(false);
  const creating = ref(false);
  const creatingStatusMessage = ref('');
  const generatingDescription = ref(false);
  const regeneratingDescriptionJobId = ref('');
  const deletingAssetId = ref('');
  const assets = ref([]);
  const jobs = ref([]);
  const config = ref({});
  const presets = ref({ audio: [], image: [] });
  const xaiPartitions = ref([]);
  const selfCheck = ref(null);
  const selfCheckLoading = ref(false);
  const selectedAssetId = ref('');
  const jobFilter = ref('active');
  const recentLogs = ref([]);
  const errorLogs = ref([]);
  let autoRefreshTimer = null;
  let qrLoginPollTimer = null;

  // 登录状态检测相关状态
  const accountLoginStatus = ref({});
  const checkingLoginAccounts = ref(new Set());
  const checkingBatchLogin = ref(false);

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

  const qrCodeData = ref({
    show: false,
    accountId: '',
    accountLabel: '',
    source: '',
    base64: '',
    qrCodePath: '',
    status: '',
    error: '',
    message: ''
  });

  const stopWechatLoginPolling = () => {
    if (qrLoginPollTimer) {
      window.clearInterval(qrLoginPollTimer);
      qrLoginPollTimer = null;
    }
  };

  const applyWechatLoginResponse = (accountId, payload) => {
    // Terminal state — don't allow any poll response to revert it
    if (qrCodeData.value.status === 'logged_in') return;

    if (payload?.status === 'logged_in') {
      qrCodeData.value = {
        show: true,
        accountId,
        accountLabel: payload.accountLabel || accountId,
        source: payload.source || 'login-check',
        base64: '',
        qrCodePath: '',
        status: 'logged_in',
        error: '',
        message: '✅ 登录成功，浏览器即将关闭'
      };
      appendLog(`账号 ${accountId} 登录有效`);
      stopWechatLoginPolling();
      window.setTimeout(() => {
        if (qrCodeData.value.accountId === accountId && qrCodeData.value.status === 'logged_in') {
          qrCodeData.value.show = false;
        }
      }, 2000);
      return;
    }

    if (payload?.status === 'need_scan') {
      qrCodeData.value = {
        show: true,
        accountId,
        accountLabel: payload.accountLabel || accountId,
        source: payload.source || 'login-check',
        base64: payload.qrCodeBase64 || '',
        qrCodePath: payload.qrCodePath || '',
        status: 'need_scan',
        error: '',
        message: payload.message || '请在弹出的浏览器窗口中扫描二维码'
      };
      return;
    }

    if (payload?.status === 'idle') {
      // Session was cleaned up — keep current state if we're already in need_scan
      if (qrCodeData.value.accountId === accountId && qrCodeData.value.status === 'need_scan') {
        return;
      }
      qrCodeData.value.status = 'loading';
      qrCodeData.value.message = '正在打开浏览器...';
    }
  };

  const applyPublishRuntimeQr = (jobId, platformKey, payload = {}) => {
    if (!jobId || !platformKey) return;
    const platformLabel = PLATFORM_DEFS.find((item) => item.key === platformKey)?.label || platformKey;
    const rawBase64 = String(payload.qrCodeBase64 || '').trim();
    const rawPath = String(payload.qrCodePath || '').trim();
    const qrImage = rawBase64
      ? rawBase64.startsWith('data:image/')
        ? rawBase64
        : `data:image/png;base64,${rawBase64}`
      : '';
    qrCodeData.value = {
      show: true,
      accountId: String(payload.accountId || jobId).trim() || jobId,
      accountLabel: String(payload.accountLabel || platformLabel).trim() || platformLabel,
      source: 'publish-runtime',
      base64: qrImage,
      qrCodePath: rawPath,
      status: qrImage || rawPath ? 'need_scan' : 'loading',
      error: '',
      message: payload.message || `正在为 ${platformLabel} 准备登录二维码...`
    };
  };

  const normalizeQrImage = (value) => {
    const rawBase64 = String(value || '').trim();
    return rawBase64 && !rawBase64.startsWith('data:image/')
      ? `data:image/png;base64,${rawBase64}`
      : rawBase64;
  };

  const applyPlatformAccountLoginResponse = (platformKey, accountId, payload = {}, options = {}) => {
    const statusKey = `${platformKey}:${accountId}`;
    const rawStatus = payload.status || 'unknown';
    const status = rawStatus === 'need_scan'
      ? 'need_login'
      : ['starting', 'checking_login'].includes(rawStatus)
        ? 'checking'
        : rawStatus;
    const result = {
      ...payload,
      status,
      lastCheckedAt: new Date().toISOString()
    };
    accountLoginStatus.value = {
      ...accountLoginStatus.value,
      [statusKey]: result
    };
    if (payload.status === 'need_scan') {
      qrCodeData.value = {
        show: true,
        accountId: statusKey,
        accountLabel: payload.accountLabel || accountId,
        source: options.source || 'platform-account-login',
        base64: normalizeQrImage(payload.qrCodeBase64),
        qrCodePath: payload.qrCodePath || '',
        status: 'need_scan',
        error: '',
        message: payload.message || '请扫描二维码登录'
      };
    } else if (payload.status === 'logged_in' && !options.silentLoggedIn) {
      qrCodeData.value = {
        show: true,
        accountId: statusKey,
        accountLabel: payload.accountLabel || accountId,
        source: options.source || 'platform-account-login',
        base64: '',
        qrCodePath: '',
        status: 'logged_in',
        error: '',
        message: payload.message || '登录态可用'
      };
      window.setTimeout(() => {
        if (qrCodeData.value.accountId === statusKey && qrCodeData.value.status === 'logged_in') {
          qrCodeData.value.show = false;
        }
      }, 1800);
    }
    return result;
  };

  const pollWechatLoginStatus = (accountId) => {
    stopWechatLoginPolling();
    qrLoginPollTimer = window.setInterval(async () => {
      if (!qrCodeData.value.show || qrCodeData.value.accountId !== accountId) {
        stopWechatLoginPolling();
        return;
      }
      try {
        const res = await axios.post(`/api/publish/wechat/test-login/${accountId}`, { poll: true });
        if (res.data?.success) {
          applyWechatLoginResponse(accountId, res.data);
        } else {
          throw new Error(res.data?.error || '扫码状态查询失败');
        }
      } catch (err) {
        const normalized = normalizeApiError(err, '扫码状态查询失败');
        qrCodeData.value.status = 'error';
        qrCodeData.value.error = normalized.message;
        qrCodeData.value.message = '';
        appendError(`扫码状态查询失败: ${normalized.message}`);
        stopWechatLoginPolling();
      }
    }, 4000);
  };

  const testWechatLogin = async (accountId, options = {}) => {
    if (!options.poll) {
      stopWechatLoginPolling();
    }
    qrCodeData.value = {
      show: true,
      accountId,
      base64: options.preserveBase64 ? qrCodeData.value.base64 : '',
      status: 'loading',
      error: '',
      message: '正在检测当前登录状态...'
    };
    appendLog(`测试微信视频号登录状态：${accountId}`);
    try {
      const res = await axios.post(`/api/publish/wechat/test-login/${accountId}`, { poll: options.poll === true });
      if (res.data?.success) {
        applyWechatLoginResponse(accountId, res.data);
        if (res.data.status === 'need_scan') {
          appendLog(`账号 ${accountId} 需要重新扫码`);
          pollWechatLoginStatus(accountId);
        }
      } else {
        throw new Error(res.data?.error || '未知错误');
      }
    } catch (err) {
      const normalized = normalizeApiError(err, '测试登录状态失败');
      qrCodeData.value.status = 'error';
      qrCodeData.value.error = normalized.message;
      qrCodeData.value.message = '';
      appendError(`测试登录状态失败: ${normalized.message}`);
      stopWechatLoginPolling();
    }
  };

  const openWechatContentManager = async (accountId) => {
    clearErrorState();
    appendLog(`打开视频号内容管理：${accountId}`);
    try {
      const res = await axios.post(`/api/publish/wechat/content-manager/${accountId}`);
      if (res.data?.success === false) {
        throw new Error(res.data?.error || res.data?.message || '打开内容管理失败');
      }
      appendLog(res.data?.message || `已打开账号 ${accountId} 的内容管理页`);
      return res.data || null;
    } catch (err) {
      setErrorState(normalizeApiError(err, '打开视频号内容管理失败'));
      return null;
    }
  };

  const openPlatformContentManager = async (platformKey, accountId) => {
    clearErrorState();
    appendLog(`打开${getPlatformLabel(platformKey)}内容管理：${accountId}`);
    try {
      const res = await axios.post(`/api/publish/platforms/${platformKey}/accounts/${accountId}/content-manager`);
      if (res.data?.success === false) {
        throw new Error(res.data?.error || res.data?.message || '打开内容管理失败');
      }
      appendLog(res.data?.message || `已打开${getPlatformLabel(platformKey)}内容管理页`);
      return res.data || null;
    } catch (err) {
      setErrorState(normalizeApiError(err, `打开${getPlatformLabel(platformKey)}内容管理失败`));
      return null;
    }
  };

  const retryQrLogin = async () => {
    const accountKey = String(qrCodeData.value.accountId || '').trim();
    const source = String(qrCodeData.value.source || '').trim();
    if (!accountKey) return;
    if (source === 'platform-account-login' && accountKey.includes(':')) {
      const [platformKey, accountId] = accountKey.split(':');
      await checkPlatformAccountLogin(platformKey, accountId);
      return;
    }
    await testWechatLogin(accountKey);
  };

  const closeQrCodeModal = () => {
    stopWechatLoginPolling();
    qrCodeData.value.show = false;
  };

  const refreshRuntimeQrFromJobs = () => {
    const currentJobs = Array.isArray(jobs.value) ? jobs.value : [];
    const candidate = currentJobs
      .flatMap((job) => (Array.isArray(job.platformTasks) ? job.platformTasks.map((task) => ({ job, task })) : []))
      .find(({ task }) => {
        const state = String(task?.runtime?.state || task?.status || '').trim();
        return ['need_login', 'checking_login', 'login_ready', 'starting', 'navigating', 'uploading'].includes(state)
          && String(task?.runtime?.qrCodeBase64 || task?.runtime?.qrCodePath || '').trim();
      });

    if (!candidate) {
      if (qrCodeData.value.source === 'publish-runtime' && qrCodeData.value.status === 'need_scan') {
        qrCodeData.value.show = false;
      }
      return;
    }
    const { job, task } = candidate;
    const currentKey = `${job.id}:${task.platform}`;
    const nextBase64 = task.runtime?.qrCodeBase64 || '';
    const nextPath = task.runtime?.qrCodePath || '';
    if (
      qrCodeData.value.show
      && qrCodeData.value.source === 'publish-runtime'
      && qrCodeData.value.accountId === currentKey
      && qrCodeData.value.status === 'need_scan'
      && qrCodeData.value.base64 === nextBase64
      && qrCodeData.value.qrCodePath === nextPath
    ) {
      return;
    }
    applyPublishRuntimeQr(job.id, task.platform, {
      accountId: currentKey,
      accountLabel: task.accountLabel || task.platformLabel || getPlatformLabel(task.platform),
      qrCodeBase64: nextBase64,
      qrCodePath: nextPath,
      message: task.runtime?.lastMessage || '请扫描二维码登录',
      status: 'need_scan'
    });
  };

  const clearErrorState = () => {
    errorState.value = { message: '', code: '', stage: '', hint: '', details: '' };
    error.value = '';
  };

  const editor = ref({
    title: '',
    description: '',
    tagStrategy: 'model',
    tags: '',
    coverUrl: '',
    scheduledTime: '',
    platforms: ['wechatChannels'],
    platformSelections: {
      wechatChannels: {
        accountId: ''
      }
    }
  });

  const platformDefs = PLATFORM_DEFS;
  const autoPilotPlatformDefs = PLATFORM_DEFS.filter((platform) => AUTO_PILOT_PLATFORM_KEYS.includes(platform.key));
  const getPlatformLabel = (platformKey) => platformDefs.find((platform) => platform.key === platformKey)?.label || platformKey;
  const getPlatformLabels = (platformKeys) => normalizePlatformSelection(platformKeys).map((platformKey) => getPlatformLabel(platformKey));
  const getRunModeLabel = (platformKey, mode) => {
    if (platformKey === 'x' && mode === 'publish') return '自动发表';
    return mode === 'publish' ? '自动发布' : '填充到待发布页';
  };

  const selectedAsset = computed(() => assets.value.find((asset) => asset.id === selectedAssetId.value) || null);

  const stats = computed(() => ({
    assetCount: assets.value.length,
    jobCount: jobs.value.length,
    enabledPlatformCount: Object.values(config.value || {}).filter((item) => item?.enabled).length
  }));

  const wechatAccounts = computed(() => getPlatformAccounts(config.value, 'wechatChannels'));
  const getSauAccounts = (platformKey) => getPlatformAccounts(config.value, platformKey);
  const douyinAccounts = computed(() => getSauAccounts('douyin'));
  const xiaohongshuAccounts = computed(() => getSauAccounts('xiaohongshu'));
  const xAccounts = computed(() => getPlatformAccounts(config.value, 'x'));
  const getPlatformAccountOptions = (platformKey) => buildPlatformAccountOptions(config.value, platformKey);
  const getPlatformAccountLabel = (platformKey, accountId) => resolvePlatformAccountLabel(config.value, platformKey, accountId);
  const ensureEditorPlatformSelection = (platformKey) => {
    if (!editor.value.platformSelections[platformKey]) {
      editor.value.platformSelections[platformKey] = { accountId: '' };
    }
    const selection = editor.value.platformSelections[platformKey];
    const options = getPlatformAccountOptions(platformKey);
    if (!selection.accountId) {
      const firstAccount = options[0];
      if (firstAccount) selection.accountId = firstAccount.id;
    }
    if (selection.accountId && !options.some((account) => account.id === selection.accountId)) {
      selection.accountId = options[0]?.id || '';
    }
  };
  const xaiPartitionOptions = computed(() => {
    const source = Array.isArray(xaiPartitions.value) && xaiPartitions.value.length
      ? xaiPartitions.value
      : [{ id: DEFAULT_XAI_PARTITION_ID, label: '加密', accounts: [] }];
    return source.map((partition) => ({
      id: normalizeXaiPartitionId(partition.id),
      label: partition.label || partition.id || '默认分区',
      accountCount: Array.isArray(partition.accounts) ? partition.accounts.length : 0
    }));
  });
  const avatarAudioPresetOptions = computed(() => {
    const options = [...presets.value.audio];
    if (!options.includes(DEFAULT_AVATAR_AUDIO_PRESET)) options.unshift(DEFAULT_AVATAR_AUDIO_PRESET);
    return options;
  });
  const avatarImagePresetOptions = computed(() => {
    const options = [...presets.value.image];
    if (!options.includes(DEFAULT_AVATAR_IMAGE_PRESET)) options.unshift(DEFAULT_AVATAR_IMAGE_PRESET);
    return options;
  });
  const getDefaultAvatarAudioPreset = () => (
    avatarAudioPresetOptions.value.includes(DEFAULT_AVATAR_AUDIO_PRESET)
      ? DEFAULT_AVATAR_AUDIO_PRESET
      : (avatarAudioPresetOptions.value[0] || '')
  );
  const getDefaultAvatarImagePreset = () => (
    avatarImagePresetOptions.value.includes(DEFAULT_AVATAR_IMAGE_PRESET)
      ? DEFAULT_AVATAR_IMAGE_PRESET
      : (avatarImagePresetOptions.value[0] || '')
  );
  const getAutoPilotAvatarPresetSummary = (mapping = {}) => buildAutoPilotAvatarPresetSummary(mapping, {
    defaultAudioPreset: getDefaultAvatarAudioPreset(),
    defaultImagePreset: getDefaultAvatarImagePreset()
  });
  const activeAutoPilotPipelineModes = computed(() => normalizeAutoPilotPipelineModes(
    config.value?.global?.autoPilotPipelineModes,
    config.value?.global?.pipelineMode || 'vertical'
  ));

  const getAutoPilotModeSchedule = (mode) => getAutoPilotModeScheduleFromGlobal(config.value?.global || {}, mode);

  const getAutoPilotMappingsForMode = (mode) => buildAutoPilotMappingsForMode({
    mode,
    global: config.value?.global || {},
    xaiPartitionOptions: xaiPartitionOptions.value,
    getDefaultAvatarAudioPreset,
    getDefaultAvatarImagePreset,
    getPlatformLabel,
    getPlatformLabels
  });

  const activeAutoPilotMappings = computed(() => buildActiveAutoPilotMappings({
    activeModes: activeAutoPilotPipelineModes.value,
    global: config.value?.global || {},
    xaiPartitionOptions: xaiPartitionOptions.value,
    getDefaultAvatarAudioPreset,
    getDefaultAvatarImagePreset,
    getPlatformLabel,
    getPlatformLabels
  }));

  const autoPilotConfiguredPlans = computed(() => buildAutoPilotConfiguredPlans({
    mappings: activeAutoPilotMappings.value,
    global: config.value?.global || {},
    getPlatformAccountLabel,
    getPlatformLabel,
    getAvatarPresetSummary: getAutoPilotAvatarPresetSummary
  }));

  const generatedAutoPilotJobs = computed(() => buildGeneratedAutoPilotJobs({
    jobs: jobs.value,
    getJobTerminalState,
    getJobStatusLabel,
    getPlatformLabels,
    getAvatarPresetSummary: getAutoPilotAvatarPresetSummary
  }));

  const autoPilotJobs = computed(() => [
    ...autoPilotConfiguredPlans.value,
    ...generatedAutoPilotJobs.value
  ]);

  const autoPilotSummaryItems = computed(() => buildAutoPilotSummaryItems({
    global: config.value?.global || {},
    activeModes: activeAutoPilotPipelineModes.value,
    activeMappings: activeAutoPilotMappings.value,
    getPlatformAccountLabel,
    getPlatformLabel,
    getAvatarPresetSummary: getAutoPilotAvatarPresetSummary
  }));

  const platformCards = computed(() => buildPlatformCards(config.value, platformDefs));

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
    editor.value.title = pickPublishTitleFromAsset(asset);
    editor.value.description = '';
    editor.value.tagStrategy = 'model';
    editor.value.tags = '';
    editor.value.coverUrl = asset.metadata?.coverUrl || '';
    for (const platformKey of editor.value.platforms || []) {
      ensureEditorPlatformSelection(platformKey);
    }
  };

  const refreshJobs = async (silent = false) => {
    try {
      const res = await axios.get('/api/publish/jobs');
      jobs.value = res.data?.jobs || [];
      refreshRuntimeQrFromJobs();
    } catch (err) {
      const normalized = normalizeApiError(err, '读取发布任务失败');
      errorState.value = normalized;
      error.value = normalized.message;
      if (!silent) appendError(error.value);
    }
  };

  const refreshPresets = async () => {
    try {
      const res = await axios.get('/api/presets');
      presets.value = normalizePresetPayload(res.data || {});
    } catch (_err) {
      presets.value = normalizePresetPayload(presets.value);
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
      const [assetsRes, jobsRes, configRes, selfCheckRes, xaiConfigRes, presetsRes] = await Promise.all([
        axios.get('/api/publish/assets', { params: { refresh: force ? 1 : 0 } }),
        axios.get('/api/publish/jobs'),
        axios.get('/api/publish/config'),
        axios.get('/api/system/self-check'),
        axios.get('/api/xai-top10/config').catch(() => ({ data: { config: { partitions: [] } } })),
        axios.get('/api/presets').catch(() => ({ data: { audio: [], image: [] } }))
      ]);
      assets.value = assetsRes.data.assets || [];
      jobs.value = jobsRes.data.jobs || [];
      refreshRuntimeQrFromJobs();
      config.value = configRes.data.config || {};
      selfCheck.value = selfCheckRes.data?.report || null;
      xaiPartitions.value = xaiConfigRes.data?.config?.partitions || [];
      presets.value = normalizePresetPayload(presetsRes.data || {});
      for (const platformKey of editor.value.platforms || []) {
        ensureEditorPlatformSelection(platformKey);
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

  const refreshAssets = async (force = true, options = {}) => {
    const preserveEditor = options.preserveEditor !== false;
    try {
      const res = await axios.get('/api/publish/assets', { params: { refresh: force ? 1 : 0 } });
      const keepId = selectedAssetId.value;
      assets.value = res.data?.assets || [];
      const nextSelected = assets.value.find((asset) => asset.id === keepId)?.id || assets.value[0]?.id || '';
      selectedAssetId.value = nextSelected;
      if (nextSelected && !preserveEditor) {
        fillEditorFromAsset(assets.value.find((asset) => asset.id === nextSelected) || null);
      }
    } catch (err) {
      setErrorState(normalizeApiError(err, '刷新成品库失败'));
    }
  };

  const selectAsset = async (assetId) => {
    selectedAssetId.value = assetId;
    appendLog(`切换发布素材：${assetId || '未选择'}`);
    await refresh(true);
  };

  const deleteAsset = async (asset) => {
    const assetId = String(asset?.id || '').trim();
    if (!assetId) {
      setErrorState({ message: '缺少素材 ID，无法删除', code: 'PUBLISH_ASSET_ID_MISSING', stage: 'publish.assets', hint: '', details: '' });
      return false;
    }
    clearErrorState();
    deletingAssetId.value = assetId;
    appendLog(`删除成品素材：${asset.displayLabel || asset.label || assetId}`);
    try {
      const res = await axios.delete(`/api/publish/assets/${encodeURIComponent(assetId)}`);
      assets.value = res.data?.assets || [];
      if (selectedAssetId.value === assetId) {
        selectedAssetId.value = assets.value[0]?.id || '';
        if (selectedAssetId.value) {
          fillEditorFromAsset(assets.value[0]);
        } else {
          editor.value.title = '';
          editor.value.description = '';
          editor.value.tags = '';
          editor.value.coverUrl = '';
        }
      }
      return true;
    } catch (err) {
      setErrorState(normalizeApiError(err, '删除成品素材失败'));
      return false;
    } finally {
      deletingAssetId.value = '';
    }
  };

  const applySuggestedTitle = () => {
    const asset = selectedAsset.value;
    if (!asset) {
      setErrorState({ message: '请先选择素材', code: 'PUBLISH_ASSET_MISSING', stage: 'publish.editor', hint: '', details: '' });
      return;
    }
    editor.value.title = pickPublishTitleFromAsset(asset);
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

    if (job?.scheduledAt) {
      // datetime-local 格式需求: YYYY-MM-DDThh:mm
      const rawDate = new Date(job.scheduledAt);
      editor.value.scheduledTime = new Date(rawDate.getTime() - (rawDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    } else {
      editor.value.scheduledTime = '';
    }
    
    editor.value.platforms = Array.isArray(job?.selectedPlatforms) && job.selectedPlatforms.length ? [...job.selectedPlatforms] : ['wechatChannels'];
    editor.value.platformSelections = job?.platformSelections && typeof job.platformSelections === 'object'
      ? JSON.parse(JSON.stringify(job.platformSelections))
      : { wechatChannels: { accountId: '' } };
    if (!editor.value.platformSelections.wechatChannels) {
      editor.value.platformSelections.wechatChannels = { accountId: '' };
    }
    for (const platformKey of editor.value.platforms || []) {
      ensureEditorPlatformSelection(platformKey);
    }
    await refresh(false, { preserveEditor: true });
    appendLog(`已将发布任务载回编辑器：${job.id}`);
  };

  const updateConfigField = (platformKey, field, value) => {
    if (!config.value[platformKey]) return;
    if (['wechatChannels', ...SAU_PLATFORM_KEYS, 'x'].includes(platformKey) && field === 'accounts') {
      config.value = {
        ...config.value,
        [platformKey]: {
          ...config.value[platformKey],
          accounts: Array.isArray(value) ? value : []
        }
      };
      return;
    }
    config.value = {
      ...config.value,
      [platformKey]: {
        ...config.value[platformKey],
        [field]: typeof config.value[platformKey][field] === 'boolean'
          ? Boolean(value)
          : (Array.isArray(value) || (value && typeof value === 'object') ? value : String(value ?? ''))
      }
    };
  };

  const updateAutoPilotArray = (field, index, value) => {
    const arr = normalizeStringArray(config.value?.global?.[field]);
    arr[index] = value;
    updateConfigField('global', field, arr);
  };

  const updateAutoPilotModeArray = (mode, field, index, value) => {
    const schedules = normalizeAutoPilotModeSchedules(config.value?.global?.autoPilotModeSchedules);
    const current = schedules[mode] || {
      accountIds: [],
      times: [],
      partitionIds: [],
      sourceRanks: [],
      platforms: [],
      audioPresets: [],
      imagePresets: []
    };
    const validKeys = new Set(['accountIds', 'times', 'partitionIds', 'sourceRanks', 'platforms', 'audioPresets', 'imagePresets']);
    const key = validKeys.has(field) ? field : 'accountIds';
    const arr = key === 'platforms'
      ? normalizeAutoPilotPlatformRows(current[key])
      : normalizeStringArray(current[key]);
    arr[index] = value;
    updateConfigField('global', 'autoPilotModeSchedules', {
      ...schedules,
      [mode]: {
        ...current,
        [key]: arr
      }
    });
  };

  const toggleAutoPilotPipelineMode = (mode, checked) => {
    const current = new Set(activeAutoPilotPipelineModes.value);
    if (checked) current.add(mode);
    else current.delete(mode);
    const nextModes = AUTO_PILOT_PIPELINE_DEFS
      .map((item) => item.key)
      .filter((key) => current.has(key));
    const normalizedModes = nextModes.length ? nextModes : ['vertical'];
    updateConfigField('global', 'autoPilotPipelineModes', normalizedModes);
    updateConfigField('global', 'pipelineMode', normalizedModes[0]);
  };

  const addAutoPilotMapping = (rank) => {
    const rIdx = rank - 1;
    if (rIdx < 0) return;
    const accountIds = normalizeStringArray(config.value?.global?.autoPilotAccountIds);
    if (!accountIds[rIdx] && wechatAccounts.value.length > 0) {
      updateAutoPilotArray('autoPilotAccountIds', rIdx, wechatAccounts.value[0].id);
      updateAutoPilotArray('autoPilotTimes', rIdx, config.value.global?.autoPilotTime || '08:00');
    }
  };

  const removeAutoPilotMapping = (rank) => {
    const rIdx = rank - 1;
    if (rIdx < 0) return;
    updateAutoPilotArray('autoPilotAccountIds', rIdx, '');
  };

  const addAutoPilotModeMapping = (mode, rank) => {
    const rIdx = rank - 1;
    if (rIdx < 0) return;
    const schedule = getAutoPilotModeSchedule(mode);
    const accountIds = normalizeStringArray(schedule.accountIds);
    if (!accountIds[rIdx] && wechatAccounts.value.length > 0) {
      updateAutoPilotModeArray(mode, 'accountIds', rIdx, wechatAccounts.value[0].id);
      updateAutoPilotModeArray(mode, 'times', rIdx, config.value.global?.autoPilotTime || '08:00');
      updateAutoPilotModeArray(mode, 'partitionIds', rIdx, config.value.global?.autoPilotPartitionId || DEFAULT_XAI_PARTITION_ID);
      updateAutoPilotModeArray(mode, 'sourceRanks', rIdx, 1);
    } else if (!accountIds[rIdx]) {
      updateAutoPilotModeArray(mode, 'times', rIdx, config.value.global?.autoPilotTime || '08:00');
      updateAutoPilotModeArray(mode, 'partitionIds', rIdx, config.value.global?.autoPilotPartitionId || DEFAULT_XAI_PARTITION_ID);
      updateAutoPilotModeArray(mode, 'sourceRanks', rIdx, 1);
    }
    updateAutoPilotModeArray(mode, 'platforms', rIdx, [DEFAULT_AUTO_PILOT_PLATFORMS[0]]);
    if (mode === 'avatar') {
      updateAutoPilotModeArray(mode, 'audioPresets', rIdx, getDefaultAvatarAudioPreset());
      updateAutoPilotModeArray(mode, 'imagePresets', rIdx, getDefaultAvatarImagePreset());
    }
  };

  const removeAutoPilotModeMapping = (mode, rank) => {
    const rIdx = rank - 1;
    if (rIdx < 0) return;
    updateAutoPilotModeArray(mode, 'accountIds', rIdx, '');
    updateAutoPilotModeArray(mode, 'times', rIdx, '');
    updateAutoPilotModeArray(mode, 'partitionIds', rIdx, '');
    updateAutoPilotModeArray(mode, 'sourceRanks', rIdx, '');
    updateAutoPilotModeArray(mode, 'platforms', rIdx, []);
    updateAutoPilotModeArray(mode, 'audioPresets', rIdx, '');
    updateAutoPilotModeArray(mode, 'imagePresets', rIdx, '');
  };

  const toggleAutoPilotModePlatform = (mode, slot, platformKey, checked) => {
    const rIdx = slot - 1;
    if (rIdx < 0) return;
    const schedule = getAutoPilotModeSchedule(mode);
    const rows = normalizeAutoPilotPlatformRows(schedule.platforms);
    const current = new Set(normalizePlatformSelection(rows[rIdx]));
    if (checked) current.add(platformKey);
    else current.delete(platformKey);
    const next = AUTO_PILOT_PLATFORM_KEYS.filter((key) => current.has(key));
    updateAutoPilotModeArray(mode, 'platforms', rIdx, next.length ? next : DEFAULT_AUTO_PILOT_PLATFORMS);
  };

  const getNextAutoPilotMappingSlot = (mode) => {
    const usedSlots = new Set(getAutoPilotMappingsForMode(mode).map((mapping) => mapping.slot || mapping.rank));
    for (let rank = 1; rank <= 10; rank += 1) {
      if (!usedSlots.has(rank)) return rank;
    }
    return 10;
  };

  const addWechatAccount = (initial = {}) => {
    const nextAccount = createWechatAccount(initial);
    updateConfigField('wechatChannels', 'accounts', [...wechatAccounts.value, nextAccount]);
    if (!editor.value.platformSelections.wechatChannels.accountId) {
      editor.value.platformSelections.wechatChannels.accountId = nextAccount.id;
    }
    return nextAccount;
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

  const addSauAccount = (platformKey, initial = {}) => {
    if (!SAU_PLATFORM_KEYS.includes(platformKey)) return null;
    const nextAccount = createSauAccount(platformKey, initial);
    const accounts = getSauAccounts(platformKey);
    updateConfigField(platformKey, 'accounts', [...accounts, nextAccount]);
    ensureEditorPlatformSelection(platformKey);
    return nextAccount;
  };

  const updateSauAccountField = (platformKey, accountId, field, value) => {
    if (!SAU_PLATFORM_KEYS.includes(platformKey)) return;
    updateConfigField(
      platformKey,
      'accounts',
      getSauAccounts(platformKey).map((account) => (account.id === accountId ? { ...account, [field]: String(value ?? '') } : account))
    );
  };

  const removeSauAccount = (platformKey, accountId) => {
    if (!SAU_PLATFORM_KEYS.includes(platformKey)) return;
    const nextAccounts = getSauAccounts(platformKey).filter((account) => account.id !== accountId);
    updateConfigField(platformKey, 'accounts', nextAccounts);
    if (editor.value.platformSelections[platformKey]?.accountId === accountId) {
      editor.value.platformSelections[platformKey].accountId = nextAccounts[0]?.id || '';
    }
  };

  const addXAccount = (initial = {}) => {
    const nextAccount = createXAccount(initial);
    updateConfigField('x', 'accounts', [...xAccounts.value, nextAccount]);
    ensureEditorPlatformSelection('x');
    return nextAccount;
  };

  const updateXAccountField = (accountId, field, value) => {
    updateConfigField(
      'x',
      'accounts',
      xAccounts.value.map((account) => (account.id === accountId ? {
        ...account,
        [field]: field === 'markMadeWithAi' ? Boolean(value) : String(value ?? '')
      } : account))
    );
  };

  const removeXAccount = (accountId) => {
    const nextAccounts = xAccounts.value.filter((account) => account.id !== accountId);
    updateConfigField('x', 'accounts', nextAccounts);
    if (editor.value.platformSelections.x?.accountId === accountId) {
      editor.value.platformSelections.x.accountId = nextAccounts[0]?.id || '';
    }
  };

  const saveConfig = async (label) => {
    const tag = label || '平台配置';
    savingConfig.value = true;
    clearErrorState();
    appendLog(`正在保存${tag}...`);
    try {
      const res = await axios.post('/api/publish/config', config.value);
      config.value = res.data?.config || config.value;
      jobs.value = res.data?.jobs || jobs.value;
      appendLog(`✅ ${tag}保存成功`);
      if (tag.includes('托管')) {
        for (const item of autoPilotSummaryItems.value) {
          appendLog(`托管任务 · ${item.label}：${item.value}`);
        }
        const trigger = res.data?.autoPilotTrigger || null;
        if (trigger?.triggered) {
          appendLog(`托管任务 · 已立即按${trigger.sourceMode === 'current_ranking' ? '当前榜单' : '最新榜单'}开始准备，数量 ${trigger.count || 0}`);
          await refreshJobs(true);
        } else if (trigger?.reason === 'scheduled_mode_waiting_for_fetch_time') {
          appendLog('托管任务 · 当前为定时抓榜模式，等待设定时间自动启动');
        } else if (trigger?.reason === 'trigger_failed') {
          appendError(`托管任务即时准备失败: ${trigger.error || '未知错误'}`);
        }
      }
      return true;
    } catch (err) {
      setErrorState(normalizeApiError(err, `保存${tag}失败`));
      appendLog(`❌ ${tag}保存失败`);
      return false;
    } finally {
      savingConfig.value = false;
    }
  };

  const toggleEditorPlatform = (platformKey, checked) => {
    const current = new Set(editor.value.platforms);
    if (checked) current.add(platformKey);
    else current.delete(platformKey);
    editor.value.platforms = Array.from(current);
    if (platformKey === 'wechatChannels' && checked && !editor.value.platformSelections.wechatChannels) {
      editor.value.platformSelections.wechatChannels = { accountId: '' };
    }
    if (checked && (SAU_PLATFORM_KEYS.includes(platformKey) || platformKey === 'x')) {
      ensureEditorPlatformSelection(platformKey);
    }
  };

  const createJob = async () => {
    if (!selectedAssetId.value) {
      error.value = '请先选择素材';
      appendError(error.value);
      return null;
    }
    creating.value = true;
    creatingStatusMessage.value = '';
    clearErrorState();
    appendLog('创建一键发布任务');
    if (!String(editor.value.description || '').trim()) {
      creatingStatusMessage.value = '正在等待模型生成描述，这一步可能需要 1 到 3 分钟，请耐心等待。';
      appendLog('当前未手动填写描述，系统将优先等待模型生成描述后再创建任务');
    } else {
      creatingStatusMessage.value = '正在创建发布任务...';
    }
    try {
      const res = await axios.post('/api/publish/jobs', {
        assetId: selectedAssetId.value,
        title: editor.value.title,
        description: editor.value.description,
        tagStrategy: editor.value.tagStrategy,
        tags: normalizeTags(editor.value.tags),
        coverUrl: editor.value.coverUrl,
        scheduledTime: editor.value.scheduledTime,
        platforms: editor.value.platforms,
        platformSelections: editor.value.platformSelections
      });
      jobs.value = res.data?.jobs || jobs.value;
      creatingStatusMessage.value = '';
      appendLog('发布任务创建成功');
      return res.data?.job || null;
    } catch (err) {
      setErrorState(normalizeApiError(err, '创建发布任务失败'));
      return null;
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

  const runPlatform = async (job, platformKey, mode = 'draft') => {
    clearErrorState();
    appendLog(`启动${getPlatformLabel(platformKey)}任务：${getRunModeLabel(platformKey, mode)} / ${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/platforms/${platformKey}/start`, { mode });
      jobs.value = res.data?.jobs || jobs.value;
      appendLog(`${getPlatformLabel(platformKey)}任务已启动`);
      return true;
    } catch (err) {
      setErrorState(normalizeApiError(err, `启动${getPlatformLabel(platformKey)}任务失败`));
      return false;
    }
  };

  const runWechat = async (job, mode = 'draft') => {
    await runPlatform(job, 'wechatChannels', mode);
  };

  const retryPlatform = async (job, platformKey, mode = '') => {
    clearErrorState();
    appendLog(`重试${getPlatformLabel(platformKey)}任务：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/platforms/${platformKey}/retry`, { mode });
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, `重试${getPlatformLabel(platformKey)}任务失败`));
    }
  };

  const retryWechat = async (job, mode = '') => {
    await retryPlatform(job, 'wechatChannels', mode);
  };

  const cancelPlatform = async (job, platformKey) => {
    clearErrorState();
    appendLog(`取消${getPlatformLabel(platformKey)}任务：${job.id}`);
    try {
      const res = await axios.post(`/api/publish/jobs/${job.id}/platforms/${platformKey}/cancel`);
      jobs.value = res.data?.jobs || jobs.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, `取消${getPlatformLabel(platformKey)}任务失败`));
    }
  };

  const cancelWechat = async (job) => {
    await cancelPlatform(job, 'wechatChannels');
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
    const jobId = String(job?.id || '').trim();
    if (!jobId) return false;
    clearErrorState();
    appendLog(`删除发布任务：${jobId}`);
    const previousJobs = jobs.value;
    jobs.value = jobs.value.filter((item) => String(item.id || '') !== jobId);
    try {
      const res = await axios.delete(`/api/publish/jobs/${jobId}`);
      jobs.value = res.data?.jobs || jobs.value;
      return true;
    } catch (err) {
      jobs.value = previousJobs;
      setErrorState(normalizeApiError(err, '删除发布任务失败'));
      return false;
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
  const getWechatAccountOptions = () => getPlatformAccountOptions('wechatChannels');

  const getJobTerminalState = (job) => {
    const states = (job.platformTasks || []).map((task) => String(task.runtime?.state || task.status || ''));
    if (states.some((state) => ['publishing', 'editing', 'uploaded', 'processing', 'uploading', 'starting', 'navigating', 'login_ready', 'need_login', 'draft_preparing', 'edited'].includes(state))) return 'running';
    if (states.some((state) => state === 'failed')) return 'failed';
    if (states.some((state) => state === 'cancelled')) return 'cancelled';
    if (states.length && states.every((state) => ['published', 'success'].includes(state))) return 'published';
    if (states.some((state) => ['published', 'success', 'ready_for_manual_publish'].includes(state))) return 'ready_for_manual_publish';
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

  const getTaskProgress = (job, platformKey = 'wechatChannels') => {
    const task = getTask(job, platformKey);
    return Math.max(0, Math.min(100, Number(task?.runtime?.progress || 0)));
  };

  const getWechatProgress = (job) => getTaskProgress(job, 'wechatChannels');

  const canRunPlatform = (job, platformKey = 'wechatChannels') => {
    const task = getTask(job, platformKey);
    return !!task && !['publishing', 'editing', 'uploaded', 'processing', 'uploading', 'starting', 'navigating'].includes(String(task.runtime?.state || task.status || ''));
  };

  const canRunWechat = (job) => canRunPlatform(job, 'wechatChannels');

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
    stopWechatLoginPolling();
  };

  watch(selectedAssetId, (value, oldValue) => {
    if (value && value !== oldValue) {
      const asset = assets.value.find((item) => item.id === value) || null;
      fillEditorFromAsset(asset);
    }
  });

  const loadAllLoginStatus = async () => {
    try {
      const res = await axios.get('/api/login-status/all');
      if (res.data?.success) {
        const statuses = {};
        res.data.statuses.forEach((status) => {
          statuses[status.accountId] = status;
        });
        accountLoginStatus.value = statuses;
      }
    } catch (err) {
      console.error('加载登录状态失败:', err);
    }
  };

  const checkSingleAccountLogin = async (accountId) => {
    checkingLoginAccounts.value.add(accountId);
    try {
      const res = await axios.post(`/api/login-status/check/${accountId}`);
      if (res.data?.success) {
        accountLoginStatus.value = {
          ...accountLoginStatus.value,
          [accountId]: res.data.result
        };
        return res.data.result;
      }
      throw new Error(res.data?.error || '检测登录状态失败');
    } catch (err) {
      const normalized = normalizeApiError(err, '检测登录状态失败');
      accountLoginStatus.value = {
        ...accountLoginStatus.value,
        [accountId]: {
          status: 'error',
          message: normalized.message,
          lastCheckedAt: new Date().toISOString()
        }
      };
      qrCodeData.value = {
        show: true,
        accountId,
        accountLabel: accountId,
        source: 'login-check',
        base64: '',
        qrCodePath: '',
        status: 'error',
        error: normalized.message,
        message: ''
      };
      appendError(`检测微信视频号登录状态失败: ${normalized.message}`);
    } finally {
      checkingLoginAccounts.value.delete(accountId);
    }
    return null;
  };

  const checkPlatformAccountLogin = async (platformKey, accountId) => {
    const statusKey = `${platformKey}:${accountId}`;
    checkingLoginAccounts.value.add(statusKey);
    stopWechatLoginPolling();
    qrCodeData.value = {
      show: true,
      accountId: statusKey,
      accountLabel: getPlatformLabel(platformKey),
      source: 'platform-account-login',
      base64: '',
      qrCodePath: '',
      status: 'loading',
      error: '',
      message: `正在检测${getPlatformLabel(platformKey)}登录状态...`
    };
    accountLoginStatus.value = {
      ...accountLoginStatus.value,
      [statusKey]: {
        status: 'checking',
        message: '正在检测登录状态',
        lastCheckedAt: new Date().toISOString()
      }
    };
    appendLog(`检测${getPlatformLabel(platformKey)}登录状态：${accountId}`);
    try {
      const res = await axios.post(`/api/publish/platforms/${platformKey}/accounts/${accountId}/test-login`);
      if (res.data?.success) {
        const result = applyPlatformAccountLoginResponse(platformKey, accountId, res.data);
        if (['need_scan', 'checking', 'checking_login', 'starting'].includes(res.data.status)) {
          qrLoginPollTimer = window.setInterval(async () => {
            if (!qrCodeData.value.show || qrCodeData.value.accountId !== statusKey) {
              stopWechatLoginPolling();
              return;
            }
            try {
              const pollRes = await axios.post(`/api/publish/platforms/${platformKey}/accounts/${accountId}/test-login`);
              if (!pollRes.data?.success) return;
              applyPlatformAccountLoginResponse(platformKey, accountId, pollRes.data, { silentLoggedIn: true });
              if (pollRes.data.status === 'logged_in') {
                qrCodeData.value = {
                  show: true,
                  accountId: statusKey,
                  accountLabel: pollRes.data.accountLabel || accountId,
                  source: 'platform-account-login',
                  base64: '',
                  qrCodePath: '',
                  status: 'logged_in',
                  error: '',
                  message: pollRes.data.message || '登录态可用'
                };
                stopWechatLoginPolling();
                window.setTimeout(() => {
                  if (qrCodeData.value.accountId === statusKey && qrCodeData.value.status === 'logged_in') {
                    qrCodeData.value.show = false;
                  }
                }, 1800);
              }
            } catch (_err) {}
          }, 4000);
        }
        return result;
      }
      throw new Error(res.data?.error || '检测平台账号登录状态失败');
    } catch (err) {
      const normalized = normalizeApiError(err, '检测平台账号登录状态失败');
      const errorMessage = normalized.details ? `${normalized.message}：${normalized.details}` : normalized.message;
      accountLoginStatus.value = {
        ...accountLoginStatus.value,
        [statusKey]: {
          status: 'error',
          message: errorMessage,
          lastCheckedAt: new Date().toISOString()
        }
      };
      if (qrCodeData.value.accountId === statusKey) {
        qrCodeData.value = {
          ...qrCodeData.value,
          show: true,
          status: 'error',
          error: errorMessage,
          message: ''
        };
      }
      appendError(`检测${getPlatformLabel(platformKey)}登录状态失败: ${errorMessage}`);
    } finally {
      checkingLoginAccounts.value.delete(statusKey);
    }
    return null;
  };

  const checkSelectedAccountsLogin = async (accountIds, notifyFeishu = false) => {
    if (!accountIds || accountIds.length === 0) return null;
    checkingBatchLogin.value = true;
    try {
      const res = await axios.post('/api/login-status/check-batch', {
        accountIds,
        notifyFeishu,
        parallel: false
      });
      if (res.data?.success) {
        const newStatuses = { ...accountLoginStatus.value };
        res.data.summary.results.forEach((result) => {
          newStatuses[result.accountId] = result;
        });
        accountLoginStatus.value = newStatuses;
        return res.data.summary;
      }
    } catch (err) {
      console.error('批量检测失败:', err);
    } finally {
      checkingBatchLogin.value = false;
    }
    return null;
  };

  return {
    loading,
    error,
    errorState,
    savingConfig,
    creating,
    creatingStatusMessage,
    generatingDescription,
    regeneratingDescriptionJobId,
    deletingAssetId,
    assets,
    jobs,
    config,
    presets,
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
    autoPilotPlatformDefs,
    autoPilotPipelineDefs: AUTO_PILOT_PIPELINE_DEFS,
    platformCards,
    wechatAccounts,
    douyinAccounts,
    xiaohongshuAccounts,
    xAccounts,
    xaiPartitionOptions,
    avatarAudioPresetOptions,
    avatarImagePresetOptions,
    activeAutoPilotPipelineModes,
    activeAutoPilotMappings,
    getAutoPilotMappingsForMode,
    getNextAutoPilotMappingSlot,
    autoPilotJobs,
    autoPilotSummaryItems,
    qrCodeData,
    testWechatLogin,
    retryQrLogin,
    openWechatContentManager,
    openPlatformContentManager,
    closeQrCodeModal,
    filteredJobs,
    selfCheckSummary,
    selfCheckHighlights,
    refreshJobs,
    refreshPresets,
    refreshAssets,
    refreshSelfCheck,
    refresh,
    startAutoRefresh,
    stopAutoRefresh,
    selectAsset,
    deleteAsset,
    updateConfigField,
    updateAutoPilotArray,
    updateAutoPilotModeArray,
    toggleAutoPilotPipelineMode,
    toggleAutoPilotModePlatform,
    addAutoPilotModeMapping,
    removeAutoPilotModeMapping,
    applySuggestedTitle,
    applySuggestedTags,
    loadJobIntoEditor,
    addWechatAccount,
    updateWechatAccountField,
    removeWechatAccount,
    addSauAccount,
    updateSauAccountField,
    removeSauAccount,
    addXAccount,
    updateXAccountField,
    removeXAccount,
    saveConfig,
    toggleEditorPlatform,
    createJob,
    generateEditorDescription,
    runAllWechat,
    runPlatform,
    runWechat,
    retryPlatform,
    retryWechat,
    cancelPlatform,
    cancelWechat,
    regenerateJobDescription,
    archiveJob,
    archiveCompleted,
    deleteJob,
    clearJobs,
    getFieldLabel,
    isSecretField,
    getPlatformLabel,
    getPlatformAccountLabel,
    getAvatarPresetLabel,
    getAutoPilotAvatarPresetSummary,
    getPlatformAccountOptions,
    getTask,
    getWechatAccountOptions,
    getJobTerminalState,
    getJobStatusLabel,
    getTaskProgress,
    getWechatProgress,
    canRunPlatform,
    canRunWechat,
    formatAutoPilotJobTime,
    // 登录状态检测函数
    accountLoginStatus,
    checkingLoginAccounts,
    checkingBatchLogin,
    applyPlatformAccountLoginResponse,
    loadAllLoginStatus,
    checkSingleAccountLogin,
    checkPlatformAccountLogin,
    checkSelectedAccountsLogin
  };
}
