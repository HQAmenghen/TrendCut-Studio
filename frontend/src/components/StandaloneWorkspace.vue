<template>
  <section class="standalone-page">
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Vertical Finishing</div>
          <div>
            <h3>竖屏后期编排台</h3>
            <p>把横屏素材、字幕和标题编排成统一的竖屏模板。现在版式控制、结果预览和批量队列放在同一个工作流里，不需要来回切换脑回路。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">素材上传</span>
            <span class="flow-pill">标题生成</span>
            <span class="flow-pill">字幕编排</span>
            <span class="flow-pill">批量队列</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="module-summary-card">
            <span>主视频</span>
            <strong>{{ form.videoName || form.sourceTaskDir ? '已载入' : '待上传' }}</strong>
            <p>支持单条手动合成，也支持从热点榜单批量送入。</p>
          </div>
          <div class="module-summary-card">
            <span>字幕策略</span>
            <strong>{{ form.useASR ? 'ASR 自动打轴' : (form.srtName ? '使用外部 SRT' : '待选择') }}</strong>
            <p>当前会优先保持字幕两行内并减少难看的短尾行。</p>
          </div>
          <div class="module-summary-card">
            <span>版式模式</span>
            <strong>{{ renderPresetLabel }}</strong>
            <p>标题、字幕、英文字幕和下移参数会一起作用到单条与批量任务。</p>
          </div>
          <div class="module-summary-card">
            <span>队列状态</span>
            <strong>{{ `${queueStatus?.running || 0} 运行 / ${queueStatus?.queued || 0} 排队` }}</strong>
            <p>所有批量任务独立工作目录，适合并行生成。</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <div class="workspace-main">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>输入与素材</h4>
              <p>先决定输入方式，再让系统根据当前模板生成竖屏成片。</p>
            </div>
          </div>
          <div class="builder-card-body stack">
            <div class="upload-grid">
              <div class="config-cluster">
                <div class="config-cluster-title">主视频</div>
                <label class="upload-card">
                  <span class="upload-icon">🎞️</span>
                  <span class="upload-title">上传横屏源视频</span>
                  <span class="upload-name">{{ form.videoName || (form.sourceTaskDir ? `任务：${form.sourceTaskTitle || form.sourceTaskDir}` : '点击上传 mp4') }}</span>
                  <input type="file" accept="video/mp4,video/*" hidden @change="onFileChange('video', $event)" />
                </label>
              </div>
              <div class="config-cluster">
                <div class="config-cluster-title">字幕来源</div>
                <label class="upload-card">
                  <span class="upload-icon">📄</span>
                  <span class="upload-title">{{ form.srtName || '上传 .srt 字幕' }}</span>
                  <span class="upload-sub">或切换为自动打轴</span>
                  <button
                    type="button"
                    class="asr-toggle"
                    :class="{ active: form.useASR }"
                    @click.prevent="$emit('update:use-asr', !form.useASR)"
                  >
                    {{ form.useASR ? '✅ 自动识别字幕' : '📎 使用外部字幕' }}
                  </button>
                  <input type="file" accept=".srt" hidden @change="onFileChange('srt', $event)" />
                </label>
              </div>
            </div>

            <div class="config-cluster task-import-cluster">
              <div class="config-cluster-title">按任务导入</div>
              <div class="task-import-row">
                <select class="input-dark text-sm" :value="form.sourceTaskDir" @change="$emit('select-material-task', $event.target.value)">
                  <option value="">不使用任务导入</option>
                  <option v-for="task in materialTasks" :key="task.id" :value="task.outputDir">
                    {{ task.title || task.outputDir }}
                  </option>
                </select>
                <button type="button" class="dark-chip" @click="$emit('refresh-material-tasks')" :disabled="materialTasksLoading">
                  {{ materialTasksLoading ? '刷新中...' : '刷新任务' }}
                </button>
              </div>
              <div v-if="selectedMaterialTask" class="task-summary">
                <strong>{{ selectedMaterialTask.title || selectedMaterialTask.outputDir }}</strong>
                <span>{{ selectedMaterialTask.outputDir }}</span>
                <div class="cluster-metrics">
                  <div class="cluster-metric">字幕：{{ selectedMaterialTask.hasSubtitles ? `${selectedMaterialTask.subtitleSource} / ${selectedMaterialTask.subtitleCount} 条` : '无结构化字幕，将按设置处理' }}</div>
                  <div class="cluster-metric">脚本：{{ selectedMaterialTask.scriptPreview || '未找到口播脚本' }}</div>
                </div>
              </div>
              <p v-else class="muted-copy">选择已完成的素材驱动任务后，系统会直接使用该任务的成片和 JSON 信息生成竖屏。</p>
            </div>

            <div class="config-cluster">
              <div class="config-cluster-title">标题脚本</div>
              <textarea
                class="input-dark resize-none"
                rows="2"
                :value="form.title"
                placeholder="输入吸引人的视频标题 (支持 \n 换行)..."
                @input="$emit('update:title', $event.target.value)"
              ></textarea>
              <p class="muted-copy">留空时会根据 ASR 字幕自动生成热点标题。建议控制在两行，避免过多压缩视频区域。</p>
            </div>
          </div>
        </div>

        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>版式设置（高级）</h4>
              <p>默认模板已经能直接生成竖屏。只有你要细调标题、字幕字号和位置时，再展开这里。</p>
            </div>
            <div class="template-pill">当前模板：{{ renderPresetLabel }}</div>
          </div>
          <div class="builder-card-body stack">
            <div class="quick-tip-card">
              <strong>默认模板已适合直接出片</strong>
              <p>当前模板会尽量保持标题两行内、中文字幕两行内，并把英文字幕压缩在底部安全区域。只有你要换风格时，再展开下方高级设置。</p>
            </div>
            <details class="advanced-block">
              <summary>展开版式高级设置</summary>
              <div class="advanced-body render-grid">
                <div class="controls-grid">
                  <div>
                    <label class="control-label">标题字号</label>
                    <input type="number" min="56" max="140" class="input-dark text-center" :value="form.renderOptions.titleFontSize" @input="$emit('update:render-option', 'titleFontSize', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">标题最小字号</label>
                    <input type="number" min="36" max="100" class="input-dark text-center" :value="form.renderOptions.titleMinFontSize" @input="$emit('update:render-option', 'titleMinFontSize', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">标题最大行数</label>
                    <input type="number" min="1" max="3" class="input-dark text-center" :value="form.renderOptions.titleMaxLines" @input="$emit('update:render-option', 'titleMaxLines', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">中文字幕字号</label>
                    <input type="number" min="24" max="72" class="input-dark text-center" :value="form.renderOptions.subtitleFontSize" @input="$emit('update:render-option', 'subtitleFontSize', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">字幕最小字号</label>
                    <input type="number" min="20" max="56" class="input-dark text-center" :value="form.renderOptions.subtitleMinFontSize" @input="$emit('update:render-option', 'subtitleMinFontSize', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">字幕最大行数</label>
                    <input type="number" min="1" max="3" class="input-dark text-center" :value="form.renderOptions.subtitleMaxLines" @input="$emit('update:render-option', 'subtitleMaxLines', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">字幕下移</label>
                    <input type="number" min="-20" max="80" class="input-dark text-center" :value="form.renderOptions.subtitleOffsetY" @input="$emit('update:render-option', 'subtitleOffsetY', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">英文字幕字号</label>
                    <input type="number" min="24" max="72" class="input-dark text-center" :value="form.renderOptions.englishSubtitleFontSize" @input="$emit('update:render-option', 'englishSubtitleFontSize', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="control-label">英文最大行数</label>
                    <input type="number" min="1" max="3" class="input-dark text-center" :value="form.renderOptions.englishMaxLines" @input="$emit('update:render-option', 'englishMaxLines', Number($event.target.value))" />
                  </div>
                </div>

                <div class="config-cluster preview-cluster">
                  <div class="preview-phone">
                    <div class="preview-title-band"></div>
                    <div class="preview-title-box" :style="titleBoxStyle">热点标题保持两行内</div>
                    <div class="preview-video-box"></div>
                    <div class="preview-subtitle-layer" :style="subtitleLayerStyle">
                      <div class="preview-en-sub" :style="englishBoxStyle">English subtitle will stay compact here</div>
                      <div class="preview-zh-card" :style="chineseBoxStyle">中文字幕尽量控制在两行内</div>
                    </div>
                  </div>
                  <div class="preview-insights">
                    <div class="insight-row">
                      <span>标题占比</span>
                      <span>{{ form.renderOptions.titleFontSize }}px / {{ form.renderOptions.titleMaxLines }} 行</span>
                    </div>
                    <div class="control-meter"><span :style="{ width: `${titleMeter}%` }"></span></div>
                    <div class="insight-row">
                      <span>中文字幕密度</span>
                      <span>{{ form.renderOptions.subtitleFontSize }}px / {{ form.renderOptions.subtitleMaxLines }} 行</span>
                    </div>
                    <div class="control-meter"><span :style="{ width: `${subtitleMeter}%` }"></span></div>
                    <div class="insight-row">
                      <span>字幕下移幅度</span>
                      <span>{{ form.renderOptions.subtitleOffsetY }}px</span>
                    </div>
                    <div class="control-meter"><span :style="{ width: `${offsetMeter}%` }"></span></div>
                    <div class="insight-row">
                      <span>英文字幕权重</span>
                      <span>{{ form.renderOptions.englishSubtitleFontSize }}px / {{ form.renderOptions.englishMaxLines }} 行</span>
                    </div>
                    <div class="control-meter"><span :style="{ width: `${englishMeter}%` }"></span></div>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        <button type="button" class="btn-primary full-btn" @click="$emit('submit')" :disabled="loading">
          {{ loading ? '正在生成动态竖屏...' : '🚀 一键生成动态竖屏' }}
        </button>

        <div v-if="loading" class="panel progress-panel">
          <div class="panel-header"><span>📡 实时进度</span></div>
          <div class="panel-body">
            <div class="progress-head">
              <span class="truncate">{{ statusText }}</span>
              <span>{{ progress }}%</span>
            </div>
            <div class="progress-meta">
              <span>已用时：{{ activeDurationLabel }}</span>
              <span>本次耗时：{{ lastDurationLabel }}</span>
            </div>
            <div class="progress-bar"><span :style="{ width: `${progress}%` }"></span></div>
          </div>
        </div>
      </div>

      <div class="workspace-side">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>XAI 批量竖屏队列</h4>
              <p>从热点榜单里直送来的视频会按这里的并发和模板设置依次执行。</p>
            </div>
            <button type="button" class="dark-chip" @click="$emit('refresh')" :disabled="loading">刷新状态</button>
          </div>
          <div class="builder-card-body stack">
            <div class="queue-stats">
              <div class="module-summary-card">
                <span>并发</span>
                <strong>{{ queueStatus?.concurrency || 0 }}</strong>
              </div>
              <div class="module-summary-card">
                <span>运行</span>
                <strong>{{ queueStatus?.running || 0 }}</strong>
              </div>
              <div class="module-summary-card">
                <span>排队</span>
                <strong>{{ queueStatus?.queued || 0 }}</strong>
              </div>
            </div>

            <div class="config-cluster">
              <div class="config-cluster-title">当前批量模板</div>
              <div class="cluster-title">{{ renderPresetLabel }}</div>
              <div class="muted-copy">批量送入竖屏队列时，会沿用当前标题字号、字幕字号和字幕下移参数。</div>
              <div class="cluster-metrics">
                <div class="cluster-metric">标题 {{ form.renderOptions.titleFontSize }} / {{ form.renderOptions.titleMaxLines }} 行</div>
                <div class="cluster-metric">中文字幕 {{ form.renderOptions.subtitleFontSize }} / {{ form.renderOptions.subtitleMaxLines }} 行</div>
                <div class="cluster-metric">字幕下移 {{ form.renderOptions.subtitleOffsetY }} / 英文 {{ form.renderOptions.englishSubtitleFontSize }}</div>
              </div>
            </div>

            <div class="queue-jobs">
              <div v-if="!(queueStatus?.jobs || []).length" class="empty-state">还没有批量竖屏任务。</div>
              <div v-for="job in (queueStatus?.jobs || []).slice(0, 8)" :key="job.id" class="job-card">
                <div class="job-head">
                  <strong>{{ job.title || job.sourceTitle || job.id }}</strong>
                  <span>{{ job.status || 'unknown' }}</span>
                </div>
                <div class="job-meta">{{ job.message || '等待执行...' }}</div>
                <div class="job-duration">{{ formatJobDuration(job) }}</div>
                <div v-if="job.logs?.length" class="job-log-preview">
                  {{ job.logs[job.logs.length - 1] }}
                </div>
                <div class="progress-bar small"><span :style="{ width: `${safeProgress(job.progress)}%` }"></span></div>
                <div class="queue-actions">
                  <button
                    type="button"
                    class="ghost-mini"
                    @click="$emit('cancel-queue-job', job.id)"
                    :disabled="['completed', 'failed', 'cancelled'].includes(job.status)"
                  >
                    取消任务
                  </button>
                  <button
                    v-if="['completed', 'failed', 'cancelled'].includes(job.status)"
                    type="button"
                    class="ghost-mini danger"
                    @click="$emit('delete-queue-job', job.id)"
                  >
                    删除任务
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>结果预览</h4>
              <p>当前竖屏成片会直接落到这里，方便检查标题、字幕和版式。现在也可以切换查看历史成品。</p>
            </div>
          </div>
          <div class="builder-card-body stack">
            <div v-if="previewOptions.length > 1">
              <label class="control-label">选择预览成品</label>
              <select class="input-dark text-sm" :value="previewSelection" @change="$emit('update:preview-selection', $event.target.value)">
                <option value="auto">自动选择最新成品</option>
                <option v-for="option in previewOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
              </select>
            </div>
            <div v-if="previewVideoUrl" class="video-shell">
              <video :src="previewVideoUrl" controls class="result-video"></video>
            </div>
            <div v-else class="empty-preview">当前还没有生成结果。</div>
            <a v-if="previewVideoUrl" :href="previewVideoUrl" download class="download-link">下载当前成片</a>
          </div>
        </div>
      </div>
    </div>

    <RunLogPanel title="📝 运行摘要" :recent-logs="recentLogs.value" :error-logs="errorLogs.value" />

    <div v-if="errorState?.message" class="error-box">
      <strong>{{ errorState.message }}</strong>
      <div v-if="errorState.code" class="error-meta">错误码：{{ errorState.code }}</div>
      <div v-if="errorState.hint" class="error-meta">排查建议：{{ errorState.hint }}</div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import RunLogPanel from './RunLogPanel.vue';

