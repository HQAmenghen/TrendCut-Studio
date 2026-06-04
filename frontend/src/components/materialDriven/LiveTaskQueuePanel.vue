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
              v-if="item.retryAction"
              type="button"
              class="mini-button task-action-button"
              title="重试当前失败步骤"
              :disabled="item.actionBusy"
              @click="emit('retry-material-task', item)"
            >
              <RefreshCw class="icon-sm" aria-hidden="true" />
              重试
            </button>
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
            <button
              v-if="item.cleanupAction"
              type="button"
              class="mini-button task-action-button task-delete-button"
              title="删除任务"
              aria-label="删除任务"
              @click="emit('delete-task', item)"
            >
              <Trash2 class="icon-sm" aria-hidden="true" />
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
import { Play, RefreshCw, Trash2 } from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';

const props = defineProps({
  items: { type: Array, default: () => [] }
});

const emit = defineEmits(['delete-task', 'resume-material-task', 'retry-material-task']);

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

<style scoped src="../AutomationDashboard.css"></style>
