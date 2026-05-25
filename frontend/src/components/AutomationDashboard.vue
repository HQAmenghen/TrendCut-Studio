<template>
  <section class="automation-dashboard">
    <section class="command-strip" :class="`state-${statusState}`">
      <div class="command-main">
        <div class="eyebrow">
          <Activity class="icon-sm" aria-hidden="true" />
          自动生产驾驶舱
        </div>
        <div class="command-title-row">
          <h2>{{ statusTitle }}</h2>
          <span class="status-badge">
            <component :is="statusIcon" class="icon-sm" aria-hidden="true" />
            {{ statusLabel }}
          </span>
        </div>
        <div class="source-line">
          <FileVideo class="icon-sm" aria-hidden="true" />
          <span>{{ sourceLabel }}</span>
        </div>
        <div class="progress-rail" aria-label="自动生产进度">
          <span :style="{ width: progressWidth }"></span>
        </div>
        <div class="run-meta">
          <span><Gauge class="icon-sm" aria-hidden="true" />{{ progressLabel }}</span>
          <span><Layers class="icon-sm" aria-hidden="true" />{{ currentStepLabel }}</span>
          <span><Clock class="icon-sm" aria-hidden="true" />{{ durationLabel }}</span>
          <span><Radio class="icon-sm" aria-hidden="true" />{{ publishReadinessLabel }}</span>
        </div>
      </div>

      <div class="launch-pad">
        <label class="source-picker" :class="{ disabled: isBusy }">
          <Upload class="icon" aria-hidden="true" />
          <span>{{ fileLabel }}</span>
          <input
            type="file"
            accept="video/mp4,video/*"
            hidden
            :disabled="isBusy"
            @change="handleFileSelect"
          />
        </label>
        <button
          v-if="!jobId"
          type="button"
          class="primary-action"
          :disabled="!canStart"
          @click="emitStart"
        >
          <Play class="icon" aria-hidden="true" />
          {{ startActionLabel }}
        </button>
        <button
          v-else-if="finalVideoUrl"
          type="button"
          class="primary-action"
          @click="$emit('to-publish')"
        >
          <Send class="icon" aria-hidden="true" />
          转入发布
        </button>
        <button
          v-else
          type="button"
          class="primary-action"
          :disabled="isBusy"
          @click="$emit('continue-workflow')"
        >
          <Play class="icon" aria-hidden="true" />
          继续当前任务
        </button>
        <div class="action-row">
          <button type="button" class="tool-button" @click="$emit('change-module', 'xaiTop10')">
            <Search class="icon-sm" aria-hidden="true" />
            热点素材
          </button>
          <button type="button" class="tool-button" @click="$emit('refresh')">
            <RefreshCw class="icon-sm" aria-hidden="true" />
            刷新状态
          </button>
          <button type="button" class="tool-button" @click="$emit('change-module', 'materialDriven')">
            <Settings2 class="icon-sm" aria-hidden="true" />
            高级编排
          </button>
        </div>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="ops-panel pipeline-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Production</span>
            <h3>自动生产链路</h3>
          </div>
          <button
            v-if="hasRecoverableFailure"
            type="button"
            class="danger-button"
            @click="$emit('retry-step', currentStep || 1)"
          >
            <RotateCcw class="icon-sm" aria-hidden="true" />
            重试失败步骤
          </button>
        </div>

        <div class="step-list">
          <div
            v-for="step in steps"
            :key="step.id"
            class="step-row"
            :class="stepClass(step.id)"
          >
            <span class="step-index">{{ step.id }}</span>
            <div class="step-copy">
              <strong>{{ step.title }}</strong>
              <span>{{ step.desc }}</span>
            </div>
            <span class="step-state">{{ getStepStateLabel(step.id) }}</span>
          </div>
        </div>
      </section>

      <section class="ops-panel output-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Output</span>
            <h3>成片与下一步</h3>
          </div>
          <CheckCircle2 v-if="finalVideoUrl" class="panel-mark ready" aria-hidden="true" />
          <AlertTriangle v-else-if="errorText" class="panel-mark danger" aria-hidden="true" />
        </div>

        <div class="output-summary">
          <div class="output-metric">
            <span>成片状态</span>
            <strong>{{ finalVideoUrl ? '已生成' : jobId ? '生产中' : '待生产' }}</strong>
          </div>
          <div class="output-metric">
            <span>脚本段落</span>
            <strong>{{ scriptUnitCount }}</strong>
          </div>
          <div class="output-metric">
            <span>输出目录</span>
            <strong>{{ outputPath || '自动生成' }}</strong>
          </div>
        </div>

        <div v-if="errorText" class="failure-box">
          <AlertTriangle class="icon" aria-hidden="true" />
          <div>
            <strong>最近失败</strong>
            <span>{{ errorText }}</span>
          </div>
        </div>

        <div class="result-actions">
          <a
            v-if="finalVideoUrl"
            class="tool-button"
            :href="finalVideoUrl"
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink class="icon-sm" aria-hidden="true" />
            查看成片
          </a>
          <button type="button" class="tool-button" :disabled="!finalVideoUrl" @click="$emit('to-vertical')">
            <Scissors class="icon-sm" aria-hidden="true" />
            竖屏精修
          </button>
          <button type="button" class="tool-button" :disabled="!finalVideoUrl" @click="$emit('to-publish')">
            <Rocket class="icon-sm" aria-hidden="true" />
            发布准备
          </button>
        </div>
      </section>

      <section class="ops-panel autopilot-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Auto-Pilot</span>
            <h3>无人值守分发</h3>
          </div>
          <span class="state-chip" :class="{ on: autoPilotEnabled }">
            {{ autoPilotEnabled ? '已开启' : '未开启' }}
          </span>
        </div>

        <div class="compact-stats">
          <div>
            <span>素材</span>
            <strong>{{ publishStats.assetCount }}</strong>
          </div>
          <div>
            <span>任务</span>
            <strong>{{ publishStats.jobCount }}</strong>
          </div>
          <div>
            <span>平台</span>
            <strong>{{ publishStats.enabledPlatformCount }}</strong>
          </div>
        </div>

        <div class="plan-list">
          <div v-for="item in autoPilotPlans" :key="item.id" class="plan-row">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.scheduledLabel || formatTime(item.scheduledAt) }}</span>
            </div>
            <span>{{ item.statusLabel }}</span>
          </div>
          <div v-if="!autoPilotPlans.length" class="empty-row">暂无托管计划</div>
        </div>
      </section>

      <section class="ops-panel health-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Health</span>
            <h3>运行健康度</h3>
          </div>
          <ShieldCheck class="panel-mark" aria-hidden="true" />
        </div>

        <div class="health-score">
          <span :class="`health-dot status-${selfCheckSummary.status}`"></span>
          <strong>{{ selfCheckLabel }}</strong>
          <span>通过 {{ selfCheckSummary.okCount || 0 }} / 警告 {{ selfCheckSummary.warnCount || 0 }} / 失败 {{ selfCheckSummary.failCount || 0 }}</span>
        </div>

        <div class="issue-list">
          <div v-for="item in selfCheckHighlights" :key="`${item.groupLabel}_${item.key}`" class="issue-row">
            <strong>{{ item.label }}</strong>
            <span>{{ item.details || item.hint || item.groupLabel }}</span>
          </div>
          <div v-if="!selfCheckHighlights.length" class="empty-row">暂无高优先级异常</div>
        </div>
      </section>

      <section class="ops-panel activity-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Activity</span>
            <h3>最近运行记录</h3>
          </div>
          <ClipboardList class="panel-mark" aria-hidden="true" />
        </div>

        <div class="log-list">
          <div v-for="line in visibleLogs" :key="line.id" class="log-row">
            <span>{{ line.time }}</span>
            <strong>{{ line.message }}</strong>
          </div>
          <div v-if="!visibleLogs.length" class="empty-row">暂无运行记录</div>
        </div>
      </section>

      <section class="ops-panel shortcuts-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Workspaces</span>
            <h3>高级工作区</h3>
          </div>
        </div>

        <div class="shortcut-list">
          <button
            v-for="item in shortcuts"
            :key="item.key"
            type="button"
            class="shortcut-row"
            @click="$emit('change-module', item.key)"
          >
            <component :is="item.icon" class="icon" aria-hidden="true" />
            <span>
              <strong>{{ item.label }}</strong>
              <em>{{ item.meta }}</em>
            </span>
            <ArrowRight class="icon-sm" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileVideo,
  Gauge,
  Layers,
  Play,
  Radio,
  RefreshCw,
  Rocket,
  RotateCcw,
  Scissors,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Upload
} from 'lucide-vue-next';

