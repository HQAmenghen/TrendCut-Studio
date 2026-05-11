<template>
  <section class="material-driven-page">
    <MaterialDrivenHero
      :job-id="jobId"
      :final-video-url="finalVideoUrl"
      :plan-summary="planSummary"
      :current-step-info="currentStepInfo"
    />

    <MaterialDrivenWorkflowStatus
      v-if="jobId"
      :steps="steps"
      :current-step="currentStep"
      :progress="progress"
      :status-text="statusText"
      :current-step-info="currentStepInfo"
      :final-video-url="finalVideoUrl"
      :active-duration-label="activeDurationLabel"
      :last-duration-label="lastDurationLabel"
      :source-bridge-label="sourceBridgeLabel"
      :script-unit-count="scriptUnitCount"
      :ready-for-publish="readyForPublish"
      :step-duration-map="stepDurationMap"
    />

    <MaterialDrivenSetupPanel
      v-if="!jobId"
      :uploading="uploading"
      :audio-mode="audioMode"
      :image-mode="imageMode"
      :presets="presets"
      :gen="gen"
      :with-subtitles="withSubtitles"
      :comfy-test-loading="comfyTestLoading"
      :comfy-test-result="comfyTestResult"
      :material-url="materialUrl"
      :material-source-label="materialSourceLabel"
      @start-workflow="emit('start-workflow', $event)"
      @reset-workflow="resetWorkflow"
      @update:audio-mode="emit('update:audio-mode', $event)"
      @update:image-mode="emit('update:image-mode', $event)"
      @update:gen-field="(...args) => emit('update:gen-field', ...args)"
      @update:with-subtitles="emit('update:with-subtitles', $event)"
      @test-comfy-connection="emit('test-comfy-connection')"
    />

    <div v-else class="workspace-grid">
      <div class="workspace-main">
        <MaterialDrivenNodeConfigPanel
          v-if="currentStep === 6 || error || showManualAvatarPrompt"
          :current-step="currentStep"
          :gen="gen"
          :comfy-test-loading="comfyTestLoading"
          :comfy-test-result="comfyTestResult"
          @update:gen-field="(...args) => emit('update:gen-field', ...args)"
          @test-comfy-connection="emit('test-comfy-connection')"
        />

        <MaterialDrivenPlanPreview
          :plan-summary="planSummary"
          :narration-summary="narrationSummary"
          :has-narration-preview="hasNarrationPreview"
          :narration-text-to-show="narrationTextToShow"
          :has-edit-plan="hasEditPlan"
          :has-execution-plan="hasExecutionPlan"
          :script-unit-count="scriptUnitCount"
          :edit-plan-block-count="editPlanBlockCount"
          :execution-plan-segment-count="executionPlanSegmentCount"
          :edit-plan="editPlan"
          :edit-plan-pretty="editPlanPretty"
          :execution-plan-pretty="executionPlanPretty"
        />

        <MaterialDrivenTimelinePanel
          :has-display-timeline-plan="hasDisplayTimelinePlan"
          :display-timeline-plan="displayTimelinePlan"
          :timeline-rows="timelineRows"
          :material-shot-count="materialShotCount"
          :aiman-shot-count="aimanShotCount"
          :cutaway-shot-count="cutawayShotCount"
          :display-timeline-pretty="displayTimelinePretty"
          :timeline-total-duration="timelineTotalDuration"
        />

        <MaterialDrivenResultActions
          :show-manual-avatar-prompt="showManualAvatarPrompt"
          :output-path="outputPath"
          :rebuilding-plan="rebuildingPlan"
          :rerendering-video="rerenderingVideo"
          :recent-logs="recentLogs"
          :final-video-url="finalVideoUrl"
          :ready-for-publish="readyForPublish"
          :script-unit-count="scriptUnitCount"
          :execution-plan-segment-count="executionPlanSegmentCount"
          :error="error"
          :current-step="currentStep"
          @continue-workflow="continueWorkflow"
          @rebuild-plan="rebuildPlan"
          @rerender-video="rerenderVideo"
          @retry-step="emit('retry-step', $event)"
          @reset-workflow="resetWorkflow"
          @to-vertical="emit('to-vertical')"
          @to-publish="emit('to-publish')"
        />
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import MaterialDrivenHero from './materialDriven/MaterialDrivenHero.vue';
import MaterialDrivenWorkflowStatus from './materialDriven/MaterialDrivenWorkflowStatus.vue';
import MaterialDrivenSetupPanel from './materialDriven/MaterialDrivenSetupPanel.vue';
import MaterialDrivenNodeConfigPanel from './materialDriven/MaterialDrivenNodeConfigPanel.vue';
import MaterialDrivenPlanPreview from './materialDriven/MaterialDrivenPlanPreview.vue';
import MaterialDrivenTimelinePanel from './materialDriven/MaterialDrivenTimelinePanel.vue';
import MaterialDrivenResultActions from './materialDriven/MaterialDrivenResultActions.vue';

