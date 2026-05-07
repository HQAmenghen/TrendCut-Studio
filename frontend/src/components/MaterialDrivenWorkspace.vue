<template>
  <section class="material-driven-page">
    <!-- Hero Panel -->
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Material First</div>
          <div>
            <h3>热点转视频生产线</h3>
            <p>把热门素材一键转入，自动完成脚本生成、数字人口播、静音素材插片和成片导出，并无缝衔接发布链路。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">热门转入</span>
            <span class="flow-pill">脚本编排</span>
            <span class="flow-pill">数字人口播</span>
            <span class="flow-pill">导出发布</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="module-summary-card">
            <span>素材状态</span>
            <strong>{{ jobId ? '已接入' : '待接入' }}</strong>
            <p>支持本地上传，也支持从热门榜单一键转入。</p>
          </div>
          <div class="module-summary-card">
            <span>编排核心</span>
            <strong>规则+AI协作</strong>
            <p>先定脚本和镜头计划，再执行渲染导出和发布衔接。</p>
          </div>
          <div class="module-summary-card">
            <span>生产目标</span>
            <strong>{{ planSummary ? `${planSummary.materialRatio}%素材` : '自动编排' }}</strong>
            <p>保留热点证据画面，同时让数字人承担解说和IP表达。</p>
          </div>
          <div class="module-summary-card">
            <span>当前进度</span>
            <strong>{{ currentStepInfo.title }}</strong>
            <p>{{ jobId ? (finalVideoUrl ? '已完成' : '处理中') : '待启动' }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Workflow Status -->
    <section v-if="jobId" class="workflow-panel">
      <div class="workflow-head">
        <div>
          <div class="section-kicker">Workflow Status</div>
          <h4>7步工作流进度</h4>
        </div>
        <div class="workflow-summary">
        <span class="workflow-badge">{{ currentStep >= 7 || finalVideoUrl ? '已完成' : `步骤 ${currentStep}/7` }}</span>
          <strong>{{ statusText || currentStepInfo.desc }}</strong>
        </div>
      </div>
      <div v-if="progress > 0" class="panel progress-detail-panel">
        <div class="panel-header"><span>📡 实时进度</span></div>
        <div class="panel-body">
          <div class="progress-head">
            <span class="truncate">{{ statusText || currentStepInfo.desc }}</span>
            <span>{{ progress }}%</span>
          </div>
          <div class="progress-meta">
            <span>已用时：{{ activeDurationLabel }}</span>
            <span>本次耗时：{{ lastDurationLabel }}</span>
          </div>
          <div class="progress-banner mt-0">
            <div class="progress-bar-fill" :style="{ width: progress + '%' }"></div>
          </div>
        </div>
      </div>
      <div class="workflow-grid">
        <article
          v-for="(step, index) in steps"
          :key="step.id"
          :class="['workflow-stage', getStepStatus(step.id)]"
        >
          <div class="workflow-stage-top">
            <strong>{{ step.title }}</strong>
            <span class="workflow-stage-state">{{ getStepStateLabel(step.id) }}</span>
          </div>
          <p class="workflow-stage-detail">{{ step.desc }}</p>
          <div class="workflow-stage-duration" v-if="stepDuration(step.id).hasStarted">
            <span class="duration-icon">⏱</span>
            <span class="duration-value">{{ stepDuration(step.id).label }}</span>
            <span v-if="getStepStatus(step.id) === 'stage-running'" class="duration-live-dot"></span>
          </div>
        </article>
      </div>
      <div class="panel linkage-panel mt-4">
        <div class="panel-header"><span>🔗 链路联动状态</span></div>
        <div class="panel-body stack">
          <div class="mini-status-grid">
            <div class="mini-status-card">
              <span>素材来源</span>
              <strong>{{ sourceBridgeLabel }}</strong>
            </div>
            <div class="mini-status-card">
              <span>脚本单元</span>
              <strong>{{ scriptUnitCount || '待生成' }}</strong>
            </div>
            <div class="mini-status-card">
              <span>渲染状态</span>
              <strong>{{ finalVideoUrl ? '已出片' : '待渲染' }}</strong>
            </div>
            <div class="mini-status-card">
              <span>发布衔接</span>
              <strong>{{ readyForPublish ? '可转发布' : '待出片' }}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Upload Section -->
    <div v-if="!jobId" class="workspace-grid">
      <div class="workspace-main">
        <div class="builder-card">
          <div class="builder-card-header">
            <div>
              <h4>接入素材或热点视频</h4>
              <p>支持本地上传，也支持从热门榜单一键送入，后续直接进入自动生产流程。</p>
            </div>
          </div>
          <div class="builder-card-body stack">
            <div class="upload-grid">
              <div class="config-cluster">
                <div class="config-cluster-title">素材视频</div>
                <label class="upload-card" v-if="!materialUrl">
                  <span class="upload-icon">🎬</span>
                  <span class="upload-title">{{ selectedFile ? selectedFile.name : '上传本地素材' }}</span>
                  <span class="upload-sub">支持 MP4 格式，或从热门发现模块直接转入</span>
                  <input
                    ref="fileInput"
                    type="file"
                    accept="video/mp4,video/*"
                    hidden
                    @change="handleFileSelect"
                    :disabled="uploading"
                  />
                </label>
                <div class="upload-card external-source-card" v-else>
                  <span class="upload-icon">🌐</span>
                  <span class="upload-title">{{ materialSourceLabel || '已关联热点素材' }}</span>
                  <span class="upload-sub" style="word-break: break-all; opacity: 0.6; font-size: 11px;">{{ materialUrl }}</span>
                </div>
                <button
                  v-if="selectedFile || materialUrl"
                  type="button"
                  class="ghost-btn helper-btn"
                  @click="clearFile"
                >
                  清除素材
                </button>
              </div>
            </div>

            <div class="config-cluster">
              <div class="config-cluster-title">生产线配置</div>
              <div class="quick-tip-card">
                <strong>默认配置已经适合直接量产</strong>
                <p>系统会优先走热门转入、脚本编排、数字人口播、静音素材插片和自动导出。你仍然可以保留高级参数做精细控制。</p>
              </div>

              <div class="config-options">
                <label class="checkbox-row">
                  <input type="checkbox" v-model="config.useSmartClip" />
                  <div>
                    <strong>启用自动编排</strong>
                    <p>按脚本、镜头计划和素材匹配结果自动执行数字人主讲渲染（推荐）</p>
                  </div>
                </label>

                <label class="checkbox-row">
                  <input type="checkbox" v-model="config.autoGenerate" />
                  <div>
                    <strong>自动生成整段数字人</strong>
                    <p>需要 ComfyUI 在线。关闭后会在脚本完成后暂停，等待你手动放入整段数字人视频</p>
                  </div>
                </label>

              </div>

              <!-- Avatar configs when autoGenerate is true -->
              <div v-if="config.autoGenerate" class="config-cluster">
                <div class="config-cluster-title">自动数字人参数</div>
                
                <div class="two-col">
                  <!-- Audio -->
                  <div class="avatar-config-block">
                    <div class="panel-header-between">
                      <label class="field-label">声音克隆/预设</label>
                      <div class="tab-switch">
                        <span @click="$emit('update:audio-mode', 'preset')" :class="audioMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
                        <span @click="$emit('update:audio-mode', 'upload')" :class="audioMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
                      </div>
                    </div>
                    <div v-if="audioMode === 'preset'" class="preset-list audio-list mt-2">
                       <div v-if="presets.audio.length === 0" class="empty-lite">暂无预设文件</div>
                       <button v-for="file in presets.audio" :key="file" type="button" :class="['preset-item', gen.audioPreset === file ? 'preset-selected' : '']" @click="$emit('update:gen-field', 'audioPreset', file)">
                         🎵 <span class="truncate">{{ file }}</span>
                       </button>
                    </div>
                    <div v-else class="upload-height mt-2">
                      <label class="upload-choice compact">
                        <span class="upload-icon">🎧</span>
                        <span class="upload-note">点击上传参考音频</span>
                        <span class="upload-file">{{ gen.audioFile ? gen.audioFile.name : '' }}</span>
                        <input type="file" accept="audio/*" hidden @change="$emit('update:gen-field', 'audioFile', $event.target.files[0])" />
                      </label>
                    </div>
                  </div>

                  <!-- Image -->
                  <div class="avatar-config-block">
                    <div class="panel-header-between">
                      <label class="field-label">驱动形象照片</label>
                      <div class="tab-switch">
                        <span @click="$emit('update:image-mode', 'preset')" :class="imageMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
                        <span @click="$emit('update:image-mode', 'upload')" :class="imageMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
                      </div>
                    </div>
                    <div v-if="imageMode === 'preset'" class="image-grid mt-2">
                       <div v-if="presets.image.length === 0" class="empty-lite full-span">暂无预设图片</div>
                       <button v-for="file in presets.image" :key="file" type="button" :class="['image-item', gen.imagePreset === file ? 'preset-selected' : '']" @click="$emit('update:gen-field', 'imagePreset', file)">
                         <img :src="`/presets/image/${file}`" :alt="file" />
                       </button>
                    </div>
                    <div v-else class="upload-height mt-2">
                      <label class="upload-choice compact">
                        <span class="upload-icon">🖼️</span>
                        <span class="upload-note">点击上传图片</span>
                        <span class="upload-file">{{ gen.imageFile ? gen.imageFile.name : '' }}</span>
                        <input type="file" accept="image/*" hidden @change="$emit('update:gen-field', 'imageFile', $event.target.files[0])" />
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label class="field-label">口播文案（可选）</label>
                  <textarea class="input-dark resize-none" rows="3" :value="gen.text" @input="$emit('update:gen-field', 'text', $event.target.value)" placeholder="留空则由系统根据热点素材自动生成整段口播稿..."></textarea>
                </div>

                <!-- Web/App details Advanced -->
                <details class="advanced-block mt-2">
                  <summary>展开高级设置 (渲染节点选项)</summary>
                  <div class="advanced-body stack mt-2">
                    <div>
                      <label class="field-label">🔗 云端接口地址</label>
                      <input class="input-dark text-sm" :value="gen.serverUrl" @input="$emit('update:gen-field', 'serverUrl', $event.target.value)" />
                      <div class="inline-tools mt-2">
                        <button
                          type="button"
                          class="ghost-btn helper-btn"
                          :disabled="comfyTestLoading"
                          @click="$emit('test-comfy-connection')"
                        >
                          {{ comfyTestLoading ? '检测中...' : '测试连通性' }}
                        </button>
                        <span
                          v-if="comfyTestResult?.message"
                          :class="['inline-result', comfyTestResult?.status === 'success' ? 'result-success' : 'result-error']"
                        >
                          {{ comfyTestResult.message }}
                        </span>
                      </div>
                      <p v-if="comfyTestResult?.testedUrl" class="muted-copy">探测地址：{{ comfyTestResult.testedUrl }}</p>
                    </div>
                    <div class="quick-tip-card">
                      <strong>当前 workflow 只接收最终口播音频</strong>
                      <p>口播文本会先在本地通过 Qwen3TTS API 复刻音色并合成音频，再把生成好的音频上传给 ComfyUI 驱动数字人。</p>
                    </div>
                  </div>
                </details>
              </div>

              <!-- General Settings -->
              <div class="config-cluster mt-2">
                <div class="config-cluster-title">全局设置</div>
                <label class="checkbox-row">
                  <input type="checkbox" :checked="withSubtitles" @change="$emit('update:with-subtitles', $event.target.checked)" />
                  <div>
                    <strong>自动烧录 AI 字幕</strong>
                    <p>推荐开启，便于后续发布和人工复查</p>
                  </div>
                </label>
              </div>

              <div>
                <label class="field-label">输出目录名称（可选）</label>
                <input
                  type="text"
                  class="input-dark text-sm"
                  v-model="config.outputDir"
                  placeholder="留空自动生成"
                />
                <p class="muted-copy">自定义输出目录名称，留空则自动生成唯一名称</p>
              </div>

              <button
                type="button"
                class="primary-btn full-btn"
                @click="startWorkflow"
                :disabled="uploading"
              >
                {{ uploading ? '⏳ 接入中...' : '🚀 开始自动生产' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Progress Section -->
    <div v-else class="workspace-grid">
      <div class="workspace-main">
        <!-- Persistent Node Config (Always visible when Step 6 or Error) -->
        <div v-if="currentStep === 6 || error || showManualAvatarPrompt" class="panel node-config-panel highlight-panel">
          <div class="panel-header"><span>🔗 ComfyUI 渲染节点配置</span></div>
          <div class="panel-body stack">
            <div class="config-row">
              <label class="field-label">接口地址</label>
              <div class="input-with-tools">
                <input
                  class="input-dark text-sm flex-1"
                  :value="gen.serverUrl"
                  @input="$emit('update:gen-field', 'serverUrl', $event.target.value)"
                  placeholder="请输入 ComfyUI API 地址..."
                />
                <button
                  type="button"
                  class="primary-btn helper-btn"
                  :disabled="comfyTestLoading"
                  @click="$emit('test-comfy-connection')"
                >
                  {{ comfyTestLoading ? '🔃 检测中' : '📡 测试连通性' }}
                </button>
              </div>
            </div>
            <div v-if="comfyTestResult?.message" class="test-feedback mt-2">
               <span :class="['inline-result', comfyTestResult?.status === 'success' ? 'result-success' : 'result-error']">
                 {{ comfyTestResult.message }}
               </span>
               <p v-if="comfyTestResult?.testedUrl" class="muted-copy ml-1">探测地址：{{ comfyTestResult.testedUrl }}</p>
            </div>
            <div class="alert-bar mt-2" v-if="currentStep === 6">
              💡 提示：如果生成失败，请检查上方地址是否正确，或查看 ComfyUI 后台是否有模型报错。
            </div>
          </div>
        </div>

        <!-- Plan Summary -->
        <div v-if="planSummary" class="panel">
          <div class="panel-header"><span>📋 导演规划摘要</span></div>
          <div class="panel-body">
            <div class="mini-status-grid">
              <div class="mini-status-card">
                <span>总时长</span>
                <strong>{{ planSummary.totalDuration }}秒</strong>
              </div>
              <div class="mini-status-card">
                <span>素材占比</span>
                <strong>{{ planSummary.materialRatio }}%</strong>
              </div>
              <div class="mini-status-card">
                <span>数字人占比</span>
                <strong>{{ planSummary.aimanRatio }}%</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- Narration Summary -->
        <div v-if="narrationSummary" class="panel">
          <div class="panel-header"><span>🎤 解说词摘要</span></div>
          <div class="panel-body stack">
            <div class="mini-status-grid">
              <div class="mini-status-card">
                <span>目标时长</span>
                <strong>{{ narrationSummary.targetDuration }}秒</strong>
              </div>
              <div class="mini-status-card">
                <span>字数</span>
                <strong>{{ narrationSummary.charCount }}字</strong>
              </div>
              <div class="mini-status-card">
                <span>语速</span>
                <strong>{{ narrationSummary.speed }}字/秒</strong>
              </div>
            </div>
            <div v-if="narrationTextToShow" class="narration-text">
              <strong>解说词内容：</strong>
              <p>{{ narrationTextToShow }}</p>
            </div>
          </div>
        </div>

        <div v-if="hasEditPlan || hasExecutionPlan" class="panel">
          <div class="panel-header"><span>🧠 自动编排状态</span></div>
          <div class="panel-body stack">
            <div class="mini-status-grid">
              <div class="mini-status-card">
                <span>脚本句数</span>
                <strong>{{ scriptUnitCount || 0 }}</strong>
              </div>
              <div class="mini-status-card">
                <span>Edit Plan</span>
                <strong>{{ editPlanBlockCount || '待生成' }}</strong>
              </div>
              <div class="mini-status-card">
                <span>Execution Plan</span>
                <strong>{{ executionPlanSegmentCount || '待落地' }}</strong>
              </div>
              <div class="mini-status-card">
                <span>模板</span>
                <strong>{{ editPlan?.meta?.template_id || editPlan?.template_id || 'material_driven_v1' }}</strong>
              </div>
            </div>
            <details v-if="hasEditPlan" class="advanced-block mt-2">
              <summary>查看 Edit Plan</summary>
              <pre class="json-block">{{ editPlanPretty }}</pre>
            </details>
            <details v-if="hasExecutionPlan" class="advanced-block mt-2">
              <summary>查看 Execution Plan</summary>
              <pre class="json-block">{{ executionPlanPretty }}</pre>
            </details>
          </div>
        </div>

        <div v-if="hasDisplayTimelinePlan" class="panel">
          <div class="panel-header"><span>🎬 时间线方案</span></div>
          <div class="panel-body stack">
            <div class="mini-status-grid">
              <div class="mini-status-card">
                <span>片段数</span>
                <strong>{{ displayTimelinePlan.length }}</strong>
              </div>
              <div class="mini-status-card">
                <span>素材镜头</span>
                <strong>{{ materialShotCount }}</strong>
              </div>
              <div class="mini-status-card">
                <span>数字人镜头</span>
                <strong>{{ aimanShotCount }}</strong>
              </div>
              <div class="mini-status-card">
                <span>插片镜头</span>
                <strong>{{ cutawayShotCount }}</strong>
              </div>
            </div>
            <div class="timeline-wrap">
              <div
                v-for="(seg, idx) in timelineRows"
                :key="`timeline-${idx}`"
                class="timeline-row"
              >
                <div class="timeline-meta">
                  <strong>#{{ idx + 1 }}</strong>
                  <span>{{ formatSec(seg.start) }} - {{ formatSec(seg.end) }}（{{ formatSec(seg.duration) }}）</span>
                  <span :class="['source-badge', seg.videoSourceClass]">{{ seg.videoSourceLabel }}</span>
                  <span :class="['source-badge', seg.audioSourceClass]">{{ seg.audioSourceLabel }}</span>
                </div>
                <div class="timeline-track">
                  <div class="timeline-bar" :style="getTimelineBarStyle(seg)"></div>
                </div>
              </div>
            </div>
            <details class="advanced-block mt-2" open>
              <summary>查看当前时间线 JSON</summary>
              <pre class="json-block">{{ displayTimelinePretty }}</pre>
            </details>
          </div>
        </div>

        <!-- Avatar Generation Prompt -->
        <div v-if="showManualAvatarPrompt" class="panel warning-panel">
          <div class="panel-header"><span>⚠️ 需要生成数字人</span></div>
          <div class="panel-body stack">
            <p>请通过以下方式生成数字人视频：</p>
            <ol class="instruction-list">
              <li>确保 ComfyUI 服务正在运行</li>
              <li>使用解说词生成数字人视频</li>
              <li>将生成的视频命名为 <code>aiman.mp4</code></li>
              <li>放置到输出目录：<code>{{ outputPath }}</code></li>
              <li>点击下方"继续"按钮</li>
            </ol>
            <button
              type="button"
              class="btn-success full-btn"
              @click="continueWorkflow"
            >
              ✅ 已生成，继续渲染
            </button>
            <button
              type="button"
              class="ghost-btn full-btn"
              :disabled="rebuildingPlan"
              @click="rebuildPlan"
            >
              {{ rebuildingPlan ? '⏳ 正在重建计划...' : '🧠 重建剪辑计划' }}
            </button>
          </div>
        </div>

        <!-- Logs -->
        <div class="panel">
          <div class="panel-header"><span>📝 执行日志</span></div>
          <div class="panel-body">
            <div class="log-container">
              <div
                v-for="(log, index) in recentLogs"
                :key="index"
                :class="['log-line', `log-${log.type}`]"
              >
                <span class="log-time">{{ log.time }}</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Final Result -->
        <div v-if="finalVideoUrl" class="panel success-panel">
          <div class="panel-header"><span>🎉 制作完成</span></div>
          <div class="panel-body stack">
            <div class="mini-status-grid">
              <div class="mini-status-card">
                <span>成片状态</span>
                <strong>已完成</strong>
              </div>
              <div class="mini-status-card">
                <span>发布状态</span>
                <strong>{{ readyForPublish ? '可转发布' : '待出片' }}</strong>
              </div>
              <div class="mini-status-card">
                <span>脚本句数</span>
                <strong>{{ scriptUnitCount || 0 }}</strong>
              </div>
              <div class="mini-status-card">
                <span>执行片段</span>
                <strong>{{ executionPlanSegmentCount || '待生成' }}</strong>
              </div>
            </div>
            <video :src="finalVideoUrl" controls class="result-video"></video>
            <div class="action-buttons">
              <a :href="finalVideoUrl" download class="primary-btn shrink-none">
                📥 下载视频
              </a>
              <button
                type="button"
                class="ghost-btn shrink-none"
                :disabled="rebuildingPlan"
                @click="rebuildPlan"
              >
                {{ rebuildingPlan ? '⏳ 重建中...' : '🧠 重建剪辑计划' }}
              </button>
              <button
                type="button"
                class="ghost-btn shrink-none"
                :disabled="rerenderingVideo"
                @click="rerenderVideo"
              >
                {{ rerenderingVideo ? '⏳ 渲染中...' : '🎞️ 重新渲染成片' }}
              </button>
              <button type="button" class="ghost-btn shrink-none" @click="$emit('to-vertical')">
                📱 导入竖屏合成 (9:16)
              </button>
              <button type="button" class="ghost-btn shrink-none" @click="$emit('to-publish')">
                {{ readyForPublish ? '🚀 进入一键发布 (16:9)' : '🚀 转到一键发布 (16:9)' }}
              </button>
              <button type="button" class="ghost-btn shrink-none" @click="resetWorkflow">
                🔄 制作新视频
              </button>
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-if="error" class="panel error-panel">
          <div class="panel-header"><span>❌ 执行失败</span></div>
          <div class="panel-body stack">
            <p class="error-message">{{ error }}</p>
            <div class="action-buttons">
              <button type="button" class="btn-success" @click="retryCurrentStep">
                🔄 重试当前步骤
              </button>
              <button type="button" class="ghost-btn" @click="resetWorkflow">
                ↩️ 重新开始
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  jobId: String,
  currentStep: Number,
  progress: Number,
  statusText: String,
  planSummary: Object,
  narrationSummary: Object,
  narrationFullText: String,
  scriptUnits: Array,
  editPlan: Object,
  executionPlan: Object,
  finalVideoUrl: String,
  error: String,
  recentLogs: Array,
  uploading: Boolean,
  rebuildingPlan: Boolean,
  rerenderingVideo: Boolean,
  outputPath: String,
  audioMode: String,
  imageMode: String,
  presets: Object,
  gen: Object,
  withSubtitles: Boolean,
  comfyTestLoading: Boolean,
  comfyTestResult: Object,
  activeDurationLabel: String,
  lastDurationLabel: String,
  materialUrl: String,
  materialSourceLabel: String,
  stepDurationMap: Object
});

const emit = defineEmits([
  'start-workflow',
  'continue-workflow',
  'rebuild-plan',
  'rerender-video',
  'retry-step',
  'reset-workflow',
  'update:audio-mode',
  'update:image-mode',
  'update:gen-field',
  'update:with-subtitles',
  'test-comfy-connection',
  'to-publish',
  'to-vertical'
]);

const steps = [
  { id: 1, title: '接入素材', desc: '本地上传或热门转入' },
  { id: 2, title: '理解内容', desc: 'ASR + OCR + 重点分析' },
  { id: 3, title: '匹配素材', desc: '切片、评分和镜头候选' },
  { id: 4, title: '生成计划', desc: '脚本、edit plan、execution plan' },
  { id: 5, title: '口播成稿', desc: '生成整段数字人口播稿' },
  { id: 6, title: '数字人生成', desc: '生成整段数字人视频' },
  { id: 7, title: '渲染导出', desc: '自动渲染并输出最终成片' }
];

const fileInput = ref(null);
const selectedFile = ref(null);
const config = ref({
  useSmartClip: true,
  autoGenerate: true,
  outputDir: ''
});

const currentStepInfo = computed(() => {
  if (props.currentStep >= 7 || props.finalVideoUrl) {
    return { id: 8, title: '制作完成', desc: '成片已输出，可直接转入发布链路' };
  }
  return steps.find(s => s.id === props.currentStep) || steps[0];
});

const narrationTextToShow = computed(() => {
  return String(props.narrationFullText || props.narrationSummary?.fullText || '').trim();
});

const scriptUnitCount = computed(() => Array.isArray(props.scriptUnits) ? props.scriptUnits.length : 0);
const hasEditPlan = computed(() => !!props.editPlan && Array.isArray(props.editPlan?.blocks));
const hasExecutionPlan = computed(() => !!props.executionPlan && Array.isArray(props.executionPlan?.segments));
const editPlanBlockCount = computed(() => hasEditPlan.value ? props.editPlan.blocks.length : 0);
const executionPlanSegmentCount = computed(() => hasExecutionPlan.value ? props.executionPlan.segments.length : 0);
const readyForPublish = computed(() => Boolean(props.finalVideoUrl));
const editPlanPretty = computed(() => hasEditPlan.value ? JSON.stringify(props.editPlan, null, 2) : '{}');
const executionPlanPretty = computed(() => hasExecutionPlan.value ? JSON.stringify(props.executionPlan, null, 2) : '{}');
const sourceBridgeLabel = computed(() => {
  if (!props.materialUrl) return '本地上传';
  return props.materialSourceLabel ? `热门转入：${props.materialSourceLabel}` : '热门素材直送';
});

const displayTimelinePlan = computed(() => {
  if (Array.isArray(props.executionPlan) && props.executionPlan.length) return props.executionPlan;
  return [];
});
const hasDisplayTimelinePlan = computed(() => displayTimelinePlan.value.length > 0);
const materialShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.video_source || '').includes('material')).length
    : 0
);
const aimanShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.video_source || '').includes('aiman')).length
    : 0
);
const cutawayShotCount = computed(() =>
  displayTimelinePlan.value.length
    ? displayTimelinePlan.value.filter((x) => String(x?.type || '') === 'material_cutaway').length
    : 0
);
const displayTimelinePretty = computed(() =>
  hasDisplayTimelinePlan.value ? JSON.stringify(displayTimelinePlan.value, null, 2) : '[]'
);
const timelineTotalDuration = computed(() => {
  if (!hasDisplayTimelinePlan.value) return 0;
  const maxEnd = Math.max(
    ...displayTimelinePlan.value.map((seg) => Number(seg?.end_time ?? seg?.end ?? 0) || 0),
    0
  );
  return maxEnd;
});
const timelineRows = computed(() => {
  if (!hasDisplayTimelinePlan.value) return [];
  return displayTimelinePlan.value.map((seg) => {
    const start = Number(seg?.start_time ?? seg?.start ?? 0) || 0;
    const end = Number(seg?.end_time ?? seg?.end ?? start) || start;
    const duration = Math.max(0, end - start);
    const videoSource = String(seg?.video_source || '');
    const audioSource = String(seg?.audio_source || '');
    const isCutaway = String(seg?.type || '') === 'material_cutaway';
    return {
      start,
      end,
      duration,
      videoSourceLabel: isCutaway
        ? '静音素材插片'
        : (videoSource.includes('material') ? '素材画面' : '数字人画面'),
      videoSourceClass: isCutaway
        ? 'source-pip'
        : (videoSource.includes('material') ? 'source-material' : 'source-aiman'),
      audioSourceLabel: '数字人口播',
      audioSourceClass: 'source-main'
    };
  });
});

