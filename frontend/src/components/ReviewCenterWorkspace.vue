<template>
  <section class="publish-page">
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Quality Control</div>
          <div>
            <h3>AI 视频审核中心</h3>
            <p>基于当前启用的 LLM 提供商进行多模态视频质量分析，从内容、字幕、标题、剪辑四个维度评估视频质量，自动生成修复建议并标记文件分数。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">内容质量</span>
            <span class="flow-pill">字幕准确性</span>
            <span class="flow-pill">标题吸引力</span>
            <span class="flow-pill">剪辑质量</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="dashboard-stat">
            <span>待审核</span>
            <strong>{{ stats.pending }}</strong>
            <p>尚未进行质量评估的视频。</p>
          </div>
          <div class="dashboard-stat">
            <span>已通过</span>
            <strong class="text-green">{{ stats.passed }}</strong>
            <p>评分达标可直接发布的视频。</p>
          </div>
          <div class="dashboard-stat">
            <span>未通过</span>
            <strong class="text-red">{{ stats.failed }}</strong>
            <p>需要根据建议优化的视频。</p>
          </div>
          <div class="dashboard-stat">
            <span>已跳过</span>
            <strong class="text-yellow">{{ stats.skipped }}</strong>
            <p>手动跳过审核的视频。</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <div class="left-column">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>审核配置</h4>
              <p>调整评分权重和通过标准，影响所有新审核任务。</p>
            </div>
            <button type="button" class="ghost-btn compact-btn" @click="saveConfig" :disabled="savingConfig">
              {{ savingConfig ? '保存中...' : '保存配置' }}
            </button>
          </div>
          <div class="builder-card-body">
            <div class="config-row">
              <label class="toggle">
                <input type="checkbox" v-model="config.enabled" />
                启用自动审核
              </label>
            </div>
            <div class="config-row">
              <label class="control-label">最低通过分数</label>
              <input type="number" v-model.number="config.minPassScore" min="0" max="100" class="input-dark" style="width: 100px;" />
            </div>
            <div class="weight-grid">
              <div class="weight-item">
                <label>内容质量</label>
                <input type="number" v-model.number="config.contentWeight" min="0" max="100" class="input-dark" />
                <span>%</span>
              </div>
              <div class="weight-item">
                <label>字幕准确性</label>
                <input type="number" v-model.number="config.subtitleWeight" min="0" max="100" class="input-dark" />
                <span>%</span>
              </div>
              <div class="weight-item">
                <label>标题吸引力</label>
                <input type="number" v-model.number="config.titleWeight" min="0" max="100" class="input-dark" />
                <span>%</span>
              </div>
              <div class="weight-item">
                <label>剪辑质量</label>
                <input type="number" v-model.number="config.editingWeight" min="0" max="100" class="input-dark" />
                <span>%</span>
              </div>
            </div>
          </div>
        </div>

        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>筛选器</h4>
              <p>按审核状态快速筛选视频列表。</p>
            </div>
          </div>
          <div class="builder-card-body">
            <div class="filter-pills">
              <button
                v-for="item in filterOptions"
                :key="item.value"
                :class="['filter-pill', { active: filter === item.value }]"
                @click="filter = item.value"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="right-column">
        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>📹 视频列表</span>
            <button type="button" class="ghost-btn compact-btn" @click="refreshList" :disabled="loading">
              {{ loading ? '加载中...' : '刷新列表' }}
            </button>
          </div>
          <div class="panel-body">
            <div v-if="loading" class="empty-state">
              <p>加载中...</p>
            </div>
            <div v-else-if="filteredVideos.length === 0" class="empty-state">
              <p>暂无视频</p>
            </div>
            <div v-else class="video-grid">
              <div
                v-for="video in filteredVideos"
                :key="video.path"
                class="video-card-compact"
                :class="[
                  reviewCardClass(video),
                  { reviewing: reviewingVideos.has(video.path) }
                ]"
              >
                <div class="video-thumb">
                  <video
                    v-if="video.url"
                    :src="video.url"
                    preload="metadata"
                  ></video>
                  <div v-if="isReviewing(video.path)" class="reviewing-overlay">
                    <div class="reviewing-badge">AI 审核中</div>
                    <div class="reviewing-progress">
                      <span></span>
                    </div>
                  </div>
                  <div v-if="video.reviewStatus" class="status-overlay" :class="video.reviewStatus.status">
                    <span v-if="video.reviewStatus.score !== undefined">{{ video.reviewStatus.score }}分</span>
                    <span v-else>{{ getStatusText(video.reviewStatus.status) }}</span>
                  </div>
                </div>

                <div class="video-info-compact">
                  <div class="title-row">
                    <div class="video-title-compact">{{ video.displayName }}</div>
                    <span
                      v-if="video.reviewStatus?.score !== undefined"
                      class="result-chip score-chip"
                      :class="video.reviewStatus?.status"
                    >
                      {{ video.reviewStatus.score }} 分
                    </span>
                  </div>
                  <div class="video-meta-compact">
                    <span>{{ formatFileSize(video.size) }}</span>
                    <span>{{ formatDate(video.mtime) }}</span>
                  </div>

                  <div v-if="video.reviewStatus?.status === 'passed'" class="inline-tags">
                    <span class="result-chip passed">审核通过</span>
                    <span
                      v-for="tag in buildPassedTags(video)"
                      :key="`${video.path}-${tag}`"
                      class="result-chip neutral"
                    >
                      {{ tag }}
                    </span>
                  </div>

                  <div v-if="video.reviewStatus?.status === 'failed'" class="inline-tags">
                    <span class="result-chip failed">未通过</span>
                    <span class="result-chip warning">
                      {{ (video.reviewStatus?.suggestions || []).length }} 条修改建议
                    </span>
                  </div>

                  <div v-if="video.regenerationComparison" class="inline-tags">
                    <span
                      class="result-chip"
                      :class="scoreDeltaChipClass(video.regenerationComparison.overallDelta)"
                    >
                      {{ formatScoreDeltaLabel(video.regenerationComparison) }}
                    </span>
                    <span
                      v-for="item in buildScoreDeltaTags(video.regenerationComparison)"
                      :key="`${video.path}-${item.key}`"
                      class="result-chip neutral"
                    >
                      {{ item.label }}
                    </span>
                  </div>

                  <div v-if="video.reviewStatus && (video.reviewStatus.status === 'passed' || video.reviewStatus.status === 'failed')" class="score-bar">
                    <div class="score-item-mini">
                      <span>内容</span>
                      <strong>{{ video.reviewStatus.scores?.content || 0 }}</strong>
                    </div>
                    <div class="score-item-mini">
                      <span>字幕</span>
                      <strong>{{ video.reviewStatus.scores?.subtitle || 0 }}</strong>
                    </div>
                    <div class="score-item-mini">
                      <span>标题</span>
                      <strong>{{ video.reviewStatus.scores?.title || 0 }}</strong>
                    </div>
                    <div class="score-item-mini">
                      <span>剪辑</span>
                      <strong>{{ video.reviewStatus.scores?.editing || 0 }}</strong>
                    </div>
                  </div>

                  <div v-if="video.reviewStatus?.suggestions?.length" class="suggestions-compact">
                    <div class="suggestions-title-compact">修复建议：</div>
                    <ul>
                      <li v-for="(suggestion, idx) in video.reviewStatus.suggestions.slice(0, 2)" :key="idx">
                        [{{ suggestion.category }}] {{ suggestion.issue }}
                      </li>
                    </ul>
                  </div>

                  <div class="actions-compact">
                    <button
                      type="button"
                      class="btn-ghost-compact"
                      @click="viewVideo(video)"
                    >
                      查看
                    </button>

                    <button
                      type="button"
                      class="btn-ghost-compact publish-btn"
                      @click="sendToPublish(video)"
                    >
                      转入发布中心
                    </button>

                      <button
                        v-if="!video.reviewStatus || video.reviewStatus.status === 'pending'"
                        @click="reviewVideo(video)"
                        :disabled="isReviewing(video.path)"
                        class="btn-primary-compact"
                      >
                        {{ isReviewing(video.path) ? '审核中...' : '开始审核' }}
                      </button>

                      <button
                        v-if="video.reviewStatus?.status === 'failed'"
                        @click="reviewVideo(video)"
                        :disabled="isReviewing(video.path)"
                        class="btn-primary-compact"
                      >
                        重新审核
                      </button>

                    <button
                      v-if="video.reviewStatus?.suggestions?.length > 0"
                      @click="regenerateVideo(video)"
                      class="btn-primary-compact"
                      style="background: #10b981;"
                    >
                      按建议重做
                    </button>

                    <button
                      v-if="!video.reviewStatus || video.reviewStatus.status === 'pending'"
                      @click="skipReview(video)"
                      class="btn-ghost-compact"
                    >
                      跳过
                    </button>

                    <button
                      v-if="video.reviewStatus"
                      @click="deleteReview(video)"
                      class="btn-ghost-compact"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const loading = ref(false);
