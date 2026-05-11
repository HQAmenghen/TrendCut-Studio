<template>
  <section class="xai-page">
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Discovery Console</div>
          <div>
            <h3>XAI 热门视频发现面板</h3>
            <p>按账号分区运行 XAI + X 搜索任务，分别抓取过去 24 小时的热门视频、计算热度指标，并把结果整理成可筛读的榜单。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">{{ partitionLabel }}</span>
            <span class="flow-pill">视频补全</span>
            <span class="flow-pill">热度评分</span>
            <span class="flow-pill">结果沉淀</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="dashboard-stat">
            <span>运行状态</span>
            <strong>{{ runStatusLabel }}</strong>
            <p>调用 Python 脚本完成搜索、补全和排序。</p>
          </div>
          <div class="dashboard-stat">
            <span>榜单结果</span>
            <strong>{{ items.length ? `${items.length} 条` : '暂无结果' }}</strong>
            <p>默认展示 Top10 结果与视频直链。</p>
          </div>
          <div class="dashboard-stat">
            <span>最高热度</span>
            <strong>{{ topHotScore }}</strong>
            <p>基于超粉比、播放、互动和时效综合计算。</p>
          </div>
          <div class="dashboard-stat">
            <span>当前分区</span>
            <strong>{{ partitionLabel }}</strong>
            <p>{{ accountsCount }} 个账号，窗口 {{ windowHours }}h。</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-grid">
      <div class="left-column">
        <div class="console-card">
          <div class="section-kicker">Run Control</div>
          <div class="console-title">榜单任务控制台</div>
          <p class="console-copy">保持原有中台风格，在这里启动任务、查看当前阶段和读取最新结果。</p>
        </div>

        <div class="panel">
          <div class="panel-header"><span>🛰️ 任务控制</span></div>
          <div class="panel-body xai-stack">
            <div class="route-guide">
              <div class="route-card route-card-fast">
                <strong>路线一：热门视频快速发布</strong>
                <p>选中热点视频后，直接送入竖屏队列，成片会自动进入发布中心，适合追热点快发。</p>
              </div>
              <div class="route-card route-card-deep">
                <strong>路线二：热点进入 AI 混剪</strong>
                <p>把热点视频当作空镜头送入混剪台，再配数字人口播做完整解说，成片后可直接发布或转成竖屏再发。</p>
              </div>
            </div>
            <div class="mini-grid">
              <div class="dashboard-stat">
                <span>阶段</span>
                <strong>{{ stageLabel }}</strong>
                <p>候选扫描、补全、粉丝获取会依次推进。</p>
              </div>
              <div class="dashboard-stat">
                <span>更新时间</span>
                <strong class="mini-strong">{{ updatedLabel }}</strong>
                <p>读取的是项目内 `xai_top10/{{ resultFileLabel }}`。</p>
              </div>
            </div>

            <button type="button" class="btn-primary" @click="xai.run" :disabled="xai.loading.value || xai.summary.value.running">
              <span v-if="!xai.loading.value && !xai.summary.value.running">▶ 运行「{{ partitionLabel }}」Top10 榜单</span>
              <span v-else class="pulse">⏳ 榜单任务执行中...</span>
            </button>

            <div class="queue-action-grid">
              <button type="button" class="btn-success" @click="xai.queueSelected" :disabled="!xai.selectedItems.value.length || xai.queueing.value">
                {{ xai.queueing.value ? '入队中...' : `批量送入竖屏队列（${xai.selectedItems.value.length}）` }}
              </button>
            </div>

            <div class="config-cluster">
              <div class="config-cluster-title">当前默认模板</div>
              <div class="cluster-content">
                <div class="cluster-title">{{ renderPresetLabel }}</div>
                <div class="cluster-copy">默认模板已经适合直接批量跑竖屏。只有你想微调队列并发、字号或字幕位置时，再展开高级设置。</div>
                <div class="cluster-metrics">
                  <div class="cluster-metric">并发 {{ xai.concurrency.value }}</div>
                  <div class="cluster-metric">标题 {{ xai.renderOptions.value.titleFontSize }} / 2 行</div>
                  <div class="cluster-metric">中文字幕 {{ xai.renderOptions.value.subtitleFontSize }} / 2 行</div>
                  <div class="cluster-metric">字幕下移 {{ xai.renderOptions.value.subtitleOffsetY }} / 英文 52</div>
                </div>
              </div>
            </div>

            <details class="advanced-block">
              <summary>展开高级设置</summary>
              <div class="advanced-body xai-stack">
                <div class="queue-action-grid advanced-queue-grid">
                  <div>
                    <label class="control-label">竖屏队列并发</label>
                    <input
                      type="number"
                      min="1"
                      max="4"
                      class="input-dark"
                      :value="xai.concurrency.value"
                      @input="xai.concurrency.value = Number($event.target.value || 1)"
                      title="并发数"
                    />
                  </div>
                </div>
                <div class="control-grid">
                  <div>
                    <label class="control-label">队列标题字号</label>
                    <input type="number" min="56" max="140" class="input-dark text-center" :value="xai.renderOptions.value.titleFontSize" @input="xai.renderOptions.value.titleFontSize = Number($event.target.value || 104)" />
                  </div>
                  <div>
                    <label class="control-label">队列字幕字号</label>
                    <input type="number" min="24" max="72" class="input-dark text-center" :value="xai.renderOptions.value.subtitleFontSize" @input="xai.renderOptions.value.subtitleFontSize = Number($event.target.value || 50)" />
                  </div>
                  <div>
                    <label class="control-label">队列字幕下移</label>
                    <input type="number" min="-20" max="80" class="input-dark text-center" :value="xai.renderOptions.value.subtitleOffsetY" @input="xai.renderOptions.value.subtitleOffsetY = Number($event.target.value || 20)" />
                  </div>
                </div>
              </div>
            </details>

            <button type="button" class="ghost-btn wide-btn" @click="xai.refresh" :disabled="xai.loading.value">刷新本地结果与状态</button>

            <p class="muted-copy">需要的环境变量包括 `XAI_API_KEY`、`X_BEARER_TOKEN`、`X_CONSUMER_KEY`、`X_CONSUMER_SECRET`、`X_ACCESS_TOKEN`、`X_ACCESS_TOKEN_SECRET`。</p>
            <p v-if="xai.error.value" class="error-box">{{ xai.error.value }}</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><span>👥 分区账号池</span></div>
          <div class="panel-body xai-stack">
            <div class="partition-switcher">
              <button
                v-for="partition in xai.partitions.value"
                :key="partition.id"
                type="button"
                class="partition-tab"
                :class="{ active: partition.id === xai.activePartitionId.value }"
                @click="xai.selectPartition(partition.id)"
              >
                <span>{{ partition.label }}</span>
                <small>{{ getPartitionAccountCount(partition) }} 个账号</small>
              </button>
            </div>

            <div class="partition-create-row">
              <input
                class="input-dark"
                :value="xai.newPartitionLabel.value"
                placeholder="新增分区，如 美股 / 游戏 / SaaS"
                @input="xai.newPartitionLabel.value = $event.target.value"
                @keydown.enter.prevent="xai.createPartition"
              />
              <button type="button" class="dark-btn" @click="xai.createPartition" :disabled="!xai.newPartitionLabel.value.trim() || xai.savingConfig.value">新增</button>
            </div>

            <div class="quick-tip-box">
              <strong>当前「{{ partitionLabel }}」共 {{ accountsCount }} 个账号</strong>
              <p>运行、刷新、导出和批量入队都会使用当前分区；自动发布中心也可以为不同账号槽选择不同分区。</p>
            </div>
            <details class="advanced-block">
              <summary>展开当前分区维护</summary>
              <div class="advanced-body xai-stack">
                <div class="partition-edit-grid">
                  <div>
                    <label class="control-label">分区名称</label>
                    <input
                      class="input-dark"
                      :value="xai.activePartition.value?.label || ''"
                      @input="xai.updatePartitionLabel(xai.activePartitionId.value, $event.target.value)"
                    />
                  </div>
                  <button
                    type="button"
                    class="ghost-btn danger-btn"
                    :disabled="xai.partitions.value.length <= 1 || xai.savingConfig.value"
                    @click="xai.removePartition(xai.activePartitionId.value)"
                  >
                    删除分区
                  </button>
                </div>
                <textarea
                  class="input-dark accounts-text"
                  :value="xai.accountsText.value"
                  rows="10"
                  placeholder="每行一个 X 账号，支持带 @ 或不带 @。保存后该分区会独立抓榜。"
                  @input="xai.accountsText.value = $event.target.value"
                />
                <div class="mini-grid">
                  <button type="button" class="dark-btn" @click="xai.saveConfig" :disabled="xai.loading.value || xai.savingConfig.value">
                    {{ xai.savingConfig.value ? '保存中...' : '保存账号池' }}
                  </button>
                  <button type="button" class="ghost-btn wide-btn" @click="xai.loadConfig" :disabled="xai.loading.value || xai.savingConfig.value">重新读取配置</button>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div class="right-column">
        <div class="panel">
          <div class="panel-header panel-header-between">
            <span>📊 榜单概览</span>
            <div class="header-actions">
              <button type="button" class="dark-chip" :disabled="!items.length" @click="xai.exportResult('json')">导出 JSON</button>
              <button type="button" class="dark-chip" :disabled="!items.length" @click="xai.exportResult('csv')">导出 CSV</button>
              <span class="header-tag">{{ xai.result.value?.title || '等待结果' }}</span>
            </div>
          </div>
          <div class="panel-body">
            <div class="overview-grid">
              <div class="dashboard-stat">
                <span>榜单数量</span>
                <strong>{{ items.length || '-' }}</strong>
              </div>
              <div class="dashboard-stat">
                <span>最高播放</span>
                <strong>{{ highestViews }}</strong>
              </div>
              <div class="dashboard-stat">
                <span>xAI 请求数</span>
                <strong>{{ xaiRequestCount }}</strong>
              </div>
              <div class="dashboard-stat">
                <span>预估工具费</span>
                <strong>{{ estimatedCost }}</strong>
              </div>
            </div>
            <p class="muted-copy summary-copy">{{ summaryText }}</p>
          </div>
        </div>

        <div class="panel table-panel">
          <div class="panel-header"><span>🏆 TOP10 榜单明细</span></div>
          <div class="table-wrap">
            <table class="result-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      :checked="allSelected"
                      @change="xai.toggleSelectAll($event.target.checked)"
                    />
                  </th>
                  <th>排名</th>
                  <th>博主 / 摘要</th>
                  <th>粉丝</th>
                  <th>超粉比</th>
                  <th>爆发指数</th>
                  <th>播放</th>
                  <th>互动率</th>
                  <th>热度</th>
                  <th>视频规格</th>
                  <th>发布时间</th>
                  <th>链接</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!items.length">
                  <td colspan="13" class="empty-cell">还没有可展示的榜单结果，先运行一次任务或读取本地结果。</td>
                </tr>
                <tr v-for="item in items" :key="item.post_id || item.rank" class="table-row">
                  <td class="cell-top">
                    <input
                      type="checkbox"
                      :checked="xai.selectedKeys.value.includes(String(item.post_id || item.rank))"
                      @change="xai.toggleSelect(item, $event.target.checked)"
                    />
                  </td>
                  <td class="cell-top rank-cell">{{ item.rank }}</td>
                  <td class="cell-top summary-cell">
                    <div class="author-name">@{{ item.author || '-' }}</div>
                    <div class="summary-en">{{ stripSummary(item.author_summary || item.summary || '-') }}</div>
                    <div v-if="item.author_summary_zh" class="summary-zh">{{ item.author_summary_zh }}</div>
                  </td>
                  <td class="cell-top nowrap">
                    {{ compactNumber(item.followers) }}
                    <div class="sub-note">{{ item.followers_source || '-' }}</div>
                  </td>
                  <td class="cell-top nowrap"><span class="pill purple">{{ item.ratio_display || '-' }}</span></td>
                  <td class="cell-top nowrap"><span class="pill blue">{{ item.breakout_display || '-' }}</span></td>
                  <td class="cell-top nowrap strong-green">{{ item.views_display || compactNumber(item.views) }}</td>
                  <td class="cell-top nowrap">{{ percent(item.engagement_rate) }}</td>
                  <td class="cell-top nowrap"><span class="pill amber">{{ item.hot_score ?? '-' }}</span></td>
                  <td class="cell-top nowrap">
                    {{ item.video_resolution || '-' }}
                    <div class="sub-note">{{ item.video_variant_count ?? 0 }} 个版本</div>
                  </td>
                  <td class="cell-top nowrap muted">{{ item.published_at || '-' }}</td>
                  <td class="cell-top nowrap">
                    <div class="link-stack">
                      <a v-if="item.post_url" :href="item.post_url" target="_blank" rel="noreferrer">查看帖子</a>
                      <a v-if="item.video_url" :href="item.video_url" target="_blank" rel="noreferrer" class="video-link">打开视频</a>
                    </div>
                  </td>
                  <td class="cell-top nowrap">
                    <div class="action-stack">
                      <button type="button" class="mini-action success" @click="xai.queueSingle(item)" :disabled="xai.queueing.value">直送竖屏队列</button>
                      <button type="button" class="mini-action primary" @click="emit('send-to-pipeline', item)">送入 AI 混剪</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <RunLogPanel title="📝 运行摘要" :recent-logs="xai.recentLogs.value" :error-logs="xai.errorLogs.value" />
  </section>
