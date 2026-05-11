<template>
  <div>
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
          @click="emit('continue-workflow')"
        >
          ✅ 已生成，继续渲染
        </button>
        <button
          type="button"
          class="ghost-btn full-btn"
          :disabled="rebuildingPlan"
          @click="emit('rebuild-plan')"
        >
          {{ rebuildingPlan ? '⏳ 正在重建计划...' : '🧠 重建剪辑计划' }}
        </button>
      </div>
    </div>

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
            @click="emit('rebuild-plan')"
          >
            {{ rebuildingPlan ? '⏳ 重建中...' : '🧠 重建剪辑计划' }}
          </button>
          <button
            type="button"
            class="ghost-btn shrink-none"
            :disabled="rerenderingVideo"
            @click="emit('rerender-video')"
          >
            {{ rerenderingVideo ? '⏳ 渲染中...' : '🎞️ 重新渲染成片' }}
          </button>
          <button type="button" class="ghost-btn shrink-none" @click="emit('to-vertical')">
            📱 导入竖屏合成 (9:16)
          </button>
          <button type="button" class="ghost-btn shrink-none" @click="emit('to-publish')">
            {{ readyForPublish ? '🚀 进入一键发布 (16:9)' : '🚀 转到一键发布 (16:9)' }}
          </button>
          <button type="button" class="ghost-btn shrink-none" @click="emit('reset-workflow')">
            🔄 制作新视频
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="panel error-panel">
      <div class="panel-header"><span>❌ 执行失败</span></div>
      <div class="panel-body stack">
        <p class="error-message">{{ error }}</p>
        <div class="action-buttons">
          <button type="button" class="btn-success" @click="emit('retry-step', currentStep)">
            🔄 重试当前步骤
          </button>
          <button type="button" class="ghost-btn" @click="emit('reset-workflow')">
            ↩️ 重新开始
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  showManualAvatarPrompt: Boolean,
  outputPath: String,
  rebuildingPlan: Boolean,
  rerenderingVideo: Boolean,
  recentLogs: {
    type: Array,
    default: () => []
  },
  finalVideoUrl: String,
  readyForPublish: Boolean,
  scriptUnitCount: Number,
  executionPlanSegmentCount: Number,
  error: String,
  currentStep: Number
});

const emit = defineEmits([
  'continue-workflow',
  'rebuild-plan',
  'rerender-video',
  'retry-step',
  'reset-workflow',
  'to-publish',
  'to-vertical'
]);
</script>
