# 任务失败自动保留排障摘要功能

## 功能概述

为失败任务自动生成标准化的排障摘要，包含失败时间、模块、阶段、错误码、错误消息、日志尾部和排障建议，让开发者无需翻阅全量日志即可快速定位问题。

## 失败摘要结构

### 标准字段

```javascript
{
  failedAt: "2026-04-01T10:30:00.000Z",      // 失败时间
  module: "vertical_queue",                   // 模块名称
  stage: "render",                            // 失败阶段
  errorCode: "RENDER_FAILED",                 // 错误码
  errorMessage: "视频渲染失败",               // 错误消息
  details: "FFmpeg process exited with code 1", // 详细信息
  hint: "检查视频文件完整性和渲染参数",      // 排障建议
  stderrTail: [...],                          // stderr 尾部（最近20行）
  stdoutTail: [...],                          // stdout 尾部（最近12行）
  exitCode: 1,                                // 进程退出码
  retryable: true,                            // 是否可重试
  context: {                                  // 额外上下文
    jobId: "job_123",
    sourceType: "xai_top10",
    videoUrl: "https://..."
  }
}
```

### 模块标识

- `vertical_queue` - 竖屏队列
- `publish_wechat` - 微信视频号发布
- `review` - AI 审核
- `pipeline` - 主流程

### 常见阶段

**竖屏队列**：
- `download` - 下载视频
- `transcribe` - ASR 字幕生成
- `render` - 视频渲染

**微信发布**：
- `login` - 登录检查
- `upload` - 视频上传
- `publish` - 发布操作

## 实现细节

### 1. 核心模块

#### failureSummary.js

提供统一的失败摘要创建和格式化函数：

```javascript
const {
  createFailureSummary,
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError,
  generateHintFromErrorCode,
  formatFailureSummaryBrief,
  formatFailureSummaryDetailed
} = require('./core/failureSummary');
```

**主要函数**：

- `createFailureSummary(options)` - 创建标准失败摘要
- `createFailureSummaryFromPythonError(error, module, options)` - 从 Python 错误创建
- `createFailureSummaryFromError(error, module, stage, options)` - 从通用错误创建
- `generateHintFromErrorCode(errorCode)` - 根据错误码生成排障建议
- `formatFailureSummaryBrief(failureSummary)` - 格式化为简短文本
- `formatFailureSummaryDetailed(failureSummary)` - 格式化为详细文本

### 2. 集成到 Vertical Queue

在 `server/services/vertical/queue.js` 中：

```javascript
const {
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError
} = require('../../core/failureSummary');

// 任务失败时
const failureSummary = error?.code
  ? createFailureSummaryFromPythonError(error, 'vertical_queue', {
    stage: job.currentStage || 'unknown',
    context: {
      jobId: job.id,
      sourceType: job.sourceType,
      videoUrl: job.videoUrl
    }
  })
  : createFailureSummaryFromError(error, 'vertical_queue', job.currentStage || 'unknown', {
    context: {
      jobId: job.id,
      sourceType: job.sourceType,
      videoUrl: job.videoUrl
    }
  });

job.failureSummary = failureSummary;
persistJobFailure(job, failureSummary, jobDir);
```

**阶段跟踪**：

```javascript
const updateStage = (stage, patch, logMessage = '') => {
  job.currentStage = stage;
  updateJob(patch, logMessage);
};

// 使用示例
updateStage('download', { status: 'downloading', progress: 10, message: '正在下载远程视频...' });
updateStage('transcribe', { status: 'transcribing', progress: 35, message: '正在执行 ASR 自动打轴...' });
updateStage('render', { status: 'rendering', progress: 75, message: '正在渲染竖屏视频...' });
```

### 3. 集成到 Publish WeChat RPA

在 `server/services/publish/wechatRpa.process.js` 中：

```javascript
const {
  createFailureSummaryFromPythonError,
  createFailureSummaryFromError
} = require('../../core/failureSummary');

// RPA 失败时
const failureSummary = error?.code
  ? createFailureSummaryFromPythonError(error, 'publish_wechat', {
    stage: runtimeEntry.currentState || 'unknown',
    context: {
      jobId,
      accountId: task?.accountId || '',
      publishMode
    }
  })
  : createFailureSummaryFromError(error, 'publish_wechat', runtimeEntry.currentState || 'unknown', {
    context: {
      jobId,
      accountId: task?.accountId || '',
      publishMode
    }
  });

safeUpdatePublishPlatformTask(jobId, 'wechatChannels', {
  status: 'failed',
  lastFailureAt: new Date().toISOString(),
  failureSummary,
  runtime: { ... }
});
```

**状态跟踪**：

```javascript
const runtimeEntry = {
  proc,
  cancel,
  jobId,
  platform: 'wechatChannels',
  accountId: wechatAccount.id,
  publishMode,
  cancelledByUser: false,
  currentState: 'starting'
};

// 状态更新时
runtimeEntry.currentState = parsed.state;
```

