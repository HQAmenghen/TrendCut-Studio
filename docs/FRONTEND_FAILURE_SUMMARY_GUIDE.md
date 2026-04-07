# 前端失败摘要展示指南

## 概述

本文档说明如何在前端展示失败摘要信息。失败摘要数据已经在后端生成并存储在任务对象中，前端只需读取并展示即可。

## 数据结构

失败摘要存储在任务对象的 `failureSummary` 字段中：

```javascript
// 竖屏队列任务
{
  id: "job_123",
  status: "failed",
  failureSummary: {
    failedAt: "2026-04-01T10:30:00.000Z",
    module: "vertical_queue",
    stage: "render",
    errorCode: "RENDER_FAILED",
    errorMessage: "视频渲染失败",
    details: "...",
    hint: "检查视频文件完整性和渲染参数",
    stderrTail: [...],
    stdoutTail: [...],
    exitCode: 1,
    retryable: true,
    context: {...}
  }
}

// 发布任务
{
  id: "job_456",
  platformTasks: [{
    platform: "wechatChannels",
    status: "failed",
    failureSummary: {
      failedAt: "2026-04-01T11:00:00.000Z",
      module: "publish_wechat",
      stage: "upload",
      errorCode: "WECHAT_UPLOAD_FAILED",
      errorMessage: "视频上传失败",
      hint: "检查视频格式和大小限制",
      retryable: true,
      ...
    }
  }]
}
```

## 展示位置

### 1. 任务卡片简短摘要

在任务列表的卡片中显示简短的失败信息：

```vue
<template>
  <div class="job-card" :class="{ failed: job.status === 'failed' }">
    <div class="job-header">
      <span class="job-status">{{ job.status }}</span>
      <span class="job-title">{{ job.title }}</span>
    </div>
    
    <!-- 失败摘要 -->
    <div v-if="job.status === 'failed' && job.failureSummary" class="failure-summary-brief">
      <div class="failure-stage">[{{ job.failureSummary.stage }}]</div>
      <div class="failure-message">{{ job.failureSummary.errorMessage }}</div>
      <div v-if="job.failureSummary.hint" class="failure-hint">
        💡 {{ job.failureSummary.hint }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.failure-summary-brief {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #ef4444;
  border-radius: 4px;
  font-size: 13px;
}

.failure-stage {
  display: inline-block;
  padding: 2px 6px;
  background: rgba(239, 68, 68, 0.2);
  border-radius: 3px;
  font-weight: 600;
  margin-right: 8px;
}

.failure-message {
  color: #dc2626;
  margin: 4px 0;
}

.failure-hint {
  color: #9ca3af;
  font-size: 12px;
  margin-top: 4px;
}
</style>
```

### 2. 详情弹窗完整摘要

在任务详情弹窗中显示完整的失败信息：

```vue
<template>
  <div class="modal" v-if="showDetails">
    <div class="modal-content">
      <h3>任务详情</h3>
      
      <!-- 失败摘要详情 -->
      <div v-if="job.status === 'failed' && job.failureSummary" class="failure-summary-detailed">
        <h4>失败摘要</h4>
        
        <div class="summary-grid">
          <div class="summary-item">
            <label>失败时间</label>
            <span>{{ formatTime(job.failureSummary.failedAt) }}</span>
          </div>
          
          <div class="summary-item">
            <label>模块</label>
            <span>{{ job.failureSummary.module }}</span>
          </div>
          
          <div class="summary-item">
            <label>阶段</label>
            <span>{{ job.failureSummary.stage }}</span>
          </div>
          
          <div class="summary-item">
            <label>错误码</label>
            <span class="error-code">{{ job.failureSummary.errorCode }}</span>
          </div>
          
          <div class="summary-item full-width">
            <label>错误消息</label>
            <span>{{ job.failureSummary.errorMessage }}</span>
          </div>
          
          <div v-if="job.failureSummary.details" class="summary-item full-width">
            <label>详细信息</label>
            <pre class="details-text">{{ job.failureSummary.details }}</pre>
          </div>
          
          <div v-if="job.failureSummary.hint" class="summary-item full-width hint-box">
            <label>💡 排障建议</label>
            <span>{{ job.failureSummary.hint }}</span>
          </div>
          
          <div class="summary-item">
            <label>可重试</label>
            <span :class="job.failureSummary.retryable ? 'text-green' : 'text-red'">
              {{ job.failureSummary.retryable ? '是' : '否' }}
            </span>
          </div>
          
          <div v-if="job.failureSummary.exitCode !== null" class="summary-item">
            <label>退出码</label>
            <span>{{ job.failureSummary.exitCode }}</span>
          </div>
        </div>
        
        <!-- stderr 日志 -->
        <div v-if="job.failureSummary.stderrTail && job.failureSummary.stderrTail.length > 0" class="log-section">
          <h5>stderr 尾部</h5>
          <pre class="log-content">{{ job.failureSummary.stderrTail.join('\n') }}</pre>
        </div>
        
        <!-- stdout 日志 -->
        <div v-if="job.failureSummary.stdoutTail && job.failureSummary.stdoutTail.length > 0" class="log-section">
          <h5>stdout 尾部</h5>
          <pre class="log-content">{{ job.failureSummary.stdoutTail.join('\n') }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  methods: {
    formatTime(isoString) {
      return new Date(isoString).toLocaleString('zh-CN');
    }
  }
};
</script>

<style scoped>
.failure-summary-detailed {
  margin-top: 16px;
  padding: 16px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-item.full-width {
  grid-column: 1 / -1;
}

.summary-item label {
  font-size: 12px;
  color: #9ca3af;
  font-weight: 600;
}

.summary-item span {
  font-size: 14px;
  color: var(--strong-text);
}

.error-code {
  font-family: monospace;
  background: rgba(239, 68, 68, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
}

.details-text {
  font-size: 12px;
  color: #6b7280;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.hint-box {
  background: rgba(59, 130, 246, 0.1);
  padding: 12px;
  border-radius: 6px;
  border-left: 3px solid #3b82f6;
}

.log-section {
  margin-top: 16px;
}

.log-section h5 {
  font-size: 13px;
  color: #9ca3af;
  margin-bottom: 8px;
}

.log-content {
  font-size: 11px;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.5);
  color: #d1d5db;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  margin: 0;
}

.text-green {
  color: #22c55e;
}

.text-red {
  color: #ef4444;
}
</style>
```

