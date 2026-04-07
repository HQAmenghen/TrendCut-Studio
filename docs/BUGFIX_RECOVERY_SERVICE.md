# Bug 修复报告：恢复服务无法扫描到中断任务

## 🐛 问题描述

恢复服务在启动时基本不会扫描到任何中断任务，导致启动恢复功能形同虚设。

## 🔍 根本原因

`listActiveTasks()` 方法需要 `type` 参数，但恢复服务调用时没有传参数。

### 问题分析

**recovery.js** (line 39):
```javascript
const tasks = taskStore.listActiveTasks();  // 没有传 type 参数
```

**taskStore.js** (line 124-126):
```javascript
listActiveTasks(type) {
  const rows = this.db.prepare(`
    SELECT * FROM tasks WHERE type = ? AND status IN ('queued', 'running') ORDER BY createdAt ASC
  `).all(type);  // type 是必需的，SQL 写死了 WHERE type = ?
```

### 问题表现

当 `type` 为 `undefined` 时：
- SQL 查询变成 `WHERE type = undefined`
- 不会匹配任何任务
- `listActiveTasks()` 返回空数组
- `scanInterruptedTasks()` 找不到任何中断任务
- `recoverOnStartup()` 不会恢复任何任务

## ✅ 修复方案

### 修改 `listActiveTasks` 使 `type` 参数可选

**文件**: `server/core/taskStore.js`

**修改前**:
```javascript
listActiveTasks(type) {
  const rows = this.db.prepare(`
    SELECT * FROM tasks WHERE type = ? AND status IN ('queued', 'running') ORDER BY createdAt ASC
  `).all(type);

  return rows.map(row => ({
    ...row,
    logs: JSON.parse(row.logs || '[]'),
    metadata: JSON.parse(row.metadata || '{}')
  }));
}
```

**修改后**:
```javascript
listActiveTasks(type) {
  let query;
  let params;

  if (type) {
    // 如果指定了 type，只查询该类型的活跃任务
    query = `SELECT * FROM tasks WHERE type = ? AND status IN ('queued', 'running') ORDER BY createdAt ASC`;
    params = [type];
  } else {
    // 如果没有指定 type，查询所有活跃任务
    query = `SELECT * FROM tasks WHERE status IN ('queued', 'running') ORDER BY createdAt ASC`;
    params = [];
  }

  const rows = this.db.prepare(query).all(...params);

  return rows.map(row => ({
    ...row,
    logs: JSON.parse(row.logs || '[]'),
    metadata: JSON.parse(row.metadata || '{}')
  }));
}
```

**改进**:
- `type` 参数变为可选
- 如果传了 `type`，只查询该类型的任务
- 如果没传 `type`，查询所有活跃任务
- 恢复服务可以扫描所有类型的中断任务

## 🧪 测试覆盖

创建了完整的恢复服务测试套件 (`server/core/__tests__/recovery.test.js`)，包含 8 个测试用例：

1. ✅ **扫描所有类型任务**: 验证能扫描到不同类型的中断任务
2. ✅ **忽略非运行状态**: 只扫描 running 状态的任务
3. ✅ **标记任务为中断**: 验证标记逻辑正确
4. ✅ **恢复策略选择**: 验证自动/手动恢复策略
5. ✅ **启动恢复流程**: 验证启动时恢复所有中断任务
6. ✅ **手动重试**: 验证手动重试功能
7. ✅ **取消中断任务**: 验证取消功能
8. ✅ **获取恢复状态**: 验证状态查询功能

**测试结果**: 8/8 通过 ✅

## 📊 影响范围

### 受影响的文件

1. ✅ `server/core/taskStore.js` - 修改 `listActiveTasks` 方法
2. ✅ `server/core/__tests__/recovery.test.js` - 新增测试文件

### 受影响的功能

- ❌ **修复前**: 恢复服务无法扫描到任何中断任务，启动恢复功能完全失效
- ✅ **修复后**: 恢复服务能正确扫描所有类型的中断任务，启动恢复功能正常工作