const savingConfig = ref(false);
const videos = ref([]);
const filter = ref('all');
const reviewingVideos = ref(new Set());
const config = ref({
  enabled: true,
  minPassScore: 65,
  contentWeight: 30,
  subtitleWeight: 25,
  titleWeight: 20,
  editingWeight: 25
});

const filterOptions = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'passed', label: '已通过' },
  { value: 'failed', label: '未通过' },
  { value: 'skipped', label: '已跳过' }
];

const stats = computed(() => {
  return {
    pending: videos.value.filter(v => !v.reviewStatus || v.reviewStatus.status === 'pending').length,
    passed: videos.value.filter(v => v.reviewStatus?.status === 'passed').length,
    failed: videos.value.filter(v => v.reviewStatus?.status === 'failed').length,
    skipped: videos.value.filter(v => v.reviewStatus?.status === 'skipped').length
  };
});

const filteredVideos = computed(() => {
  if (filter.value === 'all') return videos.value;
  if (filter.value === 'pending') {
    return videos.value.filter(v => !v.reviewStatus || v.reviewStatus.status === 'pending');
  }
  return videos.value.filter(v => v.reviewStatus?.status === filter.value);
});

function isReviewing(videoPath) {
  return reviewingVideos.value.has(videoPath);
}

function setReviewing(videoPath, enabled) {
  const next = new Set(reviewingVideos.value);
  if (enabled) {
    next.add(videoPath);
  } else {
    next.delete(videoPath);
  }
  reviewingVideos.value = next;
}

