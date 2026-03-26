<template>
  <section class="pipeline-page">
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Pipeline Console</div>
          <div>
            <h3>AI 全链路混剪中控台</h3>
            <p>按内容输入、数字人渲染、导演混剪、结果交付四个阶段推进。左侧负责输入和调度，右侧负责监控和成片预览。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">内容指令</span>
            <span class="flow-pill">素材调度</span>
            <span class="flow-pill">AI 导演</span>
            <span class="flow-pill">成片交付</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="dashboard-stat">
            <span>文案</span>
            <strong>{{ gen.text ? '已就绪' : '待输入' }}</strong>
            <p>口播文案是整条链路的起点。</p>
          </div>
          <div class="dashboard-stat">
            <span>数字人</span>
            <strong>{{ generating ? '渲染中' : (generatedVideoUrl ? '已产出' : '待渲染') }}</strong>
            <p>声音与形象配置完成后即可启动。</p>
          </div>
          <div class="dashboard-stat">
            <span>导演混剪</span>
            <strong>{{ editing ? '分析中' : '待触发' }}</strong>
            <p>上传双轨素材后一键开始。</p>
          </div>
          <div class="dashboard-stat">
            <span>交付结果</span>
            <strong>{{ finalVideoUrl ? '已交付' : '等待成片' }}</strong>
            <p>支持直接预览、下载与比例转换。</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <div class="stage-column">
        <div class="console-card">
          <div class="section-kicker">Stage A</div>
          <div class="console-title">内容指令区</div>
          <p class="console-copy">先确定口播内容与生成参数，再进入数字人渲染。</p>
        </div>

        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>📝 1. 核心口播文案</span>
            <button type="button" class="polish-btn" @click="$emit('optimize-text')" :disabled="optimizing">
              <span v-if="!optimizing">✨ AI 爆款润色</span>
              <span v-else>⏳ 润色中...</span>
            </button>
          </div>
          <div class="panel-body">
            <textarea class="input-dark resize-none" rows="5" :value="gen.text" placeholder="输入数字人需要口播的台词..." @input="$emit('update:gen-field', 'text', $event.target.value)"></textarea>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span>⚙️ 2. 生成设置</span></div>
          <div class="panel-body stack">
            <div class="quick-tip-card">
              <strong>默认设置已经可以直接开跑</strong>
              <p>一般只需要写文案、选音色和人物图。默认最大时长已设为 20 秒，适合大多数数字人口播。只有在更换云端地址、控制时长或调素材来源时，再展开高级设置。</p>
            </div>
            <details class="advanced-block">
              <summary>展开高级设置</summary>
              <div class="advanced-body stack">
                <div>
                  <label class="field-label">🔗 云端接口地址</label>
                  <input class="input-dark text-sm" :value="gen.serverUrl" @input="$emit('update:gen-field', 'serverUrl', $event.target.value)" />
                </div>
                <div class="two-col">
                  <div>
                    <label class="field-label">✂️ 尾部裁剪 (秒)</label>
                    <input type="number" step="0.1" class="input-dark text-center text-sm" :value="gen.trimSeconds" @input="$emit('update:gen-field', 'trimSeconds', Number($event.target.value))" />
                  </div>
                  <div>
                    <label class="field-label">⏱️ 最大时长 (秒，默认 20)</label>
                    <input type="number" min="1" max="180" class="input-dark text-center text-sm" :value="gen.maxDuration" @input="$emit('update:gen-field', 'maxDuration', Number($event.target.value))" />
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div class="stage-column">
        <div class="console-card">
          <div class="section-kicker">Stage B</div>
          <div class="console-title">数字人素材调度区</div>
          <p class="console-copy">选择音色源与人物图，完成数字人渲染前的素材配置。</p>
        </div>

        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>🎤 3. 声音克隆/预设</span>
            <div class="tab-switch">
              <span @click="$emit('update:audio-mode', 'preset')" :class="audioMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
              <span @click="$emit('update:audio-mode', 'upload')" :class="audioMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
            </div>
          </div>
          <div class="panel-body">
            <div v-if="audioMode === 'preset'" class="preset-list audio-list">
              <div v-if="presets.audio.length === 0" class="empty-lite">暂无预设文件</div>
              <button
                v-for="file in presets.audio"
                :key="file"
                type="button"
                :class="['preset-item', gen.audioPreset === file ? 'preset-selected' : '']"
                @click="$emit('update:gen-field', 'audioPreset', file)"
              >
                🎵 <span class="truncate">{{ file }}</span>
              </button>
            </div>
            <div v-else class="upload-height">
              <label class="upload-choice">
                <span class="upload-icon">🎧</span>
                <span class="upload-note">点击上传参考音频</span>
                <span class="upload-file">{{ genFileName.audio || '' }}</span>
                <input type="file" accept="audio/*" hidden @change="onGenFile('audio', $event)" />
              </label>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>🖼️ 4. 驱动形象照片</span>
            <div class="tab-switch">
              <span @click="$emit('update:image-mode', 'preset')" :class="imageMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
              <span @click="$emit('update:image-mode', 'upload')" :class="imageMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
            </div>
          </div>
          <div class="panel-body">
            <div v-if="imageMode === 'preset'" class="image-grid">
              <div v-if="presets.image.length === 0" class="empty-lite full-span">暂无预设图片</div>
              <button
                v-for="file in presets.image"
                :key="file"
                type="button"
                :class="['image-item', gen.imagePreset === file ? 'preset-selected' : '']"
                @click="$emit('update:gen-field', 'imagePreset', file)"
              >
                <img :src="`/presets/image/${file}`" :alt="file" />
              </button>
            </div>
            <div v-else class="upload-height">
              <label class="upload-choice">
                <span class="upload-icon">🖼️</span>
                <span class="upload-note">点击上传驱动图片</span>
                <span class="upload-file">{{ genFileName.image || '' }}</span>
                <input type="file" accept="image/*" hidden @change="onGenFile('image', $event)" />
              </label>
            </div>
          </div>
        </div>

        <button type="button" class="btn-primary full-btn" @click="$emit('submit-generate')" :disabled="generating || editing">
          {{ generating ? '正在连接云端渲染...' : '🚀 启动数字人渲染引擎' }}
        </button>
      </div>

      <div class="stage-column">
        <div class="console-card">
          <div class="section-kicker">Stage C-D</div>
          <div class="console-title">导演混剪与交付区</div>
          <p class="console-copy">这里接住数字人底板和空镜头素材，完成 AI 导演对齐、成片监控和比例转换。</p>
        </div>

        <div class="panel">
          <div class="panel-header"><span>🎬 5. AI 导演混剪</span></div>
          <div class="panel-body stack">
            <div class="route-guide">
              <div class="route-guide-item">
                <strong>傻瓜式用法</strong>
                <p>先生成数字人口播，再点击“使用当前数字人口播结果作为主轨”，最后从热门榜单送一条素材进来，直接开始混剪。</p>
              </div>
              <div class="route-guide-item">
                <strong>灵活用法</strong>
                <p>你也可以手动上传主轨和空镜头，或者在高级设置里填写远程视频地址。</p>
              </div>
            </div>
            <div v-if="edit.sourceLabel || edit.sourceSummary || edit.sourcePostUrl" class="source-bridge-card">
              <div class="source-bridge-head">
                <span class="source-bridge-kicker">热点素材桥接</span>
                <strong>{{ edit.sourceLabel || '已接入热点空镜头' }}</strong>
              </div>
              <p v-if="edit.sourceSummary" class="source-bridge-copy">{{ edit.sourceSummary }}</p>
              <a v-if="edit.sourcePostUrl" :href="edit.sourcePostUrl" target="_blank" rel="noreferrer" class="source-bridge-link">查看原帖子</a>
            </div>
            <div class="two-col">
              <div class="stack">
                <label class="upload-choice compact-choice">
                  <span class="upload-icon">🎭</span>
                  <span class="upload-note">数字人视频</span>
                  <span class="upload-file">{{ editFileName.aiman || (edit.aimanUrl ? '使用远程主轨素材' : '点击上传 mp4') }}</span>
                  <input type="file" accept="video/mp4,video/*" hidden @change="onEditFile('aiman', $event)" />
                </label>
                <input class="input-dark text-sm" :value="edit.aimanUrl" placeholder="或填写数字人主轨视频 URL" @input="$emit('update:edit-field', 'aimanUrl', $event.target.value)" />
                <button v-if="generatedVideoUrl" type="button" class="ghost-btn helper-btn" @click="$emit('use-generated-video')" :disabled="editing || generating">
                  使用当前数字人口播结果作为主轨
                </button>
              </div>
              <div class="stack">
                <label class="upload-choice compact-choice">
                  <span class="upload-icon">🎞️</span>
                  <span class="upload-note">空镜头素材</span>
                  <span class="upload-file">{{ editFileName.material || (edit.materialUrl ? '使用远程空镜头素材' : '点击上传 mp4') }}</span>
                  <input type="file" accept="video/mp4,video/*" hidden @change="onEditFile('material', $event)" />
                </label>
              </div>
            </div>
            <details class="advanced-block">
              <summary>展开素材高级设置</summary>
              <div class="advanced-body stack">
                <div class="two-col">
                  <div>
                    <label class="field-label">数字人主轨 URL</label>
                    <input class="input-dark text-sm" :value="edit.aimanUrl" placeholder="可填写数字人主轨视频 URL" @input="$emit('update:edit-field', 'aimanUrl', $event.target.value)" />
                  </div>
                  <div>
                    <label class="field-label">空镜头素材 URL</label>
                    <input class="input-dark text-sm" :value="edit.materialUrl" placeholder="可填写空镜头素材 URL" @input="$emit('update:edit-field', 'materialUrl', $event.target.value)" />
                  </div>
                </div>
              </div>
            </details>
            <label class="checkbox-row">
              <input type="checkbox" :checked="edit.withSubtitles" @change="$emit('update:edit-field', 'withSubtitles', $event.target.checked)" />
              <span>自动烧录 AI 中文精翻字幕</span>
            </label>
            <button type="button" class="btn-success full-btn" @click="$emit('submit-edit')" :disabled="editing || generating">
              {{ editing ? 'AI 导演正在拉片与思考...' : '🎯 一键触发 AI 视听对齐与合成' }}
            </button>
          </div>
        </div>

        <div class="panel" v-if="progress > 0 || generating || editing">
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

        <div class="panel">
          <div class="panel-header"><span>🧍 数字人口播预览</span></div>
          <div class="panel-body">
            <div v-if="generatedVideoUrl" class="video-shell">
              <video :src="generatedVideoUrl" controls class="result-video"></video>
            </div>
            <div v-else class="empty-preview">当前还没有数字人口播结果。</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span>🏁 最终成片交付</span></div>
          <div class="panel-body stack">
            <div v-if="finalVideoUrl" class="video-shell">
              <video :src="finalVideoUrl" controls class="result-video" :class="{ dim: converting }"></video>
            </div>
            <div v-else class="empty-preview">当前还没有最终成片。</div>
            <div class="inline-actions" v-if="finalVideoUrl">
              <button type="button" class="primary-btn" @click="$emit('to-vertical')">👉 导入竖屏合成 (9:16)</button>
              <button type="button" class="ghost-btn" @click="$emit('to-publish')">👉 候选至一键发布 (16:9)</button>
              <a :href="finalVideoUrl" download class="download-link">下载原片</a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <RunLogPanel title="📝 运行摘要" :recent-logs="recentLogs.value" :error-logs="errorLogs.value" />

    <div v-if="error" class="error-box">{{ error }}</div>
  </section>
