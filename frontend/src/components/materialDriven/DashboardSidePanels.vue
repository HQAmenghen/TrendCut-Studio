<template>
  <GlassPanel class="ops-panel asset-library-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Library</span>
        <h3>成品库</h3>
      </div>
      <button type="button" class="mini-button" :disabled="publishLoading" @click="emit('refresh-assets')">
        <RefreshCw class="icon-sm" aria-hidden="true" />
        刷新
      </button>
    </div>

    <div class="compact-stats asset-library-stats">
      <div>
        <span>成品</span>
        <strong>{{ publishAssets.length }}</strong>
      </div>
      <div>
        <span>最新</span>
        <strong>{{ latestAssetTimeLabel }}</strong>
      </div>
    </div>

    <div class="asset-list">
      <button
        v-for="asset in visibleAssets"
        :key="asset.id"
        type="button"
        class="asset-row"
        @click="emit('open-asset-detail', asset)"
      >
        <span class="asset-type-pill">{{ asset.typeLabel || '成品' }}</span>
        <div>
          <strong>{{ getAssetTitle(asset) }}</strong>
          <span>{{ asset.sourceMetaLine || formatTime(asset.updatedAt) }}</span>
        </div>
        <em>{{ formatFileSize(asset.sizeBytes) }}</em>
      </button>
      <div v-if="!visibleAssets.length" class="empty-row">暂无可查看成品</div>
    </div>
  </GlassPanel>

  <GlassPanel class="ops-panel autopilot-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Auto-Pilot</span>
        <h3>无人值守发布</h3>
      </div>
      <div class="panel-actions">
        <span class="state-chip" :class="{ on: autoPilotEnabled }">
          {{ autoPilotEnabled ? '已开启' : '未开启' }}
        </span>
        <button type="button" class="mini-button icon-mini" aria-label="配置无人值守发布" @click="emit('open-autopilot-modal')">
          <Settings class="icon-sm" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="compact-stats">
      <div>
        <span>素材</span>
        <strong>{{ publishStats.assetCount }}</strong>
      </div>
      <div>
        <span>任务</span>
        <strong>{{ publishStats.jobCount }}</strong>
      </div>
      <div>
        <span>平台</span>
        <strong>{{ publishStats.enabledPlatformCount }}</strong>
      </div>
    </div>

    <div class="plan-list">
      <div v-for="item in autoPilotPlans" :key="item.id" class="plan-row">
        <div>
          <strong>{{ item.title }}</strong>
          <span>{{ item.scheduledLabel || formatTime(item.scheduledAt) }}</span>
        </div>
        <span>{{ item.statusLabel }}</span>
      </div>
      <div v-if="!autoPilotPlans.length" class="empty-row">暂无托管计划</div>
    </div>
  </GlassPanel>

  <GlassPanel class="ops-panel account-panel">
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Accounts</span>
        <h3>账号管理</h3>
      </div>
      <div class="panel-actions account-config-actions">
        <button type="button" class="mini-button" @click="emit('add-account-config', 'wechatChannels')">
          <Plus class="icon-sm" aria-hidden="true" />
          添加配置
        </button>
        <Users class="panel-mark" aria-hidden="true" />
      </div>
    </div>

    <div class="account-list">
      <div v-for="account in accountCards" :key="account.key" class="account-row">
        <div>
          <strong>{{ account.label }}</strong>
          <span>{{ account.platformLabel }}</span>
        </div>
        <div class="account-row-actions">
          <button type="button" class="mini-button" :disabled="!canCheckAccount(account)" @click="emit('check-login', account)">
            {{ getAccountActionLabel(account) }}
          </button>
          <button type="button" class="mini-button subtle" @click="emit('edit-account-config', account)">
            配置
          </button>
          <button v-if="canOpenAccountManager(account)" type="button" class="mini-button subtle" @click="emit('open-account-manager', account)">
            内容
          </button>
          <button type="button" class="mini-button subtle danger" @click="emit('delete-account-config', account)">
            删除
          </button>
        </div>
      </div>
      <div v-if="!accountCards.length" class="empty-row">暂无账号配置</div>
    </div>
    <div class="account-config-picks">
      <button type="button" class="mini-button subtle" @click="emit('add-account-config', 'wechatChannels')">添加视频号</button>
      <button type="button" class="mini-button subtle" @click="emit('add-account-config', 'douyin')">添加抖音</button>
      <button type="button" class="mini-button subtle" @click="emit('add-account-config', 'xiaohongshu')">添加小红书</button>
      <button type="button" class="mini-button subtle" @click="emit('add-account-config', 'x')">添加 X</button>
    </div>
  </GlassPanel>
