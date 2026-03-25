import { computed, ref } from 'vue';
import axios from 'axios';

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

export function useXaiTop10() {
  const loading = ref(false);
  const queueing = ref(false);
  const error = ref('');
  const savingConfig = ref(false);
  const result = ref(null);
  const status = ref(null);
  const queueStatus = ref(null);
  const accountsText = ref('');
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

  const items = computed(() => result.value?.items || []);
  const summary = computed(() => {
    const timeRange = result.value?.time_range;
    const total = result.value?.total_items ?? items.value.length;
    return {
      total,
      since: timeRange?.since || '-',
      until: timeRange?.until || '-',
      running: !!status.value?.running,
      stage: status.value?.stage || 'idle'
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

  const refresh = async (silent = false) => {
    if (!silent) {
      loading.value = true;
      error.value = '';
      appendLog('刷新榜单结果与状态');
    }
    try {
      const [resultRes, statusRes, queueRes] = await Promise.all([
        axios.get('/api/xai-top10/result').catch((err) => {
          if (err.response?.status === 404) return { data: { success: false, result: null } };
          throw err;
        }),
        axios.get('/api/xai-top10/status'),
        axios.get('/api/xai-top10/vertical-jobs')
      ]);
      result.value = resultRes.data?.result || null;
      status.value = statusRes.data?.status || null;
      queueStatus.value = queueRes.data?.status || null;
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      if (!silent) appendError(error.value);
    } finally {
      if (!silent) loading.value = false;
    }
  };

  const loadConfig = async () => {
    try {
      appendLog('读取账号池配置');
      const res = await axios.get('/api/xai-top10/config');
      accountsText.value = (res.data?.config?.accounts || []).join('\n');
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
      const accounts = String(accountsText.value || '')
        .split(/\r?\n/)
        .map((item) => item.trim().replace(/^@+/, ''))
        .filter(Boolean);
      const res = await axios.post('/api/xai-top10/config', { accounts });
      accountsText.value = (res.data?.config?.accounts || []).join('\n');
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      savingConfig.value = false;
    }
  };

  const run = async () => {
    const clientId = `xai_${Math.random().toString(36).slice(2)}`;
    const stream = new EventSource(`/api/progress?clientId=${clientId}`);
    loading.value = true;
    error.value = '';
    appendLog('启动过去 24 小时 Top10 榜单任务');
    try {
      const res = await axios.post('/api/xai-top10/run', { clientId });
      result.value = res.data?.result || result.value;
      status.value = res.data?.status || status.value;
      appendLog('榜单任务执行完成，开始刷新结果');
      await refresh();
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
      await refresh();
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
      downloadTextFile(`xai-top10-${timestamp}.json`, JSON.stringify(result.value, null, 2), 'application/json;charset=utf-8');
      return;
    }
    const headers = ['rank', 'author', 'author_summary', 'views_display', 'hot_score', 'post_url', 'video_url'];
    const rows = [headers.join(',')];
    for (const item of items.value) {
      rows.push(headers.map((key) => `"${String(item[key] ?? '').replace(/"/g, '""')}"`).join(','));
    }
    downloadTextFile(`xai-top10-${timestamp}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
  };

  return {
    loading,
    queueing,
    error,
    savingConfig,
    result,
    status,
    queueStatus,
    accountsText,
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
    run,
    toggleSelect,
    toggleSelectAll,
    queueSelected,
    queueSingle,
    exportResult
  };
}