</template>

<script setup>
import RunLogPanel from './RunLogPanel.vue';

defineProps({
  audioMode: { type: String, default: 'preset' },
  imageMode: { type: String, default: 'preset' },
  presets: { type: Object, default: () => ({ audio: [], image: [] }) },
  optimizing: { type: Boolean, default: false },
  generating: { type: Boolean, default: false },
  editing: { type: Boolean, default: false },
  converting: { type: Boolean, default: false },
  progress: { type: Number, default: 0 },
  statusText: { type: String, default: '等待任务...' },
  activeDurationLabel: { type: String, default: '00:00' },
  lastDurationLabel: { type: String, default: '暂无' },
  recentLogs: { type: Object, required: true },
  errorLogs: { type: Object, required: true },
  error: { type: String, default: '' },
  generatedVideoUrl: { type: String, default: '' },
  finalVideoUrl: { type: String, default: '' },
  gen: { type: Object, required: true },
  genFileName: { type: Object, required: true },
  edit: { type: Object, required: true },
  editFileName: { type: Object, required: true }
});

const emit = defineEmits([
  'update:audio-mode',
  'update:image-mode',
  'update:gen-field',
  'update:edit-field',
  'gen-file',
  'edit-file',
  'optimize-text',
  'submit-generate',
  'submit-edit',
  'to-publish', 'to-vertical',
  'use-generated-video'
]);