const props = defineProps({
  materialDriven: { type: Object, required: true },
  publishCenter: { type: Object, required: true },
  standalone: { type: Object, required: true },
  xai: { type: Object, required: true }
});

const emit = defineEmits([
  'change-module',
  'start-automation',
  'continue-workflow',
  'retry-step',
  'to-publish',
  'to-vertical',
  'refresh'
]);

const selectedFile = ref(null);

const steps = [
  { id: 1, title: '接入素材', desc: '本地素材或热点素材' },
  { id: 2, title: '理解内容', desc: 'ASR、OCR、重点提取' },
  { id: 3, title: '匹配镜头', desc: '切片、评分、候选镜头' },
  { id: 4, title: '生成计划', desc: '脚本与剪辑计划' },
  { id: 5, title: '口播成稿', desc: '整段数字人口播稿' },
  { id: 6, title: '数字人生成', desc: '声音与形象驱动' },
  { id: 7, title: '渲染导出', desc: '字幕、合成、成片' }
];

const shortcuts = [
  { key: 'materialDriven', label: '素材生产线', meta: '脚本、镜头、数字人参数', icon: Settings2 },
  { key: 'xaiTop10', label: '热点榜单', meta: '抓榜、筛选、送入生产', icon: Search },
  { key: 'publishCenter', label: '发布中心', meta: '托管计划与平台任务', icon: Send },
  { key: 'standalone', label: '竖屏后期', meta: '单条精修与批量队列', icon: Scissors }
];

