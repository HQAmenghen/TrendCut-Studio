# Task 9: 启动恢复与补偿机制设计

## 目标
实现企业级长任务系统的启动恢复机制，确保服务重启后能正确处理中断的任务。

## 问题分析

### 当前状态
1. **vertical queue**: 使用内存 Map 存储任务，重启后丢失
2. **publish jobs**: 使用 SQLite 持久化，但无恢复逻辑
3. **wechat RPA**: 进程状态在内存中，重启后无法恢复
4. **taskStore**: SQLite 持久化，但无启动扫描

### 需要解决的问题
1. 服务重启时，`running` 状态的任务实际已中断
2. 进程已死亡，但状态未更新
3. 用户不知道哪些任务需要重试
4. 无自动恢复机制

## 设计方案

### 1. 任务状态定义

#### 正常状态流转
```
pending → running → completed
pending → running → failed
pending → running → cancelled
```

#### 异常状态（新增）
```
running → interrupted (服务重启导致中断)
running → retryable_failed (可重试的失败)
interrupted → pending (自动恢复)
retryable_failed → pending (手动重试)
```

### 2. 启动恢复流程

```
服务启动
  ↓
扫描 taskStore
  ↓
查找 status='running' 的任务
  ↓
检查进程是否存在
  ↓
进程不存在 → 标记为 interrupted
  ↓
根据任务类型决定恢复策略
  ↓
- 可自动恢复 → 转为 pending + 自动重试
- 需手动确认 → 保持 interrupted + 通知用户
```

### 3. 恢复策略

#### 自动恢复（Auto Recovery）
适用于：
- 幂等操作（可重复执行）
- 无副作用的任务
- 短时间内可完成的任务

**示例**:
- vertical queue 视频处理（可重新下载、重新渲染）
- xAI 榜单抓取（可重新抓取）

#### 手动恢复（Manual Recovery）
适用于：
- 有副作用的操作
- 需要用户确认的任务
- 长时间运行的任务

**示例**:
- WeChat RPA 发布（可能已部分完成，需用户确认）
- 付费 API 调用（避免重复扣费）

### 4. 数据结构

#### TaskStore 扩展
```javascript
{
  id: "task_123",
  type: "vertical_queue",
  status: "interrupted",  // 新增状态
  progress: 45,
  message: "服务重启导致任务中断",
  metadata: {
    interruptedAt: "2026-03-31T10:00:00.000Z",
    interruptReason: "service_restart",
    recoveryStrategy: "auto",  // auto | manual
    retryCount: 0,
    maxRetries: 3
  }
}
```

#### 恢复日志
```javascript
{
  taskId: "task_123",
  recoveryAttempt: 1,
  recoveryTime: "2026-03-31T10:05:00.000Z",
  recoveryResult: "success",  // success | failed | skipped
  recoveryMessage: "任务已自动恢复并重新启动"
}
```

### 5. 实现模块

#### `server/core/recovery.js`
```javascript
/**
 * 任务恢复服务
 */
function createRecoveryService(deps) {
  const { taskStore, verticalQueueService, publishStore } = deps;

  /**
   * 扫描中断的任务
   */
  function scanInterruptedTasks() {
    const tasks = taskStore.listActiveTasks();
    const interrupted = tasks.filter(task => 
      task.status === 'running' || task.status === 'in_progress'
    );
    return interrupted;
  }

  /**
   * 检查进程是否存在
   */
  function isProcessAlive(task) {
    // 检查进程 ID 是否存在
    // 检查心跳时间是否超时
    return false; // 简化：假设都已死亡
  }

  /**
   * 标记任务为中断
   */
  function markAsInterrupted(task, reason) {
    taskStore.updateTask(task.id, {
      status: 'interrupted',
      message: `任务中断: ${reason}`,
      metadata: {
        ...task.metadata,
        interruptedAt: new Date().toISOString(),
        interruptReason: reason
      }
    });
  }

  /**
   * 恢复任务
   */
  async function recoverTask(task) {
    const strategy = task.metadata?.recoveryStrategy || 'manual';
    
    if (strategy === 'auto') {
      // 自动恢复：重置状态并重新入队
      taskStore.updateTask(task.id, {
        status: 'pending',
        progress: 0,
        message: '任务已自动恢复，等待重新执行',
        metadata: {
          ...task.metadata,
          retryCount: (task.metadata?.retryCount || 0) + 1,
          lastRecoveryAt: new Date().toISOString()
        }
      });
      
      // 根据任务类型重新入队
      if (task.type === 'vertical_queue') {
        // 重新入队到 vertical queue
      }
      
      return { success: true, action: 'auto_recovered' };
    } else {
      // 手动恢复：保持 interrupted 状态，等待用户操作
      return { success: true, action: 'awaiting_manual_recovery' };
    }
  }

  /**
   * 启动时恢复所有中断的任务
   */
  async function recoverOnStartup() {
    const interrupted = scanInterruptedTasks();
    const results = [];
    
    for (const task of interrupted) {
      const isAlive = isProcessAlive(task);
      
      if (!isAlive) {
        markAsInterrupted(task, 'service_restart');
        const result = await recoverTask(task);
        results.push({ taskId: task.id, ...result });
      }
    }
    
    return results;
  }

  return {
    scanInterruptedTasks,
    markAsInterrupted,
    recoverTask,
    recoverOnStartup
  };
}
```