function scoreDeltaChipClass(delta) {
  if (!Number.isFinite(Number(delta))) return 'neutral';
  return Number(delta) >= 0 ? 'passed' : 'failed';
}

function formatDelta(delta) {
  if (!Number.isFinite(Number(delta))) return '--';
  const normalized = Number(delta);
  return `${normalized >= 0 ? '+' : ''}${normalized}`;
}

function formatScoreDeltaLabel(comparison) {
  if (!comparison) return '已重做';
  const previous = Number(comparison.previousOverallScore);
  const current = Number(comparison.currentOverallScore);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) {
    return '已重做';
  }
  return `重做对比 ${previous}→${current} (${formatDelta(comparison.overallDelta)})`;
}

function buildScoreDeltaTags(comparison) {
  if (!comparison || typeof comparison !== 'object') return [];
  const deltas = comparison.deltas || {};
  return [
    ['content', '内容', deltas.content],
    ['subtitle', '字幕', deltas.subtitle],
    ['title', '标题', deltas.title],
    ['editing', '剪辑', deltas.editing]
  ]
    .filter(([, , delta]) => Number.isFinite(Number(delta)) && Number(delta) !== 0)
    .map(([key, label, delta]) => ({
      key,
      label: `${label}${formatDelta(delta)}`
    }));
}