const readValue = (source, key, fallback = '') => {
  const raw = source?.[key];
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return raw.value ?? fallback;
  }
  return raw ?? fallback;
};

const jobId = computed(() => readValue(props.materialDriven, 'jobId', ''));
const currentStep = computed(() => Number(readValue(props.materialDriven, 'currentStep', 0)) || 0);
const progress = computed(() => Math.max(0, Math.min(100, Number(readValue(props.materialDriven, 'progress', 0)) || 0)));
const statusText = computed(() => String(readValue(props.materialDriven, 'statusText', '') || '').trim());
const finalVideoUrl = computed(() => String(readValue(props.materialDriven, 'finalVideoUrl', '') || '').trim());
const errorText = computed(() => String(readValue(props.materialDriven, 'error', '') || '').trim());
const outputPath = computed(() => String(readValue(props.materialDriven, 'outputPath', '') || '').trim());
const materialUrl = computed(() => String(readValue(props.materialDriven, 'materialUrl', '') || '').trim());
const materialSourceLabel = computed(() => String(readValue(props.materialDriven, 'materialSourceLabel', '') || '').trim());
const activeDurationLabel = computed(() => String(readValue(props.materialDriven, 'activeDurationLabel', '') || '').trim());
const lastDurationLabel = computed(() => String(readValue(props.materialDriven, 'lastDurationLabel', '') || '').trim());
const scriptUnits = computed(() => readValue(props.materialDriven, 'scriptUnits', []));
const recentLogs = computed(() => readValue(props.materialDriven, 'recentLogs', []));
const gen = computed(() => readValue(props.materialDriven, 'gen', {}));
const uploading = computed(() => Boolean(readValue(props.materialDriven, 'uploading', false)));
const rebuildingPlan = computed(() => Boolean(readValue(props.materialDriven, 'rebuildingPlan', false)));
const rerenderingVideo = computed(() => Boolean(readValue(props.materialDriven, 'rerenderingVideo', false)));

