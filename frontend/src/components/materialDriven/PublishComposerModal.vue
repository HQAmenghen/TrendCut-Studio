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

<style scoped>
.source-modal {
  display: grid;
  gap: 14px;
  width: min(760px, 100%);
  max-height: min(760px, calc(100vh - 40px));
  overflow: auto;
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--glass-panel-strong) 92%, var(--brand-a) 6%), var(--glass-panel)),
    var(--panel);
  box-shadow: 0 34px 90px rgba(0, 0, 0, 0.4), 0 1px 0 var(--glass-highlight) inset;
  backdrop-filter: blur(28px) saturate(1.18);
  padding: 16px;
}

:global(body.theme-light) .source-modal {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(252, 254, 255, 0.92)),
    var(--panel);
  box-shadow: var(--modal-shadow);
}

h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 16px;
  line-height: 1.25;
}

.panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 850;
}

.modal-heading,
.modal-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.modal-actions {
  align-items: stretch;
}

.primary-action,
.tool-button,
.mini-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid var(--glass-border);
  border-radius: 7px;
  padding: 9px 12px;
  color: var(--strong-text);
  background: var(--glass-panel);
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  text-decoration: none;
  box-shadow: 0 1px 0 var(--glass-highlight) inset, 0 8px 18px color-mix(in srgb, var(--brand-a) 7%, transparent);
  overflow: hidden;
  transition: border-color 0.22s ease, background 0.22s ease, color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.primary-action::after,
.tool-button::after,
.mini-button::after {
  content: "";
  position: absolute;
  inset: -35% auto -35% -70%;
  width: 42%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.32), transparent);
  transform: skewX(-18deg);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.42s ease, opacity 0.28s ease;
}

.primary-action {
  min-height: 46px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand-a) 90%, white), var(--brand-b));
  border-color: var(--brand-a);
  color: #04110f;
  box-shadow: 0 15px 28px color-mix(in srgb, var(--brand-a) 22%, transparent), 0 1px 0 rgba(255, 255, 255, 0.45) inset;
}

.tool-button:hover,
.mini-button:hover {
  border-color: var(--line-strong);
  color: var(--strong-text);
  transform: translateY(-1px);
  box-shadow: 0 12px 22px color-mix(in srgb, var(--brand-a) 10%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.primary-action:hover::after,
.tool-button:hover::after,
.mini-button:hover::after {
  opacity: 1;
  transform: translateX(410%) skewX(-18deg);
}

.primary-action:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 18px 30px color-mix(in srgb, var(--brand-a) 26%, transparent);
}

.primary-action:disabled,
.tool-button:disabled,
.mini-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.mini-button {
  min-height: 32px;
  padding: 6px 10px;
  color: var(--brand-a);
}

.field-control {
  display: grid;
  gap: 6px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  background: var(--glass-panel);
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  padding: 9px;
}

.field-control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-control-row > span {
  min-width: 0;
}

.field-control span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.field-control input,
.field-control textarea {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--input-border);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--strong-text);
  min-height: 34px;
  padding: 6px 8px;
  font-weight: 800;
  color-scheme: inherit;
}

.field-control .tool-button {
  width: auto;
  min-height: 32px;
  padding: 6px 9px;
  white-space: nowrap;
}

.field-control textarea {
  line-height: 1.5;
  resize: vertical;
}

.field-control input:disabled,
.field-control textarea:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.select-control {
  position: relative;
}

.select-trigger {
  min-width: 0;
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--input-border);
  border-radius: 6px;
  outline: none;
  background: var(--glass-panel);
  color: var(--strong-text);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.select-trigger:hover:not(:disabled),
