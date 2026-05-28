<template>
  <GlassPanel class="production-panel" variant="soft">
    <div class="panel-heading compact-heading">
      <div>
        <span class="panel-kicker">Production</span>
        <h3>生产进度</h3>
      </div>
      <button
        v-if="hasRecoverableFailure"
        type="button"
        class="danger-button"
        @click="$emit('retry-step')"
      >
        <RotateCcw class="icon-sm" aria-hidden="true" />
        重试失败步骤
      </button>
    </div>

    <div class="pipeline-status-card">
      <div
        class="pipeline-orb"
        :class="{ active: isActive, complete: finalVideoReady }"
        :style="{ '--pipeline-progress': progressWidth }"
        aria-hidden="true"
      >
        <strong>{{ finalVideoReady ? 100 : progress }}</strong>
        <span>%</span>
      </div>
      <div class="pipeline-copy">
        <div class="pipeline-copy-heading">
          <strong>{{ currentStepLabel }}</strong>
          <span class="state-chip" :class="{ on: isActive }">{{ statusBadge }}</span>
        </div>
        <p>{{ statusDescription }}</p>
        <div class="pipeline-metrics" aria-label="生产状态指标">
          <span><Gauge class="icon-sm" aria-hidden="true" />{{ progressLabel }}</span>
          <span><Clock class="icon-sm" aria-hidden="true" />{{ durationLabel }}</span>
          <span><Layers class="icon-sm" aria-hidden="true" />{{ stepSummary }}</span>
        </div>
      </div>
    </div>

    <div class="pipeline-progress" role="progressbar" :aria-valuenow="finalVideoReady ? 100 : progress" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: progressWidth }"></span>
    </div>

    <div class="pipeline-step-pills" aria-label="生产链路预览">
      <span
        v-for="step in steps"
        :key="step.id"
        :class="getStepClass(step.id)"
      >
        <i>{{ step.id }}</i>
        <strong>{{ step.title }}</strong>
      </span>
    </div>
  </GlassPanel>
</template>

<script setup>
import { computed } from 'vue';
import { Clock, Gauge, Layers, RotateCcw } from 'lucide-vue-next';
import GlassPanel from './GlassPanel.vue';

const props = defineProps({
  steps: {
    type: Array,
    required: true
  },
  currentStep: {
    type: Number,
    default: 0
  },
  progress: {
    type: Number,
    default: 0
  },
  progressLabel: {
    type: String,
    required: true
  },
  progressWidth: {
    type: String,
    required: true
  },
  currentStepLabel: {
    type: String,
    required: true
  },
  durationLabel: {
    type: String,
    required: true
  },
  statusText: {
    type: String,
    default: ''
  },
  jobActive: {
    type: Boolean,
    default: false
  },
  finalVideoReady: {
    type: Boolean,
    default: false
  },
  hasRecoverableFailure: {
    type: Boolean,
    default: false
  },
  errorText: {
    type: String,
    default: ''
  }
});

defineEmits(['retry-step']);

const isActive = computed(() => Boolean(props.jobActive || props.finalVideoReady));
const statusBadge = computed(() => {
  if (props.finalVideoReady) return '已完成';
  if (props.jobActive) return '执行中';
  return '待启动';
});
const statusDescription = computed(() => (
  props.statusText || (props.finalVideoReady ? '成片已生成，可以进入发布流程' : '选择素材后，系统会按链路自动推进生产')
));
const stepSummary = computed(() => (props.currentStep ? `第 ${props.currentStep} / ${props.steps.length} 步` : `${props.steps.length} 步链路`));

const getStepClass = (stepId) => {
  if (props.finalVideoReady || props.currentStep > stepId) return 'complete';
  if (props.errorText && props.currentStep === stepId) return 'danger';
  if (props.currentStep === stepId) return 'active';
  return '';
};
</script>

<style scoped>
.production-panel {
  display: grid;
  gap: 12px;
  padding: 16px;
  color: var(--text);
  opacity: 1 !important;
}

.production-panel::after {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 74px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--brand-a) 8%, transparent), transparent);
  opacity: 0.38;
  pointer-events: none;
}

:global(body.theme-light .production-panel)::after {
  opacity: 0.16;
}

.production-panel > * {
  position: relative;
  z-index: 1;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 850;
}

h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 16px;
  line-height: 1.25;
}

.pipeline-status-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
    var(--glass-panel);
  padding: 12px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

:global(body.theme-light .pipeline-status-card),
:global(body.theme-light .pipeline-metrics span),
:global(body.theme-light .pipeline-step-pills span) {
  background: rgba(255, 255, 255, 0.56);
  backdrop-filter: blur(14px) saturate(1.12);
}