const formatSec = (num) => `${Number(num || 0).toFixed(2)}s`;
const getTimelineBarStyle = (seg) => {
  const total = Math.max(0.01, timelineTotalDuration.value || 0.01);
  const left = Math.max(0, (seg.start / total) * 100);
  const width = Math.max(1, (seg.duration / total) * 100);
  return { left: `${left}%`, width: `${width}%` };
};

const showManualAvatarPrompt = computed(() => {
  const text = String(props.statusText || '');
  return props.currentStep === 6 && /等待数字人素材|手动生成|aiman\.mp4/i.test(text);
});

const getStepStatus = (stepId) => {
  if (props.currentStep >= 7) return 'stage-completed';
  if (stepId < props.currentStep) return 'stage-completed';
  if (stepId === props.currentStep) return 'stage-running';
  return 'stage-pending';
};

const getStepStateLabel = (stepId) => {
  if (props.currentStep >= 7) return '已完成';
  if (stepId < props.currentStep) return '已完成';
  if (stepId === props.currentStep) return '进行中';
  return '待执行';
};

const stepDuration = (stepId) => {
  const map = props.stepDurationMap;
  if (!map || !map[stepId]) {
    return { hasStarted: false, label: '', detail: '' };
  }
  const entry = map[stepId];
  return {
    hasStarted: entry.seconds > 0 || entry.label !== '未开始',
    label: entry.label === '未开始' ? '' : entry.label,
    detail: entry.detail || ''
  };
};

