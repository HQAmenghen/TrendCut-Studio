<template>
  <GlassPanel class="ops-panel output-panel" :class="{ 'output-panel-open': outputPublishDropdownOpen }" allow-overflow>
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Output</span>
        <h3>成片交付</h3>
      </div>
      <CheckCircle2 v-if="verticalReady" class="panel-mark ready" aria-hidden="true" />
      <AlertTriangle v-else-if="combinedErrorText" class="panel-mark danger" aria-hidden="true" />
    </div>

    <div class="output-summary">
      <div class="output-metric">
        <span>成片</span>
        <strong>{{ finalVideoLabel }}</strong>
      </div>
      <div class="output-metric">
        <span>发布任务</span>
        <strong>{{ publishStats.jobCount }}</strong>
      </div>
      <div class="output-metric">
        <span>竖屏合成</span>
        <strong>{{ verticalDeliveryLabel }}</strong>
      </div>
    </div>

    <div v-if="combinedErrorText" class="failure-box">
      <AlertTriangle class="icon" aria-hidden="true" />
      <div>
        <strong>最近失败</strong>
        <span>{{ combinedErrorText }}</span>
        <div v-if="verticalErrorText && finalVideoUrl" class="failure-actions">
          <button type="button" class="mini-button danger-mini" :disabled="verticalLoading" @click="emit('retry-vertical')">
            <RotateCcw class="icon-sm" aria-hidden="true" />
            重试竖屏合成
          </button>
        </div>
      </div>
    </div>

    <div v-if="finalVideoUrl" class="vertical-delivery-card" :class="`state-${verticalDeliveryState}`">
      <div class="vertical-delivery-copy">
        <Activity v-if="verticalLoading" class="icon-sm" aria-hidden="true" />
        <CheckCircle2 v-else-if="verticalReady" class="icon-sm" aria-hidden="true" />
        <AlertTriangle v-else-if="verticalErrorText" class="icon-sm" aria-hidden="true" />
        <Sparkles v-else class="icon-sm" aria-hidden="true" />
        <div>
          <strong>{{ verticalDeliveryTitle }}</strong>
          <span>{{ verticalDeliveryDescription }}</span>
        </div>
      </div>
      <div v-if="verticalLoading" class="vertical-progress-rail" role="progressbar" :aria-valuenow="verticalProgress" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: verticalProgressWidth }"></span>
      </div>
      <div v-if="verticalErrorText" class="vertical-retry-actions">
        <button type="button" class="tool-button compact" :disabled="verticalLoading" @click="emit('retry-vertical')">
          <RotateCcw class="icon-sm" aria-hidden="true" />
          重新合成竖屏
        </button>
      </div>
    </div>

    <div class="output-workbench">
      <div class="output-preview" :class="{ running: verticalLoading }">
        <video
          v-if="deliveryPreviewUrl"
          :src="deliveryPreviewUrl"
          controls
          preload="metadata"
          playsinline
        ></video>
        <div v-else class="empty-row">等待成片预览</div>
      </div>

      <div class="quick-publish-box">
        <div class="quick-publish-heading">
          <div>
            <span class="panel-kicker">Quick Publish</span>
            <strong>发布目标</strong>
          </div>
          <button
            v-if="deliveryPreviewUrl"
            type="button"
            class="mini-button"
            @click="emit('open-output-preview')"
          >
            <Maximize2 class="icon-sm" aria-hidden="true" />
            全屏预览
          </button>
        </div>

        <div class="field-control select-control output-account-select" @focusout="emit('output-dropdown-focusout', $event)">
          <span>平台 / 账号</span>
          <button
            type="button"
            class="select-trigger"
            aria-haspopup="listbox"
            :aria-expanded="outputPublishDropdownOpen"
            :disabled="publishComposerBusy || !publishComposerAccountOptions.length"
            @click="emit('toggle-output-dropdown')"
            @keydown.escape.prevent="emit('close-output-dropdown')"
          >
            <strong>{{ publishComposerAccountLabel }}</strong>
            <ChevronDown class="icon-sm" aria-hidden="true" />
          </button>
          <div
            v-if="outputPublishDropdownOpen"
            class="select-menu"
            role="listbox"
          >
            <button
              v-for="account in publishComposerAccountOptions"
              :key="`output_${account.key}`"
              type="button"
              class="select-option account-select-option"
              :class="{ active: selectedPublishComposerAccountKey === account.key }"
              role="option"
              :aria-selected="selectedPublishComposerAccountKey === account.key"
              @click="emit('select-output-account', account)"
            >
              <span>{{ account.platformLabel }}</span>
              <strong>{{ account.accountLabel }}</strong>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="primary-action quick-publish-action"
          :class="{ waiting: !canQuickPublish }"
          :disabled="!canQuickPublish"
          @click="emit('create-publish', 'publish')"
        >
          <Rocket class="icon-sm" aria-hidden="true" />
          {{ quickPublishActionLabel }}
        </button>
      </div>
    </div>
  </GlassPanel>
</template>

<script setup>
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Maximize2,
  Rocket,
  RotateCcw,
  Sparkles
} from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';

defineProps({
  outputPublishDropdownOpen: { type: Boolean, default: false },
  verticalReady: { type: Boolean, default: false },
  combinedErrorText: { type: String, default: '' },
  finalVideoLabel: { type: String, default: '待生产' },
  publishStats: { type: Object, default: () => ({}) },
  verticalDeliveryLabel: { type: String, default: '' },
  verticalErrorText: { type: String, default: '' },
  finalVideoUrl: { type: String, default: '' },
  verticalLoading: { type: Boolean, default: false },
  verticalDeliveryState: { type: String, default: 'idle' },
  verticalDeliveryTitle: { type: String, default: '' },
  verticalDeliveryDescription: { type: String, default: '' },
  verticalProgress: { type: Number, default: 0 },
  verticalProgressWidth: { type: String, default: '0%' },
  deliveryPreviewUrl: { type: String, default: '' },
  publishComposerBusy: { type: Boolean, default: false },
  publishComposerAccountOptions: { type: Array, default: () => [] },
  publishComposerAccountLabel: { type: String, default: '' },
  selectedPublishComposerAccountKey: { type: String, default: '' },
  canQuickPublish: { type: Boolean, default: false },
  quickPublishActionLabel: { type: String, default: '' }
});

const emit = defineEmits([
  'retry-vertical',
  'open-output-preview',
  'output-dropdown-focusout',
  'toggle-output-dropdown',
  'close-output-dropdown',
  'select-output-account',
  'create-publish'
]);
</script>

<style scoped src="../AutomationDashboard.css"></style>
