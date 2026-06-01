<template>
  <ModalBackdrop @close="$emit('close')">
    <section class="source-modal xai-error-modal" role="alertdialog" aria-modal="true" aria-labelledby="xai-error-title">
      <div class="error-header" :class="`type-${alert.type}`">
        <div class="error-icon-wrap">
          <component :is="iconComponent" class="error-icon" aria-hidden="true" />
        </div>
        <div>
          <span class="panel-kicker">{{ partitionLabel }} Top10</span>
          <h3 id="xai-error-title">{{ alert.title }}</h3>
          <p>{{ alert.message }}</p>
        </div>
      </div>

      <div class="flow-strip" aria-label="xAI 运行失败流程">
        <div class="flow-step done">
          <CheckCircle2 class="icon-sm" aria-hidden="true" />
          <span>任务启动</span>
        </div>
        <div class="flow-line active"></div>
        <div class="flow-step done">
          <Search class="icon-sm" aria-hidden="true" />
          <span>候选扫描</span>
        </div>
        <div class="flow-line failed"></div>
        <div class="flow-step failed">
          <component :is="iconComponent" class="icon-sm" aria-hidden="true" />
          <span>{{ failureStepLabel }}</span>
        </div>
      </div>

      <div class="detail-panel">
        <div>
          <span>处理建议</span>
          <strong>{{ alert.action }}</strong>
        </div>
        <div v-if="alert.details">
          <span>错误详情</span>
          <p>{{ alert.details }}</p>
        </div>
        <div class="meta-grid">
          <div>
            <span>状态码</span>
            <strong>{{ alert.status || alert.code || '-' }}</strong>
          </div>
          <div>
            <span>阶段</span>
            <strong>{{ alert.stage || 'xai.run' }}</strong>
          </div>
          <div>
            <span>时间</span>
            <strong>{{ alert.occurredAt || '-' }}</strong>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="ghost-btn" @click="$emit('close')">知道了</button>
        <button type="button" class="btn-primary" @click="$emit('retry')">
          <RefreshCw class="icon-sm" aria-hidden="true" />
          重试当前分区
        </button>
      </div>
    </section>
  </ModalBackdrop>
</template>

<script setup>
import { computed } from 'vue';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  RefreshCw,
  Search,
  Settings,
  WifiOff
} from 'lucide-vue-next';
import ModalBackdrop from './ModalBackdrop.vue';

const props = defineProps({
  alert: { type: Object, required: true },
  partitionLabel: { type: String, default: '当前分区' }
});

defineEmits(['close', 'retry']);

const iconComponent = computed(() => {
  if (props.alert.type === 'quota') return CreditCard;
  if (props.alert.type === 'timeout') return WifiOff;
  if (props.alert.type === 'config') return Settings;
  return AlertTriangle;
});

const failureStepLabel = computed(() => {
  if (props.alert.type === 'quota') return '额度拦截';
  if (props.alert.type === 'timeout') return '网络超时';
  if (props.alert.type === 'config') return '配置缺失';
  return '任务失败';
});
</script>

<style scoped>
.xai-error-modal {
  width: min(100%, 680px);
  max-height: min(86vh, 720px);
  overflow-y: auto;
  border: 1px solid rgba(248, 113, 113, 0.36);
  border-radius: 18px;
  background: var(--card-bg);
  color: var(--text);
  box-shadow: 0 24px 70px rgba(2, 6, 23, 0.42);
}

.error-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  padding: 24px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(15, 23, 42, 0.04));
  border-bottom: 1px solid var(--line);
}

.error-header.type-quota {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(239, 68, 68, 0.08));
}

.error-header.type-timeout {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.18), rgba(239, 68, 68, 0.08));
}

.error-header h3 {
  margin: 6px 0 0;
  color: var(--strong-text);
  font-size: 1.55rem;
  line-height: 1.2;
}

.error-header p {
  margin: 10px 0 0;
  color: var(--text);
  line-height: 1.6;
}

.error-icon-wrap {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: rgba(239, 68, 68, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.34);
  animation: error-pulse 1.8s ease-in-out infinite;
}

.error-icon {
  width: 28px;
  height: 28px;
  color: #fca5a5;
}

.flow-strip {
  display: grid;
  grid-template-columns: auto minmax(36px, 1fr) auto minmax(36px, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}

.flow-step {
  min-width: 96px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--line-soft);
  background: var(--panel-subtle);
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.flow-step.done {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.32);
}

.flow-step.failed {
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.42);
  animation: failed-step 1.2s ease-in-out infinite;
}

.flow-line {
  height: 3px;
  border-radius: 999px;
  background: var(--line-soft);
  overflow: hidden;
}

.flow-line::after {
  content: '';
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  animation: flow-move 1.3s ease-in-out infinite;
}

.flow-line.active::after {
  background: #34d399;
}

.flow-line.failed::after {
  background: #f87171;
}

.detail-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
}

.detail-panel span,
.meta-grid span,
.panel-kicker {
  display: block;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.detail-panel strong {
  display: block;
  margin-top: 8px;
  color: var(--strong-text);
  line-height: 1.55;
}

.detail-panel p {
  margin: 8px 0 0;
  color: var(--muted);
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.meta-grid > div {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--panel-subtle);
  padding: 12px;
}

.meta-grid strong {
  overflow-wrap: anywhere;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 18px 24px 24px;
}

.ghost-btn,
.btn-primary {
  min-height: 42px;
  border-radius: 12px;
  padding: 0 16px;
  font-weight: 800;
  cursor: pointer;
}

.ghost-btn {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
}

.btn-primary {
  border: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #dc2626 0%, #f97316 100%);
  color: #fff;
}

.icon-sm {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

@keyframes error-pulse {
  50% {
    transform: scale(1.04);
    box-shadow: 0 0 0 10px rgba(248, 113, 113, 0.08);
  }
}

@keyframes failed-step {
  50% {
    transform: translateY(-1px);
  }
}

@keyframes flow-move {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(240%);
  }
}

@media (max-width: 680px) {
  .error-header {
    grid-template-columns: 1fr;
  }

  .flow-strip {
    grid-template-columns: 1fr;
  }

  .flow-line {
    width: 3px;
    height: 22px;
    justify-self: center;
  }

  .meta-grid {
    grid-template-columns: 1fr;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .btn-primary,
  .ghost-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
