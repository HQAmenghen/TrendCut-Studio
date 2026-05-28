import { computed, ref } from 'vue';
import axios from 'axios';

const DEFAULT_PARTITION_ID = 'crypto';
const DEFAULT_PARTITIONS = [
  { id: 'crypto', label: '加密', description: 'Crypto / Web3 热点账号池', accounts: [] },
  { id: 'finance', label: '金融', description: '宏观、市场和金融账号池', accounts: [] },
  { id: 'tech', label: '科技', description: '科技产品和创业账号池', accounts: [] },
  { id: 'ai', label: 'AI', description: 'AI 模型、应用和研究账号池', accounts: [] }
];

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizePartitionId(value, fallback = DEFAULT_PARTITION_ID) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

function parseAccountsText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim().replace(/^@+/, ''))
    .filter(Boolean);
}

function normalizePartitions(config = {}) {
  const source = Array.isArray(config.partitions) && config.partitions.length ? config.partitions : DEFAULT_PARTITIONS;
  const used = new Set();
  const partitions = source.map((partition, index) => {
    const fallback = DEFAULT_PARTITIONS[index] || {};
    let id = sanitizePartitionId(partition?.id || partition?.label || fallback.id || `partition-${index + 1}`);
    let suffix = 2;
    while (used.has(id)) {
      id = sanitizePartitionId(`${id}-${suffix}`);
      suffix += 1;
    }
    used.add(id);
    return {
      id,
      label: String(partition?.label || fallback.label || id).trim() || id,
      description: String(partition?.description || fallback.description || '').trim(),
      accounts: Array.isArray(partition?.accounts) ? partition.accounts.map((item) => String(item || '').trim()).filter(Boolean) : []
    };
  });
  return partitions.length ? partitions : DEFAULT_PARTITIONS.map((item) => ({ ...item }));
}