.pipeline-orb {
  --pipeline-progress: 0%;
  display: grid;
  place-items: center;
  align-content: center;
  width: 72px;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at center, var(--glass-panel-strong) 0 58%, transparent 59%),
    conic-gradient(var(--line-strong) var(--pipeline-progress), color-mix(in srgb, var(--line-soft) 74%, transparent) 0);
  box-shadow: 0 10px 22px color-mix(in srgb, var(--brand-a) 8%, transparent), 0 1px 0 var(--glass-highlight) inset;
  color: var(--strong-text);
}

.pipeline-orb.active {
  background:
    radial-gradient(circle at center, var(--glass-panel-strong) 0 58%, transparent 59%),
    conic-gradient(var(--brand-a) var(--pipeline-progress), color-mix(in srgb, var(--line-soft) 74%, transparent) 0);
  animation: pipeline-orb-glow 1.9s ease-in-out infinite;
}

.pipeline-orb.complete {
  background:
    radial-gradient(circle at center, var(--glass-panel-strong) 0 58%, transparent 59%),
    conic-gradient(var(--brand-b) 100%, color-mix(in srgb, var(--line-soft) 74%, transparent) 0);
}

.pipeline-orb strong {
  font-size: 20px;
  line-height: 1;
}

.pipeline-orb span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 900;
}

.pipeline-copy {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.pipeline-copy-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.pipeline-copy-heading strong {
  min-width: 0;
  overflow: hidden;
  color: var(--strong-text);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pipeline-copy p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.45;
}

.state-chip,
.pipeline-metrics span,
.pipeline-step-pills span,
.danger-button {
  display: inline-flex;
  align-items: center;
}

.state-chip {
  gap: 7px;
  min-height: 30px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 6px 10px;
  color: var(--muted);
  background: var(--glass-panel);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.state-chip.on {
  border-color: rgba(20, 184, 166, 0.36);
  color: var(--brand-a);
  background: var(--brand-soft);
}

.pipeline-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.pipeline-metrics span,
.pipeline-step-pills span {
  gap: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--muted);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.pipeline-metrics span {
  min-height: 28px;
  padding: 5px 8px;
  font-size: 12px;
  font-weight: 850;
}

.pipeline-progress {
  position: relative;
  height: 7px;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.pipeline-progress::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 42%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.72), transparent);
  transform: translateX(-145%);
  animation: pipeline-rail-shimmer 1.35s ease-in-out infinite;
  pointer-events: none;
}

.pipeline-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--brand-a), var(--brand-b));
  box-shadow: 0 0 14px color-mix(in srgb, var(--brand-a) 18%, transparent);
  transition: width 0.24s ease;
}

.pipeline-step-pills {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.pipeline-step-pills span {
  justify-content: center;
  min-width: 0;
  min-height: 34px;
  padding: 5px 6px;
  font-size: 11px;
  font-weight: 850;
}

.pipeline-step-pills span.complete,
.pipeline-step-pills span.active {
  border-color: color-mix(in srgb, var(--brand-a) 34%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 10%, var(--glass-panel));
  color: var(--brand-a);
}

.pipeline-step-pills span.active {
  animation: step-live-pulse 1.8s ease-in-out infinite;
}

.pipeline-step-pills span.danger {
  border-color: rgba(239, 68, 68, 0.26);
  background: rgba(239, 68, 68, 0.08);
  color: var(--danger);
}

.pipeline-step-pills i {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--glass-panel);
  color: currentColor;
  font-style: normal;
  font-size: 10px;
  font-weight: 950;
  flex: none;
}

.pipeline-step-pills strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danger-button {
  position: relative;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  border: 1px solid rgba(239, 68, 68, 0.32);
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--danger);
  padding: 6px 10px;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
}

.icon-sm {
  width: 15px;
  height: 15px;
  flex: none;
}

@keyframes pipeline-flow {
  from {
    background-position: 0% 50%;
  }
  to {
    background-position: 220% 50%;
  }
}

@keyframes pipeline-rail-shimmer {
  0% {
    transform: translateX(-145%);
  }
  58%,
  100% {
    transform: translateX(265%);
  }
}

@keyframes pipeline-orb-glow {
  0%,
  100% {
    box-shadow: 0 10px 22px color-mix(in srgb, var(--brand-a) 8%, transparent), 0 1px 0 var(--glass-highlight) inset;
  }
  50% {
    box-shadow: 0 12px 28px color-mix(in srgb, var(--brand-a) 18%, transparent), 0 0 0 5px color-mix(in srgb, var(--brand-a) 9%, transparent), 0 1px 0 var(--glass-highlight) inset;
  }
}

@keyframes step-live-pulse {
  0%,
  100% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset;
  }
  50% {
    box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 0 0 4px color-mix(in srgb, var(--brand-a) 9%, transparent);
  }
}

@media (max-width: 980px) {
  .pipeline-step-pills {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .panel-heading {
    flex-direction: column;
  }

  .pipeline-status-card {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .pipeline-step-pills {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