</template>

<script setup>
import { Plus, RefreshCw, Settings, Users } from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';

defineProps({
  publishLoading: { type: Boolean, default: false },
  publishAssets: { type: Array, default: () => [] },
  visibleAssets: { type: Array, default: () => [] },
  latestAssetTimeLabel: { type: String, default: '暂无' },
  autoPilotEnabled: { type: Boolean, default: false },
  publishStats: { type: Object, default: () => ({}) },
  autoPilotPlans: { type: Array, default: () => [] },
  accountCards: { type: Array, default: () => [] },
  formatTime: { type: Function, required: true },
  formatFileSize: { type: Function, required: true },
  getAssetTitle: { type: Function, required: true },
  canCheckAccount: { type: Function, required: true },
  getAccountActionLabel: { type: Function, required: true },
  canOpenAccountManager: { type: Function, required: true }
});

const emit = defineEmits([
  'refresh-assets',
  'open-asset-detail',
  'open-autopilot-modal',
  'add-account-config',
  'check-login',
  'edit-account-config',
  'open-account-manager',
  'delete-account-config'
]);
</script>

<style scoped>
.panel-heading,
.panel-actions,
.compact-stats,
.account-row,
.account-row-actions,
.account-config-picks {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-heading {
  justify-content: space-between;
}

.panel-heading h3 {
  margin: 4px 0 0;
  font-size: 1rem;
}

.panel-kicker {
  display: block;
  color: rgba(148, 163, 184, 0.82);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.panel-mark {
  width: 18px;
  height: 18px;
  color: rgba(203, 213, 225, 0.72);
}

.compact-stats {
  justify-content: space-between;
  margin: 12px 0;
}

.compact-stats > div {
  display: grid;
  gap: 4px;
}

.compact-stats span,
.asset-row span,
.plan-row span,
.account-row span {
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.78rem;
}

.asset-list,
.plan-list,
.account-list {
  display: grid;
  gap: 8px;
}

.asset-row,
.plan-row,
.account-row {
  width: 100%;
  min-height: 48px;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.34);
  color: inherit;
}

.asset-row,
.plan-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.plan-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.account-row {
  justify-content: space-between;
}

.asset-row strong,
.plan-row strong,
.account-row strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-type-pill,
.state-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  color: rgba(226, 232, 240, 0.82);
  font-size: 0.72rem;
}

.state-chip.on {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.16);
}

.mini-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 9px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.56);
  color: rgba(226, 232, 240, 0.9);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.mini-button.subtle {
  background: rgba(15, 23, 42, 0.28);
}

.mini-button.danger {
  color: #fecaca;
}

.icon-mini {
  width: 30px;
  padding: 0;
}

.icon-sm {
  width: 14px;
  height: 14px;
}

.empty-row {
  display: flex;
  align-items: center;
  min-height: 46px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  color: rgba(203, 213, 225, 0.68);
  font-size: 0.82rem;
}

.account-config-picks {
  flex-wrap: wrap;
  margin-top: 10px;
}

@media (max-width: 720px) {
  .asset-row,
  .plan-row,
  .account-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .account-row,
  .account-row-actions {
    flex-wrap: wrap;
  }
}
</style>