const props = defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  errorState: { type: Object, default: () => ({ message: '', code: '', stage: '', hint: '', details: '' }) },
  progress: { type: Number, default: 0 },
  statusText: { type: String, default: '等待任务...' },
  activeDurationLabel: { type: String, default: '00:00' },
  lastDurationLabel: { type: String, default: '暂无' },
  recentLogs: { type: Object, required: true },
  errorLogs: { type: Object, required: true },
  finalVideoUrl: { type: String, default: '' },
  previewVideoUrl: { type: String, default: '' },
  previewSelection: { type: String, default: 'auto' },
  previewOptions: { type: Array, default: () => [] },
  form: { type: Object, required: true },
  queueStatus: { type: Object, default: null },
  materialTasks: { type: Array, default: () => [] },
  materialTasksLoading: { type: Boolean, default: false }
});

const emit = defineEmits(['refresh', 'submit', 'cancel-queue-job', 'delete-queue-job', 'update:file', 'update:title', 'update:use-asr', 'update:render-option', 'update:preview-selection', 'refresh-material-tasks', 'select-material-task']);

const renderPresetLabel = computed(() => '信息流稳态模板');
const selectedMaterialTask = computed(() => props.materialTasks.find((task) => task.outputDir === props.form.sourceTaskDir || task.id === props.form.sourceTaskDir) || null);
const titleMeter = computed(() => clamp((Number(props.form.renderOptions.titleFontSize || 104) - 56) / 84 * 100));
const subtitleMeter = computed(() => clamp((Number(props.form.renderOptions.subtitleFontSize || 50) - 24) / 48 * 100));
const offsetMeter = computed(() => clamp((Number(props.form.renderOptions.subtitleOffsetY || 20) + 20) / 100 * 100));
const englishMeter = computed(() => clamp((Number(props.form.renderOptions.englishSubtitleFontSize || 52) - 24) / 48 * 100));