### 6. 集成点

#### server.js 启动时调用
```javascript
// 在所有服务初始化后
const recoveryService = createRecoveryService({
  taskStore,
  verticalQueueService,
  publishStore
});

// 启动恢复
recoveryService.recoverOnStartup().then(results => {
  console.log(`[Recovery] 恢复了 ${results.length} 个中断的任务`);
  for (const result of results) {
    console.log(`[Recovery] 任务 ${result.taskId}: ${result.action}`);
  }
});
```

#### API 端点
```javascript
// GET /api/system/recovery/status
// 查看中断任务列表

// POST /api/system/recovery/retry/:taskId
// 手动重试中断的任务

// POST /api/system/recovery/cancel/:taskId
// 取消中断的任务
```

### 7. 用户界面

#### 恢复通知
```
⚠️ 检测到 3 个任务在服务重启时中断：
- 任务 #123: 竖屏视频渲染 (45% 完成)
  [自动重试] [取消]
- 任务 #124: 微信视频号发布 (需手动确认)
  [重新发布] [取消]
- 任务 #125: xAI 榜单抓取 (已自动恢复)
  [查看详情]
```

### 8. 配置选项

```javascript
// config/recovery.json
{
  "enabled": true,
  "autoRecovery": {
    "enabled": true,
    "maxRetries": 3,
    "retryDelay": 5000,  // 5 秒后重试
    "taskTypes": ["vertical_queue", "xai_top10"]
  },
  "manualRecovery": {
    "taskTypes": ["wechat_rpa", "publish"]
  },
  "heartbeatTimeout": 300000,  // 5 分钟无心跳视为死亡
  "notifyUser": true
}
```

## 实施步骤

1. ✅ 设计恢复机制和状态流转
2. ⏳ 创建 `server/core/recovery.js` 模块
3. ⏳ 扩展 taskStore 支持 `interrupted` 状态
4. ⏳ 在 server.js 启动时调用恢复逻辑
5. ⏳ 为 vertical queue 添加恢复支持
6. ⏳ 为 publish jobs 添加恢复支持
7. ⏳ 添加恢复 API 端点
8. ⏳ 添加恢复测试
9. ⏳ 添加用户通知

## 测试场景

### 场景 1: 服务正常重启
1. 启动 vertical queue 任务
2. 任务进行到 50%
3. 重启服务
4. 验证任务被标记为 `interrupted`
5. 验证任务自动恢复并重新执行

### 场景 2: 进程崩溃
1. 启动 WeChat RPA 任务
2. 手动 kill Python 进程
3. 验证任务被标记为 `interrupted`
4. 验证任务等待手动恢复

### 场景 3: 多次重试失败
1. 启动任务
2. 任务失败
3. 自动重试 3 次
4. 验证任务被标记为 `retryable_failed`
5. 验证不再自动重试

## 收益

1. **可靠性**: 服务重启不丢失任务状态
2. **用户体验**: 自动恢复减少人工干预
3. **可观测性**: 清晰的恢复日志和状态
4. **企业级**: 符合生产环境要求

## 风险与限制

1. **幂等性**: 自动恢复要求任务幂等
2. **资源消耗**: 大量任务恢复可能导致资源峰值
3. **状态一致性**: 需要确保数据库和内存状态一致
4. **重复执行**: 部分完成的任务可能重复执行

## 缓解措施

1. 使用任务协议（Task 7）确保幂等性
2. 限制并发恢复数量（如每次最多 5 个）
3. 使用事务确保状态一致性
4. 记录执行进度，支持断点续传
