<template>
  <main class="shell">
    <AppHeader
      :theme-mode="themeMode"
      :engine-status-label="engineStatusLabel"
      :engine-status-class="engineStatusClass"
      @update-theme="setThemeMode"
    />

    <AutomationDashboard
      :material-driven="materialDriven"
      :publish-center="publishCenter"
      :standalone="standalone"
      :xai="xaiTop10"
      @start-automation="handleStartAutomation"
      @continue-workflow="materialDriven.continueWorkflow"
      @retry-step="materialDriven.retryStep"
      @reset-workflow="handleResetWorkflow"
      @use-xai-material="handleUseXaiMaterial"
      @refresh="refreshDashboard"
      @run-xai="xaiTop10.run"
      @create-publish-job="handleCreatePublishJob"
      @run-publish-draft="handleRunPublishDraft"
      @retry-vertical="handleMakeVertical({ automatic: false })"
      @resume-material-task="materialDriven.resumeMaterialTask"
      @check-login="handleCheckLogin"
    />

    <XaiRunErrorModal
      v-if="xaiTop10.errorAlert.value"
      :alert="xaiTop10.errorAlert.value"
      :partition-label="xaiTop10.activePartitionLabel.value"
      @close="xaiTop10.dismissErrorAlert"
      @retry="handleRetryXaiRun"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AutomationDashboard from './components/AutomationDashboard.vue';
import XaiRunErrorModal from './components/XaiRunErrorModal.vue';
import { usePublishCenter } from './composables/usePublishCenter';
import { useXaiTop10 } from './composables/useXaiTop10';
import { useStandalone } from './composables/useStandalone';
import { useMaterialDriven } from './composables/useMaterialDriven';

function getInitialThemeMode() {
  try {
    const savedTheme = window.localStorage.getItem('comfy-panel-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme;
    }
  } catch (_err) {
    // ignore storage read errors
  }
  return 'dark';
}

const themeMode = ref(getInitialThemeMode());
const publishCenter = usePublishCenter();
const xaiTop10 = useXaiTop10();
const standalone = useStandalone();
const materialDriven = useMaterialDriven();
const autoVerticalInFlightKey = ref('');
const standaloneAssetTypes = new Set(['standalone_runtime', 'standalone']);

const engineStatusLabel = computed(() => {
  const status = publishCenter.selfCheckSummary.value?.status;
  if (status === 'fail' || status === 'error') return '需处理';
  if (status === 'warn') return '有警告';
  return '引擎在线';
});

const engineStatusClass = computed(() => {
  const status = publishCenter.selfCheckSummary.value?.status;
  if (status === 'fail' || status === 'error') return 'danger';
  if (status === 'warn') return 'warn';
  return 'ok';
});

const setThemeMode = (mode) => {
  themeMode.value = mode;
};

const refreshDashboard = async () => {
  await Promise.allSettled([
    publishCenter.refresh(true, { silent: true, preserveEditor: true }),
    xaiTop10.refresh(true),
    standalone.loadQueue(true),
    standalone.loadMaterialTasks(true),
    materialDriven.refreshActiveTasks(true),
    materialDriven.refreshTaskSnapshot()
  ]);
};

const handleStartAutomation = async (payload) => {
  if (payload?.file && materialDriven.materialUrl.value) {
    materialDriven.resetWorkflow({ clearDraftText: false });
  }
  await materialDriven.startWorkflow(payload);
};

const handleResetWorkflow = () => {
  materialDriven.resetWorkflow({ clearDraftText: true });
};

const handleUseXaiMaterial = (item) => {
  materialDriven.applyXaiMaterial(item);
};

const normalizeUrlPath = (url) => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, window.location.origin).pathname;
  } catch (_err) {
    return raw.split('?')[0];
  }
};

