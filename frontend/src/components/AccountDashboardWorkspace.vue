<template>
  <section class="account-dashboard-page">
    <!-- Hero Banner -->
    <section class="hero-panel">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="section-kicker">Account Portfolio</div>
          <div>
            <h3>账号看板</h3>
            <p>全方位监控视频号账号资产，实时掌握登录状态与发布表现。通过自动化检测与一键修复，确保发布流水线持续稳定运行。</p>
          </div>
          <div class="flow-pills">
            <span class="flow-pill">实时状态监控</span>
            <span class="flow-pill">自动化登录检测</span>
            <span class="flow-pill">发布质量跟踪</span>
          </div>
        </div>
        <div class="hero-stats">
          <div class="dashboard-stat">
            <span>资产总量</span>
            <strong>{{ summary.totalAccounts || 0 }}</strong>
            <p>已配置的视频号账号</p>
          </div>
          <div class="dashboard-stat">
            <span>在线状态</span>
            <strong>{{ summary.loggedInAccounts || 0 }}</strong>
            <p>当前登录有效的活跃账号</p>
          </div>
          <div class="dashboard-stat">
            <span>待处理</span>
            <strong :class="{ 'status-warn': summary.needLoginAccounts > 0 }">{{ summary.needLoginAccounts || 0 }}</strong>
            <p>需要重新扫描二维码登录</p>
          </div>
          <div class="dashboard-stat">
            <span>7日发布</span>
            <strong>{{ summary.totalSuccessLast7Days || 0 }}</strong>
            <p>最近一周成功发布的视频数</p>
          </div>
        </div>
      </div>
    </section>

    <div class="workspace-container">
      <div class="controls-bar">
        <div class="filter-group">
          <button 
            v-for="f in filters" 
            :key="f.key"
            class="filter-tab"
            :class="{ active: activeFilter === f.key }"
            @click="activeFilter = f.key"
          >
            {{ f.label }}
            <span class="filter-count" v-if="f.count > 0">{{ f.count }}</span>
          </button>
        </div>
        <div class="action-group">
          <button 
            class="btn-primary" 
            @click="handleBatchCheck" 
            :disabled="checkingBatchLogin || loading"
          >
            <span v-if="checkingBatchLogin">正在检测账号状态...</span>
            <span v-else>检测所有账号登录态</span>
          </button>
          <button class="ghost-btn" @click="loadDashboard" :disabled="loading">
            {{ loading ? '刷新数据中...' : '同步最新统计' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="error-box">
        <span class="error-icon">⚠️</span>
        <div>
          <strong>{{ errorTitle }}</strong>
          <p>{{ error }}</p>
        </div>
      </div>

      <div v-if="actionMessage" class="info-box">
        <span class="info-icon">✓</span>
        <div>
          <strong>操作已提交</strong>
          <p>{{ actionMessage }}</p>
        </div>
      </div>

      <div v-if="loading && accounts.length === 0" class="loading-state">
        <div class="spinner"></div>
        <p>正在拉取账号资产与运行统计...</p>
      </div>

      <div v-else-if="filteredAccounts.length === 0" class="empty-state">
        <div class="empty-icon">📂</div>
        <h4>暂无匹配账号</h4>
        <p v-if="accounts.length === 0">尚未配置任何社交媒体账号，请前往发布中心进行配置。</p>
        <p v-else>当前过滤条件下没有符合要求的账号。</p>
        <button v-if="accounts.length === 0" class="btn-primary" @click="goToPublishCenter">前往配置账号</button>
      </div>

      <div v-else class="account-grid">
        <div v-for="account in filteredAccounts" :key="account.id" class="account-card-v2">
          <div class="card-header">
            <div class="account-profile">
              <div class="avatar-placeholder">{{ account.displayName?.charAt(0) || 'U' }}</div>
              <div class="name-box">
                <div class="account-name">{{ account.displayName }}</div>
                <div class="account-id-tag">{{ account.finderUserName || account.id }}</div>
              </div>
            </div>
            <div class="status-indicator">
              <span class="status-dot" :class="getStatusDetail(account).class"></span>
              <span class="status-label">{{ getStatusDetail(account).label }}</span>
            </div>
          </div>

          <div class="stats-row">
            <div class="mini-stat">
              <span class="label">累计发布</span>
              <span class="value">{{ account.stats.totalJobs }}</span>
            </div>
            <div class="mini-stat">
              <span class="label">最近7天</span>
              <span class="value">{{ account.stats.recentJobs }}</span>
            </div>
            <div class="mini-stat success">
              <span class="label">成功率</span>
              <span class="value">{{ calculateSuccessRate(account) }}%</span>
            </div>
            <div class="mini-stat failure" v-if="account.stats.failureCount > 0">
              <span class="label">失败</span>
              <span class="value">{{ account.stats.failureCount }}</span>
            </div>
          </div>

          <div class="timeline-detail">
            <div class="detail-item">
              <span class="icon">🕒</span>
              <span class="text">最近发布: {{ formatDateTime(account.stats.lastPublishedAt) }}</span>
            </div>
            <div class="detail-item">
              <span class="icon" :class="{ 'pulsing': checkingLoginAccounts.has(account.id) }">📡</span>
              <span class="text">最后检测: {{ formatDateTime(account.loginStatus?.lastCheckedAt) }}</span>
            </div>
          </div>

          <div v-if="account.stats.lastFailure" class="alert-box failure">
            <div class="alert-head">
               <span>⚠️ 最近一次运行异常</span>
               <span class="alert-time">{{ formatDateTime(account.stats.lastFailure.failedAt) }}</span>
            </div>
            <div class="alert-content">
              <strong>{{ account.stats.lastFailure.errorMessage }}</strong>
              <p v-if="account.stats.lastFailure.hint">建议: {{ account.stats.lastFailure.hint }}</p>
            </div>
          </div>

          <div class="card-actions">
            <button 
              class="action-btn" 
              @click="handleSingleCheck(account.id)"
              :disabled="checkingLoginAccounts.has(account.id)"
            >
              {{ checkingLoginAccounts.has(account.id) ? '检测中' : '检测登录态' }}
            </button>
            <button
              class="action-btn"
              @click="handleOpenContentManager(account.id)"
              :disabled="Boolean(contentManagerActionLabels[account.id])"
            >
              {{ contentManagerActionLabels[account.id] || '内容管理' }}
            </button>
            <button class="action-btn secondary" @click="goToAccountSettings(account.id)">
              配置参数
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import { usePublishCenter } from '../composables/usePublishCenter';

const pc = usePublishCenter();
const { 
  accountLoginStatus, 
  checkingLoginAccounts, 
  checkingBatchLogin,
  checkSingleAccountLogin,
  checkSelectedAccountsLogin,
  loadAllLoginStatus
} = pc;

const loading = ref(false);
const error = ref('');
const errorTitle = ref('同步数据失败');
const actionMessage = ref('');
const accounts = ref([]);
const activeFilter = ref('all');
const contentManagerActionLabels = ref({});
const summary = reactive({
  totalAccounts: 0,
  loggedInAccounts: 0,
  needLoginAccounts: 0,
  runningTasks: 0,
  totalSuccessLast7Days: 0,
  totalFailuresLast7Days: 0
});

const filters = computed(() => [
  { key: 'all', label: '全部账号', count: accounts.value.length },
  { key: 'normal', label: '状态正常', count: accounts.value.filter(a => getAccountStatus(a) === 'logged_in').length },
  { key: 'need_login', label: '待登录', count: accounts.value.filter(a => getAccountStatus(a) === 'need_login').length },
  { key: 'error', label: '运行异常', count: accounts.value.filter(a => getAccountStatus(a) === 'error' || (a.stats?.failureCount > 0 && activeFilter.value === 'error')).length }
]);

const filteredAccounts = computed(() => {
  if (activeFilter.value === 'all') return accounts.value;
  if (activeFilter.value === 'normal') return accounts.value.filter(a => getAccountStatus(a) === 'logged_in');
  if (activeFilter.value === 'need_login') return accounts.value.filter(a => getAccountStatus(a) === 'need_login');
  if (activeFilter.value === 'error') return accounts.value.filter(a => getAccountStatus(a) === 'error');
  return accounts.value;
});

async function loadDashboard() {
  loading.value = true;
  error.value = '';
  actionMessage.value = '';
  try {
    const response = await fetch('/api/publish/accounts/dashboard');
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || '获取账号看板失败');
    }

    accounts.value = data.accounts || [];
    Object.assign(summary, data.summary || {});
    
    // 同步登录状态到 composable 的状态中
    accounts.value.forEach(acc => {
      if (acc.loginStatus) {
        accountLoginStatus.value[acc.id] = acc.loginStatus;
      }
    });
  } catch (err) {
    errorTitle.value = '同步数据失败';
    error.value = err.message || '加载失败';
    console.error('加载账号看板失败:', err);
  } finally {
    loading.value = false;
  }
}

