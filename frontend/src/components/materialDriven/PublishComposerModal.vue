<template>
  <ModalBackdrop v-if="open" @close="$emit('close')">
    <section class="source-modal publish-composer-modal" role="dialog" aria-modal="true" aria-label="发布信息">
      <div class="modal-heading">
        <div>
          <span class="panel-kicker">Publish</span>
          <h3>发布信息</h3>
        </div>
        <button type="button" class="mini-button" :disabled="busy" @click="$emit('close')">关闭</button>
      </div>

      <div class="publish-composer-grid">
        <div class="publish-composer-preview">
          <video
            v-if="asset?.url"
            :src="asset.url"
            controls
            preload="metadata"
            playsinline
          ></video>
          <div v-else class="empty-row picker-empty">当前成品没有可预览地址</div>
        </div>

        <div class="publish-composer-form">
          <label class="field-control">
            <span>发布标题</span>
            <input
              :value="editor?.title || title"
              type="text"
              placeholder="默认从成品元数据读取，可手动修改。"
              :disabled="busy"
              @input="$emit('update-title', $event.target.value)"
            />
          </label>

          <label class="field-control">
            <span class="field-control-row">
              <span>发布文案</span>
              <button
                type="button"
                class="tool-button compact"
                :disabled="busy"
                @click="$emit('generate-copy')"
              >
                <Sparkles class="icon-sm" aria-hidden="true" />
                {{ generatingDescription ? '生成中' : '生成文案和标签' }}
              </button>
            </span>
            <textarea
              rows="8"
              :value="editor?.description || ''"
              placeholder="文案由大模型生成，标签会随文案一起写入。"
              @input="$emit('update-description', $event.target.value)"
            ></textarea>
          </label>

          <div class="publish-target-list">
            <span class="panel-kicker">发布账号</span>
            <div class="field-control select-control publish-account-select" @focusout="handleAccountFocusout">
              <button
                type="button"
                class="select-trigger"
                aria-haspopup="listbox"
                :aria-expanded="accountDropdownOpen"
                :disabled="busy || !accountOptions.length"
                @click="$emit('toggle-account-dropdown')"
                @keydown.escape.prevent="$emit('close-account-dropdown')"
              >
                <strong>{{ accountLabel }}</strong>
                <ChevronDown class="icon-sm" aria-hidden="true" />
              </button>
              <div
                v-if="accountDropdownOpen"
                class="select-menu"
                role="listbox"
              >
                <button
                  v-for="account in accountOptions"
                  :key="account.key"
                  type="button"
                  class="select-option account-select-option"
                  :class="{ active: selectedAccountKey === account.key }"
                  role="option"
                  :aria-selected="selectedAccountKey === account.key"
                  @click="$emit('select-account', account)"
                >
                  <span>{{ account.platformLabel }}</span>
                  <strong>{{ account.accountLabel }}</strong>
                </button>
              </div>
            </div>
            <div v-if="!accountOptions.length" class="empty-row">还没有配置可用发布账号。</div>
          </div>

          <div v-if="creatingStatusMessage" class="publish-composer-feedback pending">
            {{ creatingStatusMessage }}
          </div>
          <div v-if="errorState?.message" class="publish-composer-feedback error">
            <strong>{{ errorState.message }}</strong>
            <span v-if="errorState.code">错误码：{{ errorState.code }}</span>
            <span v-if="errorState.hint">{{ errorState.hint }}</span>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="tool-button" :disabled="busy" @click="$emit('close')">取消</button>
        <button type="button" class="tool-button" :disabled="busy" @click="$emit('create', 'draft')">
          <ClipboardList class="icon-sm" aria-hidden="true" />
          {{ actionMode === 'draft' ? '正在创建草稿' : '创建草稿' }}
        </button>
        <button type="button" class="primary-action" :disabled="busy" @click="$emit('create', 'publish')">
          <Rocket class="icon-sm" aria-hidden="true" />
          {{ actionMode === 'publish' ? '正在发布' : '创建并发布' }}
        </button>
      </div>
    </section>
  </ModalBackdrop>
</template>

<script setup>
import { ChevronDown, ClipboardList, Rocket, Sparkles } from 'lucide-vue-next';
import ModalBackdrop from '../ModalBackdrop.vue';

defineProps({
  open: { type: Boolean, default: false },
  asset: { type: Object, default: null },
  editor: { type: Object, default: () => ({}) },
  title: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  actionMode: { type: String, default: '' },
  generatingDescription: { type: Boolean, default: false },
  creatingStatusMessage: { type: String, default: '' },
  errorState: { type: Object, default: () => ({}) },
  accountOptions: { type: Array, default: () => [] },
  accountLabel: { type: String, default: '' },
  selectedAccountKey: { type: String, default: '' },
  accountDropdownOpen: { type: Boolean, default: false }
});

const emit = defineEmits([
  'close',
  'update-title',
  'update-description',
  'generate-copy',
  'toggle-account-dropdown',
  'close-account-dropdown',
  'select-account',
  'create'
]);

const handleAccountFocusout = (event) => {
  if (event.currentTarget?.contains(event.relatedTarget)) return;
  emit('close-account-dropdown');
};
</script>
