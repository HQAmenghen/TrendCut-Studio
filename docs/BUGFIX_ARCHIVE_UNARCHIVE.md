# Bug 修复：取消归档后任务被重新归档

## 问题描述

取消归档后的已发布任务会在下一轮调度里被立刻重新归档。

## 根本原因

`server/services/publish/store.js` 中的 `archivePublishJob(jobId, false)` 函数在取消归档时：
- ✅ 将 `archived` 改回 `false`
- ❌ 但不会清空或重置 `archiveDueAt` 字段

导致 `getDueArchiveJobs()` 仍会把这个任务识别成"已到期的 published 任务"，下一轮自动归档会把它再次归档。

## 修复方案

在 `archivePublishJob` 函数中，取消归档时清空 `archiveDueAt` 字段：

```javascript
function archivePublishJob(jobId, archived = true) {
  return updatePublishJob(jobId, (job) => {
    job.archived = Boolean(archived);
    // 取消归档时清空 archiveDueAt，避免下一轮调度重新归档
    if (!archived) {
      job.archiveDueAt = null;
    }
    return job;
  });
}
```

## 修复位置

**文件**: `server/services/publish/store.js`  
**行号**: 232-237

## 测试验证

```bash
测试场景：取消归档后不应被重新归档

1. 初始状态 - 到期任务数: 1
   任务 test1 archiveDueAt: 2026-04-01T02:51:25.874Z

2. 归档后 - archived: true , archiveDueAt: 2026-04-01T02:51:25.874Z

3. 取消归档后 - archived: false , archiveDueAt: null

4. 检查到期任务 - 到期任务数: 0
   ✅ 修复成功：取消归档后不会被重新归档
```

## 影响范围

- ✅ 修复了取消归档功能
- ✅ 不影响正常归档流程
- ✅ 不影响自动归档调度

## 相关代码

### getDueArchiveJobs (line 321)

```javascript
function getDueArchiveJobs(timestamp) {
  const payload = readPublishJobs();
  const now = timestamp || Date.now();
  return (payload.jobs || []).filter((job) => {
    if (job.archived) return false;
    if (!job.archiveDueAt) return false;  // 修复后这里会过滤掉取消归档的任务
    if (job.status !== 'published') return false;
    const dueTime = new Date(job.archiveDueAt).getTime();
    return dueTime <= now;
  });
}
```

## 总结

修复后，取消归档功能可以正常工作：
- 用户取消归档后，任务不会被自动重新归档
- `archiveDueAt` 字段被正确清空
- 调度器不会再识别该任务为到期任务