const onGenFile = (type, event) => emit('gen-file', type, event.target.files?.[0] || null);
const onEditFile = (type, event) => emit('edit-file', type, event.target.files?.[0] || null);
</script>

<style scoped>
.pipeline-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero-panel,
.panel,
.console-card,
.dashboard-stat {
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
  grid-template-columns: 1.35fr 0.95fr;
  gap: 24px;
  padding: 24px;
}

.hero-copy,
.stack,
.stage-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-kicker,
.field-label {
  color: #7dd3fc;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.hero-copy h3,
.console-title {
  margin: 0;
  color: var(--strong-text);
  font-weight: 900;
  line-height: 1.1;
}

.hero-copy h3 {
  font-size: 2.8rem;
}

.console-title {
  font-size: 1.125rem;
  margin-top: 8px;
}

.hero-copy p,
.console-copy,
.dashboard-stat p,
.empty-lite,
.download-link,
.job-sub {
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
.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-stat {
  padding: 16px;
}

.dashboard-stat span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.dashboard-stat strong {
  display: block;
  color: var(--strong-text);
  font-size: 1.8rem;
  margin-top: 12px;
  line-height: 1.15;
}

.dashboard-stat p {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 3fr 4fr 5fr;
  gap: 24px;
}

.console-card,
.panel {
  overflow: hidden;
}

.console-card {
  padding: 16px;
  background: var(--console-bg);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.panel-header-between {
  justify-content: space-between;
}

.panel-body {
  padding: 20px;
}

.polish-btn,
.btn-primary,
.btn-success,
.ghost-btn {
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
}

.polish-btn {
  border: 0;
  background: #9333ea;
  color: #fff;
  padding: 8px 12px;
  font-size: 12px;
}

.btn-primary,
.btn-success {
  border: 0;
  color: #fff;
  padding: 16px;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1, #a855f7);
}

.btn-success {
  background: linear-gradient(135deg, #10b981, #059669);
}

.full-btn {
  width: 100%;
}

.ghost-btn {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
  padding: 12px 16px;
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

.text-sm {
  font-size: 14px;
}

.text-center {
  text-align: center;
}

.tab-switch {
  display: flex;
  gap: 12px;
  font-size: 12px;
}

.tab-active {
  color: #a855f7;
  border-bottom: 2px solid #a855f7;
  cursor: pointer;
}

.tab-inactive {
  color: #718096;
  cursor: pointer;
}

.preset-list {
  display: grid;
  gap: 8px;
}

.audio-list {
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--input-border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}

.preset-selected {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.1);
  box-shadow: 0 0 0 1px #a855f7;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-height {
  height: 128px;
}

.upload-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border: 2px dashed var(--input-border);
  border-radius: 14px;
  cursor: pointer;
  background: var(--input-bg);
  transition: border-color 0.2s;
}

.upload-choice:hover {
  border-color: #8b5cf6;
}

.compact-choice {
  min-height: 140px;
}

.upload-icon {
  font-size: 1.6rem;
  margin-bottom: 6px;
}

.upload-note {
  color: var(--muted);
  font-size: 12px;
}

.upload-file {
  color: #a78bfa;
  font-size: 12px;
  margin-top: 6px;
  max-width: 90%;
  text-align: center;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.image-item {
  border: 1px solid var(--input-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--input-bg);
  cursor: pointer;
  padding: 0;
}

.image-item img {
  width: 100%;
  height: 88px;
  object-fit: cover;
  display: block;
}

.full-span {
  grid-column: 1 / -1;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
}

.progress-head {
  font-size: 12px;
  color: var(--muted);
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

.progress-bar {
  height: 8px;
  border-radius: 999px;
  background: var(--line-soft);
  overflow: hidden;
  margin-top: 12px;
}

.progress-bar span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #8b5cf6);
}

.video-shell {
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid var(--line-soft);
  background: #000;
}

.result-video {
  width: 100%;
  max-height: 360px;
  display: block;
}

.dim {
  opacity: 0.55;
}

.inline-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.empty-preview,
.empty-lite {
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}

.empty-preview {
  border: 1px dashed var(--line-soft);
  border-radius: 16px;
  padding: 28px 12px;
}

.download-link {
  text-decoration: none;
  color: #86efac;
  font-weight: 600;
}

.quick-tip-card,
.route-guide-item {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--card-subtle-bg);
  padding: 14px 16px;
}

.quick-tip-card strong,
.route-guide-item strong {
  color: var(--strong-text);
  font-size: 0.95rem;
}

.quick-tip-card p,
.route-guide-item p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.route-guide {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.advanced-block {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--card-subtle-bg);
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

.helper-btn {
  width: 100%;
}

.source-bridge-card {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--card-subtle-bg);
  padding: 14px 16px;
}

.source-bridge-head {
  display: grid;
  gap: 4px;
}

.source-bridge-kicker {
  color: #7dd3fc;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.source-bridge-head strong {
  color: var(--strong-text);
  font-size: 0.95rem;
}

.source-bridge-copy {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.source-bridge-link {
  display: inline-flex;
  margin-top: 10px;
  color: #7dd3fc;
  font-size: 12px;
  text-decoration: none;
}

.error-box {
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 14px;
  padding: 14px 16px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.22);
}

@media (max-width: 1280px) {
  .hero-grid,
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .hero-stats,
  .two-col {
    grid-template-columns: 1fr;
  }

  .route-guide {
    grid-template-columns: 1fr;
  }
}
</style>