async function refreshList() {
  loading.value = true;
  try {
    const res = await fetch('/api/publish/assets?refresh=1');
    const data = await res.json();
    if (data.success) {
      videos.value = (data.assets || [])
        .filter((asset) => String(asset?.path || '').toLowerCase().endsWith('.mp4'))
        .filter((asset) => !asset?.metadata?.reviewCenterHiddenAt)
        .map((asset) => {
          const rawReview = asset?.metadata?.aiReview || null;
          const normalizedReview = rawReview ? {
            reviewId: rawReview.reviewId,
            status: rawReview.status || 'pending',
            score: Number.isFinite(Number(rawReview.overallScore))
              ? Number(rawReview.overallScore)
              : (Number.isFinite(Number(rawReview.overall_score)) ? Number(rawReview.overall_score) : undefined),
            scores: {
              content: Number(rawReview?.scores?.content ?? rawReview?.scores?.contentQuality ?? 0),
              subtitle: Number(rawReview?.scores?.subtitle ?? rawReview?.scores?.subtitleAccuracy ?? 0),
              title: Number(rawReview?.scores?.title ?? rawReview?.scores?.titleAppeal ?? 0),
              editing: Number(rawReview?.scores?.editing ?? rawReview?.scores?.editingQuality ?? 0)
            },
            suggestions: Array.isArray(rawReview.fixSuggestions)
              ? rawReview.fixSuggestions
              : (Array.isArray(rawReview.fix_suggestions) ? rawReview.fix_suggestions : [])
          } : null;

          return {
            path: asset.path,
            url: asset.url,
            assetId: asset.id,
            displayName: asset.compactLabel || asset.displayLabel || asset.label || '未命名视频',
            size: asset.sizeBytes || 0,
            mtime: asset.updatedAt || '',
            sourceType: asset.sourceType || '',
            reviewStatus: normalizedReview,
            regenerationComparison: asset?.metadata?.regeneration?.scoreComparison || null
          };
        });
    }
  } catch (err) {
    console.error('获取视频列表失败:', err);
  } finally {
    loading.value = false;
  }
}

async function reviewVideo(video) {
  setReviewing(video.path, true);
  videos.value = videos.value.map((item) => (
    item.path === video.path
      ? {
          ...item,
          reviewStatus: {
            ...(item.reviewStatus || {}),
            status: 'reviewing'
          }
        }
      : item
  ));
  try {
      const res = await fetch('/api/review/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoPath: video.path,
          assetId: video.assetId
        })
      });
    const data = await res.json();
    if (data.success) {
      await refreshList();
    } else {
      await refreshList();
      alert('审核失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    console.error('审核失败:', err);
    await refreshList();
    alert('审核失败: ' + err.message);
  } finally {
    setReviewing(video.path, false);
  }
}

async function skipReview(video) {
  try {
    const res = await fetch('/api/review/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: video.path, assetId: video.assetId })
    });
    const data = await res.json();
    if (data.success) {
      await refreshList();
    }
  } catch (err) {
    console.error('跳过审核失败:', err);
  }
}