const handleFileSelect = (event) => {
  const file = event.target.files[0];
  if (file) {
    selectedFile.value = file;
  }
};

const clearFile = () => {
  selectedFile.value = null;
  if (fileInput.value) {
    fileInput.value.value = '';
  }
  emit('reset-workflow');
};

const startWorkflow = () => {
  if (!selectedFile.value && !props.materialUrl) return;

  emit('start-workflow', {
    file: selectedFile.value,
    config: config.value,
    manualScript: props.gen.text
  });
};

const continueWorkflow = () => {
  emit('continue-workflow');
};

const rebuildPlan = () => {
  emit('rebuild-plan');
};

const rerenderVideo = () => {
  emit('rerender-video');
};

const retryCurrentStep = () => {
  emit('retry-step', props.currentStep);
};

const resetWorkflow = () => {
  selectedFile.value = null;
  config.value = {
    useSmartClip: true,
    autoGenerate: true,
    outputDir: ''
  };
  emit('reset-workflow');
};
</script>

<style scoped>
/* Inject unified layout variables */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.config-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.avatar-config-block {
  display: flex;
  flex-direction: column;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 16px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.checkbox-row:hover {
  border-color: var(--brand-a);
}

.checkbox-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--brand-a);
}

.checkbox-row div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-row strong {
  display: block;
  font-size: 14px;
  color: var(--strong-text);
  margin-bottom: 2px;
}

