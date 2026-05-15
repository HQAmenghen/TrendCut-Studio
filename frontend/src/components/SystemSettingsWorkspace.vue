<template>
  <div class="workspace">
    <div class="workspace-header">
      <h2>⚙️ 系统设置</h2>
      <p>配置飞书通知、登录检测等系统功能</p>
    </div>

    <div class="settings-grid">
      <!-- 模型提供商配置 -->
      <div class="settings-card full-width">
        <div class="card-header">
          <div>
            <h3>🧠 模型提供商配置</h3>
            <p class="card-subtitle">支持 Gemini 与 Qwen 双配置常驻保存，通过当前提供商切换实际调用链路。</p>
          </div>
        </div>

        <div class="provider-switch">
          <label class="provider-option" :class="{ active: llmConfig.provider === 'gemini' }">
            <input v-model="llmConfig.provider" type="radio" value="gemini" />
            <span>Gemini</span>
          </label>
          <label class="provider-option" :class="{ active: llmConfig.provider === 'qwen' }">
            <input v-model="llmConfig.provider" type="radio" value="qwen" />
            <span>Qwen / 千问</span>
          </label>
        </div>

        <div class="provider-panels">
          <div class="provider-panel" :class="{ active: llmConfig.provider === 'gemini' }">
            <div class="provider-title">Gemini 配置</div>
            <div class="form-grid">
              <div class="form-group">
                <label>Gemini API Key</label>
                <input
                  v-model="llmConfig.gemini.apiKey"
                  type="password"
                  placeholder="AIza..."
                  class="input-text"
                />
              </div>
              <div class="form-group">
                <label>Google API Key（可选同步）</label>
                <input
                  v-model="llmConfig.gemini.googleApiKey"
                  type="password"
                  placeholder="留空时自动跟随 Gemini API Key"
                  class="input-text"
                />
              </div>
              <div class="form-group full-span">
                <label>Gemini Base URL</label>
                <input
                  v-model="llmConfig.gemini.baseUrl"
                  type="text"
                  placeholder="官方留空，或填写兼容中转地址"
                  class="input-text"
                />
                <div class="hint">留空走官方接口；如果使用兼容 Gemini 的中转，在这里填写根地址。</div>
              </div>
              <div class="form-group">
                <label>通用模型</label>
                <input
                  v-model="llmConfig.gemini.model"
                  type="text"
                  placeholder="gemini-2.5-flash"
                  class="input-text"
                />
              </div>
              <div class="form-group">
                <label>AI 审核模型</label>
                <input
                  v-model="llmConfig.gemini.reviewModel"
                  type="text"
                  placeholder="gemini-2.5-flash"
                  class="input-text"
                />
              </div>
              <div class="form-group full-span">
                <label>发布描述模型</label>
                <input
                  v-model="llmConfig.gemini.publishDescriptionModel"
                  type="text"
                  placeholder="gemini-2.5-flash"
                  class="input-text"
                />
              </div>
            </div>
          </div>

          <div class="provider-panel" :class="{ active: llmConfig.provider === 'qwen' }">
            <div class="provider-title">Qwen / 千问配置</div>
            <div class="form-grid">
              <div class="form-group">
                <label>Qwen API Key</label>
                <input
                  v-model="llmConfig.qwen.apiKey"
                  type="password"
                  placeholder="sk-..."
                  class="input-text"
                />
              </div>
              <div class="form-group">
                <label>Qwen Base URL</label>
                <input
                  v-model="llmConfig.qwen.baseUrl"
                  type="text"
                  placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                  class="input-text"
                />
              </div>
              <div class="form-group">
                <label>视觉模型</label>
                <input
                  v-model="llmConfig.qwen.vlModel"
                  type="text"
                  placeholder="qwen3-vl-flash"
                  class="input-text"
                />
              </div>
              <div class="form-group">
                <label>ASR 模型</label>
                <input
                  v-model="llmConfig.qwen.asrModel"
                  type="text"
                  placeholder="qwen3-asr-flash"
                  class="input-text"
                />
              </div>
              <div class="form-group full-span">
                <label>文本模型</label>
                <input
                  v-model="llmConfig.qwen.textModel"
                  type="text"
                  placeholder="qwen3.6-plus"
                  class="input-text"
                />
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          class="btn-primary"
          :disabled="savingLlm"
          @click="saveLlmConfig"
        >
          {{ savingLlm ? '保存中...' : '保存模型配置' }}
        </button>

        <div class="hint">保存后会写入 `.env`。切换提供商后建议重启后端服务，保证 Python 子进程使用最新配置。</div>

        <div v-if="llmMessage" class="message" :class="llmMessageType">
          {{ llmMessage }}
        </div>
      </div>

      <!-- 飞书通知配置 -->
      <div class="settings-card">
        <div class="card-header">
          <h3>📢 飞书通知配置</h3>
          <button
            v-if="feishuConfig.webhookUrl"
            type="button"
            class="btn-test"
            :disabled="testingFeishu"
            @click="testFeishuNotification"
          >
            {{ testingFeishu ? '发送中...' : '测试通知' }}
          </button>
        </div>

        <div class="form-group">
          <label>Webhook URL</label>
          <input
            v-model="feishuConfig.webhookUrl"
            type="text"
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
            class="input-text"
          />
          <div class="hint">在飞书群聊中添加机器人，复制 Webhook 地址</div>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input v-model="feishuConfig.notifyLoginStatus" type="checkbox" />
            <span>登录状态变化时通知</span>
          </label>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input v-model="feishuConfig.notifyAutoPilot" type="checkbox" />
            <span>AutoPilot 执行时通知</span>
          </label>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input v-model="feishuConfig.notifyReview" type="checkbox" />
            <span>AI 审核失败时通知</span>
          </label>
        </div>

        <button
          type="button"
          class="btn-primary"
          :disabled="savingFeishu"
          @click="saveFeishuConfig"
        >
          {{ savingFeishu ? '保存中...' : '保存配置' }}
        </button>

        <div v-if="feishuMessage" class="message" :class="feishuMessageType">
          {{ feishuMessage }}
        </div>
      </div>

      <!-- 登录状态检测配置 -->
      <div class="settings-card">
        <div class="card-header">
          <h3>🔐 登录状态检测</h3>
          <div class="header-actions">
            <label class="checkbox-label-inline">
              <input v-model="testNotifyFeishu" type="checkbox" />
              <span>发送飞书</span>
            </label>
            <button
              type="button"
              class="btn-test"
              :disabled="checkingLogin"
              @click="checkAllLoginStatus"
            >
              {{ checkingLogin ? '检测中...' : '立即检测' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input v-model="loginCheckConfig.enabled" type="checkbox" />
            <span>启用定时检测</span>
          </label>
        </div>

        <div class="form-group">
          <label>检测间隔（分钟）</label>
          <input
            v-model.number="loginCheckConfig.intervalMinutes"
            type="number"
            min="5"
            max="1440"
            class="input-number"
          />
          <div class="hint">建议 30-60 分钟</div>
        </div>

        <div class="form-group">
          <label>失败重试次数</label>
          <input
            v-model.number="loginCheckConfig.retryTimes"
            type="number"
            min="1"
            max="10"
            class="input-number"
          />
        </div>

        <button
          type="button"
          class="btn-primary"
          :disabled="savingLoginCheck"
          @click="saveLoginCheckConfig"
        >
          {{ savingLoginCheck ? '保存中...' : '保存配置' }}
        </button>

        <div v-if="loginCheckMessage" class="message" :class="loginCheckMessageType">
          {{ loginCheckMessage }}
        </div>
      </div>

      <!-- 登录状态列表 -->
      <div class="settings-card full-width">
        <div class="card-header">
          <h3>📊 账号登录状态</h3>
          <button
            type="button"
            class="btn-test"
            @click="loadLoginStatuses"
          >
            刷新
          </button>
        </div>

        <div v-if="loadingStatuses" class="loading-state">
          加载中...
        </div>

        <div v-else-if="loginStatuses.length === 0" class="empty-state">
          暂无账号状态数据
        </div>

        <div v-else class="status-table">
          <div class="status-row header">
            <div class="checkbox-col">
              <input
                type="checkbox"
                :checked="allSelected"
                @change="toggleSelectAll"
              />
            </div>
            <div>账号</div>
            <div>状态</div>
            <div>最后检测</div>
            <div>操作</div>
          </div>
          <div
            v-for="status in loginStatuses"
            :key="status.accountId"
            class="status-row"
          >
            <div class="checkbox-col">
              <input
                type="checkbox"
                :checked="selectedAccounts.includes(status.accountId)"
                @change="toggleSelectAccount(status.accountId)"
              />
            </div>
            <div class="account-name">{{ status.accountLabel }}</div>
            <div>
              <span
                class="status-badge"
                :class="getStatusClass(status.status)"
              >
                {{ getStatusText(status.status) }}
              </span>
            </div>
            <div class="time-text">
              {{ formatTime(status.lastCheck) }}
            </div>
            <div>
              <button
                type="button"
                class="btn-small"
                @click="checkSingleAccount(status.accountId)"
              >
                检测
              </button>
            </div>
          </div>
        </div>

        <!-- 批量操作栏 -->
        <div v-if="selectedAccounts.length > 0" class="batch-actions">
          <div class="batch-info">
            已选择 {{ selectedAccounts.length }} 个账号
          </div>
          <div class="batch-buttons">
            <label class="checkbox-label-inline">
              <input v-model="batchNotifyFeishu" type="checkbox" />
              <span>发送飞书</span>
            </label>
            <label class="checkbox-label-inline">
              <input v-model="batchParallel" type="checkbox" />
              <span>并行检测</span>
            </label>
            <button
              type="button"
              class="btn-batch"
              :disabled="checkingBatch"
              @click="checkSelectedAccounts"
            >
              {{ checkingBatch ? '检测中...' : '检测选中账号' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const feishuConfig = ref({
  webhookUrl: '',
  notifyLoginStatus: false,
  notifyAutoPilot: false,
  notifyReview: false
});

const llmConfig = ref({
  provider: 'gemini',
  gemini: {
    apiKey: '',
    googleApiKey: '',
    baseUrl: '',
    model: 'gemini-2.5-flash',
    reviewModel: 'gemini-2.5-flash',
    publishDescriptionModel: 'gemini-2.5-flash'
  },
  qwen: {
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    vlModel: 'qwen3-vl-flash',
    asrModel: 'qwen3-asr-flash',
    textModel: 'qwen3.6-plus'
  }
});

const loginCheckConfig = ref({
  enabled: true,
  intervalMinutes: 30,
  retryTimes: 3
});

const loginStatuses = ref([]);
const selectedAccounts = ref([]);
const loadingStatuses = ref(false);
const savingLlm = ref(false);
const savingFeishu = ref(false);
const savingLoginCheck = ref(false);
const testingFeishu = ref(false);
const checkingLogin = ref(false);
const checkingBatch = ref(false);
const testNotifyFeishu = ref(false);
const batchNotifyFeishu = ref(false);
const batchParallel = ref(false);
const llmMessage = ref('');
const llmMessageType = ref('');
const feishuMessage = ref('');
const feishuMessageType = ref('');
const loginCheckMessage = ref('');
const loginCheckMessageType = ref('');

const allSelected = computed(() => {
  return loginStatuses.value.length > 0 &&
         selectedAccounts.value.length === loginStatuses.value.length;
});

onMounted(() => {
  loadLlmConfig();
  loadFeishuConfig();
  loadLoginCheckConfig();
  loadLoginStatuses();
});

async function loadLlmConfig() {
  try {
    const res = await fetch('/api/system/llm-config');
    const data = await res.json();
    if (data.success && data.config) {
      llmConfig.value = {
        provider: data.config.provider || 'gemini',
        gemini: {
          ...llmConfig.value.gemini,
          ...(data.config.gemini || {})
        },
        qwen: {
          ...llmConfig.value.qwen,
          ...(data.config.qwen || {})
        }
      };
    }
  } catch (err) {
    console.error('加载模型配置失败:', err);
  }
}

async function saveLlmConfig() {
  savingLlm.value = true;
  llmMessage.value = '';
  try {
    const res = await fetch('/api/system/llm-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(llmConfig.value)
    });
    const data = await res.json();
    if (data.success) {
      llmMessage.value = data.message || '模型配置已保存';
      llmMessageType.value = 'success';
      await loadLlmConfig();
    } else {
      llmMessage.value = data.error || '模型配置保存失败';
      llmMessageType.value = 'error';
    }
  } catch (err) {
    llmMessage.value = '模型配置保存失败: ' + err.message;
    llmMessageType.value = 'error';
  } finally {
    savingLlm.value = false;
    setTimeout(() => { llmMessage.value = ''; }, 4000);
  }
}

async function loadFeishuConfig() {
  try {
    const res = await fetch('/api/system/feishu-config');
    const data = await res.json();
    if (data.success) {
      feishuConfig.value = data.config;
    }
  } catch (err) {
    console.error('加载飞书配置失败:', err);
  }
}

async function saveFeishuConfig() {
  savingFeishu.value = true;
  feishuMessage.value = '';
  try {
    const res = await fetch('/api/system/feishu-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feishuConfig.value)
    });
    const data = await res.json();
    if (data.success) {
      feishuMessage.value = '保存成功';
      feishuMessageType.value = 'success';
    } else {
      feishuMessage.value = data.error || '保存失败';
      feishuMessageType.value = 'error';
    }
  } catch (err) {
    feishuMessage.value = '保存失败: ' + err.message;
    feishuMessageType.value = 'error';
  } finally {
    savingFeishu.value = false;
    setTimeout(() => { feishuMessage.value = ''; }, 3000);
  }
}

async function testFeishuNotification() {
  testingFeishu.value = true;
  feishuMessage.value = '';
  try {
    const res = await fetch('/api/login-status/test-feishu', {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      feishuMessage.value = '测试通知发送成功，请检查飞书群聊';
      feishuMessageType.value = 'success';
    } else {
      feishuMessage.value = data.error || '发送失败';
      feishuMessageType.value = 'error';
    }
  } catch (err) {
    feishuMessage.value = '发送失败: ' + err.message;
    feishuMessageType.value = 'error';
  } finally {
    testingFeishu.value = false;
    setTimeout(() => { feishuMessage.value = ''; }, 5000);
  }
}

async function loadLoginCheckConfig() {
  try {
    const res = await fetch('/api/system/login-check-config');
    const data = await res.json();
    if (data.success) {
      loginCheckConfig.value = data.config;
    }
  } catch (err) {
    console.error('加载登录检测配置失败:', err);
  }
}

async function saveLoginCheckConfig() {
  savingLoginCheck.value = true;
  loginCheckMessage.value = '';
  try {
    const res = await fetch('/api/system/login-check-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loginCheckConfig.value)
    });
    const data = await res.json();
    if (data.success) {
      loginCheckMessage.value = '保存成功，定时任务将在下次执行时生效';
      loginCheckMessageType.value = 'success';
    } else {
      loginCheckMessage.value = data.error || '保存失败';
      loginCheckMessageType.value = 'error';
    }
  } catch (err) {
    loginCheckMessage.value = '保存失败: ' + err.message;
    loginCheckMessageType.value = 'error';
  } finally {
    savingLoginCheck.value = false;
    setTimeout(() => { loginCheckMessage.value = ''; }, 3000);
  }
}

async function loadLoginStatuses() {
  loadingStatuses.value = true;
  try {
    const res = await fetch('/api/login-status/all');
    const data = await res.json();
    if (data.success) {
      loginStatuses.value = data.statuses || [];
      // 清除已删除账号的选择
      selectedAccounts.value = selectedAccounts.value.filter(id =>
        loginStatuses.value.some(s => s.accountId === id)
      );
    }
  } catch (err) {
    console.error('加载登录状态失败:', err);
  } finally {
    loadingStatuses.value = false;
  }
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedAccounts.value = [];
  } else {
    selectedAccounts.value = loginStatuses.value.map(s => s.accountId);
  }
}

function toggleSelectAccount(accountId) {
  const index = selectedAccounts.value.indexOf(accountId);
  if (index > -1) {
    selectedAccounts.value.splice(index, 1);
  } else {
    selectedAccounts.value.push(accountId);
  }
}

async function checkSelectedAccounts() {
  if (selectedAccounts.value.length === 0) return;

  checkingBatch.value = true;
  loginCheckMessage.value = '';

  try {
    const res = await fetch('/api/login-status/check-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountIds: selectedAccounts.value,
        notifyFeishu: batchNotifyFeishu.value,
        parallel: batchParallel.value
      })
    });
    const data = await res.json();
    if (data.success) {
      const summary = data.summary;
      loginCheckMessage.value = `检测完成: ${summary.logged_in} 已登录, ${summary.need_login} 需登录, ${summary.error} 异常`;
      loginCheckMessageType.value = summary.need_login > 0 ? 'warning' : 'success';
      await loadLoginStatuses();
    } else {
      loginCheckMessage.value = data.error || '检测失败';
      loginCheckMessageType.value = 'error';
    }
  } catch (err) {
    loginCheckMessage.value = '检测失败: ' + err.message;
    loginCheckMessageType.value = 'error';
  } finally {
    checkingBatch.value = false;
    setTimeout(() => { loginCheckMessage.value = ''; }, 5000);
  }
}