const props = defineProps({
  jobId: String,
  currentStep: Number,
  progress: Number,
  statusText: String,
  planSummary: Object,
  narrationSummary: Object,
  narrationFullText: String,
  scriptUnits: Array,
  editPlan: Object,
  executionPlan: [Object, Array],
  finalVideoUrl: String,
  error: String,
  recentLogs: Array,
  uploading: Boolean,
  rebuildingPlan: Boolean,
  rerenderingVideo: Boolean,
  outputPath: String,
  audioMode: String,
  imageMode: String,
  presets: Object,
  gen: Object,
  withSubtitles: Boolean,
  comfyTestLoading: Boolean,
  comfyTestResult: Object,
  activeDurationLabel: String,
  lastDurationLabel: String,
  materialUrl: String,
  materialSourceLabel: String,
  stepDurationMap: Object
});

const emit = defineEmits([
  'start-workflow',
  'continue-workflow',
  'rebuild-plan',
  'rerender-video',
  'retry-step',
  'reset-workflow',
  'update:audio-mode',
  'update:image-mode',
  'update:gen-field',
  'update:with-subtitles',
  'test-comfy-connection',
  'to-publish',
  'to-vertical'
]);

const steps = [
  { id: 1, title: '接入素材', desc: '本地上传或热门转入' },
  { id: 2, title: '理解内容', desc: 'ASR + OCR + 重点分析' },
  { id: 3, title: '匹配素材', desc: '切片、评分和镜头候选' },
  { id: 4, title: '生成计划', desc: '脚本、edit plan、execution plan' },
  { id: 5, title: '口播成稿', desc: '生成整段数字人口播稿' },
  { id: 6, title: '数字人生成', desc: '生成整段数字人视频' },
  { id: 7, title: '渲染导出', desc: '自动渲染并输出最终成片' }
];

const currentStepInfo = computed(() => {
  if (props.currentStep >= 7 || props.finalVideoUrl) {
    return { id: 8, title: '制作完成', desc: '成片已输出，可直接转入发布链路' };
  }
  return steps.find(s => s.id === props.currentStep) || steps[0];
});

const narrationTextToShow = computed(() => {
  return String(props.narrationFullText || props.narrationSummary?.fullText || props.narrationSummary?.full_text || '').trim();
});
const hasNarrationPreview = computed(() => Boolean(props.narrationSummary || narrationTextToShow.value));

const executionPlanSegments = computed(() => {
  if (Array.isArray(props.executionPlan)) return props.executionPlan;
  if (Array.isArray(props.executionPlan?.segments)) return props.executionPlan.segments;
  return [];
});

