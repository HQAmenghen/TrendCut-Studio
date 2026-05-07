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

    <StandaloneWorkspace
      v-if="activeModule === 'standalone'"
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
      :material-tasks="standalone.materialTasks.value"
      :material-tasks-loading="standalone.materialTasksLoading.value"
      @refresh="standalone.loadQueue"
      @refresh-material-tasks="standalone.loadMaterialTasks"
      @select-material-task="standalone.selectMaterialTask"
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
      @send-to-pipeline="handleSendToMaterialDriven"
    />

    <SystemSettingsWorkspace
      v-else-if="activeModule === 'systemSettings'"
    />

    <ReviewCenterWorkspace
      v-else-if="activeModule === 'reviewCenter'"
    />

    <AccountDashboardWorkspace
      v-else-if="activeModule === 'accountDashboard'"
    />

    <MaterialDrivenWorkspace
      v-else-if="activeModule === 'materialDriven'"
      :job-id="materialDriven.jobId.value"
      :current-step="materialDriven.currentStep.value"
      :progress="materialDriven.progress.value"
      :status-text="materialDriven.statusText.value"
      :plan-summary="materialDriven.planSummary.value"
      :narration-summary="materialDriven.narrationSummary.value"
      :narration-full-text="materialDriven.narrationFullText.value"
      :script-units="materialDriven.scriptUnits.value"
      :edit-plan="materialDriven.editPlan.value"
      :execution-plan="materialDriven.executionPlan.value"
      :final-video-url="materialDriven.finalVideoUrl.value"
      :error="materialDriven.error.value"
      :recent-logs="materialDriven.recentLogs.value"
      :uploading="materialDriven.uploading.value"
      :rebuilding-plan="materialDriven.rebuildingPlan.value"
      :rerendering-video="materialDriven.rerenderingVideo.value"
      :output-path="materialDriven.outputPath.value"
      
      :material-url="materialDriven.materialUrl.value"
      :material-source-label="materialDriven.materialSourceLabel.value"
      
      :audio-mode="materialDriven.audioMode.value"
      :image-mode="materialDriven.imageMode.value"
      :presets="materialDriven.presets.value"
      :gen="materialDriven.gen.value"
      :with-subtitles="materialDriven.withSubtitles.value"
      :comfy-test-loading="materialDriven.comfyTestLoading.value"
      :comfy-test-result="materialDriven.comfyTestResult.value"
      :active-duration-label="materialDriven.activeDurationLabel.value"
      :last-duration-label="materialDriven.lastDurationLabel.value"
      :step-duration-map="materialDriven.stepDurationMap.value"
      
      @update:audio-mode="materialDriven.audioMode.value = $event"
      @update:image-mode="materialDriven.imageMode.value = $event"
      @update:gen-field="(key, value) => materialDriven.gen.value[key] = value"
      @update:with-subtitles="materialDriven.withSubtitles.value = $event"
      
      @start-workflow="materialDriven.startWorkflow"
      @test-comfy-connection="materialDriven.testComfyConnection"
      @continue-workflow="materialDriven.continueWorkflow"
      @rebuild-plan="materialDriven.rebuildPlan"
      @rerender-video="materialDriven.rerenderVideo"
      @retry-step="materialDriven.retryStep"
      @reset-workflow="materialDriven.resetWorkflow"
      
      @to-publish="handleToPublish"
      @to-vertical="handleToVertical"
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
import StandaloneWorkspace from './components/StandaloneWorkspace.vue';
import XaiDiscoveryWorkspace from './components/XaiDiscoveryWorkspace.vue';
import SystemSettingsWorkspace from './components/SystemSettingsWorkspace.vue';
import ReviewCenterWorkspace from './components/ReviewCenterWorkspace.vue';
import AccountDashboardWorkspace from './components/AccountDashboardWorkspace.vue';
import MaterialDrivenWorkspace from './components/MaterialDrivenWorkspace.vue';
import { usePublishCenter } from './composables/usePublishCenter';
import { useVerticalQueue } from './composables/useVerticalQueue';
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

function getInitialActiveModule() {
  try {
    const savedModule = window.localStorage.getItem('comfy-panel-active-module');
    if (['standalone', 'xaiTop10', 'publishCenter', 'systemSettings', 'reviewCenter', 'accountDashboard', 'materialDriven'].includes(savedModule)) {
      return savedModule;
    }
  } catch (_err) {
    // ignore storage read errors
  }
  return 'materialDriven';
}