</template>

<script setup>
import { computed } from 'vue';
import RunLogPanel from './RunLogPanel.vue';

const props = defineProps({
  xai: { type: Object, required: true }
});
const emit = defineEmits(['send-to-pipeline']);

const items = computed(() => props.xai.items.value || []);
const partitionLabel = computed(() => props.xai.activePartitionLabel.value || '默认分区');
const resultFileLabel = computed(() => {
  const id = props.xai.activePartitionId.value || 'crypto';
  return id === 'crypto' ? 'result.json' : `result.${id}.json`;
});

const runStatusLabel = computed(() => {
  if (props.xai.loading.value) return '运行中';
  if (props.xai.summary.value.running) return '执行中';
  return '待触发';
});

const stageLabel = computed(() => {
  const stage = String(props.xai.summary.value.stage || 'idle').toLowerCase();
  const map = {
    idle: '粉丝拉取',
    followers: '粉丝拉取',
    scanning: '候选扫描',
    collect: '候选扫描',
    enrich: '视频补全',
    ranking: '热度评分',
    completed: '结果沉淀',
    done: '结果沉淀'
  };
  return map[stage] || props.xai.summary.value.stage || '待命';
});

const updatedLabel = computed(() => {
  const first = items.value[0]?.__read_at || props.xai.result.value?.generated_at || props.xai.result.value?.updated_at;
  return first || '暂无';
});