const titleBoxStyle = computed(() => ({
  top: '8%',
  left: '8%',
  right: '8%',
  fontSize: `${clamp(Number(props.form.renderOptions.titleFontSize || 104) / 3.6, 18, 34)}px`
}));

const subtitleLayerStyle = computed(() => {
  const baseTop = 63.54;
  const offsetPercent = clamp(Number(props.form.renderOptions.subtitleOffsetY || 20) / 19.2, -4, 6);
  return {
    top: `${baseTop + offsetPercent}%`
  };
});

const englishBoxStyle = computed(() => ({
  fontSize: `${clamp(Number(props.form.renderOptions.englishSubtitleFontSize || 52) / 5.5, 10, 16)}px`
}));

const chineseBoxStyle = computed(() => ({
  top: '38%',
  fontSize: `${clamp(Number(props.form.renderOptions.subtitleFontSize || 50) / 4.8, 11, 18)}px`
}));

function onFileChange(type, event) {
  emit('update:file', type, event.target.files?.[0] || null);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function safeProgress(value) {
  return clamp(Number(value || 0));
}

function formatDurationValue(value) {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatJobDuration(job) {
  if (Number.isFinite(Number(job?.durationSeconds)) && Number(job.durationSeconds) >= 0) {
    return `耗时 ${formatDurationValue(job.durationSeconds)}`;
  }
  if (job?.startedAt && !['completed', 'failed', 'cancelled'].includes(job?.status)) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(job.startedAt).getTime()) / 1000));
    return `已用时 ${formatDurationValue(elapsed)}`;
  }
  return '耗时暂无';
}
</script>

