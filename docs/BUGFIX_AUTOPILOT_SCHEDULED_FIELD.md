# Bug 修复：AutoPilot 定时任务字段名不一致

## 问题描述

**严重级别**: P1

AutoPilot 自动创建的定时任务使用了错误的字段名 `scheduledTime`，而调度器读取的是 `scheduledAt`，导致 AutoPilot 创建的定时任务永远不会被触发。

## 根本原因

在 `server/services/system/scheduler.js` line 453，AutoPilot 创建定时任务时写入的字段名是 `scheduledTime`：

```javascript
const pJob = {
  // ...
  status: 'scheduled_wait',
  scheduledTime: isoScheduledTime,  // ❌ 错误的字段名
  // ...
};
```

而调度器在 line 522 使用 `getDueScheduledJobs()` 查询到期任务，该函数读取的是 `scheduledAt` 字段：

```javascript
// publish/store.js line 233-242
function getDueScheduledJobs(timestamp) {
  const payload = readPublishJobs();
  const now = timestamp || Date.now();
  return (payload.jobs || []).filter((job) => {
    if (job.archived) return false;
    if (!job.scheduledAt) return false;  // ✅ 读取 scheduledAt
    if (job.status !== 'scheduled_wait') return false;
    const scheduledTime = new Date(job.scheduledAt).getTime();
    return scheduledTime <= now;
  });
}
```

## 影响范围

- AutoPilot 自动创建的所有定时任务都无法被调度器识别
- 手动创建的定时任务不受影响（handlers.js 使用的是正确的 `scheduledAt`）

## 修复方案

修改 `scheduler.js` line 453，将 `scheduledTime` 改为 `scheduledAt`：

```javascript
const pJob = {
  // ...
  status: 'scheduled_wait',
  scheduledAt: isoScheduledTime,  // ✅ 正确的字段名
  // ...
};
```

## 字段名标准化总结

整个系统现在统一使用 `scheduledAt` 字段：

1. **前端发送**：`scheduledTime`（来自用户输入）
2. **后端接收**：`req.body.scheduledTime`
3. **后端存储**：`job.scheduledAt`（ISO 8601 格式）
4. **调度器读取**：`job.scheduledAt`
5. **前端显示**：从 `job.scheduledAt` 读取并转换为本地时间

## 验证结果

所有 68 个测试通过。

## 相关文件

- `server/services/system/scheduler.js:453` - 修复 AutoPilot 创建任务的字段名
- `server/services/publish/store.js:233-242` - `getDueScheduledJobs()` 读取 `scheduledAt`
- `server/services/publish/handlers.js:329` - 手动创建任务使用 `scheduledAt`

## 修复时间

2026-03-31