const publishStats = computed(() => readValue(props.publishCenter, 'stats', {
  assetCount: 0,
  jobCount: 0,
  enabledPlatformCount: 0
}));
const publishConfig = computed(() => readValue(props.publishCenter, 'config', {}));
const selfCheckSummary = computed(() => readValue(props.publishCenter, 'selfCheckSummary', {
  status: 'unknown',
  okCount: 0,
  warnCount: 0,
  failCount: 0
}));
const selfCheckHighlights = computed(() => readValue(props.publishCenter, 'selfCheckHighlights', []));
const autoPilotPlans = computed(() => readValue(props.publishCenter, 'autoPilotJobs', []).slice(0, 4));

const isBusy = computed(() => uploading.value || rebuildingPlan.value || rerenderingVideo.value);
const scriptUnitCount = computed(() => Array.isArray(scriptUnits.value) ? scriptUnits.value.length : 0);
const autoPilotEnabled = computed(() => Boolean(publishConfig.value?.global?.autoPilotEnabled));
const hasRecoverableFailure = computed(() => Boolean(jobId.value && errorText.value && currentStep.value));

const statusState = computed(() => {
  if (errorText.value) return 'danger';
  if (finalVideoUrl.value) return 'ready';
  if (jobId.value) return 'running';
  if (selectedFile.value || materialUrl.value) return 'staged';
  return 'idle';
});

const statusTitle = computed(() => {
  if (errorText.value) return '当前任务需要处理';
  if (finalVideoUrl.value) return '成片已就绪';
  if (jobId.value) return '自动生产进行中';
  if (selectedFile.value || materialUrl.value) return '素材已接入';
  return '选择素材后自动生产';
});

const statusLabel = computed(() => ({
  danger: '需处理',
  ready: '可发布',
  running: '生产中',
  staged: '待启动',
  idle: '待接入'
}[statusState.value]));

const statusIcon = computed(() => {
  if (statusState.value === 'danger') return AlertTriangle;
  if (statusState.value === 'ready') return CheckCircle2;
  if (statusState.value === 'running') return Activity;
  return FileVideo;
});

const progressWidth = computed(() => `${finalVideoUrl.value ? 100 : progress.value}%`);
const progressLabel = computed(() => `${finalVideoUrl.value ? 100 : progress.value}%`);
const durationLabel = computed(() => {
  if (jobId.value && !finalVideoUrl.value) return activeDurationLabel.value || '00:00';
  return lastDurationLabel.value || '暂无记录';
});
const currentStepLabel = computed(() => {
  if (finalVideoUrl.value) return '制作完成';
  const step = steps.find((item) => item.id === currentStep.value);
  if (step) return step.title;
  return statusText.value || '等待启动';
});
const publishReadinessLabel = computed(() => finalVideoUrl.value ? '发布就绪' : '等待成片');

const sourceLabel = computed(() => {
  if (selectedFile.value) return selectedFile.value.name;
  if (materialSourceLabel.value) return materialSourceLabel.value;
  if (materialUrl.value) return materialUrl.value;
  return '尚未选择源素材';
});

const fileLabel = computed(() => {
  if (selectedFile.value) return selectedFile.value.name;
  if (materialUrl.value) return '已接入热点素材';
  return '选择本地素材';
});

const canStart = computed(() => Boolean(!isBusy.value && !jobId.value && (selectedFile.value || materialUrl.value)));
const startActionLabel = computed(() => {
  if (isBusy.value) return '正在接入素材';
  if (selectedFile.value || materialUrl.value) return '开始自动生产';
  return '先选择素材';
});

const selfCheckLabel = computed(() => {
  const status = selfCheckSummary.value?.status;
  if (status === 'ok' || status === 'pass') return '运行正常';
  if (status === 'warn') return '存在警告';
  if (status === 'fail' || status === 'error') return '存在失败';
  return '待检测';
});

const visibleLogs = computed(() => {
  const logs = Array.isArray(recentLogs.value) ? recentLogs.value : [];
  return logs.slice(-6).reverse().map((item, index) => ({
    id: `${item.time || index}_${item.message || index}`,
    time: item.time || '--:--:--',
    message: String(item.message || item || '').trim()
  }));
});