<style scoped>
.standalone-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero-panel,
.builder-card,
.panel,
.module-summary-card,
.config-cluster,
.job-card {
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--card-bg);
  box-shadow: var(--shadow);
}

.hero-panel {
  overflow: hidden;
  background: var(--hero-bg);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 24px;
  padding: 24px;
}

.hero-copy,
.stack,
.workspace-main,
.workspace-side,
.queue-jobs,
.preview-insights {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-kicker,
.control-label,
.config-cluster-title {
  color: #7dd3fc;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.hero-copy h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 2.8rem;
  line-height: 1.1;
  font-weight: 900;
}

.hero-copy p,
.builder-card-header p,
.muted-copy,
.job-meta {
  margin: 0;
  color: var(--muted);
  font-size: 0.875rem;
  line-height: 1.8;
}

.flow-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.flow-pill {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--muted);
  padding: 0.45rem 0.85rem;
  font-size: 0.75rem;
}

.hero-stats,
.upload-grid,
.queue-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.module-summary-card {
  padding: 16px;
}

.module-summary-card span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.module-summary-card strong {
  display: block;
  color: var(--strong-text);
  font-size: 1.35rem;
  margin-top: 12px;
  line-height: 1.2;
}

.module-summary-card p {
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 24px;
}

.builder-card-header,
.panel-header,
.job-head,
.progress-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.builder-card-header,
.panel-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

