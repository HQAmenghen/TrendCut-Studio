import { ref, computed, watch } from 'vue';

const MATERIAL_DRIVEN_STORAGE_KEY = 'comfy_panel_material_driven_state_v1';
const WORKFLOW_STEP_IDS = [1, 2, 3, 4, 5, 6, 7];

function createEmptyStepTimings() {
  return WORKFLOW_STEP_IDS.reduce((acc, stepId) => {
    acc[stepId] = { startedAt: null, completedAt: null, durationMs: 0 };
    return acc;
  }, {});
}

function normalizeStepTimings(raw) {
  const base = createEmptyStepTimings();
  if (!raw || typeof raw !== 'object') return base;
  for (const stepId of WORKFLOW_STEP_IDS) {
    const entry = raw?.[stepId] || raw?.[String(stepId)] || {};
    base[stepId] = {
      startedAt: Number(entry?.startedAt) || null,
      completedAt: Number(entry?.completedAt) || null,
      durationMs: Math.max(0, Number(entry?.durationMs) || 0)
    };
  }
  return base;
}

function formatDurationMs(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function useMaterialDriven() {
  const jobId = ref(null);
  const currentStep = ref(0);
  const progress = ref(0);
  const statusText = ref('');
  const planSummary = ref(null);
  const narrationSummary = ref(null);
  const scriptUnits = ref([]);
  const editPlan = ref(null);
  const executionPlan = ref(null);
  const narrationFullText = ref('');
  const finalVideoUrl = ref('');
  const error = ref('');
  const audioMode = ref('preset');
  const imageMode = ref('preset');
  const presets = ref({ audio: [], image: [] });
  const materialUrl = ref('');
  const materialSourceLabel = ref('');
  const materialSourceTitle = ref('');
  const materialSourceBody = ref('');
  const materialSourcePostUrl = ref('');
  const gen = ref({
    text: '',
    audioPreset: '',
    imagePreset: '',
    audioFile: null,
    imageFile: null,
    serverUrl: 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443'
  });
  const withSubtitles = ref(true);
  const comfyTestLoading = ref(false);
  const comfyTestResult = ref({ status: '', message: '', testedUrl: '' });
  const activeDurationLabel = ref('00:00');
  const lastDurationLabel = ref('暂无');
  const stepTimings = ref(createEmptyStepTimings());
  const stepTimingTick = ref(Date.now());
  let taskStartedAt = 0;
  let timerHandle = null;

  const stripAuthorPrefix = (text) => String(text || '').replace(/^@\S+\s*-\s*/, '').trim();

  const deriveXaiSourceText = (item) => {
    const zhSummary = stripAuthorPrefix(item?.author_summary_zh || '');
    const enSummary = stripAuthorPrefix(item?.author_summary || '');
    const genericTitle = String(item?.title || item?.post_title || '').trim();
    const genericBody = String(item?.summary || item?.post_text || item?.text || item?.content || '').trim();

    const title = zhSummary || genericTitle || enSummary;
    const bodyParts = [zhSummary, genericBody, enSummary]
      .map((part) => String(part || '').trim())
      .filter((part, index, arr) => part && arr.indexOf(part) === index);

    return {
      label: title || String(item?.author || item?.post_id || '热点素材').trim(),
      title,
      body: bodyParts.join('\n')
    };
  };

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
      stepTimingTick.value = Date.now();
    }, 1000);
  };

  const stopTimer = () => {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    lastDurationLabel.value = activeDurationLabel.value;
    activeDurationLabel.value = '00:00';
    stepTimingTick.value = Date.now();
  };

  const resetStepTimingsFrom = (startStep = 1) => {
    for (const stepId of WORKFLOW_STEP_IDS) {
      if (stepId >= startStep) {
        stepTimings.value[stepId] = { startedAt: null, completedAt: null, durationMs: 0 };
      }
    }
    stepTimingTick.value = Date.now();
  };

  const finalizeStepTiming = (stepId, endedAt = Date.now()) => {
    const normalizedStep = Number(stepId || 0);
    if (!WORKFLOW_STEP_IDS.includes(normalizedStep)) return;
    const entry = stepTimings.value[normalizedStep];
    if (!entry?.startedAt) return;
    entry.durationMs = Math.max(0, Number(entry.durationMs) || 0) + Math.max(0, endedAt - Number(entry.startedAt));
    entry.startedAt = null;
    entry.completedAt = endedAt;
    stepTimingTick.value = endedAt;
  };

  const applyStepTransition = (nextStep, startedAt = Date.now()) => {
    const normalizedNextStep = Number(nextStep || 0);
    if (!WORKFLOW_STEP_IDS.includes(normalizedNextStep)) {
      currentStep.value = normalizedNextStep;
      stepTimingTick.value = startedAt;
      return;
    }

    const previousStep = Number(currentStep.value || 0);
    if (WORKFLOW_STEP_IDS.includes(previousStep) && previousStep !== normalizedNextStep) {
      finalizeStepTiming(previousStep, startedAt);
    }
    if (WORKFLOW_STEP_IDS.includes(previousStep) && normalizedNextStep < previousStep) {
      resetStepTimingsFrom(normalizedNextStep);
    }

    const currentEntry = stepTimings.value[normalizedNextStep];
    if (!currentEntry.startedAt) {
      currentEntry.startedAt = startedAt;
      currentEntry.completedAt = null;
      if (previousStep !== normalizedNextStep) {
        currentEntry.durationMs = 0;
      }
    }
    currentStep.value = normalizedNextStep;
    stepTimingTick.value = startedAt;
  };

  const finalizeCurrentStepTiming = (endedAt = Date.now(), fallbackStep = null) => {
    let targetStep = Number(currentStep.value || 0);
    if (!WORKFLOW_STEP_IDS.includes(targetStep) && WORKFLOW_STEP_IDS.includes(Number(fallbackStep))) {
      targetStep = Number(fallbackStep);
    }
    if (!WORKFLOW_STEP_IDS.includes(targetStep)) return;
    if (!stepTimings.value[targetStep]?.startedAt && !stepTimings.value[targetStep]?.completedAt) {
      stepTimings.value[targetStep].startedAt = endedAt;
    }
    finalizeStepTiming(targetStep, endedAt);
  };

  const restartStepTiming = (stepId, startedAt = Date.now()) => {
    const normalizedStep = Number(stepId || 0);
    if (!WORKFLOW_STEP_IDS.includes(normalizedStep)) return;
    resetStepTimingsFrom(normalizedStep);
    currentStep.value = normalizedStep;
    stepTimings.value[normalizedStep] = { startedAt, completedAt: null, durationMs: 0 };
    stepTimingTick.value = startedAt;
  };

  const stepDurationMap = computed(() => {
    const now = stepTimingTick.value || Date.now();
    const result = {};
    for (const stepId of WORKFLOW_STEP_IDS) {
      const entry = stepTimings.value[stepId] || {};
      const baseDurationMs = Math.max(0, Number(entry.durationMs) || 0);
      const runningExtraMs = entry.startedAt ? Math.max(0, now - Number(entry.startedAt)) : 0;
      const totalDurationMs = baseDurationMs + runningExtraMs;
      const hasStarted = Boolean(entry.startedAt || entry.completedAt || totalDurationMs > 0);
      result[stepId] = {
        seconds: Math.floor(totalDurationMs / 1000),
        label: hasStarted ? formatDurationMs(totalDurationMs) : '未开始',
        detail: entry.startedAt
          ? `已耗时 ${formatDurationMs(totalDurationMs)}`
          : hasStarted
            ? `用时 ${formatDurationMs(totalDurationMs)}`
            : '未开始'
      };
    }
    return result;
  });

  const recentLogs = ref([]);
  const uploading = ref(false);
  const rebuildingPlan = ref(false);
  const rerenderingVideo = ref(false);
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
        scriptUnits: scriptUnits.value,
        editPlan: editPlan.value,
        executionPlan: executionPlan.value,
        finalVideoUrl: finalVideoUrl.value,
        error: error.value,
        recentLogs: recentLogs.value,
        outputPath: outputPath.value,
        stepTimings: stepTimings.value,
        materialUrl: materialUrl.value,
        materialSourceLabel: materialSourceLabel.value,
        materialSourceTitle: materialSourceTitle.value,
        materialSourceBody: materialSourceBody.value,
        materialSourcePostUrl: materialSourcePostUrl.value,
        audioMode: audioMode.value,
        imageMode: imageMode.value,
        withSubtitles: withSubtitles.value,
        comfyTestResult: comfyTestResult.value,
        gen: {
          text: gen.value.text,
          audioPreset: gen.value.audioPreset,
          imagePreset: gen.value.imagePreset,
          serverUrl: gen.value.serverUrl
        },
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
      scriptUnits.value = Array.isArray(payload?.scriptUnits) ? payload.scriptUnits : [];
      editPlan.value = payload?.editPlan || null;
      executionPlan.value = payload?.executionPlan || null;
      narrationFullText.value = String(payload?.narrationFullText || '');
      finalVideoUrl.value = String(payload?.finalVideoUrl || '');
      error.value = String(payload?.error || '');
      recentLogs.value = Array.isArray(payload?.recentLogs) ? payload.recentLogs : [];
      outputPath.value = String(payload?.outputPath || '');
      stepTimings.value = normalizeStepTimings(payload?.stepTimings);
      materialUrl.value = String(payload?.materialUrl || '');
      materialSourceLabel.value = String(payload?.materialSourceLabel || '');
      materialSourceTitle.value = String(payload?.materialSourceTitle || payload?.sourcePost?.title || '');
      materialSourceBody.value = String(payload?.materialSourceBody || payload?.sourcePost?.body || '');
      materialSourcePostUrl.value = String(payload?.materialSourcePostUrl || payload?.sourcePost?.postUrl || '');
      audioMode.value = String(payload?.audioMode || 'preset');
      imageMode.value = String(payload?.imageMode || 'preset');
      withSubtitles.value = typeof payload?.withSubtitles === 'boolean' ? payload.withSubtitles : true;
      comfyTestResult.value = payload?.comfyTestResult || { status: '', message: '', testedUrl: '' };
      gen.value = {
        ...gen.value,
        text: String(payload?.gen?.text || ''),
        audioPreset: String(payload?.gen?.audioPreset || gen.value.audioPreset || ''),
        imagePreset: String(payload?.gen?.imagePreset || gen.value.imagePreset || ''),
        serverUrl: String(payload?.gen?.serverUrl || gen.value.serverUrl || ''),
        audioFile: null,
        imageFile: null
      };
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

  const normalizeStepMessage = (step, message) => {
    const raw = String(message || '').trim();
    const stripped = raw
      .replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')
      .replace(/^[^\w\u4e00-\u9fa5]*\s*/, '')
      .trim();
    if (!stripped) return `步骤${step}`;
    return stripped.startsWith(`步骤${step}:`) ? stripped : `步骤${step}: ${stripped}`;
  };

  const startWorkflow = async ({ file, config, manualScript = '' }) => {
    try {
      uploading.value = true;
      error.value = '';
      recentLogs.value = [];
      stepTimings.value = createEmptyStepTimings();
      stepTimingTick.value = Date.now();

      const formData = new FormData();
      if (file) {
        formData.append('material', file);
      } else if (materialUrl.value) {
        formData.append('materialUrl', materialUrl.value);
      } else {
        throw new Error('未提供素材文件或链接');
      }

      if (manualScript) {
        formData.append('manualScript', manualScript);
      }

      formData.append('useSmartClip', config.useSmartClip);
      formData.append('autoGenerate', config.autoGenerate);
      if (config.outputDir) {
        formData.append('outputDir', config.outputDir);
      }
      
      formData.append('withSubtitles', withSubtitles.value);
      if (materialSourceTitle.value) formData.append('sourceTitle', materialSourceTitle.value);
      if (materialSourceBody.value) formData.append('sourceBody', materialSourceBody.value);
      if (materialSourcePostUrl.value) formData.append('sourcePostUrl', materialSourcePostUrl.value);

      if (config.autoGenerate) {
        formData.append('genText', gen.value.text);
        formData.append('serverUrl', gen.value.serverUrl);

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
      // Reset progress state so UI doesn't look like a task is still running
      progress.value = 0;
      statusText.value = '启动失败';
      currentStep.value = 0;
      finalVideoUrl.value = '';
      stopTimer();
      saveState();
    } finally {
      uploading.value = false;
    }
  };

  const testComfyConnection = async () => {
    comfyTestLoading.value = true;
    comfyTestResult.value = { status: '', message: '', testedUrl: '' };
    try {
      const response = await fetch('/api/material-driven/test-comfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: gen.value.serverUrl })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'ComfyUI 连通性检测失败');
      }
      comfyTestResult.value = {
        status: 'success',
        message: payload.message || 'ComfyUI 连通正常',
        testedUrl: payload.testedUrl || ''
      };
      addLog(`ComfyUI 连通测试成功: ${payload.testedUrl || gen.value.serverUrl}`, 'success');
    } catch (err) {
      comfyTestResult.value = {
        status: 'error',
        message: err.message || 'ComfyUI 连通性检测失败',
        testedUrl: ''
      };
      addLog(`ComfyUI 连通测试失败: ${comfyTestResult.value.message}`, 'error');
    } finally {
      comfyTestLoading.value = false;
      saveState();
    }
  };

  const connectEventSource = (id) => {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/material-driven/progress/${id}`);

    eventSource.addEventListener('step', (e) => {
      const data = JSON.parse(e.data);
      applyStepTransition(data.step, Date.now());
      addLog(normalizeStepMessage(data.step, data.message), 'info');
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
      const hasRatio = Number.isFinite(Number(data?.materialRatio)) && Number.isFinite(Number(data?.aimanRatio));
      if (hasRatio) {
        addLog(`规划完成: 素材${data.materialRatio}% + 数字人${data.aimanRatio}%`, 'success');
      } else if (Number.isFinite(Number(data?.segmentCount)) && Number.isFinite(Number(data?.totalDuration))) {
        addLog(`规划完成: 已选素材${data.segmentCount}段，共${data.totalDuration}秒`, 'success');
      } else {
        addLog('规划完成', 'success');
      }
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
      const endedAt = Date.now();
      if (currentStep.value !== 7 && !stepTimings.value[7]?.startedAt && !stepTimings.value[7]?.completedAt) {
        applyStepTransition(7, endedAt);
      }
      finalizeCurrentStepTiming(endedAt, 7);
      finalVideoUrl.value = data.videoUrl;
      currentStep.value = 7; // 完成
      addLog('🎉 制作完成！', 'success');
      stopTimer();
      refreshTaskSnapshot().catch(() => {});
      saveState();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    });

    eventSource.addEventListener('error_event', (e) => {
      const data = JSON.parse(e.data);
      finalizeCurrentStepTiming(Date.now());
      error.value = data.message;
      statusText.value = data.message;
      uploading.value = false;
      addLog(`错误: ${data.message}`, 'error');
      stopTimer();
      saveState();
      // Close SSE on terminal error — task is done
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    });

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (!finalVideoUrl.value && !error.value) {
        finalizeCurrentStepTiming(Date.now());
        error.value = '连接中断';
        addLog('连接中断', 'error');
        stopTimer();
        saveState();
      }
    };
  };

  const hydrateTaskPayload = (task) => {
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
    if (task.sourcePost) {
      materialSourceTitle.value = String(task.sourcePost.title || materialSourceTitle.value || '');
      materialSourceBody.value = String(task.sourcePost.body || materialSourceBody.value || '');
      materialSourcePostUrl.value = String(task.sourcePost.postUrl || materialSourcePostUrl.value || '');
    }
    if (task.avatarConfig && typeof task.avatarConfig === 'object') {
      gen.value = {
        ...gen.value,
        text: String(task.avatarConfig.genText || gen.value.text || ''),
        audioPreset: String(task.avatarConfig.audioPreset || gen.value.audioPreset || ''),
        imagePreset: String(task.avatarConfig.imagePreset || gen.value.imagePreset || ''),
        serverUrl: String(task.avatarConfig.serverUrl || gen.value.serverUrl || ''),
        audioFile: null,
        imageFile: null
      };
      if (task.avatarConfig.audioPreset) {
        audioMode.value = 'preset';
      }
      if (task.avatarConfig.imagePreset) {
        imageMode.value = 'preset';
      }
    }
    if (Array.isArray(task.scriptUnits)) {
      scriptUnits.value = task.scriptUnits;
    }
    editPlan.value = task.editPlan || null;
    executionPlan.value = task.executionPlan || null;
    if (task.narration?.full_text) {
      narrationFullText.value = String(task.narration.full_text);
    }
  };

  const refreshTaskSnapshot = async () => {
    if (!jobId.value) return null;
    const query = outputPath.value ? `?outputPath=${encodeURIComponent(outputPath.value)}` : '';
    const response = await fetch(`/api/material-driven/status/${jobId.value}${query}`);
    if (!response.ok) {
      throw new Error('获取任务状态失败');
    }
    const payload = await response.json();
    const task = payload?.task;
    if (task) {
      hydrateTaskPayload(task);
      saveState();
    }
    return task || null;
  };

  const restoreActiveJob = async () => {
    if (!jobId.value) return;
    try {
      const task = await refreshTaskSnapshot();
      if (!task) return;

      if (task.status === 'running') {
        const startedAt = task.startedAt ? new Date(task.startedAt).getTime() : Date.now();
        startTimer(Number.isFinite(startedAt) ? startedAt : Date.now());
        if (WORKFLOW_STEP_IDS.includes(Number(currentStep.value || 0))) {
          const currentTiming = stepTimings.value[currentStep.value];
          if (!currentTiming?.startedAt && !currentTiming?.completedAt && !currentTiming?.durationMs) {
            currentTiming.startedAt = Date.now();
            currentTiming.completedAt = null;
            stepTimingTick.value = Date.now();
          }
        }
        connectEventSource(jobId.value);
      } else if (task.status === 'completed') {
        finalizeCurrentStepTiming(Date.now(), Number(currentStep.value || 7));
        stopTimer();
      }
      saveState();
    } catch (_err) {
      progress.value = 0;
      statusText.value = '';
      error.value = '后端已重启或任务未在内存中，可直接重建剪辑计划或重试当前步骤';
      saveState();
    }
  };

  const continueWorkflow = async () => {
    try {
      error.value = '';
      addLog('继续执行混剪...', 'info');

      const response = await fetch(`/api/material-driven/continue/${jobId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputPath: outputPath.value })
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
      if (currentStep.value >= 6 && currentStep.value <= 7) {
        restartStepTiming(currentStep.value, Date.now());
      }
      connectEventSource(jobId.value);
      saveState();

    } catch (err) {
      error.value = err.message || '继续失败';
      addLog(`错误: ${error.value}`, 'error');
      saveState();
    }
  };

  const rebuildPlan = async () => {
    try {
      rebuildingPlan.value = true;
      error.value = '';
      addLog('重建剪辑计划...', 'info');
      restartStepTiming(4, Date.now());
      const response = await fetch(`/api/material-driven/rebuild/${jobId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputPath: outputPath.value })
      });
      if (!response.ok) {
        let serverMessage = '重建剪辑计划失败';
        try {
          const payload = await response.json();
          if (payload?.error) serverMessage = payload.error;
        } catch (_err) {}
        throw new Error(serverMessage);
      }
      connectEventSource(jobId.value);
      saveState();
    } catch (err) {
      error.value = err.message || '重建剪辑计划失败';
      addLog(`错误: ${error.value}`, 'error');
      saveState();
    } finally {
      rebuildingPlan.value = false;
    }
  };

  const rerenderVideo = async () => {
    try {
      rerenderingVideo.value = true;
      error.value = '';
      addLog('重新渲染成片...', 'info');
      restartStepTiming(7, Date.now());
      const response = await fetch(`/api/material-driven/rerender/${jobId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputPath: outputPath.value })
      });
      if (!response.ok) {
        let serverMessage = '重新渲染失败';
        try {
          const payload = await response.json();
          if (payload?.error) serverMessage = payload.error;
        } catch (_err) {}
        throw new Error(serverMessage);
      }
      connectEventSource(jobId.value);
      saveState();
    } catch (err) {
      error.value = err.message || '重新渲染失败';
      addLog(`错误: ${error.value}`, 'error');
      saveState();
    } finally {
      rerenderingVideo.value = false;
    }
  };

  const retryStep = async (step) => {
    try {
      error.value = '';
      addLog(`重试步骤${step}...`, 'info');
      restartStepTiming(step, Date.now());

      const response = await fetch(`/api/material-driven/retry/${jobId.value}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          step, 
          outputPath: outputPath.value,
          avatarConfig: {
            serverUrl: gen.value.serverUrl,
            ...(audioMode.value === 'preset' ? { audioPreset: gen.value.audioPreset } : {}),
            ...(imageMode.value === 'preset' ? { imagePreset: gen.value.imagePreset } : {})
          }
        })
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
    scriptUnits.value = [];
    editPlan.value = null;
    executionPlan.value = null;
    comfyTestResult.value = { status: '', message: '', testedUrl: '' };
    narrationFullText.value = '';
    finalVideoUrl.value = '';
    error.value = '';
    recentLogs.value = [];
    outputPath.value = '';
    stepTimings.value = createEmptyStepTimings();
    stepTimingTick.value = Date.now();
    materialUrl.value = '';
    materialSourceLabel.value = '';
    materialSourceTitle.value = '';
    materialSourceBody.value = '';
    materialSourcePostUrl.value = '';
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
    const sourceInfo = deriveXaiSourceText(item);
    materialUrl.value = url;
    materialSourceLabel.value = sourceInfo.label;
    materialSourceTitle.value = sourceInfo.title;
    materialSourceBody.value = sourceInfo.body;
    materialSourcePostUrl.value = String(item?.postUrl || item?.post_url || '').trim();
    
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
    scriptUnits,
    editPlan,
    executionPlan,
    narrationFullText,
    finalVideoUrl,
    error,
    recentLogs,
    stepTimings,
    outputPath,
    materialUrl,
    materialSourceLabel,
    materialSourceTitle,
    materialSourceBody,
    materialSourcePostUrl,
    audioMode,
    imageMode,
    withSubtitles,
    comfyTestResult,
    gen
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
    scriptUnits,
    editPlan,
    executionPlan,
    narrationFullText,
    finalVideoUrl,
    error,
    recentLogs,
    uploading,
    rebuildingPlan,
    rerenderingVideo,
    outputPath,
    audioMode,
    imageMode,
    presets,
    gen,
    withSubtitles,
    comfyTestLoading,
    comfyTestResult,
    materialUrl,
    materialSourceLabel,
    materialSourceTitle,
    materialSourceBody,
    materialSourcePostUrl,
    loadPresets,
    refreshTaskSnapshot,
    restoreActiveJob,
    activeDurationLabel,
    lastDurationLabel,
    stepDurationMap,
    startWorkflow,
    testComfyConnection,
    applyXaiMaterial,
    continueWorkflow,
    rebuildPlan,
    rerenderVideo,
    retryStep,
    resetWorkflow
  };
}