const handleFileSelect = (event) => {
  selectedFile.value = event.target.files?.[0] || null;
};

const emitStart = () => {
  if (!canStart.value) return;
  emit('start-automation', {
    file: selectedFile.value,
    config: {
      useSmartClip: true,
      autoGenerate: true,
      outputDir: ''
    },
    manualScript: gen.value?.text || ''
  });
};

const stepClass = (stepId) => {
  if (finalVideoUrl.value || currentStep.value > stepId) return 'complete';
  if (errorText.value && currentStep.value === stepId) return 'danger';
  if (currentStep.value === stepId) return 'active';
  return '';
};

const getStepStateLabel = (stepId) => {
  if (finalVideoUrl.value || currentStep.value > stepId) return '完成';
  if (errorText.value && currentStep.value === stepId) return '失败';
  if (currentStep.value === stepId) return '执行中';
  return '待执行';
};

const formatTime = (value) => {
  if (!value) return '未设定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
};
</script>

<style scoped>
.automation-dashboard {
  display: grid;
  gap: 16px;
}

.command-strip {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 18px;
  align-items: stretch;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
  padding: 18px;
  box-shadow: var(--shadow);
}

.command-main,
.launch-pad,
.ops-panel {
  min-width: 0;
}

.eyebrow,
.panel-kicker,
.source-line,
.run-meta,
.tool-button,
.primary-action,
.source-picker,
.danger-button,
.status-badge,
.state-chip,
.shortcut-row {
  display: inline-flex;
  align-items: center;
}

.eyebrow {
  gap: 7px;
  color: var(--brand-a);
  font-size: 12px;
  font-weight: 800;
}

.command-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-top: 10px;
}

h2,
h3 {
  margin: 0;
  color: var(--strong-text);
}

h2 {
  font-size: 34px;
  line-height: 1.08;
}

h3 {
  font-size: 16px;
  line-height: 1.25;
}

.status-badge,
.state-chip {
  gap: 7px;
  min-height: 30px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 6px 10px;
  color: var(--muted);
  background: var(--panel-soft);
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
}

.state-ready .status-badge,
.state-running .status-badge,
.state-staged .status-badge,
.state-chip.on {
  border-color: rgba(20, 184, 166, 0.36);
  color: var(--brand-a);
  background: var(--brand-soft);
}

.state-danger .status-badge {
  border-color: rgba(239, 68, 68, 0.38);
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
}

.source-line {
  gap: 8px;
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
  word-break: break-word;
}

.progress-rail {
  height: 8px;
  overflow: hidden;
  margin-top: 18px;
  border-radius: 7px;
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
}

.progress-rail span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--brand-a);
  transition: width 0.24s ease;
}

.run-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.run-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 6px 9px;
  color: var(--muted);
  background: var(--panel-soft);
  font-size: 12px;
  font-weight: 800;
}

.launch-pad {
  display: grid;
  align-content: start;
  gap: 10px;
  border-left: 1px solid var(--line-soft);
  padding-left: 18px;
}

.source-picker,
.primary-action,
.tool-button,
.danger-button {
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 9px 12px;
  color: var(--strong-text);
  background: var(--panel-soft);
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  text-decoration: none;
}

.source-picker {
  justify-content: flex-start;
  color: var(--muted);
}

.source-picker span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-picker.disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.primary-action {
  background: var(--brand-a);
  border-color: var(--brand-a);
  color: #04110f;
}

.tool-button:hover,
.source-picker:hover,
.danger-button:hover,
.shortcut-row:hover {
  border-color: var(--line-strong);
  color: var(--strong-text);
}

.action-row,
.result-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.danger-button {
  min-height: 34px;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.32);
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  gap: 16px;
}

.ops-panel {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
  padding: 16px;
  box-shadow: var(--shadow);
}

.pipeline-panel,
.activity-panel {
  grid-column: 1;
}

.output-panel,
.autopilot-panel,
.health-panel,
.shortcuts-panel {
  grid-column: 2;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 850;
}

.panel-mark {
  width: 22px;
  height: 22px;
  color: var(--muted);
}

.panel-mark.ready {
  color: var(--ok);
}

