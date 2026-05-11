<template>
  <div>
    <div v-if="planSummary" class="panel">
      <div class="panel-header"><span>📋 导演规划摘要</span></div>
      <div class="panel-body">
        <div class="mini-status-grid">
          <div class="mini-status-card">
            <span>总时长</span>
            <strong>{{ planSummary.totalDuration }}秒</strong>
          </div>
          <div class="mini-status-card">
            <span>素材占比</span>
            <strong>{{ planSummary.materialRatio }}%</strong>
          </div>
          <div class="mini-status-card">
            <span>数字人占比</span>
            <strong>{{ planSummary.aimanRatio }}%</strong>
          </div>
        </div>
      </div>
    </div>

    <div v-if="hasNarrationPreview" class="panel">
      <div class="panel-header"><span>🎤 解说词摘要</span></div>
      <div class="panel-body stack">
        <div v-if="narrationSummary" class="mini-status-grid">
          <div class="mini-status-card">
            <span>目标时长</span>
            <strong>{{ narrationSummary.targetDuration }}秒</strong>
          </div>
          <div class="mini-status-card">
            <span>字数</span>
            <strong>{{ narrationSummary.charCount }}字</strong>
          </div>
          <div class="mini-status-card">
            <span>语速</span>
            <strong>{{ narrationSummary.speed }}字/秒</strong>
          </div>
        </div>
        <div v-if="narrationTextToShow" class="narration-text">
          <strong>解说词内容：</strong>
          <p>{{ narrationTextToShow }}</p>
        </div>
      </div>
    </div>

    <div v-if="hasEditPlan || hasExecutionPlan" class="panel">
      <div class="panel-header"><span>🧠 自动编排状态</span></div>
      <div class="panel-body stack">
        <div class="mini-status-grid">
          <div class="mini-status-card">
            <span>脚本句数</span>
            <strong>{{ scriptUnitCount || 0 }}</strong>
          </div>
          <div class="mini-status-card">
            <span>Edit Plan</span>
            <strong>{{ editPlanBlockCount || '待生成' }}</strong>
          </div>
          <div class="mini-status-card">
            <span>Execution Plan</span>
            <strong>{{ executionPlanSegmentCount || '待落地' }}</strong>
          </div>
          <div class="mini-status-card">
            <span>模板</span>
            <strong>{{ editPlan?.meta?.template_id || editPlan?.template_id || 'material_driven_v1' }}</strong>
          </div>
        </div>
        <details v-if="hasEditPlan" class="advanced-block mt-2">
          <summary>查看 Edit Plan</summary>
          <pre class="json-block">{{ editPlanPretty }}</pre>
        </details>
        <details v-if="hasExecutionPlan" class="advanced-block mt-2">
          <summary>查看 Execution Plan</summary>
          <pre class="json-block">{{ executionPlanPretty }}</pre>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  planSummary: Object,
  narrationSummary: Object,
  hasNarrationPreview: Boolean,
  narrationTextToShow: String,
  hasEditPlan: Boolean,
  hasExecutionPlan: Boolean,
  scriptUnitCount: Number,
  editPlanBlockCount: Number,
  executionPlanSegmentCount: Number,
  editPlan: Object,
  editPlanPretty: String,
  executionPlanPretty: String
});
</script>
