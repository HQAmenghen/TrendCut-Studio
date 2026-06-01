<template>
  <GlassPanel class="ops-panel support-panel live-queue-panel">
    <div class="support-card-heading">
      <div>
        <span class="panel-kicker">Live Queue</span>
        <h3>实时任务队列</h3>
      </div>
      <span class="support-status" :class="{ active: activeTaskCount > 0 }">
        {{ summaryLabel }}
      </span>
    </div>

    <div class="support-body">
      <div class="task-queue-list">
        <div
          v-for="item in items"
          :key="item.id"
          class="task-queue-row"
          :class="`state-${item.state}`"
        >
          <span class="task-type-pill">{{ item.type }}</span>
          <div class="task-queue-main">
            <div class="task-queue-title">
              <strong>{{ item.title }}</strong>
              <em>{{ item.statusLabel }}</em>
            </div>
            <span>{{ item.detail }}</span>
            <div v-if="item.progress !== null" class="mini-progress-rail">
              <span :style="{ width: `${Math.max(3, item.progress)}%` }"></span>
            </div>
          </div>
          <div class="task-queue-side">
            <button
              v-if="item.action === 'resume-material'"
              type="button"
              class="mini-button task-action-button"
              :disabled="item.actionBusy"
              @click="emit('resume-material-task', item)"
            >
              <RefreshCw v-if="item.actionBusy" class="icon-sm spin-icon" aria-hidden="true" />
              <Play v-else class="icon-sm" aria-hidden="true" />
              {{ item.actionBusy ? '恢复中' : '继续' }}
            </button>
            <span class="task-queue-meta">{{ item.meta }}</span>
          </div>
        </div>
        <div v-if="!items.length" class="empty-row">暂无运行任务</div>
      </div>
    </div>
  </GlassPanel>
</template>

<script setup>
import { computed } from 'vue';
import { Play, RefreshCw } from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';

const props = defineProps({
  items: { type: Array, default: () => [] }
});

const emit = defineEmits(['resume-material-task']);

const activeTaskCount = computed(() => props.items.filter((item) => item.state === 'running').length);
const waitingTaskCount = computed(() => props.items.filter((item) => item.state === 'waiting').length);
const failedTaskCount = computed(() => props.items.filter((item) => item.state === 'danger').length);
const summaryLabel = computed(() => {
  if (failedTaskCount.value) return `${failedTaskCount.value} 个需处理`;
  if (activeTaskCount.value) return `${activeTaskCount.value} 运行 / ${waitingTaskCount.value} 等待`;
  if (waitingTaskCount.value) return `${waitingTaskCount.value} 个等待`;
  return '暂无任务';
});
</script>

<style scoped>
.support-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.support-card-heading h3 {
  margin: 4px 0 0;
  font-size: 1rem;
}

.panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: rgba(148, 163, 184, 0.82);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.support-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: rgba(226, 232, 240, 0.78);
  font-size: 0.78rem;
  white-space: nowrap;
}

.support-status.active {
  border-color: rgba(34, 197, 94, 0.42);
  color: #bbf7d0;
}

.task-queue-list {
  display: grid;
  gap: 10px;
}

.task-queue-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 70px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.38);
}

.task-queue-row.state-running {
  border-color: rgba(14, 165, 233, 0.38);
}

.task-queue-row.state-waiting {
  border-color: rgba(251, 191, 36, 0.32);
}

.task-queue-row.state-danger {
  border-color: rgba(248, 113, 113, 0.42);
}

.task-type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 28px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: rgba(226, 232, 240, 0.82);
  font-size: 0.75rem;
  white-space: nowrap;
}

.task-queue-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.task-queue-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-queue-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-queue-title em {
  flex: 0 0 auto;
  color: rgba(226, 232, 240, 0.58);
  font-style: normal;
  font-size: 0.78rem;
}

.task-queue-main > span,
.task-queue-meta {
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.78rem;
}

.task-queue-main > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-queue-side {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.mini-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.56);
  color: rgba(226, 232, 240, 0.9);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.mini-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.task-action-button {
  min-height: 28px;
  padding: 5px 9px;
}

.mini-progress-rail {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
}

.mini-progress-rail span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #38bdf8, #22c55e);
  transition: width 0.24s ease;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

.empty-row {
  display: flex;
  align-items: center;
  min-height: 58px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.82rem;
}

.icon-sm {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .support-card-heading {
    align-items: stretch;
  }

  .task-queue-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .task-queue-side {
    justify-items: start;
  }

  .task-queue-meta {
    white-space: normal;
  }
}
</style>