.builder-card-header h4,
.panel-header span {
  margin: 0;
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.builder-card-body,
.panel-body {
  padding: 20px;
}

.config-cluster {
  padding: 16px;
  background: var(--card-subtle-bg);
}

.upload-card {
  display: flex;
  height: 144px;
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--input-border);
  border-radius: 16px;
  background: var(--input-bg);
}

.upload-icon {
  font-size: 1.6rem;
}

.upload-title {
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 700;
}

.upload-name {
  color: #22c55e;
  font-size: 11px;
}

.upload-sub {
  color: var(--muted);
  font-size: 11px;
}

.asr-toggle,
.dark-chip,
.btn-primary {
  border-radius: 999px;
  font-weight: 700;
}

.asr-toggle {
  border: 0;
  padding: 8px 12px;
  background: #334155;
  color: #e2e8f0;
  cursor: pointer;
}

.asr-toggle.active {
  background: #10b981;
  color: #fff;
}

.input-dark {
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  padding: 14px 16px;
}

.resize-none {
  resize: none;
}

.render-grid {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 16px;
}

.controls-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.text-center {
  text-align: center;
}

.template-pill {
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  padding: 6px 12px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
}

.preview-cluster {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.preview-phone {
  position: relative;
  width: 220px;
  aspect-ratio: 9 / 16;
  border-radius: 24px;
  border: 1px solid #314155;
  background: linear-gradient(180deg, #145bb5 0%, #1357aa 100%);
  overflow: hidden;
}

.preview-title-band {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 29.17%;
  background: rgba(16, 87, 171, 0.96);
}

.preview-title-box {
  position: absolute;
  color: #facc15;
  font-weight: 900;
  line-height: 1.05;
  text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 0 rgba(0, 0, 0, 0.65);
}

.preview-video-box {
  position: absolute;
  left: 0;
  right: 0;
  top: 29.17%;
  height: 31.67%;
  background: linear-gradient(135deg, rgba(89, 53, 18, 0.85), rgba(34, 58, 83, 0.85));
}

.preview-subtitle-layer {
  position: absolute;
  left: 0;
  right: 0;
  height: 18.75%;
}

.preview-en-sub {
  position: absolute;
  left: 10%;
  right: 10%;
  top: 3%;
  color: white;
  text-align: center;
  font-weight: 700;
  line-height: 1.08;
}

.preview-zh-card {
  position: absolute;
  left: 9%;
  right: 9%;
  background: white;
  color: #111827;
  border-radius: 1rem;
  text-align: center;
  font-weight: 900;
  line-height: 1.1;
  padding: 0.55rem 0.75rem;
  box-shadow: 0 10px 18px rgba(0,0,0,0.18);
}

.insight-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 12px;
  color: var(--muted);
}

.control-meter,
.progress-bar {
  height: 10px;
  border-radius: 999px;
  background: var(--line-soft);
  overflow: hidden;
}

.control-meter span,
.progress-bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #8b5cf6);
}

