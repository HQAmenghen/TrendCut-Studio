import { computed, ref, watch } from 'vue';
import axios from 'axios';

export function usePipeline() {
  const audioMode = ref('preset');
  const imageMode = ref('preset');
  const presets = ref({ audio: [], image: [] });
  const optimizing = ref(false);
  const generating = ref(false);
  const editing = ref(false);
  const converting = ref(false);
  const progress = ref(0);
  const statusText = ref('等待任务...');
  const error = ref('');
  const generatedVideoUrl = ref('');
  const finalVideoUrl = ref('');
  const recentLogs = ref([]);
  const errorLogs = ref([]);
  const taskStartedAt = ref(0);
  const elapsedSeconds = ref(0);
  const lastDurationSeconds = ref(0);
  let timerHandle = null;

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

  try {
    const cached = localStorage.getItem("comfy_panel_pipeline_state");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.audioMode) audioMode.value = parsed.audioMode;
      if (parsed.imageMode) imageMode.value = parsed.imageMode;
      if (parsed.generatedVideoUrl) generatedVideoUrl.value = parsed.generatedVideoUrl;
      if (parsed.finalVideoUrl) finalVideoUrl.value = parsed.finalVideoUrl;
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
    aiman: null,
    aimanUrl: '',
    material: null,
    materialUrl: '',
    sourceLabel: '',
    sourceSummary: '',
    sourcePostUrl: '',
    withSubtitles: true
  });
  const editFileName = ref({ aiman: '', material: '' });

  try {
    const cached = localStorage.getItem("comfy_panel_pipeline_state");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.edit) {
        edit.value.aimanUrl = parsed.edit.aimanUrl || "";
        edit.value.materialUrl = parsed.edit.materialUrl || "";
        edit.value.sourceLabel = parsed.edit.sourceLabel || "";
        edit.value.sourceSummary = parsed.edit.sourceSummary || "";
        edit.value.sourcePostUrl = parsed.edit.sourcePostUrl || "";
        edit.value.withSubtitles = parsed.edit.withSubtitles ?? true;
      }
    }
  } catch (_e) {}

  watch([audioMode, imageMode, generatedVideoUrl, finalVideoUrl, recentLogs, errorLogs, lastDurationSeconds, gen, edit], () => {
    localStorage.setItem("comfy_panel_pipeline_state", JSON.stringify({
      audioMode: audioMode.value,
      imageMode: imageMode.value,
      generatedVideoUrl: generatedVideoUrl.value,
      finalVideoUrl: finalVideoUrl.value,
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
        aimanUrl: edit.value.aimanUrl,
        materialUrl: edit.value.materialUrl,
        sourceLabel: edit.value.sourceLabel,
        sourceSummary: edit.value.sourceSummary,
        sourcePostUrl: edit.value.sourcePostUrl,
        withSubtitles: edit.value.withSubtitles
      }
    }));
  }, { deep: true });

  const handleGenFile = (type, file) => {
    gen.value[type] = file || null;
    genFileName.value[type] = file?.name || '';
  };

  const handleEditFile = (type, file) => {
    edit.value[type] = file || null;
    editFileName.value[type] = file?.name || '';
    if (type === 'aiman') {
      edit.value.aimanUrl = '';
    }
    if (type === 'material') {
      edit.value.materialUrl = '';
      edit.value.sourceLabel = '';
      edit.value.sourceSummary = '';
      edit.value.sourcePostUrl = '';
    }
  };

  const stripSummary = (value) => String(value || '').replace(/^@[^-]+-\s*/, '').replace(/\s+/g, ' ').trim();

  const buildStarterScript = (item) => {
    const title = String(item?.title || '').trim();
    const summary = stripSummary(item?.author_summary_zh || item?.summary || item?.author_summary || '');
    if (!title && !summary) return '';
    const parts = [];
    if (title) parts.push(`今天带你看一条热点视频，标题是《${title}》。`);
    if (summary) parts.push(`原视频摘要提到：${summary}`);
    parts.push('接下来先看原片关键信息，再用数字人口播拆解其中的重点。');
    return parts.join('');
  };

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
    edit.value.sourceLabel = String(item?.title || item?.post_title || '热点素材').trim();
    edit.value.sourceSummary = stripSummary(item?.author_summary_zh || item?.summary || item?.author_summary || '');
    edit.value.sourcePostUrl = String(item?.post_url || item?.postUrl || '').trim();
    if (!String(gen.value.text || '').trim()) {
      gen.value.text = buildStarterScript(item);
    }
    appendLog(`已接入热点空镜头：${edit.value.sourceLabel || materialUrl}`);
    return true;
  };

  const useGeneratedVideoAsAiman = () => {
    if (!String(generatedVideoUrl.value || '').trim()) {
      error.value = '当前还没有数字人口播结果可用作主轨';
      appendError(error.value);
      return false;
    }
    edit.value.aiman = null;
    editFileName.value.aiman = '';
    edit.value.aimanUrl = generatedVideoUrl.value;
    appendLog('已将当前数字人口播结果设为主轨素材');
    return true;
  };

  const openProgressStream = (clientId) => {
    progress.value = 0;
    statusText.value = '正在连线服务器...';
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

  const submitGenerate = async () => {
    error.value = '';
    const useAudioPreset = audioMode.value === 'preset';
    const useImagePreset = imageMode.value === 'preset';
    if (!String(gen.value.text || '').trim()) {
      error.value = '请输入文案';
      appendError(error.value);
      return;
    }
    if (useAudioPreset && !gen.value.audioPreset) {
      error.value = '请选择预设音色';
      appendError(error.value);
      return;
    }
    if (!useAudioPreset && !gen.value.audio) {
      error.value = '请上传参考音频';
      appendError(error.value);
      return;
    }
    if (useImagePreset && !gen.value.imagePreset) {
      error.value = '请选择预设照片';
      appendError(error.value);
      return;
    }
    if (!useImagePreset && !gen.value.image) {
      error.value = '请上传驱动图片';
      appendError(error.value);
      return;
    }
    const clientId = `gen_${Math.random().toString(36).slice(2)}`;
    const stream = openProgressStream(clientId);
    generating.value = true;
    generatedVideoUrl.value = '';
    startTimer('数字人渲染');
    appendLog('启动数字人渲染任务');
    try {
      const data = new FormData();
      data.append('text', gen.value.text);
      data.append('clientId', clientId);
      data.append('serverUrl', gen.value.serverUrl);
      data.append('trimSeconds', gen.value.trimSeconds);
      data.append('maxDuration', gen.value.maxDuration);
      data.append('useAudioPreset', String(useAudioPreset));
      data.append('useImagePreset', String(useImagePreset));
      if (useAudioPreset) data.append('audioPreset', gen.value.audioPreset);
      else data.append('audio', gen.value.audio);
      if (useImagePreset) data.append('imagePreset', gen.value.imagePreset);
      else data.append('image', gen.value.image);
      const res = await axios.post('/api/generate', data);
      if (res.data?.videoUrl) generatedVideoUrl.value = res.data.videoUrl;
      appendLog('数字人口播生成完成');
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      stream.close();
      generating.value = false;
      stopTimer('数字人渲染');
      resetProgressLater();
    }
  };

  const submitEdit = async () => {
    error.value = '';
    const aimanUrl = String(edit.value.aimanUrl || generatedVideoUrl.value || '').trim();
    const materialUrl = String(edit.value.materialUrl || '').trim();
    if (!edit.value.aiman && !aimanUrl) {
      error.value = '请上传数字人视频，或先生成数字人口播后直接作为主轨';
      appendError(error.value);
      return;
    }
    if (!edit.value.material && !materialUrl) {
      error.value = '请上传空镜头素材视频，或从热门榜单送入远程素材地址';
      appendError(error.value);
      return;
    }
    const clientId = `edit_${Math.random().toString(36).slice(2)}`;
    const stream = openProgressStream(clientId);
    editing.value = true;
    finalVideoUrl.value = '';
    startTimer('AI 导演混剪');
    appendLog('启动 AI 导演混剪任务');
    try {
      const data = new FormData();
      data.append('clientId', clientId);
      if (edit.value.aiman) data.append('aiman', edit.value.aiman);
      else data.append('aimanUrl', aimanUrl);
      if (edit.value.material) data.append('material', edit.value.material);
      else data.append('materialUrl', materialUrl);
      data.append('withSubtitles', String(edit.value.withSubtitles));
      const res = await axios.post('/api/run-pipeline', data);
      if (res.data?.videoUrl) finalVideoUrl.value = `${res.data.videoUrl}?t=${Date.now()}`;
      appendLog('最终成片已生成');
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
      appendError(error.value);
    } finally {
      stream.close();
      editing.value = false;
      stopTimer('AI 导演混剪');
      resetProgressLater();
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

  return {
    audioMode,
    imageMode,
    presets,
    optimizing,
    generating,
    editing,
    converting,
    progress,
    statusText,
    activeDurationLabel,
    lastDurationLabel,
    recentLogs,
    errorLogs,
    error,
    generatedVideoUrl,
    finalVideoUrl,
    gen,
    genFileName,
    edit,
    editFileName,
    handleGenFile,
    handleEditFile,
    applyXaiMaterial,
    loadPresets,
    optimizeText,
    submitGenerate,
    submitEdit,
    convertVideo,
    useGeneratedVideoAsAiman
  };
}