async function checkAllLoginStatus() {
  checkingLogin.value = true;
  loginCheckMessage.value = '';
  try {
    const res = await fetch('/api/login-status/check-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notifyFeishu: testNotifyFeishu.value
      })
    });
    const data = await res.json();
    if (data.success) {
      const summary = data.summary;
      loginCheckMessage.value = `检测完成: ${summary.logged_in} 已登录, ${summary.need_login} 需登录, ${summary.error} 异常`;
      loginCheckMessageType.value = summary.need_login > 0 ? 'warning' : 'success';
      await loadLoginStatuses();
    } else {
      loginCheckMessage.value = data.error || '检测失败';
      loginCheckMessageType.value = 'error';
    }
  } catch (err) {
    loginCheckMessage.value = '检测失败: ' + err.message;
    loginCheckMessageType.value = 'error';
  } finally {
    checkingLogin.value = false;
    setTimeout(() => { loginCheckMessage.value = ''; }, 5000);
  }
}

async function checkSingleAccount(accountId) {
  try {
    const res = await fetch(`/api/login-status/check/${accountId}`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      await loadLoginStatuses();
    }
  } catch (err) {
    console.error('检测账号失败:', err);
  }
}

function getStatusClass(status) {
  const map = {
    logged_in: 'status-success',
    need_login: 'status-warning',
    error: 'status-error',
    checking: 'status-info'
  };
  return map[status] || 'status-default';
}

