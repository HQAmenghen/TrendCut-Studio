# 验证：定时发布字段名统一

## 验证时间
2026-03-31

## 验证结果
✅ 所有创建任务的代码都使用 `scheduledAt` 字段

## 代码审查

### 1. 手动创建任务
`server/services/publish/handlers.js:329`
```javascript
scheduledAt: scheduledTime ? new Date(scheduledTime).toISOString() : null,
```

### 2. AutoPilot 创建任务
`server/services/system/scheduler.js:453`
```javascript
scheduledAt: isoScheduledTime,
```

### 3. 调度器读取任务
`server/services/publish/store.js:233-242`
```javascript
function getDueScheduledJobs(timestamp) {
  return (payload.jobs || []).filter((job) => {
    if (!job.scheduledAt) return false;  // 读取 scheduledAt
    // ...
  });
}
```

## 测试验证
所有 7 个定时发布测试通过：
- 使用 scheduledAt 字段存储定时时间
- 正确识别到期的定时任务
- 只返回状态为 scheduled_wait 的任务
- 忽略没有 scheduledAt 字段的任务
- 边界情况测试通过

## 结论
字段名已完全统一为 `scheduledAt`，调度器可以正确识别到期任务。