const normalizeTaskDirReference = (value) => {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!normalized) return '';
  const projectsMarker = '/projects/';
  const projectsIndex = normalized.lastIndexOf(projectsMarker);
  if (projectsIndex >= 0) {
    return normalized.slice(projectsIndex + projectsMarker.length).split('/')[0] || '';
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

const getAutoVerticalKey = () => {
  const taskDir = getCurrentMaterialTaskDir();
  const videoPath = normalizeUrlPath(materialDriven.finalVideoUrl.value);
  return taskDir && videoPath ? `${taskDir}|${videoPath}` : '';
};

const getCurrentMaterialTaskDir = () => normalizeTaskDirReference(materialDriven.outputPath.value);

const isStandaloneForCurrentMaterial = () => {
  const taskDir = getCurrentMaterialTaskDir();
  return Boolean(
    taskDir &&
    normalizeTaskDirReference(standalone.lastSourceTaskDir.value) === taskDir &&
    standalone.finalVideoUrl.value
  );
};

const refreshPublishAssets = async () => {
  await publishCenter.refresh(true, { silent: true, preserveEditor: true });
};

const findVerticalAssetForCurrentMaterial = () => {
  const taskDir = getCurrentMaterialTaskDir();
  if (!taskDir) return null;
  return publishCenter.assets.value.find((asset) =>
    standaloneAssetTypes.has(asset.sourceType) &&
    normalizeTaskDirReference(asset.metadata?.sourceTaskDir) === taskDir
  ) || null;
};

const restoreStandaloneFromAsset = (asset) => {
  const taskDir = getCurrentMaterialTaskDir();
  if (!asset || !taskDir) return;
  standalone.finalVideoUrl.value = asset.url || standalone.finalVideoUrl.value;
  standalone.lastSourceTaskDir.value = taskDir;
  standalone.form.value.sourceTaskDir = taskDir;
  standalone.form.value.sourceTaskTitle = asset.metadata?.title || asset.compactLabel || taskDir;
  standalone.setPreviewSelection('current');
  standalone.progress.value = 100;
  standalone.statusText.value = '已检测到已有竖屏成片，跳过重复合成';
};

const findCurrentAsset = async () => {
  if (!materialDriven.finalVideoUrl.value && !standalone.finalVideoUrl.value) return null;
  await refreshPublishAssets();

  if (isStandaloneForCurrentMaterial()) {
    const standaloneAsset = findVerticalAssetForCurrentMaterial() || publishCenter.assets.value.find((asset) =>
      standaloneAssetTypes.has(asset.sourceType)
    );
    if (standaloneAsset) return standaloneAsset;
  }

  const finalPath = normalizeUrlPath(materialDriven.finalVideoUrl.value);
  return publishCenter.assets.value.find((asset) =>
    normalizeUrlPath(asset.url) === finalPath ||
    finalPath.includes(String(asset.path || '').replace(/\\/g, '/'))
  ) || null;
};

const handleCreatePublishJob = async () => {
  const targetAsset = await findCurrentAsset();
  if (!targetAsset) return;
  await publishCenter.selectAsset(targetAsset.id);
  await publishCenter.createJob();
  await publishCenter.refreshJobs(true);
};

const handleRunPublishDraft = async () => {
  await publishCenter.runAllWechat('draft');
};

const normalizeSubtitlesPayload = (payload) => {
  const narrationText = String(payload?.full_text || payload?.fullText || '').trim();
  if (narrationText) {
    const duration = Number(payload?.target_duration_sec ?? payload?.duration ?? payload?.duration_sec);
    return [{
      time: [0, Number.isFinite(duration) && duration > 0 ? duration : Math.max(6, Math.ceil(narrationText.length / 4))],
      zh: narrationText,
      text: narrationText
    }];
  }

  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.segments)
      ? payload.segments
      : [];
  return source.map((item) => {
    if (Array.isArray(item?.time) && item.time.length >= 2) {
      return item;
    }
    const start = Number(item?.start_time ?? item?.start ?? 0);
    const end = Number(item?.end_time ?? item?.end ?? 0);
    const zh = String(item?.subtitle_zh || item?.zh_text || item?.subtitle_text || item?.text || item?.zh || '').trim();
    const en = String(item?.subtitle_en || item?.en_text || item?.english || item?.en || '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !zh) {
      return null;
    }
    return {
      time: [start, end],
      zh,
      en: en || undefined
    };
  }).filter(Boolean);
};

