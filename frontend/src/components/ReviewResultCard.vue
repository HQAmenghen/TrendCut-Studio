<template>
  <div v-if="review" class="review-result-card">
    <div class="review-header">
      <div class="review-title">
        <span>AI审核结果</span>
        <span class="review-status" :class="`status-${review.status}`">
          {{ statusLabel }}
        </span>
      </div>
      <div class="review-score" :class="scoreClass">
        {{ review.overall_score }}<span class="score-max">/100</span>
      </div>
    </div>

    <div class="review-scores">
      <div class="score-item">
        <span class="score-icon" :class="getScoreClass(review.scores.content)">
          {{ getScoreIcon(review.scores.content) }}
        </span>
        <span class="score-label">内容质量</span>
        <span class="score-value">{{ review.scores.content }}分</span>
      </div>
      <div class="score-item">
        <span class="score-icon" :class="getScoreClass(review.scores.subtitle)">
          {{ getScoreIcon(review.scores.subtitle) }}
        </span>
        <span class="score-label">字幕准确性</span>
        <span class="score-value">{{ review.scores.subtitle }}分</span>
      </div>
      <div class="score-item">
        <span class="score-icon" :class="getScoreClass(review.scores.title)">
          {{ getScoreIcon(review.scores.title) }}
        </span>
        <span class="score-label">标题吸引力</span>
        <span class="score-value">{{ review.scores.title }}分</span>
      </div>
      <div class="score-item">
        <span class="score-icon" :class="getScoreClass(review.scores.editing)">
          {{ getScoreIcon(review.scores.editing) }}
        </span>
        <span class="score-label">剪辑质量</span>
        <span class="score-value">{{ review.scores.editing }}分</span>
      </div>
    </div>

    <div v-if="review.fix_suggestions && review.fix_suggestions.length > 0" class="review-suggestions">
      <div class="suggestions-header">
        <span>修复建议 ({{ review.fix_suggestions.length }}条)</span>
      </div>
      <div class="suggestions-list">
        <div
          v-for="(suggestion, index) in review.fix_suggestions.slice(0, 5)"
          :key="index"
          class="suggestion-item"
          :class="`severity-${suggestion.severity}`"
        >
          <span class="suggestion-category">[{{ categoryLabel(suggestion.category) }}]</span>
          <span class="suggestion-text">{{ suggestion.issue }}</span>
        </div>
        <div v-if="review.fix_suggestions.length > 5" class="suggestion-more">
          还有 {{ review.fix_suggestions.length - 5 }} 条建议...
        </div>
      </div>
    </div>

    <div class="review-actions">
      <button
        v-if="showDetails"
        type="button"
        class="ghost-btn compact-btn"
        @click="$emit('show-details')"
      >
        查看详情
      </button>
      <button
        v-if="showSkip && !review.passed"
        type="button"
        class="ghost-btn compact-btn"
        @click="$emit('skip')"
      >
        跳过审核
      </button>
      <button
        v-if="showRegenerate && !review.passed"
        type="button"
        class="primary-btn compact-btn"
        @click="$emit('regenerate')"
      >
        重新生成
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  review: {
    type: Object,
    required: true
  },
  showDetails: {
    type: Boolean,
    default: true
  },
  showSkip: {
    type: Boolean,
    default: true
  },
  showRegenerate: {
    type: Boolean,
    default: false
  }
});

defineEmits(['show-details', 'skip', 'regenerate']);

const statusLabel = computed(() => {
  const labels = {
    passed: '✓ 通过',
    failed: '✗ 未通过',
    reviewing: '审核中',
    skipped: '已跳过'
  };
  return labels[props.review.status] || props.review.status;
});

const scoreClass = computed(() => {
  const score = props.review.overall_score;
  if (score >= 80) return 'score-high';
  if (score >= 60) return 'score-medium';
  return 'score-low';
});

