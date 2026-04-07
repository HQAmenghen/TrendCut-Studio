import { computed, ref, watch } from 'vue';
import axios from 'axios';

const STAGE_DETAIL_MAP = {
  plan: '等待读取素材并生成大纲',
  narration: '等待根据大纲生成口播',
  generate: '等待开始数字人口播渲染',
  edit: '等待进入 AI 导演混剪',
  deliver: '等待最终成片输出'
};

const STAGE_ORDER = ['plan', 'narration', 'generate', 'edit', 'deliver'];
const STAGE_WEIGHTS = { plan: 15, narration: 15, generate: 30, edit: 30, deliver: 10 };
const RECENT_LOG_LIMIT = 24;
const ERROR_LOG_LIMIT = 12;

const createDefaultWorkflowStages = () => ([
  { key: 'plan', label: '素材策划', status: 'waiting', detail: STAGE_DETAIL_MAP.plan, startedAt: 0, finishedAt: 0 },
  { key: 'narration', label: '口播生成', status: 'waiting', detail: STAGE_DETAIL_MAP.narration, startedAt: 0, finishedAt: 0 },
  { key: 'generate', label: '数字人渲染', status: 'waiting', detail: STAGE_DETAIL_MAP.generate, startedAt: 0, finishedAt: 0 },
  { key: 'edit', label: '导演混剪', status: 'waiting', detail: STAGE_DETAIL_MAP.edit, startedAt: 0, finishedAt: 0 },
  { key: 'deliver', label: '成片交付', status: 'waiting', detail: STAGE_DETAIL_MAP.deliver, startedAt: 0, finishedAt: 0 }
]);

const formatStageIdleMessage = (label, elapsedSeconds) => {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${label}仍在执行，已等待 ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}。当前没有新的模型/渲染输出，但任务还活着。`;
};

const appendLimitedLine = (targetRef, message, limit, onWrite) => {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${String(message || '').trim()}`;
  if (!line.trim()) return;
  if (typeof onWrite === 'function') onWrite();
  targetRef.value = [...targetRef.value, line].slice(-limit);
};

