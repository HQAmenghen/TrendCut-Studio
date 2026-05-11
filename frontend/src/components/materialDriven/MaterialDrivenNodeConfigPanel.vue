<template>
  <div class="panel node-config-panel highlight-panel">
    <div class="panel-header"><span>{{ providerTitle }}</span></div>
    <div class="panel-body stack">
      <div class="config-row">
        <label class="field-label">接口地址</label>
        <div class="input-with-tools">
          <input
            class="input-dark text-sm flex-1"
            :value="gen.serverUrl"
            @input="emit('update:gen-field', 'serverUrl', $event.target.value)"
            :placeholder="addressPlaceholder"
          />
          <button
            type="button"
            class="primary-btn helper-btn"
            :disabled="comfyTestLoading"
            @click="emit('test-comfy-connection')"
          >
            {{ comfyTestLoading ? '🔃 检测中' : '📡 检测配置' }}
          </button>
        </div>
      </div>
      <div v-if="comfyTestResult?.message" class="test-feedback mt-2">
        <span :class="['inline-result', comfyTestResult?.status === 'success' ? 'result-success' : 'result-error']">
          {{ comfyTestResult.message }}
        </span>
        <p v-if="comfyTestResult?.testedUrl" class="muted-copy ml-1">{{ testedUrlLabel }}：{{ comfyTestResult.testedUrl }}</p>
      </div>
      <div class="alert-bar mt-2" v-if="currentStep === 6">
        {{ providerHint }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  currentStep: Number,
  gen: {
    type: Object,
    default: () => ({})
  },
  comfyTestLoading: Boolean,
  comfyTestResult: Object
});

const emit = defineEmits([
  'update:gen-field',
  'test-comfy-connection'
]);

const isRunningHub = computed(() => String(props.gen?.renderProvider || '').trim().toLowerCase() === 'runninghub');
const providerTitle = computed(() => isRunningHub.value ? '🔗 RunningHub 工作流配置' : '🔗 ComfyUI 渲染节点配置');
const addressPlaceholder = computed(() => isRunningHub.value ? 'RunningHub 工作流由后台配置；这里可保留当前地址' : '请输入 ComfyUI API 地址...');
const testedUrlLabel = computed(() => isRunningHub.value ? '工作流地址' : '探测地址');
const providerHint = computed(() => isRunningHub.value
  ? '💡 提示：如果生成失败，请检查后台凭据、工作流编号和节点映射配置是否可用。'
  : '💡 提示：如果生成失败，请检查上方地址是否正确，或查看 ComfyUI 后台是否有模型报错。'
);
</script>