const scriptUnitCount = computed(() => Array.isArray(props.scriptUnits) ? props.scriptUnits.length : 0);
const hasEditPlan = computed(() => !!props.editPlan && Array.isArray(props.editPlan?.blocks));
const hasExecutionPlan = computed(() => executionPlanSegments.value.length > 0);
const editPlanBlockCount = computed(() => hasEditPlan.value ? props.editPlan.blocks.length : 0);
const executionPlanSegmentCount = computed(() => executionPlanSegments.value.length);
const readyForPublish = computed(() => Boolean(props.finalVideoUrl));
const editPlanPretty = computed(() => hasEditPlan.value ? JSON.stringify(props.editPlan, null, 2) : '{}');
const executionPlanPretty = computed(() => hasExecutionPlan.value ? JSON.stringify(props.executionPlan, null, 2) : '{}');
const sourceBridgeLabel = computed(() => {
  if (!props.materialUrl) return '本地上传';
  return props.materialSourceLabel ? `热门转入：${props.materialSourceLabel}` : '热门素材直送';
});

const displayTimelinePlan = computed(() => executionPlanSegments.value);
const hasDisplayTimelinePlan = computed(() => displayTimelinePlan.value.length > 0);
const materialShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.video_source || '').includes('material')).length
    : 0
);
const aimanShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.video_source || '').includes('aiman')).length
    : 0
);
const cutawayShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.type || '') === 'material_cutaway').length
    : 0
);
const displayTimelinePretty = computed(() =>
  hasDisplayTimelinePlan.value ? JSON.stringify(displayTimelinePlan.value, null, 2) : '[]'
);
const timelineTotalDuration = computed(() => {
  if (!hasDisplayTimelinePlan.value) return 0;
  const maxEnd = Math.max(
    ...displayTimelinePlan.value.map((seg) => Number(seg?.end_time ?? seg?.end ?? 0) || 0),
    0
  );
  return maxEnd;
});
const timelineRows = computed(() => {
  if (!hasDisplayTimelinePlan.value) return [];
  return displayTimelinePlan.value.map((seg) => {
    const start = Number(seg?.start_time ?? seg?.start ?? 0) || 0;
    const end = Number(seg?.end_time ?? seg?.end ?? start) || start;
    const duration = Math.max(0, end - start);
    const videoSource = String(seg?.video_source || '');
    const isCutaway = String(seg?.type || '') === 'material_cutaway';
    return {
      start,
      end,
      duration,
      videoSourceLabel: isCutaway
        ? '静音素材插片'
        : (videoSource.includes('material') ? '素材画面' : '数字人画面'),
      videoSourceClass: isCutaway
        ? 'source-pip'
        : (videoSource.includes('material') ? 'source-material' : 'source-aiman'),
      audioSourceLabel: '数字人口播',
      audioSourceClass: 'source-main'
    };
  });
});

const showManualAvatarPrompt = computed(() => {
  const text = String(props.statusText || '');
  return props.currentStep === 6 && /等待数字人素材|手动生成|aiman\.mp4/i.test(text);
});

const continueWorkflow = () => {
  emit('continue-workflow');
};

const rebuildPlan = () => {
  emit('rebuild-plan');
};

const rerenderVideo = () => {
  emit('rerender-video');
};

const resetWorkflow = () => {
  emit('reset-workflow');
};
</script>

<style>
/* Inject unified layout variables */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.config-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.avatar-config-block {
  display: flex;
  flex-direction: column;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 16px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.checkbox-row:hover {
  border-color: var(--brand-a);
}

.checkbox-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--brand-a);
}

.checkbox-row div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-row strong {
  display: block;
  font-size: 14px;
  color: var(--strong-text);
  margin-bottom: 2px;
}

.checkbox-row p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}


/* Glassmorphism Hero Panel */
.hero-panel {
  background: linear-gradient(135deg, rgba(30, 30, 46, 0.8) 0%, rgba(20, 20, 32, 0.8) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  position: relative;
  overflow: hidden;
}

.hero-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(109, 107, 255, 0.5), transparent);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: stretch;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
}