function getScoreClass(score) {
  if (score >= 80) return 'icon-success';
  if (score >= 60) return 'icon-warning';
  return 'icon-error';
}

function getScoreIcon(score) {
  if (score >= 80) return '✓';
  if (score >= 60) return '⚠';
  return '✗';
}

function categoryLabel(category) {
  const labels = {
    content: '内容',
    subtitle: '字幕',
    title: '标题',
    editing: '剪辑'
  };
  return labels[category] || category;
}
</script>

<style scoped>
.review-result-card {
  border: 1px solid var(--line-soft);
  border-radius: 22px;
  padding: 18px;
  background:
    linear-gradient(180deg, rgba(99, 102, 241, 0.05), rgba(99, 102, 241, 0)),
    var(--card-bg);
  box-shadow: var(--shadow);
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft);
}

.review-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--strong-text);
}

.review-status {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.review-status.status-passed {
  background: rgba(34, 197, 94, 0.16);
  color: #15803d;
}

.review-status.status-failed {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

.review-status.status-skipped {
  background: rgba(148, 163, 184, 0.18);
  color: var(--muted);
}

.review-status.status-reviewing {
  background: rgba(59, 130, 246, 0.16);
  color: #2563eb;
}

.review-score {
  font-size: 32px;
  font-weight: 700;
}

.review-score.score-high {
  color: #10b981;
}

.review-score.score-medium {
  color: #f59e0b;
}

.review-score.score-low {
  color: #ef4444;
}

.score-max {
  font-size: 16px;
  color: var(--muted);
  font-weight: 400;
}

.review-scores {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.score-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  border-radius: 14px;
}

.score-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
}

.score-icon.icon-success {
  background: rgba(34, 197, 94, 0.16);
  color: #15803d;
}

.score-icon.icon-warning {
  background: rgba(245, 158, 11, 0.16);
  color: #b45309;
}

.score-icon.icon-error {
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
}

.score-label {
  flex: 1;
  font-size: 13px;
  color: var(--muted);
}

.score-value {
  font-weight: 600;
  font-size: 14px;
  color: var(--strong-text);
}

.review-suggestions {
  margin-bottom: 16px;
}

.suggestions-header {
  font-weight: 600;
  margin-bottom: 8px;
  font-size: 14px;
  color: var(--strong-text);
}

.suggestions-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.suggestion-item {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  background: var(--input-bg);
  border-radius: 12px;
  border: 1px solid var(--line-soft);
  font-size: 13px;
  border-left: 3px solid transparent;
}

.suggestion-item.severity-high {
  border-left-color: #ef4444;
}

.suggestion-item.severity-medium {
  border-left-color: #f59e0b;
}

.suggestion-item.severity-low {
  border-left-color: #3b82f6;
}

.suggestion-category {
  font-weight: 600;
  color: var(--muted);
  flex-shrink: 0;
}

.suggestion-text {
  flex: 1;
  color: var(--text);
}

.suggestion-more {
  padding: 6px 8px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}

.review-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.ghost-btn,
.primary-btn,
.compact-btn {
  border-radius: 12px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
  transition: transform 0.18s ease, opacity 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.ghost-btn {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
  font-weight: 700;
}

.ghost-btn:hover {
  border-color: rgba(99, 102, 241, 0.52);
  background: rgba(99, 102, 241, 0.08);
}

.primary-btn {
  border: none;
  background: linear-gradient(135deg, var(--brand-a), var(--brand-b));
  color: #fff;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(99, 102, 241, 0.18);
}

.primary-btn:hover {
  transform: translateY(-1px);
}

.compact-btn {
  min-width: 96px;
}

@media (max-width: 640px) {
  .review-header,
  .review-scores,
  .review-actions {
    grid-template-columns: 1fr;
  }

  .review-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .review-scores {
    grid-template-columns: 1fr;
  }

  .review-actions > * {
    width: 100%;
  }
}
</style>
