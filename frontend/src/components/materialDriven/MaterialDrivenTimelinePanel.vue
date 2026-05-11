<template>
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
</template>

<script setup>
const props = defineProps({
  hasDisplayTimelinePlan: Boolean,
  displayTimelinePlan: {
    type: Array,
    default: () => []
  },
  timelineRows: {
    type: Array,
    default: () => []
  },
  materialShotCount: Number,
  aimanShotCount: Number,
  cutawayShotCount: Number,
  displayTimelinePretty: String,
  timelineTotalDuration: Number
});

const formatSec = (num) => `${Number(num || 0).toFixed(2)}s`;
const getTimelineBarStyle = (seg) => {
  const total = Math.max(0.01, props.timelineTotalDuration || 0.01);
  const left = Math.max(0, (seg.start / total) * 100);
  const width = Math.max(1, (seg.duration / total) * 100);
  return { left: `${left}%`, width: `${width}%` };
};
</script>