## 排障建议映射

系统根据错误码自动生成排障建议：

| 错误码 | 排障建议 |
|--------|----------|
| `NETWORK_ERROR` | 检查网络连接和代理设置 |
| `TIMEOUT` | 增加超时时间或检查服务响应速度 |
| `FILE_NOT_FOUND` | 检查文件路径是否正确 |
| `PERMISSION_DENIED` | 检查文件或目录权限 |
| `INVALID_CONFIG` | 检查配置文件格式和必填字段 |
| `API_ERROR` | 检查 API 密钥和配额 |
| `LOGIN_REQUIRED` | 需要重新登录或刷新令牌 |
| `RATE_LIMIT` | 请求频率过高，稍后重试 |
| `DOWNLOAD_FAILED` | 检查视频链接有效性和网络连接 |
| `RENDER_FAILED` | 检查视频文件完整性和渲染参数 |
| `UPLOAD_FAILED` | 检查上传权限和网络连接 |
| `WECHAT_LOGIN_FAILED` | 需要扫码重新登录微信视频号 |
| `WECHAT_UPLOAD_FAILED` | 检查视频格式和大小限制 |
| `REVIEW_FAILED` | 检查 AI 审核配置和 API 密钥 |

## 可重试判断

系统自动判断错误是否可重试：

**不可重试的错误码**：
- `FILE_NOT_FOUND` - 文件不存在
- `INVALID_CONFIG` - 配置无效
- `PERMISSION_DENIED` - 权限不足
- `INVALID_INPUT` - 输入无效

其他错误默认为可重试。

## 前端展示

### 1. 任务卡片简短摘要

```javascript
// 使用 formatFailureSummaryBrief
const brief = formatFailureSummaryBrief(job.failureSummary);
// 输出: "[render] 视频渲染失败 💡 检查视频文件完整性和渲染参数"
```

### 2. 详情弹窗完整摘要

```javascript
// 使用 formatFailureSummaryDetailed
const detailed = formatFailureSummaryDetailed(job.failureSummary);
// 输出多行详细信息，包含所有字段
```

### 3. 账号详情最近失败

在账号管理界面显示该账号最近的失败任务摘要。

## 使用示例

### 查看失败摘要

**竖屏队列**：
```javascript
// 获取失败任务
const job = verticalQueueService.getJob(jobId);
if (job.status === 'failed' && job.failureSummary) {
  console.log('失败时间:', job.failureSummary.failedAt);
  console.log('失败阶段:', job.failureSummary.stage);
  console.log('错误码:', job.failureSummary.errorCode);
  console.log('错误消息:', job.failureSummary.errorMessage);
  console.log('排障建议:', job.failureSummary.hint);
  console.log('可重试:', job.failureSummary.retryable);
}
```

**发布任务**：
```javascript
// 获取发布任务
const payload = publishStore.readPublishJobs();
const job = payload.jobs.find(j => j.id === jobId);
const task = job.platformTasks.find(t => t.platform === 'wechatChannels');
if (task.status === 'failed' && task.failureSummary) {
  console.log('失败摘要:', formatFailureSummaryBrief(task.failureSummary));
}
```

### 持久化存储

失败摘要会自动保存到：

**竖屏队列**：
- `data/vertical_queue/{jobId}/failure.json`
- `data/logs/vertical_queue.log`

**发布任务**：
- 存储在 SQLite 数据库的 `publish_jobs_v1` 表中
- 作为任务对象的 `failureSummary` 字段

## 收益

- ✅ **快速排障**：无需翻阅全量日志，直接查看失败摘要
- ✅ **标准化**：统一的数据结构，便于分析和展示
- ✅ **智能建议**：根据错误码自动生成排障建议
- ✅ **上下文完整**：保留关键日志尾部和执行上下文
- ✅ **可重试判断**：自动判断错误是否可重试
- ✅ **易于扩展**：可轻松集成到新模块

## 后续扩展

### 1. 集成到 Review 模块

```javascript
// server/services/review/handlers.js
const failureSummary = createFailureSummaryFromError(
  error,
  'review',
  'ai_review',
  {
    context: {
      videoPath,
      reviewId
    }
  }
);
```

### 2. 集成到 Pipeline 模块

```javascript
// server/services/pipeline/comfy.js
const failureSummary = createFailureSummaryFromPythonError(
  error,
  'pipeline',
  {
    stage: 'comfy_workflow',
    context: {
      workflowId,
      promptId
    }
  }
);
```

### 3. 失败统计和分析

基于失败摘要数据，可以实现：
- 失败率统计
- 常见错误分析
- 账号健康度评分
- 自动告警和通知

## 相关文件

### 核心模块
- `server/core/failureSummary.js` - 失败摘要工具模块

### 集成模块
- `server/services/vertical/queue.js` - 竖屏队列集成
- `server/services/publish/wechatRpa.process.js` - 微信发布集成

### 文档
- `docs/FEATURE_FAILURE_SUMMARY.md` - 本文档