function getStatusText(status) {
  const map = {
    logged_in: '✓ 已登录',
    need_login: '⚠ 需登录',
    error: '✗ 异常',
    checking: '⋯ 检测中'
  };
  return map[status] || status;
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
</script>

<style scoped>
.workspace {
  padding: 24px;
}

.workspace-header {
  margin-bottom: 32px;
}

.workspace-header h2 {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 8px;
  color: var(--strong-text);
}

.workspace-header p {
  font-size: 14px;
  color: var(--muted);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
}

.settings-card {
  background: var(--panel-subtle);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px;
  box-shadow: var(--shadow);
}

.settings-card.full-width {
  grid-column: 1 / -1;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.card-header h3 {
  font-size: 18px;
  font-weight: 700;
  color: var(--strong-text);
}

.card-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: var(--muted);
}

.form-group {
  margin-bottom: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.full-span {
  grid-column: 1 / -1;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--strong-text);
}

.input-text,
.input-number {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
}

.input-number {
  width: 120px;
}

.provider-switch {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.provider-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}

.provider-option.active {
  border-color: rgba(139, 92, 246, 0.55);
  box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.2);
}

.provider-option:hover {
  transform: translateY(-1px);
}

.provider-panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.provider-panel {
  padding: 18px;
  border-radius: 14px;
  border: 1px solid var(--line-soft);
  background: var(--bg);
}