.hero-copy h3 {
  font-size: 28px;
  color: #fff;
  margin: 0 0 12px 0;
  font-weight: 800;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-copy p {
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  margin: 0;
  font-size: 15px;
}

.flow-pills {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.flow-pill {
  padding: 6px 16px;
  border-radius: 99px;
  background: rgba(109, 107, 255, 0.15);
  border: 1px solid rgba(109, 107, 255, 0.3);
  color: #8ed1ff;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(109, 107, 255, 0.1);
}

.hero-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.module-summary-card {
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-summary-card span {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.module-summary-card strong {
  font-size: 20px;
  color: var(--strong-text);
  font-weight: 800;
}

.module-summary-card p {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  line-height: 1.4;
}

/* Base Upload and Setup Grid Layouts */
.workspace-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

.workspace-main {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.builder-card {
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.builder-card-header {
  padding: 24px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--card-subtle-bg);
}

.builder-card-header h4 {
  margin: 0 0 8px 0;
  font-size: 18px;
  color: var(--strong-text);
}

.builder-card-header p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.builder-card-body {
  padding: 24px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.upload-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.config-cluster {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-cluster-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--strong-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.quick-tip-card {
  padding: 16px;
  background: rgba(109, 107, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(109, 107, 255, 0.2);
}

.quick-tip-card strong {
  display: block;
  color: #a5b4fc;
  margin-bottom: 4px;
}

.quick-tip-card p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  color: var(--strong-text);
  font-size: 14px;
  font-weight: 600;
}

.input-dark {
  width: 100%;
  padding: 12px 16px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  border-radius: 8px;
  outline: none;
  transition: all 0.2s;
}

.input-dark:focus {
  border-color: var(--brand-a);
  background: var(--card-subtle-bg);
}

.muted-copy {
  margin: 8px 0 0 0;
  color: var(--muted);
  font-size: 12px;
}

.inline-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.inline-result {
  font-size: 12px;
  font-weight: 700;
}

.result-success {
  color: #22c55e;
}

.result-error {
  color: #ef4444;
}

/* Button Styles */
.primary-btn, .btn-success {
  background: linear-gradient(135deg, var(--brand-a), var(--brand-b));
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  text-decoration: none;
  box-shadow: 0 4px 12px rgba(109, 107, 255, 0.3);
}

.btn-success {
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.primary-btn:hover, .btn-success:hover {
  transform: translateY(-2px);
  filter: brightness(1.1);
  box-shadow: 0 6px 16px rgba(109, 107, 255, 0.4);
}

.ghost-btn {
  background: transparent;
  color: var(--brand-a);
  border: 1px solid rgba(109, 107, 255, 0.3);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.ghost-btn:hover {
  background: rgba(109, 107, 255, 0.1);
  border-color: var(--brand-a);
}

.full-btn {
  width: 100%;
}

.helper-btn {
  padding: 8px 16px;
  font-size: 13px;
  align-self: flex-start;
}

.section-kicker {
  color: var(--brand-a);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-weight: 800;
  margin-bottom: 8px;
}

/* Redesign 7-step visualization with glowing active states */
.workflow-panel {
  background: var(--card-bg);
  border-radius: 20px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: var(--shadow);
}

.linkage-panel {
  margin-top: 18px;
}

.workflow-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.workflow-badge {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(109, 107, 255, 0.15);
  color: #a5b4fc;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  margin-right: 12px;
  border: 1px solid rgba(109, 107, 255, 0.3);
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.workflow-stage {
  padding: 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.workflow-stage.stage-completed {
  opacity: 0.6;
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.02);
}

.workflow-stage.stage-pending {
  opacity: 0.4;
}

.workflow-stage.stage-running {
  border-color: var(--brand-a);
  background: linear-gradient(180deg, rgba(109, 107, 255, 0.15) 0%, rgba(109, 107, 255, 0.02) 100%);
  box-shadow: 0 8px 24px rgba(109, 107, 255, 0.2), inset 0 0 0 1px var(--brand-a);
  transform: translateY(-4px);
  position: relative;
  opacity: 1;
}

.workflow-stage.stage-running::before {
  content: '';
  position: absolute;
  top: -1px; left: 20%; right: 20%; height: 2px;
  background: linear-gradient(90deg, transparent, #8ed1ff, transparent);
  box-shadow: 0 0 10px #8ed1ff;
  border-radius: 2px;
}

.workflow-stage-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-stage-top strong {
  color: var(--strong-text);
  font-size: 15px;
}

.workflow-stage-state {
  font-size: 12px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
}

.stage-running .workflow-stage-state {
  color: #8ed1ff;
  background: rgba(142, 209, 255, 0.1);
  font-weight: 700;
}

/* Step duration badge */
.workflow-stage-duration {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.stage-completed .workflow-stage-duration {
  color: #22c55e;
}

.stage-running .workflow-stage-duration {
  color: #8ed1ff;
}

.duration-icon {
  font-size: 11px;
  opacity: 0.8;
}

.duration-value {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.duration-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8ed1ff;
  margin-left: 2px;
  animation: live-pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.6); }
}

/* Premium Upload Card */
.upload-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  border: 2px dashed rgba(109, 107, 255, 0.3);
  border-radius: 20px;
  background: rgba(109, 107, 255, 0.02);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.upload-card.external-source-card {
  cursor: default;
  border-style: solid;
  border-color: var(--brand-a);
  background: rgba(109, 107, 255, 0.05);
}

.upload-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(109, 107, 255, 0.1) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
}

.upload-card:hover {
  border-color: var(--brand-a);
  background: rgba(109, 107, 255, 0.05);
  box-shadow: 0 12px 32px rgba(109, 107, 255, 0.15);
  transform: translateY(-2px);
}

.upload-card:hover::after {
  opacity: 1;
}

.upload-icon {
  font-size: 48px;
  margin-bottom: 4px;
  filter: drop-shadow(0 8px 16px rgba(109, 107, 255, 0.4));
  transform: scale(1);
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.upload-card:hover .upload-icon {
  transform: scale(1.1) rotate(-5deg);
}

.upload-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--strong-text);
  z-index: 1;
}

.upload-sub {
  font-size: 13px;
  color: var(--muted);
  z-index: 1;
}

/* Modern Dashboards for Summaries */
.panel {
  border-radius: 20px;
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  margin-bottom: 24px;
}

.panel-header {
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-weight: 700;
  font-size: 15px;
  color: var(--strong-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-body {
  padding: 24px;
}

.mini-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.mini-status-card {
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.2s;
}

.mini-status-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.03);
}

.mini-status-card span {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.mini-status-card strong {
  font-size: 26px;
  font-weight: 800;
  color: var(--strong-text);
}

/* Polished Alert and Log Panels */
.warning-panel {
  border-color: rgba(251, 191, 36, 0.3);
  box-shadow: 0 8px 24px rgba(251, 191, 36, 0.1);
}

.warning-panel .panel-header {
  background: rgba(251, 191, 36, 0.1);
  color: #fcd34d;
}

.success-panel {
  border-color: rgba(34, 197, 94, 0.3);
  box-shadow: 0 8px 24px rgba(34, 197, 94, 0.1);
}

.success-panel .panel-header {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
}

.error-panel {
  border-color: rgba(239, 68, 68, 0.3);
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.1);
}

.error-panel .panel-header {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
}

.log-container {
  max-height: 300px;
  overflow-y: auto;
  background: #090a0f;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.3);
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 13px;
}

.log-line {
  display: flex;
  gap: 16px;
  padding: 6px 8px;
  border-radius: 6px;
  margin-bottom: 4px;
  transition: background 0.2s;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.05);
}

.log-time {
  color: #6366f1;
  font-weight: 600;
  flex-shrink: 0;
}

.log-message {
  color: #e2e8f0;
}

.log-line.log-error .log-message { color: #ef4444; }
.log-line.log-success .log-message { color: #22c55e; }
.log-line.log-warn .log-message { color: #f59e0b; }

/* Progress Banner */
.progress-banner {
  position: relative;
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
  margin: 20px 0 24px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-a), #8ed1ff);
  box-shadow: 0 0 10px rgba(109, 107, 255, 0.5);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-label {
  position: absolute;
  top: -26px;
  right: 0;
  font-size: 13px;
  font-weight: 800;
  color: var(--brand-a);
  text-shadow: 0 2px 8px rgba(109, 107, 255, 0.4);
}


.instruction-list {
  margin: 16px 0;
  padding-left: 24px;
  line-height: 2;
  color: var(--text);
}

.instruction-list code {
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #fcd34d;
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.narration-text {
  padding: 16px;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  line-height: 1.8;
}

.narration-text strong {
  display: block;
  margin-bottom: 12px;
  color: var(--strong-text);
  font-size: 15px;
}

.narration-text p {
  margin: 0;
  color: var(--text);
  font-size: 14px;
}

.compact-card {
  gap: 8px;
}

.json-block {
  margin: 0;
  padding: 14px;
  background: #0b1020;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  color: #dbeafe;
  max-height: 380px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.timeline-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--card-subtle-bg);
}

.timeline-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.timeline-meta strong {
  color: var(--strong-text);
}

.timeline-track {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  overflow: hidden;
}

.timeline-bar {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #6366f1);
}

.source-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
}

.source-material {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  border-color: rgba(22, 163, 74, 0.25);
}

.source-aiman {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.25);
}

.source-broll {
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.25);
}

.source-main {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.14);
  border-color: rgba(124, 58, 237, 0.25);
}

.source-pip {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.14);
  border-color: rgba(20, 184, 166, 0.25);
}

.result-video {
  width: 100%;
  max-width: 800px;
  border-radius: 16px;
  margin: 0 auto;
  display: block;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.action-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 24px;
  flex-wrap: wrap;
}

.error-message {
  padding: 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  color: #fca5a5;
  margin: 0;
  font-weight: 500;
}

/* Avatar config nested components */
.panel-header-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.tab-switch {
  display: flex;
  gap: 12px;
  font-size: 12px;
}
.tab-active {
  color: #a855f7;
  border-bottom: 2px solid #a855f7;
  cursor: pointer;
}
.tab-inactive {
  color: #718096;
  cursor: pointer;
}
.preset-list {
  display: grid;
  gap: 8px;
}
.audio-list {
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}
.preset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--input-border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.preset-selected {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.1);
  box-shadow: 0 0 0 1px #a855f7;
}
.image-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.image-item {
  border: 1px solid var(--input-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--input-bg);
  cursor: pointer;
  padding: 0;
}
.image-item img {
  width: 100%;
  height: 88px;
  object-fit: cover;
  display: block;
}
.upload-height {
  height: 128px;
}
.upload-choice.compact {
  min-height: auto;
}
.panel-header {
  display: flex;
  align-items: center;
  font-weight: 700;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
}
.progress-detail-panel {
  padding: 16px;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.advanced-block {
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--input-bg);
  overflow: hidden;
}
.advanced-block summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 16px;
  color: var(--strong-text);
  font-weight: 700;
  font-size: 13px;
}
.advanced-body {
  padding: 0 16px 16px;
}
.mt-0 { margin-top: 0; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.shrink-none { flex-shrink: 0; }

/* New Persistent Node Config Styles */
.node-config-panel {
  border: 1px solid var(--line-soft);
  background: var(--card-bg);
  box-shadow: var(--shadow-lg);
}

.highlight-panel {
  border: 1px solid rgba(168, 85, 247, 0.3);
  background: rgba(168, 85, 247, 0.03);
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-with-tools {
  display: flex;
  gap: 12px;
  align-items: center;
}

.alert-bar {
  padding: 10px 14px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
  font-size: 13px;
  color: var(--muted);
  border-left: 3px solid var(--brand-a);
}

.test-feedback {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.ml-1 { margin-left: 4px; }

</style>