export function useXaiTop10() {
  const loading = ref(false);
  const progressPercent = ref(0);
  const progressMessage = ref('');
  const queueing = ref(false);
  const error = ref('');
  const savingConfig = ref(false);
  const result = ref(null);
  const status = ref(null);
  const queueStatus = ref(null);
  const accountsText = ref('');
  const partitions = ref(DEFAULT_PARTITIONS.map((item) => ({ ...item })));
  const activePartitionId = ref(DEFAULT_PARTITION_ID);
  const newPartitionLabel = ref('');
  const partitionDrafts = ref({});
  const concurrency = ref(2);
  const selectedKeys = ref([]);
  const renderOptions = ref({
    titleFontSize: 104,
    subtitleFontSize: 50,
    subtitleOffsetY: 20
  });
  const localLogs = ref([]);
  const localErrors = ref([]);
  let autoRefreshTimer = null;

  const appendLog = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    localLogs.value = [...localLogs.value, line].slice(-30);
  };

  const appendError = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    localErrors.value = [...localErrors.value, line].slice(-20);
  };

  const normalizeProgressPercent = (value, fallback = progressPercent.value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(0, Math.min(100, Math.round(numeric)));
  };

  const applyProgressEvent = (payload = {}) => {
    const type = String(payload?.type || '').trim();
    const message = String(payload?.msg || payload?.message || '').trim();
    if (type === 'progress') {
      progressPercent.value = normalizeProgressPercent(payload.percent);
      if (message) {
        progressMessage.value = message;
        appendLog(message);
      }
      return;
    }
    if (type === 'status' && message) {
      progressMessage.value = message;
      appendLog(message);
    }
  };

  const createProgressStream = (clientId) => {
    progressPercent.value = 1;
    progressMessage.value = '正在连接榜单进度通道';
    const stream = new EventSource(`/api/progress?clientId=${clientId}`);
    stream.onmessage = (event) => {
      try {
        applyProgressEvent(JSON.parse(event.data));
      } catch (_err) {
        // Ignore malformed progress frames and keep the task request alive.
      }
    };
    return stream;
  };

  const waitForProgressStream = (stream) => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, 300);
    stream.onopen = () => {
      window.clearTimeout(timer);
      finish();
    };
    stream.onerror = () => {
      window.clearTimeout(timer);
      finish();
    };
  });

  const activePartition = computed(() => partitions.value.find((item) => item.id === activePartitionId.value) || partitions.value[0] || DEFAULT_PARTITIONS[0]);
  const activePartitionLabel = computed(() => activePartition.value?.label || activePartitionId.value || '默认分区');
  const activePartitionAccountsCount = computed(() => parseAccountsText(accountsText.value).length);
  const items = computed(() => result.value?.items || []);
  const summary = computed(() => {
    const timeRange = result.value?.time_range;
    const total = result.value?.total_items ?? items.value.length;
    return {
      total,
      partition: activePartition.value,
      since: timeRange?.since || '-',
      until: timeRange?.until || '-',
      running: !!status.value?.running,
      stage: status.value?.stage || 'idle',
      progress: progressPercent.value,
      message: progressMessage.value
    };
  });

  const selectedItems = computed(() => items.value.filter((item) => selectedKeys.value.includes(String(item.post_id || item.rank))));
  const recentLogs = computed(() => {
    const remote = Array.isArray(status.value?.logTail) ? status.value.logTail : [];
    return [...localLogs.value, ...remote].slice(-12);
  });
  const errorLogs = computed(() => {
    const remote = Array.isArray(status.value?.errorTail) ? status.value.errorTail : [];
    return [...localErrors.value, ...remote].slice(-8);
  });

  const persistActivePartitionDraft = () => {
    partitionDrafts.value = {
      ...partitionDrafts.value,
      [activePartitionId.value]: accountsText.value
    };
  };

  const applyConfig = (config = {}) => {
    const normalizedPartitions = normalizePartitions(config);
    partitions.value = normalizedPartitions;
    const requested = sanitizePartitionId(config.activePartitionId || activePartitionId.value);
    activePartitionId.value = normalizedPartitions.some((partition) => partition.id === requested)
      ? requested
      : normalizedPartitions[0]?.id || DEFAULT_PARTITION_ID;
    partitionDrafts.value = normalizedPartitions.reduce((acc, partition) => {
      acc[partition.id] = (partition.accounts || []).join('\n');
      return acc;
    }, {});
    accountsText.value = partitionDrafts.value[activePartitionId.value] || '';
  };

  const buildConfigPayload = () => {
    persistActivePartitionDraft();
    return {
      activePartitionId: activePartitionId.value,
      partitions: partitions.value.map((partition) => ({
        id: partition.id,
        label: partition.label,
        description: partition.description || '',
        accounts: parseAccountsText(partitionDrafts.value[partition.id] || '')
      }))
    };
  };

  const selectPartition = async (partitionId) => {
    const id = sanitizePartitionId(partitionId);
    if (!partitions.value.some((partition) => partition.id === id)) return;
    persistActivePartitionDraft();
    activePartitionId.value = id;
    accountsText.value = partitionDrafts.value[id] || '';
    selectedKeys.value = [];
    result.value = null;
    await refresh();
  };

  const createPartition = async () => {
    if (savingConfig.value) return;
    const label = String(newPartitionLabel.value || '').trim();
    if (!label) return;
    persistActivePartitionDraft();
    const baseId = sanitizePartitionId(label, `partition-${partitions.value.length + 1}`);
    const existingIds = new Set(partitions.value.map((partition) => partition.id));
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
      id = sanitizePartitionId(`${baseId}-${suffix}`, `partition-${suffix}`);
      suffix += 1;
    }
    partitions.value = [
      ...partitions.value,
      { id, label, description: '', accounts: [] }
    ];
    partitionDrafts.value = { ...partitionDrafts.value, [id]: '' };
    newPartitionLabel.value = '';
    activePartitionId.value = id;
    accountsText.value = '';
    selectedKeys.value = [];
    result.value = null;
    await saveConfig();
  };

  const removePartition = async (partitionId) => {
    if (savingConfig.value) return;
    const id = sanitizePartitionId(partitionId);
    if (partitions.value.length <= 1) return;
    persistActivePartitionDraft();
    partitions.value = partitions.value.filter((partition) => partition.id !== id);
    const { [id]: _removed, ...rest } = partitionDrafts.value;
    partitionDrafts.value = rest;
    if (activePartitionId.value === id) {
      activePartitionId.value = partitions.value[0]?.id || DEFAULT_PARTITION_ID;
      accountsText.value = partitionDrafts.value[activePartitionId.value] || '';
      result.value = null;
      selectedKeys.value = [];
    }
    await saveConfig();
  };

  const updatePartitionLabel = (partitionId, label) => {
    const id = sanitizePartitionId(partitionId);
    partitions.value = partitions.value.map((partition) => partition.id === id
      ? { ...partition, label: String(label || '').trim() }
      : partition);
  };

  const refresh = async (silent = false) => {
    if (!silent) {
      loading.value = true;
      error.value = '';
      progressPercent.value = 15;
      progressMessage.value = '正在同步榜单结果与状态';
      appendLog('刷新榜单结果与状态');
    }
    try {
      const [resultRes, statusRes, queueRes] = await Promise.all([
        axios.get('/api/xai-top10/result', { params: { partitionId: activePartitionId.value } }).catch((err) => {
          if (err.response?.status === 404) return { data: { success: false, result: null } };
          throw err;
        }),
        axios.get('/api/xai-top10/status', { params: { partitionId: activePartitionId.value } }),
        axios.get('/api/xai-top10/vertical-jobs')
      ]);
      result.value = resultRes.data?.result || null;
      status.value = statusRes.data?.status || null;
      queueStatus.value = queueRes.data?.status || null;
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      if (!silent) appendError(error.value);
    } finally {
      if (!silent) {
        progressPercent.value = 100;
        loading.value = false;
      }
    }
  };

  const loadConfig = async () => {
    try {
      appendLog('读取账号池配置');
      const res = await axios.get('/api/xai-top10/config');
      applyConfig(res.data?.config || {});
      await refresh(true);
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    }
  };

  const saveConfig = async () => {
    savingConfig.value = true;
    error.value = '';
    appendLog('保存账号池配置');
    try {
      const res = await axios.post('/api/xai-top10/config', buildConfigPayload());
      applyConfig(res.data?.config || {});
      await refresh(true);
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      savingConfig.value = false;
    }
  };

  const run = async () => {
    if (loading.value) return;
    const clientId = `xai_${Math.random().toString(36).slice(2)}`;
    const stream = createProgressStream(clientId);
    loading.value = true;
    error.value = '';
    progressPercent.value = 1;
    progressMessage.value = `正在准备「${activePartitionLabel.value}」榜单任务`;
    status.value = {
      ...(status.value || {}),
      running: true,
      runningPartitionId: activePartitionId.value,
      stage: 'starting'
    };
    appendLog(`启动「${activePartitionLabel.value}」过去 24 小时 Top10 榜单任务`);
    try {
      await waitForProgressStream(stream);
      const res = await axios.post('/api/xai-top10/run', { clientId, partitionId: activePartitionId.value });
      result.value = res.data?.result || result.value;
      status.value = res.data?.status || status.value;
      progressPercent.value = 100;
      progressMessage.value = '榜单任务执行完成，开始同步结果';
      appendLog(progressMessage.value);
      await refresh(true);
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      progressMessage.value = '榜单任务执行失败';
      appendError(error.value);
      await refresh(true);
    } finally {
      stream.close();
      loading.value = false;
    }
  };

  const toggleSelect = (item, checked) => {
    const key = String(item.post_id || item.rank);
    if (checked) {
      if (!selectedKeys.value.includes(key)) selectedKeys.value = [...selectedKeys.value, key];
    } else {
      selectedKeys.value = selectedKeys.value.filter((value) => value !== key);
    }
  };

  const toggleSelectAll = (checked) => {
    selectedKeys.value = checked ? items.value.map((item) => String(item.post_id || item.rank)) : [];
  };

  const queueItems = async (inputItems) => {
    const payloadItems = inputItems.map((item) => ({
      ...item,
      sourcePartitionId: item.source_partition_id || item.sourcePartitionId || activePartitionId.value,
      sourcePartitionLabel: item.source_partition_label || item.sourcePartitionLabel || activePartitionLabel.value,
      partition: item.partition || { id: activePartitionId.value, label: activePartitionLabel.value },
      renderOptions: { ...renderOptions.value }
    }));
    if (!payloadItems.length) return;
    queueing.value = true;
    error.value = '';
    appendLog(`送入竖屏队列：${payloadItems.length} 条`);
    try {
      const res = await axios.post('/api/xai-top10/vertical-jobs', {
        concurrency: concurrency.value,
        items: payloadItems
      });
      queueStatus.value = res.data?.status || queueStatus.value;
      selectedKeys.value = [];
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      queueing.value = false;
    }
  };

  const queueSelected = async () => queueItems(selectedItems.value);
  const queueSingle = async (item) => queueItems([item]);

  const startAutoRefresh = () => {
    if (autoRefreshTimer) return;
    autoRefreshTimer = window.setInterval(() => {
      refresh(true);
    }, 4000);
  };

  const stopAutoRefresh = () => {
    if (autoRefreshTimer) {
      window.clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  };

  const exportResult = (format = 'json') => {
    if (!result.value) return;
    appendLog(`导出榜单结果：${format.toUpperCase()}`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') {
      downloadTextFile(`xai-top10-${activePartitionId.value}-${timestamp}.json`, JSON.stringify(result.value, null, 2), 'application/json;charset=utf-8');
      return;
    }
    const headers = ['rank', 'author', 'author_summary', 'views_display', 'hot_score', 'post_url', 'video_url'];
    const rows = [headers.join(',')];
    for (const item of items.value) {
      rows.push(headers.map((key) => `"${String(item[key] ?? '').replace(/"/g, '""')}"`).join(','));
    }
    downloadTextFile(`xai-top10-${activePartitionId.value}-${timestamp}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
  };

  return {
    loading,
    progressPercent,
    progressMessage,
    queueing,
    error,
    savingConfig,
    result,
    status,
    queueStatus,
    accountsText,
    partitions,
    activePartitionId,
    activePartition,
    activePartitionLabel,
    activePartitionAccountsCount,
    newPartitionLabel,
    concurrency,
    selectedKeys,
    renderOptions,
    items,
    summary,
    selectedItems,
    recentLogs,
    errorLogs,
    refresh,
    startAutoRefresh,
    stopAutoRefresh,
    loadConfig,
    saveConfig,
    selectPartition,
    createPartition,
    removePartition,
    updatePartitionLabel,
    run,
    toggleSelect,
    toggleSelectAll,
    queueSelected,
    queueSingle,
    exportResult
  };
}