## 🔄 使用场景

### 场景 1: 服务重启后恢复任务

**修复前**:
```
服务启动
  ↓
扫描中断任务 (listActiveTasks())
  ↓
返回空数组 (type = undefined，查不到任何任务)
  ↓
[Recovery] 未发现中断的任务
  ↓
✗ 所有中断的任务都丢失了
```

**修复后**:
```
服务启动
  ↓
扫描中断任务 (listActiveTasks())
  ↓
返回所有 running 状态的任务
  ↓
[Recovery] 发现 3 个中断的任务
  ↓
根据恢复策略处理：
  - vertical_queue → 自动恢复
  - xai_top10 → 自动恢复
  - wechat_rpa → 等待手动恢复
  ↓
✓ 任务正确恢复
```

### 场景 2: 多种类型任务同时中断

**修复前**:
- 无法扫描到任何任务
- 所有任务都丢失

**修复后**:
- 扫描到所有类型的中断任务
- 根据任务类型应用不同的恢复策略
- 自动恢复幂等任务
- 手动恢复有副作用的任务

## 🎯 验证

### 1. 单元测试
```bash
npm test -- recovery.test.js
# Test Suites: 1 passed
# Tests:       8 passed
```

### 2. 所有测试
```bash
npm test
# Test Suites: 7 passed, 7 total
# Tests:       68 passed, 68 total
```

### 3. 手动测试（建议）

1. 创建几个不同类型的任务
2. 将任务状态设置为 `running`
3. 重启服务
4. 检查日志：
   ```
   [Recovery] 开始扫描中断的任务...
   [Recovery] 发现 N 个中断的任务
   [Recovery] 任务 xxx (vertical_queue): auto_recovered
   [Recovery] 任务 yyy (wechat_rpa): awaiting_manual_recovery
   ```

## 📝 修复清单

- [x] 修改 `taskStore.listActiveTasks()` 使 `type` 参数可选
- [x] 添加恢复服务测试套件（8 个测试）
- [x] 验证修复
  - [x] 恢复服务测试通过（8/8）
  - [x] 所有单元测试通过（68/68）

## 🚀 部署建议

### 部署前

1. 确认当前没有正在运行的任务
2. 备份 `tasks.db`

### 部署后

1. 重启服务
2. 检查启动日志中的恢复信息
3. 验证中断任务能被正确识别和恢复

### 回滚方案

如果出现问题：
1. 回滚到修复前版本
2. 恢复备份的 `tasks.db`
3. 重启服务

## 🔮 未来改进

### 1. 添加恢复日志持久化

将恢复操作记录到数据库：
```javascript
{
  taskId: 'xxx',
  recoveryAttempt: 1,
  recoveryTime: '2026-03-31T10:00:00Z',
  recoveryResult: 'success',
  recoveryMessage: '任务已自动恢复'
}
```

### 2. 恢复统计和监控

添加恢复统计 API：
```javascript
GET /api/system/recovery/stats
{
  totalRecovered: 10,
  autoRecovered: 7,
  manualRecovered: 3,
  failedRecovery: 0
}
```

### 3. 恢复策略配置化

允许用户配置恢复策略：
```json
{
  "recovery": {
    "strategies": {
      "vertical_queue": "auto",
      "xai_top10": "auto",
      "wechat_rpa": "manual",
      "custom_task": "auto"
    }
  }
}
```

## 📚 相关文档

- 恢复服务: `server/core/recovery.js`
- 任务存储: `server/core/taskStore.js`
- 恢复测试: `server/core/__tests__/recovery.test.js`
- 恢复设计文档: `RECOVERY_DESIGN.md`

## 🙏 致谢

感谢发现并报告此 P1 级别 bug！这是一个关键的功能缺陷，如果不修复会导致恢复服务完全失效，所有中断的任务都会丢失。

---

**修复日期**: 2026-03-31  
**严重级别**: P1（核心功能失效）  
**修复版本**: 当前版本  
**测试状态**: ✅ 68/68 测试通过  
**部署状态**: 待部署
