import { computed, ref, watch } from 'vue';
import axios from 'axios';

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

export function useStandalone() {
  const loading = ref(false);
  const error = ref('');
  const errorState = ref({ message: '', code: '', stage: '', hint: '', details: '' });
  const progress = ref(0);
  const statusText = ref('等待任务...');
  const finalVideoUrl = ref('');
  const queueStatus = ref(null);
  const previewSelection = ref('auto');
  const localRecentLogs = ref([]);
  const localErrorLogs = ref([]);
  const lastQueueSnapshot = ref('');
  const taskStartedAt = ref(0);
  const elapsedSeconds = ref(0);
  const lastDurationSeconds = ref(0);
  let timerHandle = null;
  let autoRefreshTimer = null;
  const form = ref({
    video: null,
    videoName: '',
    srt: null,
    srtName: '',
    title: '',
    useASR: true,
    renderOptions: {
      titleFontSize: 72,
      titleMinFontSize: 52,
      titleMaxLines: 2,
      subtitleFontSize: 50,
      subtitleMinFontSize: 28,
      subtitleMaxLines: 2,
      subtitleOffsetY: 20,
      englishSubtitleFontSize: 52,
      englishMaxLines: 2
    }
  });

  try {
    const cached = localStorage.getItem("comfy_panel_standalone_state");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.finalVideoUrl) finalVideoUrl.value = parsed.finalVideoUrl;
      if (parsed.localRecentLogs) localRecentLogs.value = parsed.localRecentLogs;
      if (parsed.localErrorLogs) localErrorLogs.value = parsed.localErrorLogs;
      if (parsed.lastDurationSeconds) lastDurationSeconds.value = parsed.lastDurationSeconds;
      if (parsed.form) {
        form.value.title = parsed.form.title || "";
        form.value.useASR = parsed.form.useASR ?? true;
        if (parsed.form.renderOptions) {
          form.value.renderOptions = { ...form.value.renderOptions, ...parsed.form.renderOptions };
        }
      }
    }
  } catch (_e) {}

  watch([finalVideoUrl, localRecentLogs, localErrorLogs, lastDurationSeconds, form], () => {
    localStorage.setItem("comfy_panel_standalone_state", JSON.stringify({
      finalVideoUrl: finalVideoUrl.value,
      localRecentLogs: localRecentLogs.value,
      localErrorLogs: localErrorLogs.value,
      lastDurationSeconds: lastDurationSeconds.value,
      form: {
        title: form.value.title,
        useASR: form.value.useASR,
        renderOptions: form.value.renderOptions
      }
    }));
  }, { deep: true });

  const appendLog = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    localRecentLogs.value = [...localRecentLogs.value, line].slice(-24);
  };

  const appendError = (message) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
    if (!line.trim()) return;
    localErrorLogs.value = [...localErrorLogs.value, line].slice(-12);
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

  const formatDuration = (value) => {
    const total = Math.max(0, Number(value || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const startTimer = () => {
    if (timerHandle) window.clearInterval(timerHandle);
    taskStartedAt.value = Date.now();
    elapsedSeconds.value = 0;
    appendLog('单条竖屏生成开始计时');
    timerHandle = window.setInterval(() => {
      elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - taskStartedAt.value) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }
    if (taskStartedAt.value) {
      lastDurationSeconds.value = Math.max(0, Math.floor((Date.now() - taskStartedAt.value) / 1000));
      appendLog(`单条竖屏生成完成，用时 ${formatDuration(lastDurationSeconds.value)}`);
    }
    taskStartedAt.value = 0;
    elapsedSeconds.value = 0;
  };

  const activeDurationLabel = computed(() => formatDuration(elapsedSeconds.value));
  const lastDurationLabel = computed(() => (lastDurationSeconds.value > 0 ? formatDuration(lastDurationSeconds.value) : '暂无'));
  const queueRecentLogs = computed(() => {
    const jobs = Array.isArray(queueStatus.value?.jobs) ? queueStatus.value.jobs : [];
    return jobs
      .flatMap((job) => Array.isArray(job.logs) ? job.logs.map((line) => `${job.id} · ${line}`) : [])
      .slice(-60);
  });
  const queueErrorLogs = computed(() => {
    const jobs = Array.isArray(queueStatus.value?.jobs) ? queueStatus.value.jobs : [];
    return jobs
      .filter((job) => job.status === 'failed' || job.error)
      .flatMap((job) => {
        const lines = [];
        if (job.error) lines.push(`${job.id} · ${job.error}`);
        if (Array.isArray(job.logs)) {
          lines.push(...job.logs.filter((line) => /失败|error|cancel/i.test(line)).map((line) => `${job.id} · ${line}`));
        }
        return lines;
      })
      .slice(-24);
  });
  const recentLogs = computed(() => [...localRecentLogs.value, ...queueRecentLogs.value].slice(-60));
  const errorLogs = computed(() => [...localErrorLogs.value, ...queueErrorLogs.value].slice(-24));
  const queuePreviewVideoUrl = computed(() => {
    const jobs = Array.isArray(queueStatus.value?.jobs) ? [...queueStatus.value.jobs] : [];
    const completedJob = jobs
      .filter((job) => job?.status === 'completed' && job?.resultVideoUrl)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    return completedJob?.resultVideoUrl || '';
  });
  const previewOptions = computed(() => {
    const options = [];
    if (finalVideoUrl.value) {
      options.push({ id: 'current', label: '当前单条成品', url: finalVideoUrl.value });
    }
    const completedJobs = (Array.isArray(queueStatus.value?.jobs) ? queueStatus.value.jobs : [])
      .filter((job) => job?.status === 'completed' && job?.resultVideoUrl)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    for (const job of completedJobs) {
      options.push({
        id: `job:${job.id}`,
        label: `队列成品｜${job.title || job.id}`,
        url: job.resultVideoUrl
      });
    }
    return options;
  });
  const previewVideoUrl = computed(() => {
    if (previewSelection.value === 'auto') {
      return finalVideoUrl.value || queuePreviewVideoUrl.value || '';
    }
    if (previewSelection.value === 'current') {
      return finalVideoUrl.value || '';
    }
    return previewOptions.value.find((item) => item.id === previewSelection.value)?.url || finalVideoUrl.value || queuePreviewVideoUrl.value || '';
  });

  const setPreviewSelection = (value) => {
    previewSelection.value = String(value || 'auto');
  };

  const loadQueue = async (silent = false) => {
    try {
      const res = await axios.get('/api/xai-top10/vertical-jobs');
      queueStatus.value = res.data?.status || null;
      const snapshot = JSON.stringify({
        running: queueStatus.value?.running || 0,
        queued: queueStatus.value?.queued || 0,
        jobs: Array.isArray(queueStatus.value?.jobs)
          ? queueStatus.value.jobs.map((job) => ({
              id: job.id,
              status: job.status,
              progress: job.progress,
              message: job.message,
              updatedAt: job.updatedAt
            }))
          : []
      });
      if (snapshot !== lastQueueSnapshot.value) {
        lastQueueSnapshot.value = snapshot;
        appendLog(`读取竖屏批量队列状态：${queueStatus.value?.running || 0} 运行 / ${queueStatus.value?.queued || 0} 排队`);
      }
    } catch (err) {
      const normalized = normalizeApiError(err, '读取竖屏队列失败');
      errorState.value = normalized;
      error.value = normalized.message;
      if (!silent) appendError(error.value);
    }
  };

  const cancelQueueJob = async (jobId) => {
    try {
      appendLog(`请求取消竖屏队列任务：${jobId}`);
      const res = await axios.post(`/api/xai-top10/vertical-jobs/${jobId}/cancel`);
      queueStatus.value = res.data?.status || queueStatus.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '取消竖屏队列任务失败'));
    }
  };

  const deleteQueueJob = async (jobId) => {
    try {
      appendLog(`请求删除竖屏队列任务：${jobId}`);
      const res = await axios.delete(`/api/xai-top10/vertical-jobs/${jobId}`);
      queueStatus.value = res.data?.status || queueStatus.value;
    } catch (err) {
      setErrorState(normalizeApiError(err, '删除竖屏队列任务失败'));
    }
  };

  const handleFile = (type, file) => {
    form.value[type] = file || null;
    form.value[`${type}Name`] = file?.name || '';
  };

  const createProgressStream = (clientId) => {
    progress.value = 0;
    statusText.value = '正在连线服务器...';
    appendLog(`建立竖屏进度流：${clientId}`);
    const stream = new EventSource(`/api/progress?clientId=${clientId}`);
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'progress') {
        progress.value = payload.percent ?? progress.value;
        statusText.value = payload.msg || statusText.value;
        appendLog(statusText.value);
      } else if (payload.type === 'status') {
        statusText.value = payload.msg || statusText.value;
        appendLog(statusText.value);
      }
    };
    return stream;
  };

  const submit = async () => {
    if (!form.value.video) {
      error.value = '请先上传主视频';
      appendError(error.value);
      return;
    }
    const clientId = `standalone_${Math.random().toString(36).slice(2)}`;
    const stream = createProgressStream(clientId);
    loading.value = true;
    clearErrorState();
    finalVideoUrl.value = '';
    startTimer();
    appendLog('启动单条竖屏生成任务');
    try {
      const data = new FormData();
      data.append('clientId', clientId);
      data.append('video', form.value.video);
      if (form.value.srt) data.append('srt', form.value.srt);
      data.append('title', form.value.title || '');
      data.append('useASR', String(form.value.useASR));
      data.append('renderOptions', JSON.stringify(form.value.renderOptions));
      const res = await axios.post('/api/generate-vertical-standalone', data);
      if (res.data?.title && !form.value.title) form.value.title = res.data.title;
      if (res.data?.videoUrl) finalVideoUrl.value = res.data.videoUrl;
      previewSelection.value = 'current';
      appendLog('动态竖屏生成完成');
      await loadQueue();
    } catch (err) {
      setErrorState(normalizeApiError(err, '单条竖屏生成失败'));
    } finally {
      stream.close();
      loading.value = false;
      stopTimer();
      window.setTimeout(() => {
        progress.value = 0;
        statusText.value = '等待任务...';
      }, 1200);
    }
  };

  const startAutoRefresh = () => {
    if (autoRefreshTimer) return;
    autoRefreshTimer = window.setInterval(() => {
      loadQueue(true);
    }, 4000);
  };

  const stopAutoRefresh = () => {
    if (autoRefreshTimer) {
      window.clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  };

  return {
    loading,
    error,
    errorState,
    progress,
    statusText,
    activeDurationLabel,
    lastDurationLabel,
    recentLogs,
    errorLogs,
    finalVideoUrl,
    previewVideoUrl,
    queueStatus,
    previewSelection,
    previewOptions,
    form,
    loadQueue,
    startAutoRefresh,
    stopAutoRefresh,
    cancelQueueJob,
    deleteQueueJob,
    setPreviewSelection,
    handleFile,
    submit
  };
}