.panel-mark.danger {
  color: var(--danger);
}

.step-list,
.plan-list,
.issue-list,
.log-list,
.shortcut-list {
  display: grid;
  gap: 8px;
}

.step-row,
.plan-row,
.issue-row,
.log-row,
.shortcut-row {
  display: grid;
  gap: 10px;
  align-items: center;
  min-height: 48px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--panel-soft);
  padding: 10px;
}

.step-row {
  grid-template-columns: 32px minmax(0, 1fr) 70px;
}

.step-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--muted);
  font-size: 12px;
  font-weight: 900;
}

.step-copy,
.plan-row div,
.issue-row,
.shortcut-row span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.step-copy strong,
.plan-row strong,
.issue-row strong,
.shortcut-row strong,
.output-metric strong,
.log-row strong {
  color: var(--strong-text);
  font-size: 13px;
}

.step-copy span,
.plan-row span,
.issue-row span,
.shortcut-row em,
.output-metric span,
.health-score span,
.log-row span {
  color: var(--muted);
  font-size: 12px;
  font-style: normal;
}

.step-state {
  justify-self: end;
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.step-row.complete .step-index,
.step-row.active .step-index {
  background: var(--brand-soft);
  color: var(--brand-a);
}

.step-row.complete .step-state,
.step-row.active .step-state {
  color: var(--brand-a);
}

.step-row.danger .step-index,
.step-row.danger .step-state {
  color: var(--danger);
}

.output-summary,
.compact-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.output-metric,
.compact-stats div {
  display: grid;
  gap: 5px;
  min-height: 62px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--panel-soft);
  padding: 10px;
}

.output-metric strong,
.compact-stats strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-stats span {
  color: var(--muted);
  font-size: 12px;
}

.compact-stats strong {
  color: var(--strong-text);
  font-size: 18px;
}

.failure-box {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  margin: 12px 0;
  border: 1px solid rgba(239, 68, 68, 0.32);
  border-radius: 7px;
  background: rgba(239, 68, 68, 0.1);
  padding: 10px;
  color: var(--danger);
}

.failure-box div {
  display: grid;
  gap: 4px;
}

.failure-box strong {
  color: var(--strong-text);
  font-size: 13px;
}

.failure-box span {
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}

.plan-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.plan-row > span {
  color: var(--brand-a);
  font-weight: 850;
}

.health-score {
  display: grid;
  grid-template-columns: 12px auto minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  margin-bottom: 12px;
}

.health-score strong {
  color: var(--strong-text);
  font-size: 13px;
}

.health-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: var(--muted);
}

.status-ok,
.status-pass {
  background: var(--ok);
}

.status-warn {
  background: var(--warn);
}

.status-fail,
.status-error {
  background: var(--danger);
}

.issue-row,
.log-row {
  min-height: 42px;
}

.log-row {
  grid-template-columns: 70px minmax(0, 1fr);
}

.shortcut-row {
  grid-template-columns: 22px minmax(0, 1fr) 16px;
  width: 100%;
  text-align: left;
}

.empty-row {
  border: 1px dashed var(--line-soft);
  border-radius: 7px;
  padding: 12px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.icon {
  width: 18px;
  height: 18px;
  flex: none;
}

.icon-sm {
  width: 15px;
  height: 15px;
  flex: none;
}

@media (max-width: 1180px) {
  .command-strip,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .launch-pad {
    border-left: 0;
    border-top: 1px solid var(--line-soft);
    padding-left: 0;
    padding-top: 16px;
  }

  .pipeline-panel,
  .activity-panel,
  .output-panel,
  .autopilot-panel,
  .health-panel,
  .shortcuts-panel {
    grid-column: 1;
  }
}

@media (max-width: 720px) {
  .command-strip,
  .ops-panel {
    padding: 14px;
  }

  .command-title-row,
  .panel-heading {
    flex-direction: column;
  }

  .action-row,
  .result-actions,
  .output-summary,
  .compact-stats {
    grid-template-columns: 1fr;
  }

  .step-row {
    grid-template-columns: 28px minmax(0, 1fr);
  }

  .step-state {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
