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

<style scoped src="../AutomationDashboard.css"></style>