.provider-panel.active {
  border-color: rgba(139, 92, 246, 0.45);
  box-shadow: 0 10px 24px rgba(124, 58, 237, 0.08);
}

.provider-title {
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 700;
  color: var(--strong-text);
}

.input-text:focus,
.input-number:focus {
  outline: none;
  border-color: rgba(139, 92, 246, 0.6);
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--muted);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-weight: 400;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.checkbox-label-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
}

.checkbox-label-inline input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.btn-primary {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-test {
  padding: 8px 16px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-test:hover:not(:disabled) {
  border-color: #8b5cf6;
  color: #8b5cf6;
}

.btn-test:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-small {
  padding: 4px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line-soft);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-small:hover {
  border-color: #8b5cf6;
  color: #8b5cf6;
}

.message {
  margin-top: 16px;
  padding: 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.message.success {
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.message.error {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.message.warning {
  background: rgba(251, 191, 36, 0.1);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.status-table {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line-soft);
  border-radius: 8px;
  overflow: hidden;
}

.status-row {
  display: grid;
  grid-template-columns: 40px 2fr 1fr 1.5fr 0.8fr;
  gap: 16px;
  padding: 14px 16px;
  background: var(--bg);
  align-items: center;
}

.checkbox-col {
  display: flex;
  align-items: center;
  justify-content: center;
}

.checkbox-col input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.status-row.header {
  background: var(--panel-subtle);
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.account-name {
  font-weight: 500;
  color: var(--strong-text);
}

.time-text {
  font-size: 13px;
  color: var(--muted);
}

.status-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-badge.status-success {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.status-badge.status-warning {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.status-badge.status-error {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.status-badge.status-info {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

.loading-state,
.empty-state {
  padding: 48px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

.batch-actions {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--panel-subtle);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.batch-info {
  font-size: 13px;
  font-weight: 600;
  color: var(--strong-text);
}

.batch-buttons {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-batch {
  padding: 8px 16px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

.btn-batch:hover:not(:disabled) {
  transform: translateY(-1px);
}

.btn-batch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 1080px) {
  .settings-grid,
  .provider-panels,
  .form-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .workspace {
    padding: 16px;
  }

  .card-header,
  .batch-actions,
  .provider-switch {
    flex-direction: column;
    align-items: stretch;
  }

  .status-row {
    grid-template-columns: 32px 1fr;
  }

  .status-row > :nth-child(3),
  .status-row > :nth-child(4),
  .status-row > :nth-child(5) {
    grid-column: 2;
  }
}
</style>