const handleMakeVertical = async ({ automatic = false } = {}) => {
  if (!materialDriven.finalVideoUrl.value || standalone.loading.value) return false;
  if (automatic && !getCurrentMaterialTaskDir()) return false;
  const verticalKey = getAutoVerticalKey();
  if (automatic && (
    autoVerticalInFlightKey.value === verticalKey ||
    isStandaloneForCurrentMaterial()
  )) {
    return false;
  }

  autoVerticalInFlightKey.value = verticalKey;
  try {
    if (automatic) {
      await refreshPublishAssets();
      const existingVerticalAsset = findVerticalAssetForCurrentMaterial();
      if (existingVerticalAsset) {
        restoreStandaloneFromAsset(existingVerticalAsset);
        return false;
      }
    }

    const projectDir = getCurrentMaterialTaskDir();
    if (projectDir) {
      standalone.selectMaterialTask(projectDir);
      const candidates = [
        `/projects/${projectDir}/narration.json`,
        `/projects/${projectDir}/aiman_subtitles.json`,
        `/projects/${projectDir}/subtitles.json`
      ];
      for (const url of candidates) {
        const res = await fetch(url);
        if (!res.ok) continue;
        const payload = await res.json();
        const subtitles = normalizeSubtitlesPayload(payload);
        if (subtitles.length) {
          standalone.form.value.subtitlesPayload = JSON.stringify(subtitles);
          standalone.form.value.useASR = true;
          break;
        }
      }
    } else {
      const response = await fetch(materialDriven.finalVideoUrl.value);
      if (!response.ok) throw new Error('读取素材成片失败');
      const blob = await response.blob();
      const file = new File([blob], 'output_final.mp4', { type: 'video/mp4' });
      standalone.handleFile('video', file);
    }

    if (materialDriven.narrationFullText.value) {
      standalone.form.value.script = materialDriven.narrationFullText.value;
    }
    if (materialDriven.materialSourceTitle.value || materialDriven.materialSourceBody.value) {
      standalone.form.value.context = JSON.stringify({
        title: materialDriven.materialSourceTitle.value,
        body: materialDriven.materialSourceBody.value
      });
    }
    await standalone.submit();
    await Promise.allSettled([
      standalone.loadQueue(true),
      refreshPublishAssets()
    ]);
    if (!standalone.error.value && standalone.finalVideoUrl.value) {
      return true;
    }
  } catch (err) {
    console.warn('Failed to create vertical version from cockpit', err);
    standalone.setErrorState({
      message: err?.message || '自动竖屏合成失败',
      code: 'AUTO_VERTICAL_FAILED',
      stage: 'frontend.auto_vertical',
      hint: '请确认素材任务目录和成片文件仍然存在',
      details: err?.stack || err?.message || ''
    });
  } finally {
    if (autoVerticalInFlightKey.value === verticalKey) {
      autoVerticalInFlightKey.value = '';
    }
  }
  return false;
};

const handleCheckLogin = ({ platformKey, accountId }) => {
  if (!platformKey || !accountId) return;
  if (platformKey === 'wechatChannels') {
    publishCenter.testWechatLogin(accountId);
    return;
  }
  publishCenter.checkPlatformAccountLogin(platformKey, accountId);
};

const handleRetryXaiRun = async () => {
  xaiTop10.dismissErrorAlert();
  await xaiTop10.run();
};

onMounted(() => {
  publishCenter.refresh();
  publishCenter.startAutoRefresh();
  xaiTop10.loadConfig();
  standalone.loadQueue(true);
  standalone.loadMaterialTasks(true);
  standalone.startAutoRefresh();
  materialDriven.loadPresets();
  materialDriven.restoreActiveJob().then(() => materialDriven.restoreLatestCompletedTask({ silent: true }));
  materialDriven.startActiveTasksRefresh();
});

onBeforeUnmount(() => {
  publishCenter.stopAutoRefresh();
  xaiTop10.stopAutoRefresh();
  standalone.stopAutoRefresh();
  materialDriven.stopActiveTasksRefresh();
});

watch(themeMode, (value) => {
  document.body.classList.toggle('theme-light', value === 'light');
  document.documentElement.dataset.theme = value;
  try {
    window.localStorage.setItem('comfy-panel-theme', value);
  } catch (_err) {
    // ignore storage write errors
  }
}, { immediate: true });

watch(
  () => [materialDriven.finalVideoUrl.value, materialDriven.outputPath.value],
  ([finalVideoUrl, outputPath]) => {
    if (!finalVideoUrl || !outputPath) return;
    window.setTimeout(() => {
      handleMakeVertical({ automatic: true });
    }, 0);
  },
  { immediate: true }
);
</script>

<style scoped>
.shell {
  width: min(100%, 1720px);
  margin: 0 auto;
  padding: 22px 20px 44px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (max-width: 760px) {
  .shell {
    padding: 16px 12px 32px;
  }
}
</style>
