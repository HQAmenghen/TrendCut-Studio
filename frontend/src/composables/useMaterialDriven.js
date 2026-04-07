import { ref, computed, watch } from 'vue';

const MATERIAL_DRIVEN_STORAGE_KEY = 'comfy_panel_material_driven_state_v1';

export function useMaterialDriven() {
  const jobId = ref(null);
  const currentStep = ref(0);
  const progress = ref(0);
  const statusText = ref('');
  const planSummary = ref(null);
  const narrationSummary = ref(null);
  const directorPlan = ref([]);
  const narrationFullText = ref('');
  const finalVideoUrl = ref('');
  const error = ref('');
  const audioMode = ref('preset');
  const imageMode = ref('preset');
  const presets = ref({ audio: [], image: [] });
  const materialUrl = ref('');
  const materialSourceLabel = ref('');
  const gen = ref({
    text: '',
    audioPreset: '',
    imagePreset: '',
    audioFile: null,
    imageFile: null,
    serverUrl: 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443',
    trimSeconds: 0,
    maxDuration: 35
  });
  const withSubtitles = ref(true);
  const activeDurationLabel = ref('00:00');
  const lastDurationLabel = ref('暂无');
  let taskStartedAt = 0;
  let timerHandle = null;

  const loadPresets = async () => {
    try {
      const res = await fetch('/api/presets');
      if (res.ok) {
        const data = await res.json();
        presets.value = data.success ? data : { audio: [], image: [] };
        if (!gen.value.audioPreset && presets.value.audio.length) gen.value.audioPreset = presets.value.audio[0];
        if (!gen.value.imagePreset && presets.value.image.length) gen.value.imagePreset = presets.value.image[0];
      }
    } catch(err) {
      console.error(err);
    }
  };

  const startTimer = (startedAt = Date.now()) => {
    if (timerHandle) clearInterval(timerHandle);
    taskStartedAt = startedAt;
    activeDurationLabel.value = '00:00';
    timerHandle = setInterval(() => {
      const total = Math.max(0, Math.floor((Date.now() - taskStartedAt) / 1000));
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      activeDurationLabel.value = `${m}:${s}`;
    }, 1000);
  };

  const stopTimer = () => {
    if (timerHandle) clearInterval(timerHandle);
    lastDurationLabel.value = activeDurationLabel.value;
    activeDurationLabel.value = '00:00';
  };

  const recentLogs = ref([]);
  const uploading = ref(false);
  const outputPath = ref('');

  let eventSource = null;

  const saveState = () => {
    try {
      const payload = {
        jobId: jobId.value,
        currentStep: currentStep.value,
        progress: progress.value,
        statusText: statusText.value,
        planSummary: planSummary.value,
        narrationSummary: narrationSummary.value,
        finalVideoUrl: finalVideoUrl.value,
        error: error.value,
        recentLogs: recentLogs.value,
        outputPath: outputPath.value,
        materialUrl: materialUrl.value,
        materialSourceLabel: materialSourceLabel.value,
        activeDurationLabel: activeDurationLabel.value,
        lastDurationLabel: lastDurationLabel.value,
        narrationFullText: narrationFullText.value
      };
      window.localStorage.setItem(MATERIAL_DRIVEN_STORAGE_KEY, JSON.stringify(payload));
    } catch (_err) {
      // ignore storage write errors
    }
  };

  const loadState = () => {
    try {
      const raw = window.localStorage.getItem(MATERIAL_DRIVEN_STORAGE_KEY);
      if (!raw) return;
      const payload = JSON.parse(raw);
      jobId.value = payload?.jobId || null;
      currentStep.value = Number(payload?.currentStep || 0);
      progress.value = Number(payload?.progress || 0);
      statusText.value = String(payload?.statusText || '');
      planSummary.value = payload?.planSummary || null;
      narrationSummary.value = payload?.narrationSummary || null;
      narrationFullText.value = String(payload?.narrationFullText || '');
      finalVideoUrl.value = String(payload?.finalVideoUrl || '');
      error.value = String(payload?.error || '');
      recentLogs.value = Array.isArray(payload?.recentLogs) ? payload.recentLogs : [];
      outputPath.value = String(payload?.outputPath || '');
      materialUrl.value = String(payload?.materialUrl || '');
      materialSourceLabel.value = String(payload?.materialSourceLabel || '');
      activeDurationLabel.value = String(payload?.activeDurationLabel || '00:00');
      lastDurationLabel.value = String(payload?.lastDurationLabel || '暂无');
    } catch (_err) {
      // ignore storage read errors
    }
  };

  const addLog = (message, type = 'info') => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    recentLogs.value.push({
      time,
      message,
      type
    });

    // 保持最近50条日志
    if (recentLogs.value.length > 50) {
      recentLogs.value.shift();
    }
    saveState();
  };

  const startWorkflow = async ({ file, config }) => {
    try {
      uploading.value = true;
      error.value = '';
      recentLogs.value = [];

      const formData = new FormData();
      if (file) {
        formData.append('material', file);
      } else if (materialUrl.value) {
        formData.append('materialUrl', materialUrl.value);
      } else {
        throw new Error('未提供素材文件或链接');
      }

      formData.append('useSmartClip', config.useSmartClip);
      formData.append('autoGenerate', config.autoGenerate);
      if (config.outputDir) {
        formData.append('outputDir', config.outputDir);
      }
      
      formData.append('withSubtitles', withSubtitles.value);

      if (config.autoGenerate) {
        formData.append('genText', gen.value.text);
        formData.append('serverUrl', gen.value.serverUrl);
        formData.append('trimSeconds', gen.value.trimSeconds);
        formData.append('maxDuration', gen.value.maxDuration);

        if (audioMode.value === 'preset') formData.append('audioPreset', gen.value.audioPreset);
        else if (gen.value.audioFile) formData.append('audioFile', gen.value.audioFile);
        
        if (imageMode.value === 'preset') formData.append('imagePreset', gen.value.imagePreset);
        else if (gen.value.imageFile) formData.append('imageFile', gen.value.imageFile);
      }

      addLog('上传素材视频...', 'info');
      startTimer();

      const response = await fetch('/api/material-driven/start', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('上传失败');
      }

      const data = await response.json();
      jobId.value = data.jobId;
      outputPath.value = data.outputPath;

      addLog('上传成功，开始处理...', 'success');

      // 连接SSE监听进度
      connectEventSource(data.jobId);
      saveState();

    } catch (err) {
      error.value = err.message || '启动失败';
      addLog(`错误: ${error.value}`, 'error');
      stopTimer();
      saveState();
    } finally {
      uploading.value = false;
    }
  };

  const connectEventSource = (id) => {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/material-driven/progress/${id}`);

    eventSource.addEventListener('step', (e) => {
      const data = JSON.parse(e.data);
      currentStep.value = data.step;
      addLog(`步骤${data.step}: ${data.message}`, 'info');
      saveState();
    });

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      progress.value = data.percent;
      if (data.message) {
        statusText.value = data.message;
      }
      saveState();
    });

    eventSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      statusText.value = data.message;
      addLog(data.message, 'info');
      saveState();
    });

    eventSource.addEventListener('plan_summary', (e) => {
      const data = JSON.parse(e.data);
      planSummary.value = data;
      addLog(`规划完成: 素材${data.materialRatio}% + 数字人${data.aimanRatio}%`, 'success');
      saveState();
    });

    eventSource.addEventListener('narration_summary', (e) => {
      const data = JSON.parse(e.data);
      narrationSummary.value = data;
      if (data?.fullText) narrationFullText.value = data.fullText;
      addLog(`解说词生成: ${data.charCount}字, ${data.speed}字/秒`, 'success');
      saveState();
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      finalVideoUrl.value = data.videoUrl;
      currentStep.value = 8; // 完成
      addLog('🎉 制作完成！', 'success');
      stopTimer();
      saveState();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    });

    eventSource.addEventListener('error_event', (e) => {
      const data = JSON.parse(e.data);
      error.value = data.message;
      addLog(`错误: ${data.message}`, 'error');
      stopTimer();
      saveState();
    });

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (!finalVideoUrl.value && !error.value) {
        error.value = '连接中断';
        addLog('连接中断', 'error');
        stopTimer();
        saveState();
      }
    };
  };

  const restoreActiveJob = async () => {
    if (!jobId.value) return;
    try {
      const response = await fetch(`/api/material-driven/status/${jobId.value}`);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const task = payload?.task;
      if (!task) return;

      currentStep.value = Number(task.currentStep || currentStep.value || 0);
      progress.value = Number(task.progress || progress.value || 0);
      statusText.value = String(task.statusText || statusText.value || '');
      outputPath.value = String(task.outputPath || outputPath.value || '');
      if (Array.isArray(task.logs) && task.logs.length) {
        recentLogs.value = task.logs.map((item) => ({
          time: item?.time ? String(item.time).slice(11, 19) : '00:00:00',
          message: String(item?.message || ''),
          type: String(item?.type || 'info')
        })).slice(-50);
      }
      if (task.videoUrl) {
        finalVideoUrl.value = task.videoUrl;
      }
      if (task.error) {
        error.value = String(task.error);
      }
      if (Array.isArray(task.directorPlan)) {
        directorPlan.value = task.directorPlan;
      }
      if (task.narration?.full_text) {
        narrationFullText.value = String(task.narration.full_text);
      }

      if (task.status === 'running') {
        const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
        startTimer(Number.isFinite(startedAt) ? startedAt : Date.now());
        connectEventSource(jobId.value);
      } else if (task.status === 'completed') {
        stopTimer();
      }
      saveState();
    } catch (_err) {
      // ignore restore errors
    }
  };

  const continueWorkflow = async () => {
    try {
      error.value = '';
      addLog('继续执行混剪...', 'info');

      const response = await fetch(`/api/material-driven/continue/${jobId.value}`, {
        method: 'POST'
      });

      if (!response.ok) {
        let serverMessage = '继续失败';
        try {
          const payload = await response.json();
          if (payload?.error) serverMessage = payload.error;
        } catch (_err) {
          // ignore parse error
        }
        throw new Error(serverMessage);
      }

      // 重新连接SSE
      connectEventSource(jobId.value);
      saveState();

    } catch (err) {
      error.value = err.message || '继续失败';
      addLog(`错误: ${error.value}`, 'error');
      saveState();
    }
  };

  const retryStep = async (step) => {
    try {
      error.value = '';
      addLog(`重试步骤${step}...`, 'info');

      const response = await fetch(`/api/material-driven/retry/${jobId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step })
      });

      if (!response.ok) {
        let serverMessage = '重试失败';
        try {
          const payload = await response.json();
          if (payload?.error) serverMessage = payload.error;
        } catch (_err) {
          // ignore parse error
        }
        throw new Error(serverMessage);
      }

      // 重新连接SSE
      connectEventSource(jobId.value);
      saveState();

    } catch (err) {
      error.value = err.message || '重试失败';
      addLog(`错误: ${error.value}`, 'error');
      saveState();
    }
  };

  const resetWorkflow = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    jobId.value = null;
    currentStep.value = 0;
    progress.value = 0;
    statusText.value = '';
    planSummary.value = null;
    narrationSummary.value = null;
    directorPlan.value = [];
    narrationFullText.value = '';
    finalVideoUrl.value = '';
    error.value = '';
    recentLogs.value = [];
    outputPath.value = '';
    materialUrl.value = '';
    materialSourceLabel.value = '';
    saveState();
  };

  const applyXaiMaterial = (item) => {
    const url = String(item?.video_url || item?.videoUrl || '').trim();
    if (!url) {
      error.value = '当前热点条目没有可用的视频地址，无法送入 AI 混剪';
      addLog(error.value, 'error');
      return false;
    }
    
    // Clear workflow and file states
    resetWorkflow();
    materialUrl.value = url;
    materialSourceLabel.value = String(item?.title || item?.post_title || '热点素材').trim();
    
    addLog(`已接入热点素材：${materialSourceLabel.value}`, 'success');
    saveState();
    return true;
  };

  watch([
    jobId,
    currentStep,
    progress,
    statusText,
    planSummary,
    narrationSummary,
    directorPlan,
    narrationFullText,
    finalVideoUrl,
    error,
    recentLogs,
    outputPath,
    materialUrl,
    materialSourceLabel
  ], () => {
    saveState();
  }, { deep: true });

  loadState();

  return {
    jobId,
    currentStep,
    progress,
    statusText,
    planSummary,
    narrationSummary,
    directorPlan,
    narrationFullText,
    finalVideoUrl,
    error,
    recentLogs,
    uploading,
    outputPath,
    audioMode,
    imageMode,
    presets,
    gen,
    withSubtitles,
    materialUrl,
    materialSourceLabel,
    loadPresets,
    restoreActiveJob,
    activeDurationLabel,
    lastDurationLabel,
    startWorkflow,
    applyXaiMaterial,
    continueWorkflow,
    retryStep,
    resetWorkflow
  };
}
