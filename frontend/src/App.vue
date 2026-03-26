<template>
  <main class="shell">
    <div class="page-header">
      <div>
        <div class="header-kicker">Unified Video Console</div>
        <h1>AI 视频中台工作台</h1>
        <p>{{ shellDescription }}</p>
      </div>
      <div class="status-card">
        <div class="theme-toggle">
          <button type="button" :class="{ active: themeMode === 'dark' }" @click="setThemeMode('dark')">🌙 暗色</button>
          <button type="button" :class="{ active: themeMode === 'light' }" @click="setThemeMode('light')">☀️ 亮色</button>
        </div>
        <div class="status-online">
          <span class="dot"></span>
          <strong>引擎在线</strong>
        </div>
        <div class="module-tag">
          <span>当前模块</span>
          <strong>{{ currentModuleTitle }}</strong>
        </div>
      </div>
    </div>

    <TopNavigation :items="navItems" :active-key="activeModule" @change="activeModule = $event" />

    <PipelineWorkspace
      v-if="activeModule === 'pipeline'"
      :audio-mode="pipeline.audioMode.value"
      :image-mode="pipeline.imageMode.value"
      :presets="pipeline.presets.value"
      :optimizing="pipeline.optimizing.value"
      :generating="pipeline.generating.value"
      :editing="pipeline.editing.value"
      :converting="pipeline.converting.value"
      :progress="pipeline.progress.value"
      :status-text="pipeline.statusText.value"
      :active-duration-label="pipeline.activeDurationLabel.value"
      :last-duration-label="pipeline.lastDurationLabel.value"
      :recent-logs="pipeline.recentLogs"
      :error-logs="pipeline.errorLogs"
      :error="pipeline.error.value"
      :generated-video-url="pipeline.generatedVideoUrl.value"
      :final-video-url="pipeline.finalVideoUrl.value"
      :gen="pipeline.gen.value"
      :gen-file-name="pipeline.genFileName.value"
      :edit="pipeline.edit.value"
      :edit-file-name="pipeline.editFileName.value"
      @update:audio-mode="pipeline.audioMode.value = $event"
      @update:image-mode="pipeline.imageMode.value = $event"
      @update:gen-field="(key, value) => pipeline.gen.value[key] = value"
      @update:edit-field="(key, value) => pipeline.edit.value[key] = value"
      @gen-file="pipeline.handleGenFile"
      @edit-file="pipeline.handleEditFile"
      @optimize-text="pipeline.optimizeText"
      @submit-generate="pipeline.submitGenerate"
      @submit-edit="pipeline.submitEdit"
      @to-publish="handleToPublish"
      @to-vertical="handleToVertical"
      @use-generated-video="pipeline.useGeneratedVideoAsAiman"
    />

    <StandaloneWorkspace
      v-else-if="activeModule === 'standalone'"
      :loading="standalone.loading.value"
      :error="standalone.error.value"
      :error-state="standalone.errorState.value"
      :progress="standalone.progress.value"
      :status-text="standalone.statusText.value"
      :active-duration-label="standalone.activeDurationLabel.value"
      :last-duration-label="standalone.lastDurationLabel.value"
      :recent-logs="standalone.recentLogs"
      :error-logs="standalone.errorLogs"
      :final-video-url="standalone.finalVideoUrl.value"
      :preview-video-url="standalone.previewVideoUrl.value"
      :preview-selection="standalone.previewSelection.value"
      :preview-options="standalone.previewOptions.value"
      :form="standalone.form.value"
      :queue-status="standalone.queueStatus.value"
      @refresh="standalone.loadQueue"
      @cancel-queue-job="standalone.cancelQueueJob"
      @delete-queue-job="standalone.deleteQueueJob"
      @submit="standalone.submit"
      @update:file="standalone.handleFile"
      @update:title="standalone.form.value.title = $event"
      @update:use-asr="standalone.form.value.useASR = $event"
      @update:render-option="(key, value) => standalone.form.value.renderOptions[key] = value"
      @update:preview-selection="standalone.setPreviewSelection"
    />

    <XaiDiscoveryWorkspace
      v-else-if="activeModule === 'xaiTop10'"
      :xai="xaiTop10"
      @send-to-pipeline="handoffXaiToPipeline"
    />

    <PublishCenterWorkspace
      v-else
      :center="publishCenter"
    />

  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import TopNavigation from './components/TopNavigation.vue';
import PublishCenterWorkspace from './components/PublishCenterWorkspace.vue';
import PipelineWorkspace from './components/PipelineWorkspace.vue';
import StandaloneWorkspace from './components/StandaloneWorkspace.vue';
import XaiDiscoveryWorkspace from './components/XaiDiscoveryWorkspace.vue';
import { usePipeline } from './composables/usePipeline';
import { usePublishCenter } from './composables/usePublishCenter';
import { useVerticalQueue } from './composables/useVerticalQueue';
import { useXaiTop10 } from './composables/useXaiTop10';
import { useStandalone } from './composables/useStandalone';

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

function getInitialActiveModule() {
  try {
    const savedModule = window.localStorage.getItem('comfy-panel-active-module');
    if (['pipeline', 'standalone', 'xaiTop10', 'publishCenter'].includes(savedModule)) {
      return savedModule;
    }
  } catch (_err) {
    // ignore storage read errors
  }
  return 'publishCenter';
}

const navItems = [
  { key: 'pipeline', kicker: 'Stage A-D', title: '🎬 AI 全链路混剪', desc: '内容指令、数字人渲染、导流混剪与成片交付。' },
  { key: 'standalone', kicker: 'Vertical Edit', title: '📱 竖屏后期合成', desc: '单条竖屏精修与批量竖屏队列的统一编排入口。' },
  { key: 'xaiTop10', kicker: 'Discovery', title: '📈 热门视频榜单', desc: '抓取、排序、筛选热点视频，并直送后续生产链路。' },
  { key: 'publishCenter', kicker: 'Distribution', title: '🚀 一键发布', desc: '平台接入、素材选择、任务创建与发布执行统一管理。' }
];

