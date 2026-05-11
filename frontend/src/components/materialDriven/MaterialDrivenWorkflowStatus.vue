<template>
  <section class="workflow-panel">
    <div class="workflow-head">
      <div>
        <div class="section-kicker">Workflow Status</div>
        <h4>7步工作流进度</h4>
      </div>
      <div class="workflow-summary">
        <span class="workflow-badge">{{ currentStep >= 7 || finalVideoUrl ? '已完成' : `步骤 ${currentStep}/7` }}</span>
        <strong>{{ statusText || currentStepInfo.desc }}</strong>
      </div>
    </div>
    <div v-if="progress > 0" class="panel progress-detail-panel">
      <div class="panel-header"><span>📡 实时进度</span></div>
      <div class="panel-body">
        <div class="progress-head">
          <span class="truncate">{{ statusText || currentStepInfo.desc }}</span>
          <span>{{ progress }}%</span>
        </div>
        <div class="progress-meta">
          <span>已用时：{{ activeDurationLabel }}</span>
          <span>本次耗时：{{ lastDurationLabel }}</span>
        </div>
        <div class="progress-banner mt-0">
          <div class="progress-bar-fill" :style="{ width: progress + '%' }"></div>
        </div>
      </div>
    </div>
    <div class="workflow-grid">
      <article
        v-for="step in steps"
        :key="step.id"
        :class="['workflow-stage', getStepStatus(step.id)]"
      >
        <div class="workflow-stage-top">
          <strong>{{ step.title }}</strong>
          <span class="workflow-stage-state">{{ getStepStateLabel(step.id) }}</span>
        </div>
        <p class="workflow-stage-detail">{{ step.desc }}</p>
        <div class="workflow-stage-duration" v-if="stepDuration(step.id).hasStarted">
          <span class="duration-icon">⏱</span>
          <span class="duration-value">{{ stepDuration(step.id).label }}</span>
          <span v-if="getStepStatus(step.id) === 'stage-running'" class="duration-live-dot"></span>
        </div>
      </article>
    </div>
    <div class="panel linkage-panel mt-4">
      <div class="panel-header"><span>🔗 链路联动状态</span></div>
      <div class="panel-body stack">
        <div class="mini-status-grid">
          <div class="mini-status-card">
            <span>素材来源</span>
            <strong>{{ sourceBridgeLabel }}</strong>
          </div>
          <div class="mini-status-card">
            <span>脚本单元</span>
            <strong>{{ scriptUnitCount || '待生成' }}</strong>
          </div>
          <div class="mini-status-card">
            <span>渲染状态</span>
            <strong>{{ finalVideoUrl ? '已出片' : '待渲染' }}</strong>
          </div>
          <div class="mini-status-card">
            <span>发布衔接</span>
            <strong>{{ readyForPublish ? '可转发布' : '待出片' }}</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  steps: {
    type: Array,
    required: true
  },
  currentStep: Number,
  progress: Number,
  statusText: String,
  currentStepInfo: {
    type: Object,
    required: true
  },
  finalVideoUrl: String,
  activeDurationLabel: String,
  lastDurationLabel: String,
  sourceBridgeLabel: String,
  scriptUnitCount: Number,
  readyForPublish: Boolean,
  stepDurationMap: Object
});

const getStepStatus = (stepId) => {
  if (props.currentStep >= 7) return 'stage-completed';
  if (stepId < props.currentStep) return 'stage-completed';
  if (stepId === props.currentStep) return 'stage-running';
  return 'stage-pending';
};

const getStepStateLabel = (stepId) => {
  if (props.currentStep >= 7) return '已完成';
  if (stepId < props.currentStep) return '已完成';
  if (stepId === props.currentStep) return '进行中';
  return '待执行';
};

const stepDuration = (stepId) => {
  const map = props.stepDurationMap;
  if (!map || !map[stepId]) {
    return { hasStarted: false, label: '', detail: '' };
  }
  const entry = map[stepId];
  return {
    hasStarted: entry.seconds > 0 || entry.label !== '未开始',
    label: entry.label === '未开始' ? '' : entry.label,
    detail: entry.detail || ''
  };
};
</script>
