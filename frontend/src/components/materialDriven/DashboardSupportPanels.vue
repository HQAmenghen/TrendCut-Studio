<template>
  <section class="support-section cockpit-support-section">
    <div class="support-grid">
      <LiveTaskQueuePanel
        :items="liveTaskItems"
        @delete-task="emit('delete-task', $event)"
        @resume-material-task="emit('resume-material-task', $event)"
        @retry-material-task="emit('retry-material-task', $event)"
      />

      <GlassPanel class="ops-panel support-panel publish-panel">
        <div class="support-card-heading">
          <div>
            <span class="panel-kicker">Delivery</span>
            <h3>发布队列</h3>
          </div>
          <span class="support-status">{{ publishJobs.length ? `${publishJobs.length} 个任务` : '暂无任务' }}</span>
        </div>

        <div class="support-body">
          <div class="plan-list">
            <div
              v-for="job in publishJobs"
              :key="job.id"
              class="plan-row"
              :class="{ deleting: isDeletingPublishJob(job) }"
            >
              <div>
                <strong>{{ job.asset?.label || job.asset?.compactLabel || job.title || job.id }}</strong>
                <span>{{ formatTime(job.scheduledAt) }}</span>
              </div>
              <div class="support-row-actions">
                <span>{{ getPublishJobLabel(job) }}</span>
                <button
                  v-if="canRepublishJob(job)"
                  type="button"
                  class="mini-button"
                  @click="emit('republish-job', job)"
                >
                  重新发布
                </button>
                <button
                  v-if="canDeletePublishJob(job)"
                  type="button"
                  class="mini-button icon-mini danger-mini"
                  :class="{ loading: isDeletingPublishJob(job) }"
                  :title="isDeletingPublishJob(job) ? '正在删除发布任务' : '删除发布任务'"
                  aria-label="删除发布任务"
                  :disabled="isDeletingPublishJob(job)"
                  @click="emit('delete-publish-job', job)"
                >
                  <RefreshCw v-if="isDeletingPublishJob(job)" class="icon-sm spin-icon" aria-hidden="true" />
                  <Trash2 v-else class="icon-sm" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div v-if="!publishJobs.length" class="empty-row">暂无发布任务</div>
          </div>
        </div>
      </GlassPanel>

      <GlassPanel class="ops-panel support-panel health-panel">
        <div class="support-card-heading">
          <div>
            <span class="panel-kicker">Health</span>
            <h3>系统健康</h3>
          </div>
          <span class="support-status">
            <span :class="`health-dot status-${selfCheckSummary.status}`"></span>
            {{ selfCheckLabel }}
          </span>
        </div>

        <div class="support-body">
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
        </div>
      </GlassPanel>

      <GlassPanel class="ops-panel support-panel activity-panel">
        <div class="support-card-heading">
          <div>
            <span class="panel-kicker">Activity</span>
            <h3>最近运行</h3>
          </div>
          <span class="support-status">{{ visibleLogs.length ? `${visibleLogs.length} 条记录` : '暂无记录' }}</span>
        </div>

        <div class="support-body">
          <div class="log-list">
            <div v-for="line in visibleLogs" :key="line.id" class="log-row">
              <span>{{ line.time }}</span>
              <strong>{{ line.message }}</strong>
            </div>
            <div v-if="!visibleLogs.length" class="empty-row">暂无运行记录</div>
          </div>
        </div>
      </GlassPanel>
    </div>
  </section>
</template>

<script setup>
import { RefreshCw, Trash2 } from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';
import LiveTaskQueuePanel from './LiveTaskQueuePanel.vue';

const props = defineProps({
  liveTaskItems: { type: Array, default: () => [] },
  publishJobs: { type: Array, default: () => [] },
  deletingPublishJobIds: { type: Array, default: () => [] },
  selfCheckSummary: { type: Object, default: () => ({}) },
  selfCheckLabel: { type: String, default: '' },
  selfCheckHighlights: { type: Array, default: () => [] },
  visibleLogs: { type: Array, default: () => [] },
  formatTime: { type: Function, required: true },
  getPublishJobLabel: { type: Function, required: true },
  canRepublishJob: { type: Function, required: true },
  canDeletePublishJob: { type: Function, required: true }
});

const emit = defineEmits(['delete-task', 'resume-material-task', 'retry-material-task', 'republish-job', 'delete-publish-job']);

const isDeletingPublishJob = (job) => props.deletingPublishJobIds.includes(String(job?.id || ''));
</script>

<style scoped src="../AutomationDashboard.css"></style>