### 3. 账号详情最近失败

在微信账号管理界面显示该账号最近的失败记录：

```vue
<template>
  <div class="account-card">
    <div class="account-header">
      <strong>{{ account.displayName }}</strong>
      <span class="login-status">{{ loginStatus }}</span>
    </div>
    
    <!-- 最近失败记录 -->
    <div v-if="recentFailures.length > 0" class="recent-failures">
      <h5>最近失败 ({{ recentFailures.length }})</h5>
      <div v-for="failure in recentFailures.slice(0, 3)" :key="failure.jobId" class="failure-item">
        <div class="failure-time">{{ formatTime(failure.failedAt) }}</div>
        <div class="failure-brief">
          <span class="failure-stage">[{{ failure.stage }}]</span>
          <span class="failure-message">{{ failure.errorMessage }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    account: Object,
    jobs: Array
  },
  computed: {
    recentFailures() {
      return this.jobs
        .filter(job => {
          const task = job.platformTasks?.find(t => 
            t.platform === 'wechatChannels' && 
            t.accountId === this.account.id &&
            t.status === 'failed' &&
            t.failureSummary
          );
          return task;
        })
        .map(job => {
          const task = job.platformTasks.find(t => t.platform === 'wechatChannels');
          return {
            jobId: job.id,
            ...task.failureSummary
          };
        })
        .sort((a, b) => new Date(b.failedAt) - new Date(a.failedAt));
    }
  }
};
</script>

<style scoped>
.recent-failures {
  margin-top: 12px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.05);
  border-radius: 6px;
}

.recent-failures h5 {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 8px;
}

.failure-item {
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  margin-bottom: 6px;
  font-size: 12px;
}

.failure-time {
  color: #9ca3af;
  font-size: 11px;
  margin-bottom: 4px;
}

.failure-brief {
  display: flex;
  align-items: center;
  gap: 6px;
}

.failure-stage {
  padding: 2px 4px;
  background: rgba(239, 68, 68, 0.2);
  border-radius: 2px;
  font-weight: 600;
  font-size: 10px;
}

.failure-message {
  color: #dc2626;
  flex: 1;
}
</style>
```

## 工具函数

创建一个工具函数来格式化失败摘要：

```javascript
// frontend/src/utils/failureSummary.js

export function formatFailureSummaryBrief(failureSummary) {
  if (!failureSummary) return '';
  
  const parts = [];
  
  if (failureSummary.stage) {
    parts.push(`[${failureSummary.stage}]`);
  }
  
  parts.push(failureSummary.errorMessage || '未知错误');
  
  if (failureSummary.hint) {
    parts.push(`💡 ${failureSummary.hint}`);
  }
  
  return parts.join(' ');
}

export function formatFailureSummaryDetailed(failureSummary) {
  if (!failureSummary) return '';
  
  const lines = [];
  
  lines.push(`失败时间: ${failureSummary.failedAt || 'N/A'}`);
  lines.push(`模块: ${failureSummary.module || 'N/A'}`);
  lines.push(`阶段: ${failureSummary.stage || 'N/A'}`);
  lines.push(`错误码: ${failureSummary.errorCode || 'N/A'}`);
  lines.push(`错误消息: ${failureSummary.errorMessage || 'N/A'}`);
  
  if (failureSummary.details) {
    lines.push(`详细信息: ${failureSummary.details}`);
  }
  
  if (failureSummary.hint) {
    lines.push(`💡 排障建议: ${failureSummary.hint}`);
  }
  
  if (failureSummary.exitCode !== null) {
    lines.push(`退出码: ${failureSummary.exitCode}`);
  }
  
  lines.push(`可重试: ${failureSummary.retryable ? '是' : '否'}`);
  
  return lines.join('\n');
}

export function getFailureStatusColor(failureSummary) {
  if (!failureSummary) return '#6b7280';
  
  if (!failureSummary.retryable) {
    return '#dc2626'; // 红色 - 不可重试
  }
  
  return '#f59e0b'; // 橙色 - 可重试
}
```

## 使用示例

在现有组件中集成失败摘要展示：

```vue
<script>
import { formatFailureSummaryBrief } from '@/utils/failureSummary';

export default {
  methods: {
    getJobStatusText(job) {
      if (job.status === 'failed' && job.failureSummary) {
        return formatFailureSummaryBrief(job.failureSummary);
      }
      return job.message || job.status;
    }
  }
};
</script>
```

## 注意事项

1. **兼容性**：旧任务可能没有 `failureSummary` 字段，需要做好兼容处理
2. **性能**：大量任务时，避免在列表中展示过多详细信息
3. **样式**：失败摘要的样式应与现有设计保持一致
4. **国际化**：如需支持多语言，需要对错误消息和提示进行翻译

## 相关文件

- `docs/FEATURE_FAILURE_SUMMARY.md` - 失败摘要功能文档
- `server/core/failureSummary.js` - 后端失败摘要模块
- `frontend/src/utils/failureSummary.js` - 前端工具函数（待创建）
