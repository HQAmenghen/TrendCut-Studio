<template>
  <section class="log-panel">
    <div class="log-header">
      <span>{{ title }}</span>
    </div>
    <div class="log-body">
      <div v-if="summaryItems.length" class="log-card">
        <div class="log-kicker">任务信息</div>
        <div class="summary-lines">
          <div v-for="(item, index) in summaryItems" :key="`summary_${index}`" class="summary-line">
            <span class="summary-label">{{ item.label }}</span>
            <strong class="summary-value">{{ item.value }}</strong>
          </div>
        </div>
      </div>
      <div class="log-card">
        <div class="log-kicker">最近日志</div>
        <div v-if="recentLogs.length" class="log-lines">
          <div v-for="(line, index) in recentLogs" :key="`log_${index}`">{{ line }}</div>
        </div>
        <div v-else class="empty-log">暂无日志。</div>
      </div>
      <div class="log-card">
        <div class="log-kicker">错误输出</div>
        <div v-if="errorLogs.length" class="log-lines error">
          <div v-for="(line, index) in errorLogs" :key="`err_${index}`">{{ line }}</div>
        </div>
        <div v-else class="empty-log">暂无错误。</div>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, default: '📝 运行摘要' },
  summaryItems: { type: Array, default: () => [] },
  recentLogs: { type: Array, default: () => [] },
  errorLogs: { type: Array, default: () => [] }
});
</script>

<style scoped>
.log-panel {
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--card-bg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.log-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.log-body {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.log-card {
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  background: var(--card-subtle-bg);
  padding: 16px;
}

.log-kicker {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 12px;
}

.log-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
  padding-right: 6px;
}

.log-lines.error {
  color: #ef4444;
}

.summary-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.45);
}

.summary-label {
  color: var(--muted);
  font-size: 13px;
}

.summary-value {
  color: var(--strong-text);
  font-size: 13px;
  line-height: 1.6;
  text-align: right;
}

.empty-log {
  color: var(--muted);
  font-size: 14px;
}
</style>