export function usePipeline() {
  const audioMode = ref('preset');
  const imageMode = ref('preset');
  const presets = ref({ audio: [], image: [] });
  const optimizing = ref(false);
  const generating = ref(false);
  const editing = ref(false);
  const planning = ref(false);
  const fullFlowRunning = ref(false);
  const converting = ref(false);
  const progress = ref(0);
  const statusText = ref('等待任务...');
  const error = ref('');
  const finalVideoUrl = ref('');
  const editPreviewUrls = ref({ material: '' });
  const directorPlan = ref([]);
  const contentOutline = ref(null);
  const narrationPlan = ref(null);
  const videoScript = ref(null);
  const workflowStages = ref(createDefaultWorkflowStages());
  const recentLogs = ref([]);
  const errorLogs = ref([]);
  const taskStartedAt = ref(0);
  const elapsedSeconds = ref(0);
  const lastDurationSeconds = ref(0);
  const heartbeatMessage = ref('');
  const lastActivityAt = ref(0);
  let planRecoveryPromise = null;
  let timerHandle = null;
  let heartbeatHandle = null;

  const appendLog = (message) => {
    appendLimitedLine(recentLogs, message, RECENT_LOG_LIMIT, () => {
      lastActivityAt.value = Date.now();
    });
  };

  const appendError = (message) => {
    appendLimitedLine(errorLogs, message, ERROR_LOG_LIMIT, () => {
      lastActivityAt.value = Date.now();
    });
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

  const startTimer = (label) => {
    if (timerHandle) window.clearInterval(timerHandle);
    taskStartedAt.value = Date.now();
    elapsedSeconds.value = 0;
    appendLog(`${label}开始计时`);
    timerHandle = window.setInterval(() => {
      elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - taskStartedAt.value) / 1000));
    }, 1000);
  };

  const stopTimer = (label) => {
    if (timerHandle) {
      window.clearInterval(timerHandle);
      timerHandle = null;
    }
    if (taskStartedAt.value) {
      lastDurationSeconds.value = Math.max(0, Math.floor((Date.now() - taskStartedAt.value) / 1000));
      appendLog(`${label}完成，用时 ${formatDuration(lastDurationSeconds.value)}`);
    }
    taskStartedAt.value = 0;
    elapsedSeconds.value = 0;
  };

  const activeDurationLabel = computed(() => formatDuration(elapsedSeconds.value));
  const lastDurationLabel = computed(() => (lastDurationSeconds.value > 0 ? formatDuration(lastDurationSeconds.value) : '暂无'));
  const hasMaterialSource = computed(() => Boolean(edit.value.material || String(edit.value.materialUrl || '').trim()));
  const canAutoGenerateBridgeAiman = computed(() => {
    if (imageMode.value === 'preset') return Boolean(gen.value.imagePreset);
    return Boolean(gen.value.image);
  });
  const hasPlanResult = computed(() => Boolean(
    edit.value?.planContext?.taskDir ||
    edit.value?.planContext?.lastPipelineTaskDir ||
    videoScript.value?.segments?.length ||
    contentOutline.value?.segments?.length ||
    narrationPlan.value?.full_text
  ));
  const isPipelineBusy = computed(() => planning.value || generating.value || editing.value || fullFlowRunning.value);
  const hasActiveTask = computed(() => planning.value || generating.value || editing.value || fullFlowRunning.value);
  const canSubmitPlan = computed(() => !isPipelineBusy.value && hasMaterialSource.value);
  const canSubmitEdit = computed(() => !isPipelineBusy.value && hasMaterialSource.value && canAutoGenerateBridgeAiman.value);
  const canSubmitFullFlow = computed(() => !isPipelineBusy.value && hasMaterialSource.value && canAutoGenerateBridgeAiman.value);

  const upsertStage = (key, patch) => {
    workflowStages.value = workflowStages.value.map((stage) => stage.key === key ? { ...stage, ...patch } : stage);
    refreshProgressFromStages();
  };

  const refreshProgressFromStages = () => {
    let total = 0;
    let activeDetail = '';

    for (const key of STAGE_ORDER) {
      const stage = workflowStages.value.find((item) => item.key === key);
      if (!stage) continue;
      if (stage.status === 'success' || stage.status === 'skipped') {
        total += STAGE_WEIGHTS[key] || 0;
      } else if (stage.status === 'running') {
        total += Math.floor((STAGE_WEIGHTS[key] || 0) * 0.45);
        if (!activeDetail) activeDetail = stage.detail || '';
      } else if (stage.status === 'failed') {
        if (!activeDetail) activeDetail = stage.detail || '';
        break;
      }
    }

    if (hasActiveTask.value) {
      progress.value = Math.max(0, Math.min(99, total));
      if (activeDetail) {
        statusText.value = activeDetail;
      }
    }
  };

  const getRunningStage = () => workflowStages.value.find((stage) => stage.status === 'running') || null;

  const startHeartbeatMonitor = () => {
    if (heartbeatHandle) window.clearInterval(heartbeatHandle);
    lastActivityAt.value = Date.now();
    heartbeatMessage.value = '';
    heartbeatHandle = window.setInterval(() => {
      if (!hasActiveTask.value) {
        heartbeatMessage.value = '';
        return;
      }
      const runningStage = getRunningStage();
      if (!runningStage) {
        heartbeatMessage.value = '';
        return;
      }
      const idleSeconds = Math.max(0, Math.floor((Date.now() - (lastActivityAt.value || Date.now())) / 1000));
      if (idleSeconds < 12) {
        heartbeatMessage.value = '';
        return;
      }
      const stageElapsed = Math.max(0, Math.floor((Date.now() - Number(runningStage.startedAt || Date.now())) / 1000));
      heartbeatMessage.value = formatStageIdleMessage(runningStage.label, stageElapsed);
    }, 3000);
  };

  const stopHeartbeatMonitor = () => {
    if (heartbeatHandle) {
      window.clearInterval(heartbeatHandle);
      heartbeatHandle = null;
    }
    heartbeatMessage.value = '';
  };

  const resetWorkflowStages = () => {
    workflowStages.value = workflowStages.value.map((stage) => ({
      ...stage,
      status: 'waiting',
      detail: STAGE_DETAIL_MAP[stage.key] || STAGE_DETAIL_MAP.deliver,
      startedAt: 0,
      finishedAt: 0
    }));
    refreshProgressFromStages();
  };

  const setStageRunning = (key, detail) => {
    upsertStage(key, {
      status: 'running',
      detail,
      startedAt: Date.now(),
      finishedAt: 0
    });
  };

  const setStageSuccess = (key, detail) => {
    upsertStage(key, {
      status: 'success',
      detail,
      finishedAt: Date.now()
    });
  };

  const setStageFailed = (key, detail) => {
    upsertStage(key, {
      status: 'failed',
      detail,
      finishedAt: Date.now()
    });
  };

  const setStageSkipped = (key, detail) => {
    upsertStage(key, {
      status: 'skipped',
      detail,
      finishedAt: Date.now()
    });
  };

  const markWaitingAfter = (keys) => {
    workflowStages.value = workflowStages.value.map((stage) => {
      if (!keys.includes(stage.key)) return stage;
      if (stage.status === 'waiting') return stage;
      return {
        ...stage,
        status: 'waiting',
        detail: STAGE_DETAIL_MAP[stage.key] || STAGE_DETAIL_MAP.deliver,
        startedAt: 0,
        finishedAt: 0
      };
    });
    refreshProgressFromStages();
  };

  const gen = ref({
    text: '',
    audio: null,
    image: null,
    audioPreset: '',
    imagePreset: '',
    serverUrl: 'https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443',
    trimSeconds: 0,
    maxDuration: 20
  });

  const clearPlanArtifacts = () => {
    contentOutline.value = null;
    narrationPlan.value = null;
    videoScript.value = null;
    if (edit.value.planContext) {
      edit.value.planContext = null;
    }
  };

  const setGenField = (key, value) => {
    gen.value[key] = value;
  };

  const revokeEditPreviewUrl = (type) => {
    const current = String(editPreviewUrls.value[type] || '');
    if (current.startsWith('blob:')) {
      URL.revokeObjectURL(current);
    }
    editPreviewUrls.value = {
      ...editPreviewUrls.value,
      [type]: ''
    };
  };

  const updateEditPreviewUrl = (type, source) => {
    revokeEditPreviewUrl(type);
    const nextValue = source instanceof File
      ? URL.createObjectURL(source)
      : String(source || '').trim();
    editPreviewUrls.value = {
      ...editPreviewUrls.value,
      [type]: nextValue
    };
  };

  const setEditField = (key, value) => {
    const nextValue = key === 'targetDurationSec' ? Number(value) : value;
    const prevValue = edit.value[key];
    if (prevValue === nextValue) return;

    edit.value[key] = nextValue;

    if (key === 'materialUrl') {
      edit.value.material = null;
      editFileName.value.material = '';
      updateEditPreviewUrl('material', nextValue);
      clearPlanArtifacts();
      return;
    }

    if (['sourceLabel', 'sourceSummary', 'targetDurationSec'].includes(key)) {
      clearPlanArtifacts();
    }
  };

  const resolveBridgeAvatarConfig = () => {
    if (imageMode.value !== 'preset' || !gen.value.imagePreset) {
      return {
        ok: false,
        message: '素材优先模式下，请先选择一个人物预设图像，系统会自动生成补位数字人。'
      };
    }
    return {
      ok: true,
      avatarImage: `preset:${gen.value.imagePreset}`,
      avatarAudio: audioMode.value === 'preset' && gen.value.audioPreset ? `preset:${gen.value.audioPreset}` : ''
    };
  };

  const applyRecoveredPlanPayload = (payload, options = {}) => {
    const { appendRecoveryLog = true } = options;
    const recoveredDuration = Number(payload?.outline?.target_duration_sec || edit.value.targetDurationSec || 45);
    contentOutline.value = {
      topic: payload?.outline?.topic || edit.value.sourceLabel || '素材结构已分析',
      angle: payload?.outline?.angle || edit.value.sourceSummary || '已生成素材结构与补位策略',
      target_duration_sec: recoveredDuration,
      segments: []
    };
    narrationPlan.value = null;
    videoScript.value = null;

    edit.value.planContext = {
      sourceLabel: edit.value.sourceLabel,
      sourceSummary: edit.value.sourceSummary,
      taskDir: payload?.taskDir || '',
      targetDurationSec: recoveredDuration,
      lastPipelineTaskDir: edit.value.planContext?.lastPipelineTaskDir || ''
    };

    setStageSuccess('plan', '素材结构与补位策略已恢复');
    setStageSuccess('narration', '补位策略已从已完成任务恢复');
    error.value = '';
    if (appendRecoveryLog) {
      appendLog(`已恢复策划结果：${payload?.taskDir || '最近一次成功任务'}`);
    }
  };

  const restoreLatestPlanResult = async ({ taskDir = '', silent = false } = {}) => {
    if (planRecoveryPromise) return planRecoveryPromise;
    planRecoveryPromise = (async () => {
      try {
        const params = {};
        if (String(taskDir || '').trim()) {
          params.taskDir = String(taskDir).trim();
        } else if (edit.value.planContext?.taskDir) {
          params.taskDir = edit.value.planContext.taskDir;
        }
        const res = await axios.get('/api/plan-pipeline-result', { params });
        if (res.data?.success) {
          applyRecoveredPlanPayload(res.data, { appendRecoveryLog: !silent });
          return true;
        }
      } catch (err) {
        if (!silent) {
          appendError(err.response?.data?.error || err.message || '恢复策划结果失败');
        }
      } finally {
        planRecoveryPromise = null;
      }
      return false;
    })();
    return planRecoveryPromise;
  };

  try {
    const cached = localStorage.getItem("comfy_panel_pipeline_state");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.audioMode) audioMode.value = parsed.audioMode;
      if (parsed.imageMode) imageMode.value = parsed.imageMode;
      if (parsed.finalVideoUrl) finalVideoUrl.value = parsed.finalVideoUrl;
      if (Array.isArray(parsed.directorPlan)) directorPlan.value = parsed.directorPlan;
      if (parsed.contentOutline) contentOutline.value = parsed.contentOutline;
      if (parsed.narrationPlan) narrationPlan.value = parsed.narrationPlan;
      if (parsed.videoScript) videoScript.value = parsed.videoScript;
      if (Array.isArray(parsed.workflowStages)) workflowStages.value = parsed.workflowStages;
      if (parsed.recentLogs) recentLogs.value = parsed.recentLogs;
      if (parsed.errorLogs) errorLogs.value = parsed.errorLogs;
      if (parsed.lastDurationSeconds) lastDurationSeconds.value = parsed.lastDurationSeconds;
      if (parsed.gen) {
        gen.value.text = parsed.gen.text || "";
        gen.value.serverUrl = parsed.gen.serverUrl || "https://u920820-82c4-2ba7d3b1.westc.seetacloud.com:8443";
        gen.value.trimSeconds = parsed.gen.trimSeconds || 0;
        gen.value.maxDuration = parsed.gen.maxDuration || 20;
        gen.value.audioPreset = parsed.gen.audioPreset || "";
        gen.value.imagePreset = parsed.gen.imagePreset || "";
      }
    }
  } catch (_e) {}

  const genFileName = ref({ audio: '', image: '' });
  const edit = ref({
    material: null,
    materialUrl: '',
    sourceLabel: '',
    sourceSummary: '',
    sourcePostUrl: '',
    withSubtitles: true,
    targetDurationSec: 45
  });
  const editFileName = ref({ aiman: '', material: '' });

  try {
    const cached = localStorage.getItem("comfy_panel_pipeline_state");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.edit) {
        edit.value.materialUrl = parsed.edit.materialUrl || "";
        edit.value.sourceLabel = parsed.edit.sourceLabel || "";
        edit.value.sourceSummary = parsed.edit.sourceSummary || "";
        edit.value.sourcePostUrl = parsed.edit.sourcePostUrl || "";
        edit.value.withSubtitles = parsed.edit.withSubtitles ?? true;
        edit.value.targetDurationSec = parsed.edit.targetDurationSec || 45;
      }
      if (parsed.planContext) {
        edit.value.planContext = parsed.planContext;
      }
    }
  } catch (_e) {}

  watch([audioMode, imageMode, finalVideoUrl, directorPlan, contentOutline, narrationPlan, videoScript, workflowStages, recentLogs, errorLogs, lastDurationSeconds, gen, edit], () => {
    localStorage.setItem("comfy_panel_pipeline_state", JSON.stringify({
      audioMode: audioMode.value,
      imageMode: imageMode.value,
      finalVideoUrl: finalVideoUrl.value,
      directorPlan: directorPlan.value,
      contentOutline: contentOutline.value,
      narrationPlan: narrationPlan.value,
      videoScript: videoScript.value,
      planContext: edit.value.planContext || null,
      workflowStages: workflowStages.value,
      recentLogs: recentLogs.value,
      errorLogs: errorLogs.value,
      lastDurationSeconds: lastDurationSeconds.value,
      gen: {
        text: gen.value.text,
        serverUrl: gen.value.serverUrl,
        trimSeconds: gen.value.trimSeconds,
        maxDuration: gen.value.maxDuration,
        audioPreset: gen.value.audioPreset,
        imagePreset: gen.value.imagePreset
      },
      edit: {
        materialUrl: edit.value.materialUrl,
        sourceLabel: edit.value.sourceLabel,
        sourceSummary: edit.value.sourceSummary,
        sourcePostUrl: edit.value.sourcePostUrl,
        withSubtitles: edit.value.withSubtitles,
        targetDurationSec: edit.value.targetDurationSec
      }
    }));
  }, { deep: true });

  window.setTimeout(() => {
    const planStage = workflowStages.value.find((stage) => stage.key === 'plan');
    const timedOut = /timeout/i.test(String(planStage?.detail || '')) || /timeout/i.test(String(error.value || ''));
    if (timedOut && !edit.value.planContext?.taskDir) {
      appendLog('检测到上次素材策划因前端超时中断，正在尝试恢复最近成功结果');
      restoreLatestPlanResult({ silent: false });
    }
  }, 0);

  const handleGenFile = (type, file) => {
    gen.value[type] = file || null;
    genFileName.value[type] = file?.name || '';
  };

  const handleEditFile = (type, file) => {
    edit.value[type] = file || null;
    editFileName.value[type] = file?.name || '';
    updateEditPreviewUrl(type, file);
    if (type === 'material') {
      edit.value.materialUrl = '';
      edit.value.sourceLabel = '';
      edit.value.sourceSummary = '';
      edit.value.sourcePostUrl = '';
      clearPlanArtifacts();
    }
  };

  const stripSummary = (value) => String(value || '').replace(/^@[^-]+-\s*/, '').replace(/\s+/g, ' ').trim();

  const applyXaiMaterial = (item) => {
    const materialUrl = String(item?.video_url || item?.videoUrl || '').trim();
    if (!materialUrl) {
      error.value = '当前热点条目没有可用的视频地址，无法送入 AI 混剪';
      appendError(error.value);
      return false;
    }
    edit.value.material = null;
    editFileName.value.material = '';
    edit.value.materialUrl = materialUrl;
    updateEditPreviewUrl('material', materialUrl);
    edit.value.sourceLabel = String(item?.title || item?.post_title || '热点素材').trim();
    edit.value.sourceSummary = stripSummary(item?.author_summary_zh || item?.summary || item?.author_summary || '');
    edit.value.sourcePostUrl = String(item?.post_url || item?.postUrl || '').trim();
    clearPlanArtifacts();
    appendLog(`已接入热点空镜头：${edit.value.sourceLabel || materialUrl}`);
    appendLog('建议先用 AI 从素材生成结构与补位策略，再直接进入素材优先混剪');
    return true;
  };

  const openProgressStream = (clientId) => {
    progress.value = 0;
    statusText.value = '正在连线服务器...';
    lastActivityAt.value = Date.now();
    appendLog(`建立进度流：${clientId}`);
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

  const resetProgressLater = () => {
    window.setTimeout(() => {
      progress.value = 0;
      statusText.value = '等待任务...';
      heartbeatMessage.value = '';
    }, 1200);
  };

  const loadPresets = async () => {
    try {
      appendLog('读取音频与图片预设');
      const res = await axios.get('/api/presets');
      presets.value = res.data?.success ? res.data : { audio: [], image: [] };
      if (!gen.value.audioPreset && presets.value.audio.length) gen.value.audioPreset = presets.value.audio[0];
      if (!gen.value.imagePreset && presets.value.image.length) gen.value.imagePreset = presets.value.image[0];
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    }
  };

  const optimizeText = async () => {
    if (!String(gen.value.text || '').trim()) {
      error.value = '请先输入基础文案';
      appendError(error.value);
      return;
    }
    optimizing.value = true;
    error.value = '';
    appendLog('启动 AI 爆款润色');
    try {
      const res = await axios.post('/api/optimize-text', { text: gen.value.text });
      if (res.data?.text) gen.value.text = res.data.text;
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      optimizing.value = false;
    }
  };

  const submitEdit = async (options = {}) => {
    error.value = '';
    const materialUrl = String(edit.value.materialUrl || '').trim();
    const { forceAutoGenerateAiman = false, forceFreshAiman = false } = options;

    if (!edit.value.material && !materialUrl) {
      error.value = '请上传空镜头素材视频，或从热门榜单送入远程素材地址';
      appendError(error.value);
      return;
    }
    const bridgeAvatarConfig = resolveBridgeAvatarConfig();
    if (!bridgeAvatarConfig.ok) {
      error.value = bridgeAvatarConfig.message;
      appendError(error.value);
      return;
    }
    const clientId = `edit_${Math.random().toString(36).slice(2)}`;
    const stream = openProgressStream(clientId);
    startHeartbeatMonitor();
    editing.value = true;
    finalVideoUrl.value = '';
    directorPlan.value = [];
    setStageRunning('edit', '正在进行 ASR、视觉理解和导演混剪');
    setStageRunning('deliver', '等待导演混剪产出最终成片');
    startTimer('AI 导演混剪');
    appendLog('启动 AI 导演混剪任务');
    try {
      const data = new FormData();
      const lastPipelineTaskDir = String(edit.value.planContext?.lastPipelineTaskDir || '').trim();
      const canReuseExistingAiman = !forceFreshAiman && Boolean(lastPipelineTaskDir);
      data.append('clientId', clientId);
      data.append('autoGenerateAiman', 'true');
      data.append('requireAutoGenerate', 'true');
      data.append('comfyServerUrl', gen.value.serverUrl);
      data.append('reuseExistingAiman', String(canReuseExistingAiman));
      if (canReuseExistingAiman) {
        data.append('existingAimanTaskDir', lastPipelineTaskDir);
        appendLog(`本次导演混剪将复用已有补位数字人：${lastPipelineTaskDir}`);
      } else {
        data.append('avatarImage', bridgeAvatarConfig.avatarImage);
        if (bridgeAvatarConfig.avatarAudio) {
          data.append('avatarAudio', bridgeAvatarConfig.avatarAudio);
        }
        appendLog(`本次导演混剪将自动生成补位数字人：${bridgeAvatarConfig.avatarImage}`);
      }
      if (edit.value.material) data.append('material', edit.value.material);
      else data.append('materialUrl', materialUrl);
      data.append('withSubtitles', String(edit.value.withSubtitles));

      // 传递策划上下文
      if (edit.value.planContext) {
        data.append('sourceLabel', edit.value.planContext.sourceLabel || '');
        data.append('sourceSummary', edit.value.planContext.sourceSummary || '');
      }
      data.append('targetDurationSec', String(edit.value.planContext?.targetDurationSec || edit.value.targetDurationSec || 45));

      // 传递 planTaskDir 以复用识别结果
      if (edit.value.planContext?.taskDir) {
        data.append('planTaskDir', edit.value.planContext.taskDir);
        appendLog(`检测到策划任务目录，将复用识别结果: ${edit.value.planContext.taskDir}`);
      }

      const res = await axios.post('/api/run-pipeline', data);
      if (res.data?.videoUrl) finalVideoUrl.value = `${res.data.videoUrl}?t=${Date.now()}`;
      if (res.data?.taskDir) {
        if (!edit.value.planContext) {
          edit.value.planContext = {
            sourceLabel: edit.value.sourceLabel,
            sourceSummary: edit.value.sourceSummary,
            taskDir: '',
            targetDurationSec: edit.value.targetDurationSec || 45,
            lastPipelineTaskDir: ''
          };
        }
        edit.value.planContext.lastPipelineTaskDir = res.data.taskDir;
        appendLog(`已记录最近一次混剪任务目录：${res.data.taskDir}`);
      }
      if (Array.isArray(res.data?.directorPlan)) {
        directorPlan.value = res.data.directorPlan;
        appendLog(`AI 导演方案已返回，共 ${directorPlan.value.length} 个镜头片段`);
      }
      setStageSuccess('edit', `导演混剪完成，已返回 ${directorPlan.value.length || 0} 个镜头片段`);
      setStageSuccess('deliver', '最终成片已生成，可以预览与导出');
      progress.value = 100;
      statusText.value = '🎉 全流程已完成';
      appendLog('最终成片已生成');
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      setStageFailed('edit', error.value);
      setStageFailed('deliver', '成片交付未完成');
      appendError(error.value);
    } finally {
      stream.close();
      editing.value = false;
      if (!planning.value && !generating.value && !fullFlowRunning.value) stopHeartbeatMonitor();
      stopTimer('AI 导演混剪');
      resetProgressLater();
    }
  };

  const submitPlan = async () => {
    error.value = '';
    const materialUrl = String(edit.value.materialUrl || '').trim();
    if (!edit.value.material && !materialUrl) {
      error.value = '请先上传空镜头素材，或从热门榜单送入远程素材地址';
      appendError(error.value);
      return;
    }
    planning.value = true;
    const clientId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const stream = openProgressStream(clientId);
    startHeartbeatMonitor();
    if (!fullFlowRunning.value) {
      resetWorkflowStages();
    }
    progress.value = 6;
    statusText.value = '正在读取素材并生成大纲...';
    setStageRunning('plan', '正在提取素材字幕、画面和结构信息');
    setStageRunning('narration', '等待先产出内容大纲');
    markWaitingAfter(['generate', 'edit', 'deliver']);
    appendLog('启动 AI 素材策划任务');
    try {
      const data = new FormData();
      if (edit.value.material) data.append('material', edit.value.material);
      else data.append('materialUrl', materialUrl);
      data.append('sourceLabel', edit.value.sourceLabel || '');
      data.append('sourceSummary', edit.value.sourceSummary || '');
      data.append('targetDurationSec', String(edit.value.targetDurationSec || 45));
      data.append('clientId', clientId);
      const res = await axios.post('/api/plan-pipeline', data, { timeout: 600000 });
      const plannedDuration = Number(res.data?.outline?.target_duration_sec || edit.value.targetDurationSec || 45);
      contentOutline.value = {
        topic: res.data?.outline?.topic || edit.value.sourceLabel || '素材结构已分析',
        angle: res.data?.outline?.angle || edit.value.sourceSummary || '已生成素材结构与补位策略',
        target_duration_sec: plannedDuration,
        segments: []
      };
      narrationPlan.value = null;
      videoScript.value = null;
      if (Number.isFinite(plannedDuration) && plannedDuration > 0) {
        gen.value.maxDuration = Math.max(20, Math.min(180, Math.ceil(plannedDuration + 5)));
        appendLog(`已同步目标时长为 ${gen.value.maxDuration} 秒上限，便于后续自动生成补位数字人`);
      }
      setStageSuccess('plan', '素材结构与补位策略已生成');
      setStageSuccess('narration', '补位策略已生成，等待素材片段编排');
      appendLog(`素材策划完成，后续将按素材优先模式自动生成补位数字人并编排时间线`);

      // 保存策划上下文，供后续流程使用
      edit.value.planContext = {
        sourceLabel: edit.value.sourceLabel,
        sourceSummary: edit.value.sourceSummary,
        taskDir: res.data?.taskDir,
        targetDurationSec: plannedDuration,
        lastPipelineTaskDir: edit.value.planContext?.lastPipelineTaskDir || ''
      };
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      if (/timeout/i.test(String(error.value || ''))) {
        appendLog('前端等待素材策划超时，正在尝试从已完成任务恢复结果...');
        const restored = await restoreLatestPlanResult({ silent: true });
        if (restored) {
          appendLog('已从后端完成任务恢复素材策划结果');
          return;
        }
      }
      setStageFailed('plan', error.value);
      setStageFailed('narration', '口播文案未生成');
      appendError(error.value);
    } finally {
      if (stream) stream.close();
      planning.value = false;
      if (!generating.value && !editing.value && !fullFlowRunning.value) stopHeartbeatMonitor();
    }
  };

  const convertVideo = async (ratio) => {
    converting.value = true;
    error.value = '';
    appendLog(`启动比例转换：${ratio}`);
    try {
      const res = await axios.post('/api/convert-video', { ratio });
      if (res.data?.videoUrl) finalVideoUrl.value = res.data.videoUrl;
      appendLog(`比例转换完成：${ratio}`);
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      converting.value = false;
    }
  };

  const submitFullFlow = async () => {
    if (planning.value || generating.value || editing.value || fullFlowRunning.value) {
      return;
    }
    fullFlowRunning.value = true;
    error.value = '';
    startHeartbeatMonitor();
    resetWorkflowStages();
    appendLog('启动一键全流程：素材理解 -> 选片编排 -> 自动生成补位数字人 -> AI 导演混剪');
    try {
      await submitPlan();
      if (error.value) {
        throw new Error(error.value);
      }

      await submitEdit({ forceAutoGenerateAiman: true, forceFreshAiman: true });
      if (error.value) {
        throw new Error(error.value);
      }

      appendLog('一键全流程执行完成');
    } catch (err) {
      const message = err?.message || '一键全流程执行失败';
      error.value = message;
      const runningStage = workflowStages.value.find((stage) => stage.status === 'running');
      if (runningStage) {
        setStageFailed(runningStage.key, message);
      }
      appendError(message);
    } finally {
      fullFlowRunning.value = false;
      if (!planning.value && !generating.value && !editing.value) stopHeartbeatMonitor();
    }
  };

  return {
    audioMode,
    imageMode,
    presets,
    optimizing,
    generating,
    editing,
    planning,
    fullFlowRunning,
    converting,
    progress,
    statusText,
    activeDurationLabel,
    lastDurationLabel,
    canSubmitPlan,
    canSubmitEdit,
    canSubmitFullFlow,
    canAutoGenerateBridgeAiman,
    hasPlanResult,
    hasMaterialSource,
    recentLogs,
    errorLogs,
    error,
    finalVideoUrl,
    directorPlan,
    editPreviewUrls,
    contentOutline,
    narrationPlan,
    videoScript,
    workflowStages,
    heartbeatMessage,
    gen,
    genFileName,
    edit,
    editFileName,
    handleGenFile,
    handleEditFile,
    setGenField,
    setEditField,
    applyXaiMaterial,
    loadPresets,
    optimizeText,
    submitPlan,
    restoreLatestPlanResult,
    submitEdit,
    submitFullFlow,
    convertVideo
  };
}
