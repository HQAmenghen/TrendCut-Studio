# Bug 修复：恢复服务测试未清理异步定时器

## 问题描述

**严重级别**: P1

测试套件显示全部通过（7 passed / 68 passed），但 Jest 进程无法正常退出，报错 "Jest did not exit one second after the test run has completed"，导致 CI 失败。

## 根本原因

在 `server/core/recovery.js` line 158，`autoRecoverTask()` 函数使用 `setTimeout` 延迟重新入队任务：

```javascript
setTimeout(() => {
  try {
    verticalQueueService.enqueue(item);
    console.log(`[Recovery] 任务 ${task.id} 已重新入队`);
  } catch (err) {
    console.error('[Recovery] 重新入队失败:', err);
  }
}, config.autoRecovery.retryDelay);
```

问题：
1. `setTimeout` 返回的 timer ID 没有被存储
2. 没有提供清理机制来取消未完成的定时器
3. 测试结束后，定时器仍在运行，导致 Jest 无法退出

## 影响范围

- 所有测试套件在本地运行时会有警告
- CI 环境中测试会以非零状态退出，导致 CI 失败
- 虽然测试逻辑正确，但进程清理不完整

## 修复方案

### 1. 存储定时器 ID

在 `recovery.js` 中添加 `pendingTimers` Set 来跟踪所有未完成的定时器：

```javascript
// 存储所有未完成的定时器，用于清理
const pendingTimers = new Set();
```

### 2. 注册和清理定时器

修改 `autoRecoverTask()` 中的 `setTimeout` 调用：

```javascript
const timerId = setTimeout(() => {
  pendingTimers.delete(timerId);  // 执行完成后从集合中移除
  try {
    verticalQueueService.enqueue(item);
    console.log(`[Recovery] 任务 ${task.id} 已重新入队`);
  } catch (err) {
    console.error('[Recovery] 重新入队失败:', err);
  }
}, config.autoRecovery.retryDelay);
pendingTimers.add(timerId);  // 添加到集合中
```

### 3. 提供清理函数

添加 `cleanup()` 函数并导出：

```javascript
function cleanup() {
  for (const timerId of pendingTimers) {
    clearTimeout(timerId);
  }
  pendingTimers.clear();
}

return {
  scanInterruptedTasks,
  markAsInterrupted,
  recoverTask,
  recoverOnStartup,
  manualRetry,
  cancelInterrupted,
  getRecoveryStatus,
  cleanup  // 新增
};
```

### 4. 在测试中调用清理

修改 `recovery.test.js` 的 `afterEach`：

```javascript
afterEach(() => {
  // 清理恢复服务的定时器
  if (recoveryService && typeof recoveryService.cleanup === 'function') {
    recoveryService.cleanup();
  }

  // 关闭数据库连接
  if (taskStore && taskStore.db) {
    taskStore.db.close();
  }

  // 清理测试数据库
  if (fs.existsSync(testDbPath)) {
    try {
      fs.unlinkSync(testDbPath);
    } catch (err) {
      // 忽略删除失败（可能被锁定）
    }
  }
});
```

## 验证结果

修复后：
- 所有 68 个测试通过
- Jest 正常退出，无警告
- 退出码为 0
- CI 可以正常通过

修复前：
```
Test Suites: 7 passed, 7 total
Tests:       68 passed, 68 total
Jest did not exit one second after the test run has completed.
```

修复后：
```
Test Suites: 7 passed, 7 total
Tests:       68 passed, 68 total
Exit code: 0
```

## 最佳实践

对于所有使用异步操作（setTimeout、setInterval、Promise、事件监听器等）的服务：

1. **跟踪资源**：存储所有异步操作的句柄/ID
2. **提供清理函数**：导出 `cleanup()` 或 `destroy()` 方法
3. **测试清理**：在 `afterEach` 中调用清理函数
4. **生产环境清理**：在服务关闭时调用清理函数

## 相关文件

- `server/core/recovery.js:11-33` - 添加 `pendingTimers` 和 `cleanup()` 函数
- `server/core/recovery.js:158-168` - 修改 `setTimeout` 调用以跟踪 timer ID
- `server/core/__tests__/recovery.test.js:44-58` - 在 `afterEach` 中调用 `cleanup()`

## 修复时间

2026-03-31