.checkbox-row p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}


/* Glassmorphism Hero Panel */
.hero-panel {
  background: linear-gradient(135deg, rgba(30, 30, 46, 0.8) 0%, rgba(20, 20, 32, 0.8) 100%);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  position: relative;
  overflow: hidden;
}

.hero-panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(109, 107, 255, 0.5), transparent);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: stretch;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
}

.hero-copy h3 {
  font-size: 28px;
  color: #fff;
  margin: 0 0 12px 0;
  font-weight: 800;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.hero-copy p {
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.6;
  margin: 0;
  font-size: 15px;
}

.flow-pills {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.flow-pill {
  padding: 6px 16px;
  border-radius: 99px;
  background: rgba(109, 107, 255, 0.15);
  border: 1px solid rgba(109, 107, 255, 0.3);
  color: #8ed1ff;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(109, 107, 255, 0.1);
}

.hero-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.module-summary-card {
  background: var(--input-bg);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-summary-card span {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.module-summary-card strong {
  font-size: 20px;
  color: var(--strong-text);
  font-weight: 800;
}

.module-summary-card p {
  font-size: 12px;
  color: var(--muted);
  margin: 0;
  line-height: 1.4;
}

/* Base Upload and Setup Grid Layouts */
.workspace-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

.workspace-main {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.builder-card {
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.builder-card-header {
  padding: 24px;
  border-bottom: 1px solid var(--line-soft);
  background: var(--card-subtle-bg);
}

.builder-card-header h4 {
  margin: 0 0 8px 0;
  font-size: 18px;
  color: var(--strong-text);
}

.builder-card-header p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

.builder-card-body {
  padding: 24px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.upload-grid {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.config-cluster {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.config-cluster-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--strong-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.quick-tip-card {
  padding: 16px;
  background: rgba(109, 107, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(109, 107, 255, 0.2);
}

.quick-tip-card strong {
  display: block;
  color: #a5b4fc;
  margin-bottom: 4px;
}

.quick-tip-card p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  color: var(--strong-text);
  font-size: 14px;
  font-weight: 600;
}

.input-dark {
  width: 100%;
  padding: 12px 16px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  border-radius: 8px;
  outline: none;
  transition: all 0.2s;
}

.input-dark:focus {
  border-color: var(--brand-a);
  background: var(--card-subtle-bg);
}

.muted-copy {
  margin: 8px 0 0 0;
  color: var(--muted);
  font-size: 12px;
}

.inline-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.inline-result {
  font-size: 12px;
  font-weight: 700;
}

.result-success {
  color: #22c55e;
}

.result-error {
  color: #ef4444;
}

/* Button Styles */
.primary-btn, .btn-success {
  background: linear-gradient(135deg, var(--brand-a), var(--brand-b));
  color: #fff;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
  text-decoration: none;
  box-shadow: 0 4px 12px rgba(109, 107, 255, 0.3);
}

.btn-success {
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.primary-btn:hover, .btn-success:hover {
  transform: translateY(-2px);
  filter: brightness(1.1);
  box-shadow: 0 6px 16px rgba(109, 107, 255, 0.4);
}

.ghost-btn {
  background: transparent;
  color: var(--brand-a);
  border: 1px solid rgba(109, 107, 255, 0.3);
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.ghost-btn:hover {
  background: rgba(109, 107, 255, 0.1);
  border-color: var(--brand-a);
}

.full-btn {
  width: 100%;
}

.helper-btn {
  padding: 8px 16px;
  font-size: 13px;
  align-self: flex-start;
}

.section-kicker {
  color: var(--brand-a);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-weight: 800;
  margin-bottom: 8px;
}

/* Redesign 7-step visualization with glowing active states */
.workflow-panel {
  background: var(--card-bg);
  border-radius: 20px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: var(--shadow);
}

.linkage-panel {
  margin-top: 18px;
}

.workflow-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.workflow-badge {
  display: inline-block;
  padding: 4px 12px;
  background: rgba(109, 107, 255, 0.15);
  color: #a5b4fc;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 700;
  margin-right: 12px;
  border: 1px solid rgba(109, 107, 255, 0.3);
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
}

.workflow-stage {
  padding: 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.workflow-stage.stage-completed {
  opacity: 0.6;
  border-color: rgba(34, 197, 94, 0.3);
  background: rgba(34, 197, 94, 0.02);
}

.workflow-stage.stage-pending {
  opacity: 0.4;
}

.workflow-stage.stage-running {
  border-color: var(--brand-a);
  background: linear-gradient(180deg, rgba(109, 107, 255, 0.15) 0%, rgba(109, 107, 255, 0.02) 100%);
  box-shadow: 0 8px 24px rgba(109, 107, 255, 0.2), inset 0 0 0 1px var(--brand-a);
  transform: translateY(-4px);
  position: relative;
  opacity: 1;
}

.workflow-stage.stage-running::before {
  content: '';
  position: absolute;
  top: -1px; left: 20%; right: 20%; height: 2px;
  background: linear-gradient(90deg, transparent, #8ed1ff, transparent);
  box-shadow: 0 0 10px #8ed1ff;
  border-radius: 2px;
}

.workflow-stage-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.workflow-stage-top strong {
  color: var(--strong-text);
  font-size: 15px;
}

.workflow-stage-state {
  font-size: 12px;
  color: var(--muted);
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.2);
}

.stage-running .workflow-stage-state {
  color: #8ed1ff;
  background: rgba(142, 209, 255, 0.1);
  font-weight: 700;
}

/* Step duration badge */
.workflow-stage-duration {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.stage-completed .workflow-stage-duration {
  color: #22c55e;
}

.stage-running .workflow-stage-duration {
  color: #8ed1ff;
}

.duration-icon {
  font-size: 11px;
  opacity: 0.8;
}

.duration-value {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.duration-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #8ed1ff;
  margin-left: 2px;
  animation: live-pulse 1.2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(0.6); }
}

/* Premium Upload Card */
.upload-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  border: 2px dashed rgba(109, 107, 255, 0.3);
  border-radius: 20px;
  background: rgba(109, 107, 255, 0.02);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.upload-card.external-source-card {
  cursor: default;
  border-style: solid;
  border-color: var(--brand-a);
  background: rgba(109, 107, 255, 0.05);
}

.upload-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(109, 107, 255, 0.1) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s;
}

.upload-card:hover {
  border-color: var(--brand-a);
  background: rgba(109, 107, 255, 0.05);
  box-shadow: 0 12px 32px rgba(109, 107, 255, 0.15);
  transform: translateY(-2px);
}

.upload-card:hover::after {
  opacity: 1;
}

.upload-icon {
  font-size: 48px;
  margin-bottom: 4px;
  filter: drop-shadow(0 8px 16px rgba(109, 107, 255, 0.4));
  transform: scale(1);
  transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.upload-card:hover .upload-icon {
  transform: scale(1.1) rotate(-5deg);
}

.upload-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--strong-text);
  z-index: 1;
}

.upload-sub {
  font-size: 13px;
  color: var(--muted);
  z-index: 1;
}

/* Modern Dashboards for Summaries */
.panel {
  border-radius: 20px;
  background: var(--card-bg);
  border: 1px solid rgba(255, 255, 255, 0.05);
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  margin-bottom: 24px;
}

.panel-header {
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-weight: 700;
  font-size: 15px;
  color: var(--strong-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-body {
  padding: 24px;
}

.mini-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.mini-status-card {
  padding: 16px 20px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.2s;
}

.mini-status-card:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.03);
}

.mini-status-card span {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.mini-status-card strong {
  font-size: 26px;
  font-weight: 800;
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Polished Alert and Log Panels */
.warning-panel {
  border-color: rgba(251, 191, 36, 0.3);
  box-shadow: 0 8px 24px rgba(251, 191, 36, 0.1);
}

.warning-panel .panel-header {
  background: rgba(251, 191, 36, 0.1);
  color: #fcd34d;
}

.success-panel {
  border-color: rgba(34, 197, 94, 0.3);
  box-shadow: 0 8px 24px rgba(34, 197, 94, 0.1);
}

.success-panel .panel-header {
  background: rgba(34, 197, 94, 0.1);
  color: #4ade80;
}

.error-panel {
  border-color: rgba(239, 68, 68, 0.3);
  box-shadow: 0 8px 24px rgba(239, 68, 68, 0.1);
}

.error-panel .panel-header {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
}

.log-container {
  max-height: 300px;
  overflow-y: auto;
  background: #090a0f;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.3);
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 13px;
}

.log-line {
  display: flex;
  gap: 16px;
  padding: 6px 8px;
  border-radius: 6px;
  margin-bottom: 4px;
  transition: background 0.2s;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.05);
}

.log-time {
  color: #6366f1;
  font-weight: 600;
  flex-shrink: 0;
}

.log-message {
  color: #e2e8f0;
}

.log-line.log-error .log-message { color: #ef4444; }
.log-line.log-success .log-message { color: #22c55e; }
.log-line.log-warn .log-message { color: #f59e0b; }

/* Progress Banner */
.progress-banner {
  position: relative;
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
  margin: 20px 0 24px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--brand-a), #8ed1ff);
  box-shadow: 0 0 10px rgba(109, 107, 255, 0.5);
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-label {
  position: absolute;
  top: -26px;
  right: 0;
  font-size: 13px;
  font-weight: 800;
  color: var(--brand-a);
  text-shadow: 0 2px 8px rgba(109, 107, 255, 0.4);
}


.instruction-list {
  margin: 16px 0;
  padding-left: 24px;
  line-height: 2;
  color: var(--text);
}

.instruction-list code {
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #fcd34d;
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.narration-text {
  padding: 16px;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  line-height: 1.8;
}

.narration-text strong {
  display: block;
  margin-bottom: 12px;
  color: var(--strong-text);
  font-size: 15px;
}

.narration-text p {
  margin: 0;
  color: var(--text);
  font-size: 14px;
}

.compact-card {
  gap: 8px;
}

.json-block {
  margin: 0;
  padding: 14px;
  background: #0b1020;
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  color: #dbeafe;
  max-height: 380px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.timeline-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--card-subtle-bg);
}

.timeline-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.timeline-meta strong {
  color: var(--strong-text);
}

.timeline-track {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  overflow: hidden;
}

.timeline-bar {
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #38bdf8, #6366f1);
}

.source-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
}

.source-material {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
  border-color: rgba(22, 163, 74, 0.25);
}

.source-aiman {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
  border-color: rgba(37, 99, 235, 0.25);
}

.source-broll {
  color: #b45309;
  background: rgba(245, 158, 11, 0.14);
  border-color: rgba(245, 158, 11, 0.25);
}

.source-main {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.14);
  border-color: rgba(124, 58, 237, 0.25);
}

.source-pip {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.14);
  border-color: rgba(20, 184, 166, 0.25);
}

.result-video {
  width: 100%;
  max-width: 800px;
  border-radius: 16px;
  margin: 0 auto;
  display: block;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.action-buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  margin-top: 24px;
  flex-wrap: wrap;
}

.error-message {
  padding: 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 12px;
  color: #fca5a5;
  margin: 0;
  font-weight: 500;
}

/* Avatar config nested components */
.panel-header-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
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
.upload-height {
  height: 128px;
}
.upload-choice.compact {
  min-height: auto;
}
.panel-header {
  display: flex;
  align-items: center;
  font-weight: 700;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
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
.progress-detail-panel {
  padding: 16px;
  background: var(--card-subtle-bg);
  border: 1px solid var(--line);
  border-radius: 16px;
}
.advanced-block {
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--input-bg);
  overflow: hidden;
}
.advanced-block summary {
  cursor: pointer;
  list-style: none;
  padding: 12px 16px;
  color: var(--strong-text);
  font-weight: 700;
  font-size: 13px;
}
.advanced-body {
  padding: 0 16px 16px;
}
.mt-0 { margin-top: 0; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.shrink-none { flex-shrink: 0; }

/* New Persistent Node Config Styles */
.node-config-panel {
  border: 1px solid var(--line-soft);
  background: var(--card-bg);
  box-shadow: var(--shadow-lg);
}

.highlight-panel {
  border: 1px solid rgba(168, 85, 247, 0.3);
  background: rgba(168, 85, 247, 0.03);
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-with-tools {
  display: flex;
  gap: 12px;
  align-items: center;
}

.alert-bar {
  padding: 10px 14px;
  background: rgba(30, 41, 59, 0.5);
  border-radius: 8px;
  font-size: 13px;
  color: var(--muted);
  border-left: 3px solid var(--brand-a);
}

.test-feedback {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.ml-1 { margin-left: 4px; }

</style>