function getAccountStatus(account) {
  // 优先使用实时的登录状态
  const liveStatus = accountLoginStatus.value[account.id];
  return liveStatus?.status || account.loginStatus?.status || 'unknown';
}

function getStatusDetail(account) {
  const status = getAccountStatus(account);
  const map = {
    logged_in: { label: '正常运行', class: 'status-ok' },
    need_login: { label: '需要登录', class: 'status-warn' },
    checking: { label: '正在检测', class: 'status-info' },
    error: { label: '异常断开', class: 'status-error' },
    unknown: { label: '未知状态', class: 'status-unknown' }
  };
  return map[status] || map.unknown;
}

function calculateSuccessRate(account) {
  const total = account.stats.totalJobs || 0;
  if (total === 0) return 0;
  const success = account.stats.successCount || 0;
  return Math.round((success / total) * 100);
}

async function handleSingleCheck(accountId) {
  await checkSingleAccountLogin(accountId);
  // 更新本地账号列表中的状态（如果是为了同步 UI）
  const acc = accounts.value.find(a => a.id === accountId);
  if (acc) {
    acc.loginStatus = accountLoginStatus.value[accountId];
  }
}

async function readJsonResponse(response, fallbackMessage, options = {}) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(fallbackMessage);
  }
  const data = await response.json();
  if (!response.ok || (!data.success && !options.allowFailurePayload)) {
    const err = new Error(data.error || data.details || fallbackMessage);
    err.payload = data;
    throw err;
  }
  return data;
}

