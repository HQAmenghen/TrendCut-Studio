<template>
  <div class="workspace-grid">
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
                  <p>使用所选渲染方式自动生成。关闭后会在脚本完成后暂停，等待你手动放入整段数字人视频</p>
                </div>
              </label>
            </div>

            <div v-if="config.autoGenerate" class="config-cluster">
              <div class="config-cluster-title">自动数字人参数</div>

              <div class="two-col">
                <div class="avatar-config-block">
                  <div class="panel-header-between">
                    <label class="field-label">声音克隆/预设</label>
                    <div class="tab-switch">
                      <span @click="emit('update:audio-mode', 'preset')" :class="audioMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
                      <span @click="emit('update:audio-mode', 'upload')" :class="audioMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
                    </div>
                  </div>
                  <div v-if="audioMode === 'preset'" class="preset-list audio-list mt-2">
                    <div v-if="presets.audio.length === 0" class="empty-lite">暂无预设文件</div>
                    <button v-for="file in presets.audio" :key="file" type="button" :class="['preset-item', gen.audioPreset === file ? 'preset-selected' : '']" @click="emit('update:gen-field', 'audioPreset', file)">
                      🎵 <span class="truncate">{{ file }}</span>
                    </button>
                  </div>
                  <div v-else class="upload-height mt-2">
                    <label class="upload-choice compact">
                      <span class="upload-icon">🎧</span>
                      <span class="upload-note">点击上传参考音频</span>
                      <span class="upload-file">{{ gen.audioFile ? gen.audioFile.name : '' }}</span>
                      <input type="file" accept="audio/*" hidden @change="emit('update:gen-field', 'audioFile', $event.target.files[0])" />
                    </label>
                  </div>
                </div>

                <div class="avatar-config-block">
                  <div class="panel-header-between">
                    <label class="field-label">驱动形象照片</label>
                    <div class="tab-switch">
                      <span @click="emit('update:image-mode', 'preset')" :class="imageMode === 'preset' ? 'tab-active' : 'tab-inactive'">预设库</span>
                      <span @click="emit('update:image-mode', 'upload')" :class="imageMode === 'upload' ? 'tab-active' : 'tab-inactive'">本地上传</span>
                    </div>
                  </div>
                  <div v-if="imageMode === 'preset'" class="image-grid mt-2">
                    <div v-if="presets.image.length === 0" class="empty-lite full-span">暂无预设图片</div>
                    <button v-for="file in presets.image" :key="file" type="button" :class="['image-item', gen.imagePreset === file ? 'preset-selected' : '']" @click="emit('update:gen-field', 'imagePreset', file)">
                      <img :src="`/presets/image/${file}`" :alt="file" />
                    </button>
                  </div>
                  <div v-else class="upload-height mt-2">
                    <label class="upload-choice compact">
                      <span class="upload-icon">🖼️</span>
                      <span class="upload-note">点击上传图片</span>
                      <span class="upload-file">{{ gen.imageFile ? gen.imageFile.name : '' }}</span>
                      <input type="file" accept="image/*" hidden @change="emit('update:gen-field', 'imageFile', $event.target.files[0])" />
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <label class="field-label">口播文案（可选）</label>
                <textarea class="input-dark resize-none" rows="3" :value="gen.text" @input="emit('update:gen-field', 'text', $event.target.value)" placeholder="留空则由系统根据热点素材自动生成整段口播稿..."></textarea>
              </div>

              <div class="mt-2">
                <label class="field-label">渲染方式</label>
                <select class="input-dark text-sm" :value="gen.renderProvider" @change="emit('update:gen-field', 'renderProvider', $event.target.value)">
                  <option value="comfyui">ComfyUI (原生)</option>
                  <option value="runninghub">RunningHub Workflow API</option>
                </select>
              </div>

              <details class="advanced-block mt-2">
                <summary>展开高级设置 (渲染节点选项)</summary>
                <div class="advanced-body stack mt-2">
                  <div>
                    <label class="field-label">{{ providerAddressLabel }}</label>
                    <input class="input-dark text-sm" :value="gen.serverUrl" @input="emit('update:gen-field', 'serverUrl', $event.target.value)" />
                    <div class="inline-tools mt-2">
                      <button
                        type="button"
                        class="ghost-btn helper-btn"
                        :disabled="comfyTestLoading"
                        @click="emit('test-comfy-connection')"
                      >
                        {{ comfyTestLoading ? '检测中...' : '检测配置' }}
                      </button>
                      <span
                        v-if="comfyTestResult?.message"
                        :class="['inline-result', comfyTestResult?.status === 'success' ? 'result-success' : 'result-error']"
                      >
                        {{ comfyTestResult.message }}
                      </span>
                    </div>
                    <p v-if="comfyTestResult?.testedUrl" class="muted-copy">{{ testedUrlLabel }}：{{ comfyTestResult.testedUrl }}</p>
                  </div>
                  <div class="quick-tip-card">
                    <strong>当前 workflow 只接收最终口播音频</strong>
                    <p>口播文本会先在本地通过 Qwen3TTS API 复刻音色并合成音频，再把生成好的音频上传给{{ providerName }}驱动数字人。</p>
                  </div>
                </div>
              </details>
            </div>

            <div class="config-cluster mt-2">
              <div class="config-cluster-title">全局设置</div>
              <label class="checkbox-row">
                <input type="checkbox" :checked="withSubtitles" @change="emit('update:with-subtitles', $event.target.checked)" />
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
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  uploading: Boolean,
  audioMode: String,
  imageMode: String,
  presets: {
    type: Object,
    default: () => ({ audio: [], image: [] })
  },
  gen: {
    type: Object,
    default: () => ({})
  },
  withSubtitles: Boolean,
  comfyTestLoading: Boolean,
  comfyTestResult: Object,
  materialUrl: String,
  materialSourceLabel: String
});

const emit = defineEmits([
  'start-workflow',
  'reset-workflow',
  'update:audio-mode',
  'update:image-mode',
  'update:gen-field',
  'update:with-subtitles',
  'test-comfy-connection'
]);

const fileInput = ref(null);
const selectedFile = ref(null);
const config = ref({
  useSmartClip: true,
  autoGenerate: true,
  outputDir: ''
});
const isRunningHub = computed(() => String(props.gen?.renderProvider || '').trim().toLowerCase() === 'runninghub');
const providerName = computed(() => isRunningHub.value ? 'RunningHub' : 'ComfyUI');
const providerAddressLabel = computed(() => isRunningHub.value ? '🔗 RunningHub 工作流配置' : '🔗 ComfyUI 接口地址');
const testedUrlLabel = computed(() => isRunningHub.value ? '工作流地址' : '探测地址');

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
    config: { ...config.value },
    manualScript: props.gen.text
  });
};
</script>