.btn-primary {
  width: 100%;
  border: 0;
  color: #fff;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
  padding: 16px;
  cursor: pointer;
}

.full-btn {
  border-radius: 18px;
}

.dark-chip {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
  padding: 8px 12px;
  font-size: 11px;
  cursor: pointer;
}

.progress-panel {
  overflow: hidden;
}

.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
  color: var(--muted);
  font-size: 12px;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-jobs {
  display: grid;
  gap: 12px;
}

.job-card {
  padding: 14px;
  background: var(--card-subtle-bg);
}

.job-log-preview {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.job-duration {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}

.job-head strong {
  color: var(--strong-text);
}

.job-head span,
.empty-state {
  color: var(--muted);
  font-size: 12px;
}

.small {
  height: 8px;
  margin-top: 10px;
}

.queue-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.task-import-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.task-summary {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.task-summary strong {
  color: var(--strong-text);
  font-size: 0.95rem;
  line-height: 1.35;
}

.task-summary span {
  color: var(--muted);
  font-size: 12px;
}

.ghost-mini {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
}

.ghost-mini:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ghost-mini.danger {
  color: #dc2626;
}

.video-shell {
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid var(--line-soft);
  background: #000;
}

.result-video {
  width: 100%;
  max-height: 420px;
  display: block;
}

.empty-preview {
  border-radius: 16px;
  border: 1px dashed var(--line-soft);
  padding: 32px 12px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
}

.download-link {
  color: #86efac;
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}

.cluster-title {
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 700;
}

.cluster-metrics {
  display: grid;
  gap: 8px;
}

.cluster-metric {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--input-bg);
  padding: 10px 12px;
  font-size: 11px;
  color: var(--muted);
}

.quick-tip-card,
.advanced-block {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--card-subtle-bg);
}

.quick-tip-card {
  padding: 14px 16px;
}

.quick-tip-card strong {
  color: var(--strong-text);
  font-size: 0.95rem;
}

.quick-tip-card p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.advanced-block {
  overflow: hidden;
}

.advanced-block summary {
  cursor: pointer;
  list-style: none;
  padding: 14px 16px;
  color: var(--strong-text);
  font-weight: 700;
}

.advanced-block summary::-webkit-details-marker {
  display: none;
}

.advanced-body {
  padding: 0 16px 16px;
}

.error-box {
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  padding: 12px 14px;
}

@media (max-width: 1200px) {
  .hero-grid,
  .workspace-grid,
  .render-grid {
    grid-template-columns: 1fr;
  }

  .hero-stats,
  .upload-grid,
  .queue-stats,
  .controls-grid,
  .task-import-row {
    grid-template-columns: 1fr;
  }
}
</style>
