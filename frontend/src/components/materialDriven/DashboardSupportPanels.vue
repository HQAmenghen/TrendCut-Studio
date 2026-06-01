<template>
  <section class="support-section cockpit-support-section">
    <div class="support-grid">
      <LiveTaskQueuePanel
        :items="liveTaskItems"
        @resume-material-task="emit('resume-material-task', $event)"
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
            <div v-for="job in publishJobs" :key="job.id" class="plan-row">
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
import GlassPanel from '../GlassPanel.vue';
import LiveTaskQueuePanel from './LiveTaskQueuePanel.vue';

defineProps({
  liveTaskItems: { type: Array, default: () => [] },
  publishJobs: { type: Array, default: () => [] },
  selfCheckSummary: { type: Object, default: () => ({}) },
  selfCheckLabel: { type: String, default: '' },
  selfCheckHighlights: { type: Array, default: () => [] },
  visibleLogs: { type: Array, default: () => [] },
  formatTime: { type: Function, required: true },
  getPublishJobLabel: { type: Function, required: true },
  canRepublishJob: { type: Function, required: true }
});

const emit = defineEmits(['resume-material-task', 'republish-job']);
</script>

<style scoped>
.support-section {
  min-width: 0;
}

.support-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.support-card-heading,
.health-score,
.support-row-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.support-card-heading {
  align-items: flex-start;
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
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: rgba(226, 232, 240, 0.78);
  font-size: 0.78rem;
  white-space: nowrap;
}

.support-body {
  margin-top: 12px;
}

.plan-list,
.issue-list,
.log-list {
  display: grid;
  gap: 8px;
}

.plan-row,
.issue-row,
.log-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(15, 23, 42, 0.34);
}

.plan-row > div,
.issue-row,
.log-row {
  min-width: 0;
}

.plan-row strong,
.issue-row strong,
.log-row strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-row span,
.issue-row span,
.log-row span {
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.78rem;
}

.mini-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.56);
  color: rgba(226, 232, 240, 0.9);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.health-score {
  justify-content: flex-start;
  margin-bottom: 10px;
}

.health-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #94a3b8;
}

.health-dot.status-ok,
.health-dot.status-healthy {
  background: #22c55e;
}

.health-dot.status-warn,
.health-dot.status-warning {
  background: #f59e0b;
}

.health-dot.status-fail,
.health-dot.status-error {
  background: #ef4444;
}

.empty-row {
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.82rem;
}

@media (max-width: 980px) {
  .support-grid {
    grid-template-columns: 1fr;
  }
}
</style>
