<template>
  <main class="shell">
    <header class="page-header">
      <div>
        <div class="header-kicker">Unified Video Console</div>
        <h1>自动生产驾驶舱</h1>
      </div>
      <div class="status-card">
        <div class="theme-toggle">
          <button type="button" :class="{ active: themeMode === 'dark' }" @click="setThemeMode('dark')">
            <Moon class="status-icon" aria-hidden="true" />
            暗色
          </button>
          <button type="button" :class="{ active: themeMode === 'light' }" @click="setThemeMode('light')">
            <Sun class="status-icon" aria-hidden="true" />
            亮色
          </button>
        </div>
        <div class="status-online" :class="engineStatusClass">
          <span class="dot"></span>
          <strong>{{ engineStatusLabel }}</strong>
        </div>
      </div>
    </header>

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
      @make-vertical="handleMakeVertical"
      @check-login="handleCheckLogin"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Moon, Sun } from 'lucide-vue-next';
import AutomationDashboard from './components/AutomationDashboard.vue';
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

const findCurrentAsset = async () => {
  if (!materialDriven.finalVideoUrl.value) return null;
  if (typeof publishCenter.fetchAssets === 'function') {
    await publishCenter.fetchAssets(true);
  } else {
    await publishCenter.refresh(true, { silent: true, preserveEditor: true });
  }
  return publishCenter.assets.value.find((asset) =>
    asset.url === materialDriven.finalVideoUrl.value ||
    materialDriven.finalVideoUrl.value.includes(asset.path)
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

const handleMakeVertical = async () => {
  if (!materialDriven.finalVideoUrl.value || standalone.loading.value) return;
  try {
    const response = await fetch(materialDriven.finalVideoUrl.value);
    const blob = await response.blob();
    const file = new File([blob], 'output_final.mp4', { type: 'video/mp4' });
    standalone.handleFile('video', file);

    const projectDir = materialDriven.outputPath.value;
    if (projectDir) {
      const candidates = [
        `/projects/${projectDir}/execution_plan.json`,
        `/projects/${projectDir}/avatar_segments.json`,
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
  } catch (err) {
    console.warn('Failed to create vertical version from cockpit', err);
  }
};

const handleCheckLogin = ({ platformKey, accountId }) => {
  if (!platformKey || !accountId) return;
  publishCenter.checkPlatformAccountLogin(platformKey, accountId);
};

onMounted(() => {
  publishCenter.refresh();
  publishCenter.startAutoRefresh();
  xaiTop10.loadConfig();
  standalone.loadQueue(true);
  standalone.loadMaterialTasks(true);
  standalone.startAutoRefresh();
  materialDriven.loadPresets();
  materialDriven.restoreActiveJob();
});

onBeforeUnmount(() => {
  publishCenter.stopAutoRefresh();
  xaiTop10.stopAutoRefresh();
  standalone.stopAutoRefresh();
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

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.header-kicker {
  color: var(--brand-a);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 850;
}

h1 {
  margin: 8px 0 0;
  font-size: 28px;
  line-height: 1.12;
  color: var(--strong-text);
}

.status-card {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  border-radius: 8px;
  border: 1px solid var(--line-soft);
  background: var(--panel);
  padding: 10px 14px;
  box-shadow: var(--shadow);
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 7px;
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  padding: 4px;
}

.theme-toggle button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 10px;
  font-weight: 800;
  cursor: pointer;
}

.theme-toggle button.active {
  color: #04110f;
  background: var(--brand-a);
}

.status-online {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ok);
  font-weight: 800;
}

.status-online.warn {
  color: var(--warn);
}

.status-online.danger {
  color: var(--danger);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 16%, transparent);
}

.status-icon {
  width: 15px;
  height: 15px;
}

@media (max-width: 760px) {
  .shell {
    padding: 16px 12px 32px;
  }

  .page-header {
    flex-direction: column;
  }

  .status-card {
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
  }
}
</style>