const navItems = [
  { key: 'materialDriven', kicker: 'Material First', title: '🎬 热点转视频生产线', desc: '热门转入、脚本编排、数字人口播、静音素材插片和发布衔接的一体化入口。' },
  { key: 'standalone', kicker: 'Vertical Edit', title: '📱 竖屏后期合成', desc: '单条竖屏精修与批量竖屏队列的统一编排入口。' },
  { key: 'xaiTop10', kicker: 'Discovery', title: '📈 热门视频榜单', desc: '抓取、排序、筛选热点视频，并一键送入自动生产链路。' },
  { key: 'reviewCenter', kicker: 'Quality', title: '🎯 AI 审核中心', desc: '视频质量审核、评分管理与修复建议。' },
  { key: 'publishCenter', kicker: 'Distribution', title: '🚀 一键发布', desc: '平台接入、素材选择、任务创建与发布执行统一管理。' },
  { key: 'accountDashboard', kicker: 'Monitoring', title: '📊 账号看板', desc: '监控账号登录状态、任务统计和最近失败情况。' },
  { key: 'systemSettings', kicker: 'Ops', title: '⚙️ 系统设置', desc: '飞书通知、登录检测与系统级配置管理。' }
];

const activeModule = ref(getInitialActiveModule());
const themeMode = ref(getInitialThemeMode());
const autoPublishRoutedJobId = ref('');
const publishCenter = usePublishCenter();
const verticalQueue = useVerticalQueue();
const xaiTop10 = useXaiTop10();
const standalone = useStandalone();
const materialDriven = useMaterialDriven();

const shellDescription = computed(() => '');

const currentModuleTitle = computed(() => navItems.find((item) => item.key === activeModule.value)?.title || '工作台');

const setThemeMode = (mode) => {
  themeMode.value = mode;
};

const isMaterialDrivenReadyForPublish = () => {
  return Boolean(materialDriven.finalVideoUrl.value);
};

const handleToPublish = async ({ auto = false } = {}) => {
  activeModule.value = "publishCenter";
  try {
    if (typeof publishCenter.fetchAssets === "function") {
      await publishCenter.fetchAssets(true);
    } else {
      await publishCenter.refresh();
    }
    const targetAsset = publishCenter.assets?.value?.find((a) => a.url === materialDriven.finalVideoUrl.value);
    if (targetAsset && typeof publishCenter.selectAsset === "function") {
      await publishCenter.selectAsset(targetAsset.id);
      if (auto) {
        autoPublishRoutedJobId.value = materialDriven.jobId.value || '';
      }
    }
  } catch (err) {
    console.warn("Failed to candidate video for publish", err);
  }
};