const topHotScore = computed(() => {
  const value = items.value.reduce((max, item) => Math.max(max, Number(item.hot_score || 0)), 0);
  return value || '-';
});

const highestViews = computed(() => {
  const byDisplay = items.value.map((item) => item.views_display).filter(Boolean)[0];
  if (byDisplay) {
    const sorted = [...items.value]
      .filter((item) => item.views_display || item.views)
      .sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    return sorted[0]?.views_display || compactNumber(sorted[0]?.views);
  }
  return compactNumber(items.value.reduce((max, item) => Math.max(max, Number(item.views || 0)), 0));
});

const xaiRequestCount = computed(() => props.xai.result.value?.cost_estimate?.xai_request_count ?? '-');
const estimatedCost = computed(() => props.xai.result.value?.cost_estimate?.estimated_total_cost_usd ?? '-');
const windowHours = computed(() => props.xai.result.value?.time_range?.window_hours || 24);

const summaryText = computed(() => {
  const range = props.xai.result.value?.time_range;
  const title = props.xai.result.value?.title || '';
  if (!range) return title || '等待结果文件生成。';
  return `时间范围：${range.since || '-'} 到 ${range.until || '-'}。当前共整理 ${items.value.length} 条结果。${props.xai.result.value?.cost_estimate?.notes || ''}`.trim();
});