async function deleteReview(video) {
  if (!video.reviewStatus?.reviewId) return;
  if (!confirm('确定删除审核记录吗？')) return;

  try {
    const params = new URLSearchParams({ videoPath: video.path });
    const res = await fetch(`/api/review/${encodeURIComponent(video.reviewStatus.reviewId)}?${params.toString()}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      await refreshList();
    }
  } catch (err) {
    console.error('删除审核记录失败:', err);
  }
}

async function regenerateVideo(video) {
  if (!confirm('确定要根据审核建议重新生成视频吗？\n\n这将创建一个新的渲染任务，原视频保持不变。')) {
    return;
  }

  try {
    const res = await fetch('/api/review/regenerate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoPath: video.path,
        assetId: video.assetId
      })
    });
    const data = await res.json();

    if (data.success) {
      const adjustments = data.adjustments || {};
      let message = '视频已加入重新生成队列！\n\n';

      if (adjustments.titleChanged && adjustments.newTitle) {
        message += `✓ 标题已更新为: ${adjustments.newTitle}\n`;
      }
      if (adjustments.subtitlesRegenerated) {
        message += `✓ 将重新生成字幕\n`;
      }
      if (adjustments.appliedSuggestionsCount > 0) {
        message += `✓ 已应用 ${adjustments.appliedSuggestionsCount} 条高优先级建议\n`;
      }
      if (adjustments.repairProfile) {
        message += `✓ 修补策略: ${adjustments.repairProfile}\n`;
      }
      if (Array.isArray(adjustments.repairFocus) && adjustments.repairFocus.length) {
        message += `✓ 修补重点: ${adjustments.repairFocus.join(' / ')}\n`;
      }
      if (Array.isArray(adjustments.repairSummary) && adjustments.repairSummary.length) {
        message += '\n本次修补动作:\n';
        adjustments.repairSummary.slice(0, 4).forEach((item) => {
          message += `- ${item}\n`;
        });
      }

      message += `\n任务ID: ${data.jobId}`;
      alert(message);

      // 刷新列表
      await refreshList();
    } else {
      alert('重新生成失败: ' + (data.error || '未知错误') + '\n\n' + (data.hint || ''));
    }
  } catch (err) {
    console.error('重新生成失败:', err);
    alert('重新生成失败: ' + err.message);
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/review/config');
    const data = await res.json();
    if (data.success && data.config) {
      config.value = { ...config.value, ...data.config };
    }
  } catch (err) {
    console.error('加载配置失败:', err);
  }
}

async function saveConfig() {
  savingConfig.value = true;
  try {
    const res = await fetch('/api/review/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value)
    });
    const data = await res.json();
    if (data.success) {
      alert('配置已保存');
    }
  } catch (err) {
    console.error('保存配置失败:', err);
    alert('保存失败');
  } finally {
    savingConfig.value = false;
  }
}

function getStatusText(status) {
  const map = {
    pending: '待审核',
    passed: '通过',
    failed: '未通过',
    skipped: '已跳过'
  };
  return map[status] || status;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildPassedTags(video) {
  const tags = [];
  const scores = video?.reviewStatus?.scores || {};
  if ((scores.content || 0) >= 80) tags.push('内容达标');
  if ((scores.subtitle || 0) >= 80) tags.push('字幕良好');
  if ((scores.title || 0) >= 80) tags.push('标题合格');
  if ((scores.editing || 0) >= 80) tags.push('剪辑稳定');
  return tags.slice(0, 3);
}

function reviewCardClass(video) {
  const status = video?.reviewStatus?.status;
  if (!status) return 'status-pending-card';
  return `status-${status}-card`;
}

function viewVideo(video) {
  if (!video?.url) return;
  window.open(video.url, '_blank', 'noopener,noreferrer');
}

function sendToPublish(video) {
  window.dispatchEvent(new CustomEvent('review-center:to-publish', {
    detail: {
      assetId: video?.assetId || '',
      path: video?.path || '',
      url: video?.url || ''
    }
  }));
}

onMounted(() => {
  refreshList();
  loadConfig();
});
</script>

<style scoped>
.publish-page {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.hero-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 32px;
  background: var(--hero-bg);
  box-shadow: var(--shadow);
}

.hero-panel::after {
  content: '';
  position: absolute;
  inset: auto -8% -42% auto;
  width: 380px;
  height: 380px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(125, 211, 252, 0.12), transparent 68%);
  pointer-events: none;
}

.hero-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr);
  gap: 22px;
  padding: 28px;
}

.hero-copy {
  display: grid;
  gap: 18px;
}

.section-kicker {
  color: #7dd3fc;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

.hero-copy h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 34px;
  line-height: 1.08;
}

.hero-copy p {
  margin: 12px 0 0;
  max-width: 760px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}

.flow-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.flow-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-stat {
  border-radius: 24px;
  border: 1px solid var(--line-soft);
  background: var(--panel-subtle);
  padding: 18px;
  display: grid;
  gap: 6px;
}

.dashboard-stat span {
  color: var(--muted);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.dashboard-stat strong {
  color: var(--strong-text);
  font-size: 30px;
  line-height: 1;
}

.dashboard-stat p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.text-green {
  color: #10b981;
}

.text-red {
  color: #ef4444;
}

.text-yellow {
  color: #f59e0b;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}

.left-column,
.right-column {
  display: grid;
  gap: 22px;
}

.builder-card,
.panel {
  border-radius: 28px;
  border: 1px solid var(--line-soft);
  background: var(--card-bg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.builder-card-header,
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 24px 16px;
  border-bottom: 1px solid var(--line-soft);
}

.builder-card-header h4,
.panel-header span {
  margin: 0;
  color: var(--strong-text);
  font-size: 18px;
  font-weight: 900;
}

.builder-card-header p {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

.panel-header-between {
  align-items: center;
}

.builder-card-body,
.panel-body {
  padding: 22px 24px 24px;
}

.config-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--line-soft);
}

.config-row:last-child {
  border-bottom: none;
}

.weight-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 16px;
}

.weight-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
}

.weight-item label {
  font-size: 13px;
  color: var(--muted);
  flex: 1;
  line-height: 1.5;
}

.weight-item input {
  width: 60px;
  text-align: center;
}

.weight-item span {
  font-size: 13px;
  color: var(--muted);
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--strong-text);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.toggle input {
  width: 18px;
  height: 18px;
}

.control-label {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.input-dark {
  border: 1px solid var(--input-border);
  border-radius: 16px;
  background: var(--input-bg);
  color: var(--text);
  padding: 12px 14px;
  font: inherit;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.input-dark:focus {
  outline: none;
  border-color: rgba(99, 102, 241, 0.66);
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
}

.filter-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-pill {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--line-soft);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.filter-pill:hover {
  border-color: var(--line);
  background: var(--input-bg);
}

.filter-pill.active {
  border-color: var(--brand-a);
  background: var(--brand-a);
  color: white;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--muted);
}

.ghost-btn,
.btn-ghost-compact {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
  font-weight: 700;
}

.ghost-btn,
.compact-btn,
.btn-primary-compact,
.btn-ghost-compact {
  border-radius: 14px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease;
}

.ghost-btn:hover,
.btn-ghost-compact:hover {
  border-color: rgba(99, 102, 241, 0.52);
  background: rgba(99, 102, 241, 0.08);
}

.ghost-btn:disabled,
.btn-primary-compact:disabled,
.btn-ghost-compact:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.video-card-compact {
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s;
  position: relative;
}

.video-card-compact:hover {
  border-color: var(--line);
  background: var(--card-bg);
}

.video-card-compact::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: transparent;
}

.status-pending-card::before {
  background: rgba(59, 130, 246, 0.8);
}

.status-passed-card {
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 14px 28px rgba(16, 185, 129, 0.08);
}

.status-passed-card::before {
  background: linear-gradient(180deg, #34d399, #059669);
}

.status-failed-card {
  border-color: rgba(239, 68, 68, 0.32);
  box-shadow: 0 14px 28px rgba(239, 68, 68, 0.08);
}

.status-failed-card::before {
  background: linear-gradient(180deg, #f87171, #dc2626);
}

.status-skipped-card {
  border-color: rgba(245, 158, 11, 0.32);
  box-shadow: 0 14px 28px rgba(245, 158, 11, 0.08);
}

.status-skipped-card::before {
  background: linear-gradient(180deg, #fbbf24, #d97706);
}

.status-reviewing-card {
  border-color: rgba(99, 102, 241, 0.34);
  box-shadow: 0 14px 28px rgba(99, 102, 241, 0.08);
}

.status-reviewing-card::before {
  background: linear-gradient(180deg, #818cf8, #4f46e5);
}

.video-card-compact.reviewing {
  opacity: 0.5;
  pointer-events: none;
}

.video-thumb {
  position: relative;
  width: 100%;
  height: 160px;
  background: #000;
  overflow: hidden;
}

.video-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reviewing-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: end;
  gap: 10px;
  padding: 14px;
  background: linear-gradient(180deg, rgba(10, 15, 30, 0.06), rgba(10, 15, 30, 0.72));
}

.reviewing-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.92);
  color: #fff;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.reviewing-progress {
  position: relative;
  height: 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.2);
}

.reviewing-progress span {
  position: absolute;
  inset: 0 auto 0 -35%;
  width: 35%;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255,255,255,0), #ffffff, rgba(255,255,255,0));
  animation: review-progress-slide 1.4s linear infinite;
}

.status-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  backdrop-filter: blur(8px);
}

.status-overlay.pending {
  background: rgba(59, 130, 246, 0.9);
  color: white;
}

.status-overlay.passed {
  background: rgba(16, 185, 129, 0.9);
  color: white;
}

.status-overlay.failed {
  background: rgba(239, 68, 68, 0.9);
  color: white;
}

.status-overlay.skipped {
  background: rgba(245, 158, 11, 0.9);
  color: white;
}

@keyframes review-progress-slide {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(420%);
  }
}

.video-info-compact {
  padding: 14px 12px 12px;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.video-title-compact {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--strong-text);
  flex: 1;
}

.video-meta-compact {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 10px;
}

.status-passed-card .video-title-compact {
  color: #0f9f6e;
}

.status-failed-card .video-title-compact {
  color: #ef4444;
}

.status-skipped-card .video-title-compact {
  color: #d97706;
}

.score-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px;
  background: var(--input-bg);
  border-radius: 6px;
}

.score-item-mini {
  flex: 1;
  text-align: center;
}

.score-item-mini span {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-bottom: 2px;
}

.score-item-mini strong {
  display: block;
  font-size: 14px;
  color: var(--brand-a);
}

.suggestions-compact {
  margin-bottom: 10px;
  padding: 8px;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 6px;
  font-size: 11px;
}

.suggestions-title-compact {
  font-weight: 500;
  margin-bottom: 4px;
  color: var(--strong-text);
}

.suggestions-compact ul {
  margin: 0;
  padding-left: 16px;
  color: var(--muted);
}

.suggestions-compact li {
  margin: 2px 0;
}

.inline-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.result-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.result-chip.score-chip {
  white-space: nowrap;
}

.result-chip.passed {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.result-chip.failed {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}

.result-chip.warning {
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
}

.result-chip.neutral {
  background: rgba(99, 102, 241, 0.12);
  color: var(--brand-a);
}

.actions-compact {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-primary-compact {
  flex: 1;
  border: none;
  min-width: 110px;
  background: linear-gradient(135deg, var(--brand-a), var(--brand-b));
  color: white;
  box-shadow: 0 10px 24px rgba(99, 102, 241, 0.18);
}

.btn-primary-compact:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-ghost-compact {
  min-width: 84px;
}

.publish-btn {
  border-color: rgba(99, 102, 241, 0.28);
  color: var(--brand-a);
}

@media (max-width: 1240px) {
  .hero-grid,
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .hero-grid {
    padding: 22px;
  }

  .hero-copy h3 {
    font-size: 28px;
  }

  .hero-stats,
  .weight-grid,
  .video-grid {
    grid-template-columns: 1fr;
  }

  .builder-card-header,
  .panel-header,
  .builder-card-body,
  .panel-body {
    padding-left: 18px;
    padding-right: 18px;
  }
}

@media (max-width: 640px) {
  .config-row,
  .builder-card-header,
  .panel-header,
  .actions-compact {
    flex-direction: column;
    align-items: stretch;
  }

  .weight-item {
    grid-column: 1 / -1;
  }

  .video-grid {
    grid-template-columns: 1fr;
  }
}
</style>