.select-trigger[aria-expanded="true"] {
  border-color: color-mix(in srgb, var(--brand-a) 44%, var(--input-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-a) 12%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.select-trigger strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.select-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.select-trigger .icon-sm {
  color: var(--muted);
  flex: none;
  transition: transform 0.18s ease, color 0.18s ease;
}

.select-trigger[aria-expanded="true"] .icon-sm {
  color: var(--brand-a);
  transform: rotate(180deg);
}

.select-menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  display: grid;
  gap: 4px;
  max-height: min(260px, 44vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border: 1px solid var(--input-border);
  border-radius: 7px;
  background: var(--glass-panel-strong);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(22px) saturate(1.18);
}

.select-menu::-webkit-scrollbar {
  width: 7px;
}

.select-menu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-a) 38%, transparent);
}

.select-option {
  width: 100%;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in srgb, var(--input-bg) 84%, transparent);
  color: var(--strong-text);
  display: flex;
  align-items: center;
  padding: 7px 9px;
  font-size: 13px;
  font-weight: 850;
  text-align: left;
  cursor: pointer;
}

.select-option:hover,
.select-option:focus-visible {
  border-color: var(--input-border);
  background: var(--glass-panel);
  outline: none;
}

.select-option.active {
  border-color: color-mix(in srgb, var(--brand-a) 60%, var(--input-border));
  background: color-mix(in srgb, var(--brand-a) 16%, var(--glass-panel));
}

.empty-row {
  border: 1px dashed var(--line-soft);
  border-radius: 7px;
  padding: 12px;
  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.icon-sm {
  width: 15px;
  height: 15px;
  flex: none;
}

.publish-composer-modal {
  width: min(1040px, 100%);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0;
}

.publish-composer-modal .modal-heading {
  padding: 16px 16px 0;
}

.publish-composer-modal .modal-actions {
  border-top: 1px solid var(--line-soft);
  background: var(--glass-panel);
  padding: 12px 16px 16px;
}

:global(body.theme-light) .publish-composer-modal .modal-actions {
  background: rgba(248, 253, 255, 0.68);
}

.publish-composer-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(360px, 1fr);
  gap: 14px;
  padding: 0 16px 16px;
}

.publish-composer-preview {
  justify-self: center;
  width: min(100%, 320px);
  height: min(520px, calc(100vh - 240px));
  overflow: hidden;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: #05070a;
}

.publish-composer-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.publish-composer-form {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.publish-target-list {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-subtle);
  padding: 10px;
}

.publish-account-select {
  position: relative;
  z-index: 90;
  padding: 0;
  background: transparent;
  border: 0;
}

.publish-account-select .select-menu {
  top: auto;
  bottom: calc(100% + 6px);
  z-index: 120;
  max-height: min(320px, calc(100vh - 360px));
}

.account-select-option {
  display: grid;
  grid-template-columns: minmax(84px, 0.45fr) minmax(0, 1fr);
  gap: 10px;
}

.account-select-option span,
.account-select-option strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-select-option span {
  color: var(--muted);
  font-size: 12px;
}

.account-select-option strong {
  color: var(--strong-text);
  font-size: 13px;
}

.publish-composer-feedback {
  display: grid;
  gap: 4px;
  border-radius: 7px;
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.5;
}

.publish-composer-feedback.pending {
  border: 1px solid color-mix(in srgb, var(--brand-a) 26%, var(--line-soft));
  background: color-mix(in srgb, var(--brand-a) 8%, var(--glass-panel));
  color: var(--strong-text);
}

.publish-composer-feedback.error {
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line-soft));
  background: color-mix(in srgb, var(--danger) 8%, var(--glass-panel));
  color: var(--danger);
}

.publish-composer-feedback span {
  color: inherit;
  opacity: 0.88;
}

@media (max-width: 720px) {
  .publish-composer-modal {
    max-height: calc(100vh - 24px);
    overflow: auto;
  }

  .publish-composer-modal .modal-heading,
  .publish-composer-grid,
  .publish-composer-modal .modal-actions {
    padding-left: 12px;
    padding-right: 12px;
  }

  .publish-composer-grid {
    grid-template-columns: 1fr;
  }

  .publish-composer-preview {
    width: min(100%, 300px);
    height: min(52vh, 460px);
  }
}
</style>