const allSelected = computed(() => items.value.length > 0 && props.xai.selectedItems.value.length === items.value.length);

const accountsCount = computed(() => props.xai.activePartitionAccountsCount.value || 0);
const renderPresetLabel = computed(() => '信息流稳态模板');

function getPartitionAccountCount(partition) {
  if (partition?.id === props.xai.activePartitionId.value) return accountsCount.value;
  return Array.isArray(partition?.accounts) ? partition.accounts.length : 0;
}

function stripSummary(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^@[^-]+-\s*/, '')
    .trim();
}

function compactNumber(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '-';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
  return String(Math.round(num));
}

function percent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${(num * 100).toFixed(2).replace(/\.00$/, '')}%`;
}
</script>

<style scoped>
.xai-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero-panel,
.panel {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 24px;
  box-shadow: var(--shadow);
}

.hero-panel {
  overflow: hidden;
  background: var(--hero-bg);
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 24px;
  padding: 24px;
}

.hero-copy,
.xai-stack,
.cluster-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-kicker,
.control-label,
.config-cluster-title {
  color: #7dd3fc;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.hero-copy h3,
.console-title {
  margin: 0;
  color: var(--strong-text);
  font-size: 44px;
  line-height: 1.1;
  font-weight: 900;
}

.console-title {
  font-size: 1.125rem;
  margin-top: 8px;
}

.hero-copy p,
.console-copy,
.muted-copy {
  margin: 0;
  color: var(--muted);
  font-size: 0.875rem;
  line-height: 1.8;
}

.flow-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.flow-pill {
  border: 1px solid var(--line-soft);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--muted);
  padding: 0.45rem 0.85rem;
  font-size: 0.75rem;
}

.hero-stats,
.mini-grid,
.overview-grid,
.control-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.dashboard-stat,
.console-card,
.config-cluster {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--panel-subtle);
}

.dashboard-stat {
  padding: 16px;
}

.dashboard-stat span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.dashboard-stat strong {
  display: block;
  color: var(--strong-text);
  font-size: 1.9rem;
  line-height: 1.15;
  margin-top: 12px;
}

.dashboard-stat p,
.sub-note,
.header-tag {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
  margin-top: 10px;
}

.mini-strong {
  font-size: 0.95rem !important;
  line-height: 1.6 !important;
}

.workspace-grid {
  display: grid;
  grid-template-columns: 4fr 8fr;
  gap: 24px;
}

.left-column,
.right-column {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.console-card {
  padding: 16px;
  background: var(--console-bg);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 800;
}

.panel-header-between {
  justify-content: space-between;
}

.panel-body {
  padding: 20px;
}

.btn-primary,
.btn-success,
.ghost-btn,
.dark-btn,
.dark-chip,
.mini-action {
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
}

.btn-primary,
.btn-success {
  border: 0;
  color: #fff;
  width: 100%;
  padding: 16px;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
}

.btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.ghost-btn,
.dark-btn,
.dark-chip {
  border: 1px solid var(--line-soft);
  background: var(--input-bg);
  color: var(--strong-text);
}

.ghost-btn,
.dark-btn {
  padding: 14px 16px;
}

.dark-chip {
  padding: 8px 12px;
  font-size: 11px;
}

.wide-btn {
  width: 100%;
}

.queue-action-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.partition-switcher {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.partition-tab {
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  background: var(--panel-subtle);
  color: var(--text);
  padding: 12px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s, border-color 0.2s, background 0.2s;
}

.partition-tab.active {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(14, 165, 233, 0.14);
  box-shadow: inset 0 0 0 1px rgba(125, 211, 252, 0.16);
}

.partition-tab span,
.partition-tab small {
  display: block;
}

.partition-tab span {
  color: var(--strong-text);
  font-weight: 800;
}

.partition-tab small {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}

.partition-create-row,
.partition-edit-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.danger-btn {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.28);
}

.input-dark {
  width: 100%;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text);
  border-radius: 12px;
  padding: 14px 16px;
}

.compact-input {
  width: 96px;
  text-align: center;
}

.text-center {
  text-align: center;
}

.config-cluster {
  padding: 16px;
}

.route-guide {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.route-card,
.quick-tip-box,
.advanced-block {
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  background: var(--panel-subtle);
}

.route-card,
.quick-tip-box {
  padding: 16px;
}

.route-card strong,
.quick-tip-box strong {
  color: var(--strong-text);
  font-size: 0.95rem;
}

.route-card p,
.quick-tip-box p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.route-card-fast {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.02));
}

.route-card-deep {
  background: linear-gradient(180deg, rgba(99, 102, 241, 0.1), rgba(99, 102, 241, 0.03));
}

.advanced-block {
  overflow: hidden;
}

.advanced-block summary {
  cursor: pointer;
  list-style: none;
  padding: 14px 16px;
  color: var(--strong-text);
  font-weight: 700;
}

.advanced-block summary::-webkit-details-marker {
  display: none;
}

.advanced-body {
  padding: 0 16px 16px;
}

.advanced-queue-grid {
  grid-template-columns: minmax(0, 220px);
}

.cluster-title {
  color: var(--strong-text);
  font-size: 0.95rem;
  font-weight: 700;
}

.cluster-copy {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.cluster-metrics {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 8px;
}

.cluster-metric {
  border: 1px solid var(--line-soft);
  border-radius: 10px;
  background: var(--card-subtle-bg);
  padding: 10px 12px;
  font-size: 11px;
  color: var(--muted);
}

.accounts-text {
  resize: none;
}

.table-panel {
  overflow: hidden;
}

.table-wrap {
  overflow-x: auto;
}

.result-table {
  width: 100%;
  min-width: 1320px;
  border-collapse: collapse;
  font-size: 14px;
}

.result-table thead {
  background: var(--card-subtle-bg);
}

.result-table th {
  padding: 12px 16px;
  text-align: left;
  color: var(--muted);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.14em;
}

.table-row {
  border-top: 1px solid var(--line);
}

.table-row:hover {
  background: var(--brand-soft);
}

.cell-top {
  padding: 16px;
  vertical-align: top;
}

.rank-cell {
  font-size: 1.6rem;
  font-weight: 900;
  color: #7c3aed;
}

.summary-cell {
  min-width: 280px;
}

.author-name {
  color: var(--strong-text);
  font-weight: 800;
}

.summary-en {
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}

.summary-zh {
  margin-top: 8px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.7;
}

.nowrap {
  white-space: nowrap;
}

.muted {
  color: var(--muted);
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.pill.purple {
  background: rgba(168, 85, 247, 0.1);
  color: #c084fc;
}

.pill.blue {
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
}

.pill.amber {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.strong-green {
  color: #10b981;
  font-weight: 700;
}

.link-stack,
.action-stack,
.header-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-actions {
  flex-direction: row;
  align-items: center;
}

.link-stack a {
  color: #38bdf8;
  font-size: 12px;
  text-decoration: none;
}

.link-stack a.video-link {
  color: #34d399;
}

.mini-action {
  border: 0;
  padding: 10px 12px;
  font-size: 12px;
  color: #fff;
}

.mini-action.success {
  background: rgba(5, 150, 105, 0.92);
}

.mini-action.primary {
  background: rgba(99, 102, 241, 0.94);
}

.empty-cell {
  padding: 40px 16px;
  text-align: center;
  color: var(--muted);
}

.summary-copy {
  margin-top: 16px;
}

.pulse {
  animation: pulse 1.5s infinite;
}

.error-box {
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  padding: 12px 14px;
}

@keyframes pulse {
  50% {
    opacity: 0.6;
  }
}

@media (max-width: 1200px) {
  .hero-grid,
  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .route-guide {
    grid-template-columns: 1fr;
  }
}
</style>
