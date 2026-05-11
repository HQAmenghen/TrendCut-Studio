<template>
  <section class="hero-panel">
    <div class="hero-grid">
      <div class="hero-copy">
        <div class="section-kicker">Material First</div>
        <div>
          <h3>热点转视频生产线</h3>
          <p>把热门素材一键转入，自动完成脚本生成、数字人口播、静音素材插片和成片导出，并无缝衔接发布链路。</p>
        </div>
        <div class="flow-pills">
          <span class="flow-pill">热门转入</span>
          <span class="flow-pill">脚本编排</span>
          <span class="flow-pill">数字人口播</span>
          <span class="flow-pill">导出发布</span>
        </div>
      </div>
      <div class="hero-stats">
        <div class="module-summary-card">
          <span>素材状态</span>
          <strong>{{ jobId ? '已接入' : '待接入' }}</strong>
          <p>支持本地上传，也支持从热门榜单一键转入。</p>
        </div>
        <div class="module-summary-card">
          <span>编排核心</span>
          <strong>规则+AI协作</strong>
          <p>先定脚本和镜头计划，再执行渲染导出和发布衔接。</p>
        </div>
        <div class="module-summary-card">
          <span>生产目标</span>
          <strong>{{ planSummary ? `${planSummary.materialRatio}%素材` : '自动编排' }}</strong>
          <p>保留热点证据画面，同时让数字人承担解说和IP表达。</p>
        </div>
        <div class="module-summary-card">
          <span>当前进度</span>
          <strong>{{ currentStepInfo.title }}</strong>
          <p>{{ jobId ? (finalVideoUrl ? '已完成' : '处理中') : '待启动' }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  jobId: String,
  finalVideoUrl: String,
  planSummary: Object,
  currentStepInfo: {
    type: Object,
    required: true
  }
});
</script>
