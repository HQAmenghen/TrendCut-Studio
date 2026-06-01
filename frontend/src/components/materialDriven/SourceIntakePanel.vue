<template>
  <GlassPanel class="ops-panel intake-panel" :aria-busy="hotListBusy" allow-overflow>
    <div class="panel-heading">
      <div>
        <span class="panel-kicker">Source</span>
        <h3>素材接入</h3>
      </div>
      <span class="state-chip" :class="{ on: hasSource }">
        {{ hasSource ? '已接入' : '待接入' }}
      </span>
    </div>

    <div class="source-toolbar">
      <div class="partition-select" @focusout="emit('partition-menu-focusout', $event)">
        <span>榜单分区</span>
        <button
          type="button"
          class="partition-trigger"
          aria-haspopup="listbox"
          :aria-expanded="partitionMenuOpen"
          @click="emit('toggle-partition-menu')"
          @keydown.escape.prevent="emit('close-partition-menu')"
        >
          <strong>{{ activePartitionLabel }}</strong>
          <ChevronDown class="icon-sm" aria-hidden="true" />
        </button>
        <div v-if="partitionMenuOpen" class="partition-menu" role="listbox">
          <button
            v-for="partition in xaiPartitions"
            :key="partition.id"
            type="button"
            class="partition-option"
            role="option"
            :aria-selected="partition.id === activePartitionId"
            :class="{ active: partition.id === activePartitionId }"
            @click="emit('select-partition', partition.id)"
          >
            <span>{{ partition.label || partition.id }}</span>
          </button>
        </div>
      </div>
      <button type="button" class="tool-button" :disabled="hotListBusy" @click="emit('run-xai')">
        <Search class="icon-sm" aria-hidden="true" />
        {{ xaiLoading ? '抓取中' : '抓取榜单' }}
      </button>
      <button
        type="button"
        class="tool-button"
        :class="{ loading: hotListBusy }"
        :disabled="hotListBusy"
        @click="emit('refresh-hot-list')"
      >
        <RefreshCw class="icon-sm" aria-hidden="true" />
        {{ hotListBusy ? '刷新中' : '刷新榜单' }}
      </button>
    </div>

    <div
      v-if="hotListBusy"
      :key="`source-${hotListProgressKey}`"
      class="hot-refresh-progress source-refresh-progress"
      role="progressbar"
      aria-label="榜单刷新中"
      :aria-valuenow="xaiProgressPercent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuetext="xaiProgressLabel"
    >
      <span :style="{ width: xaiProgressWidth }"></span>
    </div>
    <div v-if="hotListBusy" class="hot-refresh-status source-refresh-status">
      <strong>{{ xaiProgressLabel }}</strong>
      <span>{{ xaiProgressMessage }}</span>
    </div>

    <div class="source-hot-list">
      <article
        v-for="item in displayedHotItems"
        :key="itemKey(item)"
        class="source-hot-card"
      >
        <div class="rank-pill">{{ item.rank || '-' }}</div>
        <div class="hot-main">
          <strong>{{ hotTitle(item) }}</strong>
          <span>{{ hotMetaLine(item) }}</span>
          <div class="hot-stats">
            <em>{{ item.views_display || formatNumber(item.views) }} 播放</em>
            <em>{{ formatNumber(item.likes) }} 赞</em>
            <em>{{ formatNumber(item.reposts) }} 转</em>
            <em>{{ item.breakout_display || '常规' }}</em>
            <em>热度 {{ item.hot_score || '-' }}</em>
          </div>
        </div>
        <div class="hot-actions">
          <button type="button" class="mini-button" :disabled="sourceLocked" @click="emit('use-hot-item', item)">
            <Play class="icon-sm" aria-hidden="true" />
            导入制作
          </button>
          <button type="button" class="mini-button subtle" @click="emit('open-hot-detail', item)">
            <Info class="icon-sm" aria-hidden="true" />
            详情
          </button>
        </div>
      </article>
      <div v-if="!displayedHotItems.length" class="empty-row picker-empty">
        <strong>当前 {{ activePartitionLabel }} 分区暂无素材</strong>
        <button type="button" class="tool-button" @click="emit('open-source-picker')">
          <Search class="icon-sm" aria-hidden="true" />
          切换榜单分区
        </button>
        <button type="button" class="tool-button" :disabled="hotListBusy" @click="emit('run-xai')">
          <Search class="icon-sm" aria-hidden="true" />
          {{ xaiLoading ? '抓取中' : '抓取热门榜单' }}
        </button>
      </div>
    </div>
  </GlassPanel>
</template>

<script setup>
import { ChevronDown, Info, Play, RefreshCw, Search } from 'lucide-vue-next';
import GlassPanel from '../GlassPanel.vue';

defineProps({
  hotListBusy: { type: Boolean, default: false },
  hasSource: { type: Boolean, default: false },
  partitionMenuOpen: { type: Boolean, default: false },
  activePartitionLabel: { type: String, default: '' },
  activePartitionId: { type: String, default: '' },
  xaiPartitions: { type: Array, default: () => [] },
  xaiLoading: { type: Boolean, default: false },
  hotListProgressKey: { type: Number, default: 0 },
  xaiProgressPercent: { type: Number, default: 0 },
  xaiProgressLabel: { type: String, default: '' },
  xaiProgressWidth: { type: String, default: '0%' },
  xaiProgressMessage: { type: String, default: '' },
  displayedHotItems: { type: Array, default: () => [] },
  sourceLocked: { type: Boolean, default: false },
  itemKey: { type: Function, required: true },
  hotTitle: { type: Function, required: true },
  hotMetaLine: { type: Function, required: true },
  formatNumber: { type: Function, required: true }
});

const emit = defineEmits([
  'partition-menu-focusout',
  'toggle-partition-menu',
  'close-partition-menu',
  'select-partition',
  'run-xai',
  'refresh-hot-list',
  'use-hot-item',
  'open-hot-detail',
  'open-source-picker'
]);
</script>

<style scoped src="../AutomationDashboard.css"></style>