const activeModule = ref(getInitialActiveModule());
const themeMode = ref(getInitialThemeMode());
const pipeline = usePipeline();
const publishCenter = usePublishCenter();
const verticalQueue = useVerticalQueue();
const xaiTop10 = useXaiTop10();
const standalone = useStandalone();

const shellDescription = computed(() => '');

const currentModuleTitle = computed(() => navItems.find((item) => item.key === activeModule.value)?.title || '工作台');

const setThemeMode = (mode) => {
  themeMode.value = mode;
};

const handleToPublish = async () => {
  activeModule.value = "publishCenter";
  try {
    if (typeof publishCenter.fetchAssets === "function") {
      await publishCenter.fetchAssets(true);
    } else {
      await publishCenter.refresh();
    }
    const targetAsset = publishCenter.assets?.value?.find((a) => a.url === pipeline.finalVideoUrl.value);
    if (targetAsset && typeof publishCenter.selectAsset === "function") {
      publishCenter.selectAsset(targetAsset.id);
    }
  } catch (err) {
    console.warn("Failed to candidate video for publish", err);
  }
};

const handleToVertical = async () => {
  activeModule.value = "standalone";
  if (!pipeline.finalVideoUrl.value) return;
  try {
    const response = await fetch(pipeline.finalVideoUrl.value);
    const blob = await response.blob();
    const file = new File([blob], "output_final.mp4", { type: "video/mp4" });
    standalone.handleFile("video", file);
    // standalone.handleFile deals with name already
  } catch (err) {
    console.warn("Failed to load video for standalone", err);
  }
};

const handoffXaiToPipeline = (item) => {
  const accepted = pipeline.applyXaiMaterial(item);
  if (accepted) {
    activeModule.value = 'pipeline';
  }
};

onMounted(() => {
  pipeline.loadPresets();
  publishCenter.refresh();
  verticalQueue.refresh();
  xaiTop10.refresh();
  xaiTop10.loadConfig();
  standalone.loadQueue();
});

watch(activeModule, (value) => {
  publishCenter.stopAutoRefresh();
  xaiTop10.stopAutoRefresh();
  standalone.stopAutoRefresh();

  if (value === 'publishCenter') {
    publishCenter.startAutoRefresh();
    return;
  }
  if (value === 'xaiTop10') {
    xaiTop10.startAutoRefresh();
    return;
  }
  if (value === 'standalone') {
    standalone.startAutoRefresh();
  }
}, { immediate: true });

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

watch(activeModule, (value) => {
  try {
    window.localStorage.setItem('comfy-panel-active-module', value);
  } catch (_err) {
    // ignore storage write errors
  }
}, { immediate: true });
</script>

<style scoped>
.shell {
  max-width: 1820px;
  margin: 0 auto;
  padding: 28px 20px 44px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.header-kicker {
  color: #8ed1ff;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

h1 {
  margin: 10px 0 0;
  font-size: 32px;
  line-height: 1.12;
  color: var(--strong-text);
}

p {
  margin: 12px 0 0;
  max-width: 980px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
}

.status-card {
  display: inline-flex;
  align-items: center;
  gap: 18px;
  border-radius: 24px;
  border: 1px solid var(--line-soft);
  background: var(--console-bg);
  padding: 10px 14px;
  box-shadow: var(--shadow);
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  padding: 4px;
}

.theme-toggle button {
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  padding: 8px 14px;
  font-weight: 800;
  cursor: pointer;
}

.theme-toggle button.active {
  color: #fff;
  background: linear-gradient(135deg, var(--brand-a), var(--brand-b));
  box-shadow: 0 10px 24px rgba(109, 107, 255, 0.22);
}

.status-online {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ok);
  font-weight: 800;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--ok);
  box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.15);
}

.module-tag {
  display: grid;
  gap: 2px;
  padding-left: 16px;
  border-left: 1px solid var(--line-soft);
}

.module-tag span {
  font-size: 12px;
  color: var(--muted);
}

.module-tag strong {
  color: var(--strong-text);
  font-weight: 900;
}

.old-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  padding: 11px 16px;
  text-decoration: none;
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  color: var(--strong-text);
  font-weight: 700;
}

:deep(.workspace),
:deep(.panel),
:deep(.stat-card),
:deep(.health-card),
:deep(.job-card),
:deep(.preview-card),
:deep(.pick-card),
:deep(.platform-block),
:deep(.wechat-box),
:deep(.item-card),
:deep(.queue-box) {
  background: var(--card-bg) !important;
  border-color: var(--line-soft) !important;
  color: var(--text);
  box-shadow: var(--shadow);
}

:deep(.field),
:deep(.textarea),
:deep(.accounts),
:deep(select.field),
:deep(input.field) {
  background: var(--input-bg) !important;
  border-color: var(--input-border) !important;
  color: var(--text) !important;
}

:deep(.label),
:deep(.panel-title),
:deep(.workspace-kicker),
:deep(.job-meta),
:deep(.item-meta),
:deep(.health-meta),
:deep(.empty-state),
:deep(.stat-card span) {
  color: var(--muted) !important;
}

:deep(.stat-card strong),
:deep(.asset-name),
:deep(.nav-title),
:deep(.job-head strong),
:deep(.item-card strong),
:deep(.platform-head strong),
:deep(.wechat-head strong) {
  color: var(--strong-text) !important;
}

@media (max-width: 1100px) {
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