function setContentManagerActionLabel(accountId, label) {
  contentManagerActionLabels.value = {
    ...contentManagerActionLabels.value,
    [accountId]: label
  };
}

function clearContentManagerActionLabel(accountId) {
  const next = { ...contentManagerActionLabels.value };
  delete next[accountId];
  contentManagerActionLabels.value = next;
}

function updateLocalAccountLoginStatus(accountId, result) {
  const status = result?.status || 'unknown';
  const nextStatus = {
    ...(accountLoginStatus.value[accountId] || {}),
    ...result,
    status,
    lastCheckedAt: new Date().toISOString()
  };
  accountLoginStatus.value = {
    ...accountLoginStatus.value,
    [accountId]: nextStatus
  };
  const acc = accounts.value.find(a => a.id === accountId);
  if (acc) {
    acc.loginStatus = nextStatus;
  }
}

async function checkLoginBeforeOpening(accountId) {
  const response = await fetch(`/api/login-status/check/${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  const data = await readJsonResponse(response, '登录检测失败，请稍后重试');
  const result = data.result || {};
  updateLocalAccountLoginStatus(accountId, result);
  return result;
}

async function handleOpenContentManager(accountId) {
  if (!accountId || contentManagerActionLabels.value[accountId]) return;
  error.value = '';
  actionMessage.value = '';
  try {
    setContentManagerActionLabel(accountId, '检测登录');
    const loginResult = await checkLoginBeforeOpening(accountId);
    if (loginResult.status !== 'logged_in') {
      errorTitle.value = '需要登录';
      error.value = loginResult.error || '该账号当前未登录，已打开登录检测窗口。请先扫码登录，完成后再点击内容管理。';
      return;
    }

    setContentManagerActionLabel(accountId, '打开中');
    const response = await fetch(`/api/publish/wechat/content-manager/${encodeURIComponent(accountId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await readJsonResponse(response, '打开内容管理页失败，请确认后端服务已重启并加载最新代码', {
      allowFailurePayload: true
    });
    if (data.status === 'need_login') {
      errorTitle.value = '需要登录';
      error.value = data.message || '该账号登录态已失效，请先完成登录检测后再打开内容管理。';
      return;
    }
    if (!data.success) {
      throw new Error(data.error || data.details || '打开内容管理页失败');
    }
    actionMessage.value = data.status === 'already_open'
      ? '内容管理页已经在独立浏览器窗口中打开。如果没有看到，请查看任务栏中的微信视频号浏览器窗口。'
      : '内容管理页已在对应账号的独立浏览器窗口中打开。';
  } catch (err) {
    if (err.payload?.status === 'need_login') {
      errorTitle.value = '需要登录';
      error.value = err.payload.message || err.payload.error || '该账号登录态已失效，请先完成登录检测后再打开内容管理。';
    } else {
      errorTitle.value = '打开内容管理失败';
      error.value = err.message || '打开内容管理页失败';
    }
    console.error('打开内容管理页失败:', err);
  } finally {
    clearContentManagerActionLabel(accountId);
  }
}

async function handleBatchCheck() {
  const ids = accounts.value.map(a => a.id);
  const result = await checkSelectedAccountsLogin(ids);
  if (result) {
    // 重新加载看板以刷新统计汇总
    await loadDashboard();
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '从未发布';
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 30) return `${days} 天前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch (err) {
    return '-';
  }
}

function goToAccountSettings(accountId) {
  // 假设路由逻辑是通过切换到发布中心并展开特定账号
  // 这里可以抛出事件或使用路由跳转，目前简单跳转
  window.location.hash = '#/publish'; // 简单模拟
}

function goToPublishCenter() {
  window.location.hash = '#/publish';
}

onMounted(() => {
  loadDashboard();
});
</script>

<style scoped>
.account-dashboard-page {
  display: flex;
  flex-direction: column;
  gap: 32px;
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.hero-panel {
  overflow: hidden;
  background: var(--hero-bg);
  border-bottom: 1px solid var(--line);
  padding: 40px 0;
}

.hero-grid {
  max-width: 1300px;
  margin: 0 auto;
  padding: 0 32px;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 48px;
  align-items: center;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero-copy h3 {
  margin: 0;
  color: var(--strong-text);
  font-size: 3.2rem;
  line-height: 1.1;
  font-weight: 900;
}

.hero-copy p {
  color: var(--muted);
  font-size: 1.1rem;
  line-height: 1.7;
  max-width: 500px;
}

.section-kicker {
  color: var(--brand-a);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-weight: 800;
}

.flow-pills {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.flow-pill {
  font-size: 12px;
  padding: 6px 14px;
  border-radius: 99px;
  background: var(--line-soft);
  color: var(--text);
  border: 1px solid var(--line);
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.dashboard-stat {
  background: var(--card-bg);
  border: 1px solid var(--line);
  padding: 24px;
  border-radius: 24px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s;
}

.dashboard-stat:hover {
  transform: translateY(-4px);
  border-color: var(--brand-a-soft);
}

.dashboard-stat span {
  display: block;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 700;
}

.dashboard-stat strong {
  display: block;
  color: var(--strong-text);
  font-size: 2.4rem;
  margin: 12px 0 8px;
  font-weight: 800;
}

.dashboard-stat p {
  font-size: 12px;
  color: var(--muted);
}

.workspace-container {
  max-width: 1300px;
  width: 100%;
  margin: 0 auto;
  padding: 0 32px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Controls Bar */
.controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--card-bg);
  padding: 12px 20px;
  border-radius: 20px;
  border: 1px solid var(--line);
}

.filter-group {
  display: flex;
  gap: 8px;
}

.filter-tab {
  padding: 10px 18px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--muted);
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-tab.active {
  background: var(--brand-a-soft);
  color: var(--brand-a);
}

.filter-count {
  font-size: 10px;
  background: rgba(0, 0, 0, 0.1);
  padding: 2px 6px;
  border-radius: 6px;
}

.action-group {
  display: flex;
  gap: 12px;
}

/* Buttons */
.btn-primary {
  padding: 12px 24px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, var(--brand-a), #7c3aed);
  color: white;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ghost-btn {
  padding: 12px 24px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--card-bg);
  color: var(--text);
  font-weight: 600;
  cursor: pointer;
}

/* Grid */
.account-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 24px;
}

.account-card-v2 {
  background: var(--card-bg);
  border: 1px solid var(--line);
  border-radius: 24px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: relative;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.account-card-v2:hover {
  transform: scale(1.01);
  border-color: var(--brand-a);
  box-shadow: 0 10px 30px rgba(0,0,0,0.08);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.account-profile {
  display: flex;
  gap: 16px;
}

.avatar-placeholder {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  background: linear-gradient(135deg, #e2e8f0, #cbd5e1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 800;
  color: #64748b;
}

.name-box {
  display: flex;
  flex-direction: column;
}

.account-name {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--strong-text);
}

.account-id-tag {
  font-size: 12px;
  color: var(--muted);
  font-family: monospace;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 99px;
  background: var(--line-soft);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-label {
  font-size: 12px;
  font-weight: 700;
}

.status-ok { background: #10b981; color: #065f46; }
.status-warn { background: #f59e0b; color: #92400e; }
.status-error { background: #ef4444; color: #991b1b; }
.status-info { background: #3b82f6; color: #1e40af; }
.status-unknown { background: #94a3b8; color: #1e293b; }

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--input-bg);
  padding: 16px;
  border-radius: 18px;
}

.mini-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mini-stat .label {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
}

.mini-stat .value {
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--strong-text);
}

.mini-stat.success .value { color: #10b981; }
.mini-stat.failure .value { color: #ef4444; }

.timeline-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
}

.alert-box {
  padding: 16px;
  border-radius: 16px;
  font-size: 13px;
}

.alert-box.failure {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
}

.alert-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 700;
  color: #dc2626;
}

.alert-time {
  font-weight: normal;
  font-size: 11px;
  color: #991b1b;
}

.alert-content p {
  margin-top: 4px;
  opacity: 0.8;
}

.info-box {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 16px 18px;
  border-radius: 16px;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.18);
  color: var(--text);
}

.info-icon {
  color: #10b981;
  font-weight: 900;
}

.info-box p {
  margin: 4px 0 0;
  color: var(--muted);
}

.card-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: auto;
}

.action-btn {
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--card-bg);
  color: var(--text);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
  white-space: nowrap;
}

.action-btn:hover:not(:disabled) {
  background: var(--line-soft);
  border-color: var(--muted);
}

.action-btn.secondary {
  color: var(--brand-a);
}

.action-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.loading-state, .empty-state {
  padding: 80px;
  text-align: center;
  background: var(--card-bg);
  border-radius: 32px;
  border: 1px solid var(--line);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--line-soft);
  border-top-color: var(--brand-a);
  border-radius: 50%;
  margin: 0 auto 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.pulsing {
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}

@media (max-width: 1100px) {
  .hero-grid { grid-template-columns: 1fr; text-align: center; }
  .hero-copy { align-items: center; }
  .hero-copy p { margin: 0 auto; }
  .flow-pills { justify-content: center; }
}
</style>