const handleToVertical = async () => {
  activeModule.value = "standalone";
  if (!materialDriven.finalVideoUrl.value) return;
  try {
    standalone.form.value.title = '';

    // 1. 下载视频文件
    const response = await fetch(materialDriven.finalVideoUrl.value);
    const blob = await response.blob();
    const file = new File([blob], "output_final.mp4", { type: "video/mp4" });
    standalone.handleFile("video", file);

    // 2. 尝试同步字幕和标题 (如果可用)
    const projectDir = materialDriven.outputPath.value;
    if (projectDir) {
      const subsUrl = `/projects/${projectDir}/subtitles.json`;
      const aimanUrl = `/projects/${projectDir}/aiman_subtitles.json`;
      const avatarSegmentsUrl = `/projects/${projectDir}/avatar_segments.json`;
      const planUrl = `/projects/${projectDir}/execution_plan.json`;
      
      try {
        let finalSubs = null;
        
        // 优先级 1: execution_plan.json（最终成片时间线）
        console.log(`[Vertical Sync] 正在尝试从 execution_plan.json 恢复字幕...`);
        const planRes = await fetch(planUrl);
        if (planRes.ok) {
          const blocks = await planRes.json();
          if (Array.isArray(blocks)) {
            const mapped = [];
            let currentSub = null;

            for (const block of blocks) {
              const zhText = (block.subtitle_zh || block.zh_text || block.subtitle_text || block.text || "").trim();
              const enText = (block.subtitle_en || block.en_text || block.en || block.english || "").trim();
              if (!zhText && !enText) continue;

              const start = parseFloat(block.start_time || 0);
              const end = parseFloat(block.end_time || 0);
              if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

              if (currentSub && currentSub.zh === zhText) {
                currentSub.time[1] = Math.max(currentSub.time[1], end);
                if (!currentSub.en && enText) currentSub.en = enText;
              } else {
                if (currentSub) mapped.push(currentSub);
                currentSub = {
                  time: [start, end],
                  zh: zhText,
                  en: enText || undefined
                };
              }
            }
            if (currentSub) mapped.push(currentSub);

            if (mapped.length > 0) {
              finalSubs = mapped;
              console.log(`[Vertical Sync] 成功从 execution_plan.json 恢复了 ${mapped.length} 条最终口播字幕`);
            }
          }
        } else {
          console.warn(`[Vertical Sync] 无法加载 execution_plan.json: ${planRes.status}`);
        }

        // 优先级 2: avatar_segments.json（数字人口播切段）
        if (!finalSubs) {
          const avatarSegmentsRes = await fetch(avatarSegmentsUrl);
          if (avatarSegmentsRes.ok) {
            const avatarPayload = await avatarSegmentsRes.json();
            const segments = Array.isArray(avatarPayload?.segments) ? avatarPayload.segments : [];
            const mapped = segments
              .map((segment) => {
                const start = parseFloat(segment.start || 0);
                const end = parseFloat(segment.end || 0);
                const zh = String(segment.text || '').trim();
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !zh) {
                  return null;
                }
                return {
                  time: [start, end],
                  zh
                };
              })
              .filter(Boolean);
            if (mapped.length > 0) {
              finalSubs = mapped;
              console.log(`[Vertical Sync] 成功从 avatar_segments.json 恢复了 ${mapped.length} 条数字人口播字幕`);
            }
          }
        }

        // 优先级 3: aiman_subtitles.json（如果存在已对齐的数字人字幕）
        if (!finalSubs) {
          const aimanRes = await fetch(aimanUrl);
          if (aimanRes.ok) {
            const aimanData = await aimanRes.json();
            if (Array.isArray(aimanData) && aimanData.length > 0) {
              finalSubs = aimanData;
              console.log(`[Vertical Sync] 成功从 aiman_subtitles.json 加载了 ${finalSubs.length} 条双语字幕`);
            }
          }
        }

        // 优先级 4: raw subtitles.json（最后兜底）
        if (!finalSubs) {
          const subsRes = await fetch(subsUrl);
          if (subsRes.ok) {
            const subsData = await subsRes.json();
            if (Array.isArray(subsData) && subsData.length > 0) {
              finalSubs = subsData;
              console.warn(`[Vertical Sync] 仅回退使用 subtitles.json，可能包含素材原声字幕`);
            }
          }
        }

        if (finalSubs && finalSubs.length > 0) {
          standalone.form.value.subtitlesPayload = JSON.stringify(finalSubs);
          standalone.form.value.useASR = false; 
        } else {
          console.warn(`[Vertical Sync] 未发现有效的结构化字幕文件，将启用 AI 自动打轴提取中英双语...`);
          standalone.form.value.useASR = true;
          standalone.form.value.subtitlesPayload = "";
        }
      } catch (_e) {
        console.warn("Could not fetch pre-existing subtitles or execution plan", _e);
      }
    }
    // 3. 同步标题、上下文与口播脚本
    // 传输原始素材信息作为背景
    if (materialDriven.materialSourceTitle.value || materialDriven.materialSourceBody.value) {
      standalone.form.value.context = JSON.stringify({
        title: materialDriven.materialSourceTitle.value,
        body: materialDriven.materialSourceBody.value
      });
    }

    // 传输口播脚本
    if (materialDriven.narrationFullText.value) {
      standalone.form.value.script = materialDriven.narrationFullText.value;
    }
  } catch (err) {
    console.warn("Failed to load video or metadata for standalone", err);
  }
};

const handleSendToMaterialDriven = (item) => {
  const accepted = materialDriven.applyXaiMaterial(item);
  if (accepted) {
    activeModule.value = 'materialDriven';
  }
};

const handleReviewToPublish = async (event) => {
  const detail = event?.detail || {};
  activeModule.value = 'publishCenter';
  try {
    if (typeof publishCenter.fetchAssets === 'function') {
      await publishCenter.fetchAssets(true);
    } else {
      await publishCenter.refresh();
    }
    const targetAsset = publishCenter.assets?.value?.find((asset) =>
      (detail.assetId && asset.id === detail.assetId) ||
      (detail.path && asset.path === detail.path) ||
      (detail.url && asset.url?.includes(detail.url))
    );
    if (targetAsset && typeof publishCenter.selectAsset === 'function') {
      await publishCenter.selectAsset(targetAsset.id);
    }
  } catch (err) {
    console.warn('Failed to route reviewed asset to publish center', err);
  }
};

onMounted(() => {
  publishCenter.refresh();
  verticalQueue.refresh();
  xaiTop10.refresh();
  xaiTop10.loadConfig();
  standalone.loadQueue();
  standalone.loadMaterialTasks(true);
  materialDriven.loadPresets();
  materialDriven.restoreActiveJob();
  window.addEventListener('review-center:to-publish', handleReviewToPublish);
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

watch(
  [
    () => materialDriven.jobId.value,
    () => materialDriven.finalVideoUrl.value
  ],
  async ([jobId]) => {
    if (!jobId) return;
    if (!isMaterialDrivenReadyForPublish()) return;
    if (autoPublishRoutedJobId.value === jobId) return;
    await handleToPublish({ auto: true });
  },
  { deep: true }
);

onBeforeUnmount(() => {
  publishCenter.stopAutoRefresh();
  xaiTop10.stopAutoRefresh();
  standalone.stopAutoRefresh();
  window.removeEventListener('review-center:to-publish', handleReviewToPublish);
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
