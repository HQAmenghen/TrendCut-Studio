# Bug 修复报告：定时发布任务永远不会被触发

## 🐛 问题描述

定时发布任务创建后永远不会被识别为到期，导致调度器无法触发这些任务。

## 🔍 根本原因

发现了两个严重的字段名不一致问题：

### Bug 1: 字段名不一致（scheduledTime vs scheduledAt）

**写入位置** (`server/services/publish/handlers.js:329`):
```javascript
scheduledTime: scheduledTime ? new Date(scheduledTime).toISOString() : null
```

**读取位置** (`server/services/publish/store.js:238`):
```javascript
if (!job.scheduledAt) return false;
```

**影响**: 
- 创建任务时写入 `scheduledTime` 字段
- 查询到期任务时读取 `scheduledAt` 字段
- 导致所有定时任务永远不会被识别为到期

### Bug 2: 状态检查错误（pending vs scheduled_wait）

**创建任务时的状态** (`server/services/publish/handlers.js:328`):
```javascript
status: scheduledTime ? 'scheduled_wait' : ...
```

**查询到期任务时的状态检查** (`server/services/publish/store.js:240`):
```javascript
return scheduledTime <= now && job.status === 'pending';
```

**影响**:
- 创建定时任务时状态为 `'scheduled_wait'`
- 查询时检查状态是否为 `'pending'`
- 即使字段名正确，状态不匹配也会导致任务不被触发

## ✅ 修复方案

### 1. 统一字段名为 `scheduledAt`

**修改文件**:
- `server/services/publish/handlers.js` (line 329)
- `server/services/system/scheduler.js` (lines 88, 537, 543, 548)
- `frontend/src/composables/usePublishCenter.js` (lines 489, 491, 492)

**原因**: `scheduledAt` 与其他时间字段（`createdAt`, `updatedAt`, `archivedAt`）命名一致。

### 2. 修正状态检查逻辑

**修改文件**: `server/services/publish/store.js` (line 240)

**修改前**:
```javascript
function getDueScheduledJobs(timestamp) {
  const payload = readPublishJobs();
  const now = timestamp || Date.now();
  return (payload.jobs || []).filter((job) => {
    if (job.archived) return false;
    if (!job.scheduledAt) return false;
    const scheduledTime = new Date(job.scheduledAt).getTime();
    return scheduledTime <= now && job.status === 'pending';
  });
}
```

**修改后**:
```javascript
function getDueScheduledJobs(timestamp) {
  const payload = readPublishJobs();
  const now = timestamp || Date.now();
  return (payload.jobs || []).filter((job) => {
    if (job.archived) return false;
    if (!job.scheduledAt) return false;
    if (job.status !== 'scheduled_wait') return false;
    const scheduledTime = new Date(job.scheduledAt).getTime();
    return scheduledTime <= now;
  });
}
```

**改进**:
- 明确检查状态为 `'scheduled_wait'`
- 提前返回，提高可读性
- 逻辑更清晰

## 🧪 测试覆盖

创建了完整的测试套件 (`server/services/publish/__tests__/scheduling.test.js`)，包含 7 个测试用例：

1. ✅ **字段名一致性测试**: 确保使用 `scheduledAt` 而不是 `scheduledTime`
2. ✅ **到期任务识别测试**: 验证能正确识别到期的任务
3. ✅ **状态检查测试**: 只返回 `scheduled_wait` 状态的任务
4. ✅ **字段缺失测试**: 忽略没有 `scheduledAt` 字段的任务
5. ✅ **归档任务测试**: 忽略已归档的任务
6. ✅ **边界情况测试 1**: `scheduledAt` 正好等于当前时间（应该触发）
7. ✅ **边界情况测试 2**: `scheduledAt` 比当前时间晚 1 毫秒（不应该触发）

**测试结果**: 7/7 通过 ✅

## 📊 影响范围

### 受影响的文件

**后端**:
- `server/services/publish/handlers.js` - 任务创建
- `server/services/publish/store.js` - 任务查询
- `server/services/system/scheduler.js` - 调度器

**前端**:
- `frontend/src/composables/usePublishCenter.js` - 编辑器

### 受影响的功能

- ❌ **修复前**: 所有定时发布任务永远不会被触发
- ✅ **修复后**: 定时发布任务在到期时正确触发

## 🔄 数据迁移

### 现有数据兼容性

**问题**: 已创建的定时任务使用 `scheduledTime` 字段，修复后会失效。

**解决方案**: 添加数据迁移逻辑（可选）

```javascript
// 在 store.js 的 readPublishJobs 中添加迁移逻辑
function migrateScheduledTime(job) {
  // 如果有 scheduledTime 但没有 scheduledAt，迁移数据
  if (job.scheduledTime && !job.scheduledAt) {
    job.scheduledAt = job.scheduledTime;
    delete job.scheduledTime;
  }
  return job;
}
```

**注意**: 当前实现未包含迁移逻辑，因为：
1. 系统尚未部署到生产环境
2. 没有历史数据需要迁移
3. 如果需要，可以手动修改 JSON 文件

## 📝 修复清单

- [x] 统一字段名为 `scheduledAt`
  - [x] handlers.js (任务创建)
  - [x] store.js (任务查询)
  - [x] scheduler.js (调度器)
  - [x] usePublishCenter.js (前端编辑器)

- [x] 修正状态检查逻辑
  - [x] store.js `getDueScheduledJobs()` 函数

- [x] 添加测试覆盖
  - [x] 创建 scheduling.test.js
  - [x] 7 个测试用例全部通过

- [x] 验证修复
  - [x] 所有单元测试通过（60/60）
  - [x] 无回归问题

## 🎯 验证步骤

### 1. 单元测试
```bash
npm test
# Test Suites: 6 passed, 6 total
# Tests:       60 passed, 60 total
```

### 2. 手动测试（建议）

1. 创建一个定时发布任务，设置 5 分钟后发布
2. 检查任务状态为 `scheduled_wait`
3. 检查任务有 `scheduledAt` 字段
4. 等待 5 分钟
5. 验证调度器识别并触发任务

### 3. 日志验证

查看调度器日志：
```
[Scheduler -> 微信发布] 查询到到期定时任务 { count: 1, jobs: [...] }
```

## 🚀 部署建议

### 部署前

1. 备份现有的 `publish_jobs.json` 文件
2. 检查是否有待发布的定时任务
3. 如果有，记录这些任务的 ID 和预定时间

### 部署后

1. 验证调度器正常运行
2. 检查日志中是否有错误
3. 创建测试任务验证功能

### 回滚方案

如果出现问题：
1. 恢复备份的 `publish_jobs.json`
2. 回滚代码到修复前版本
3. 手动触发待发布的任务

## 📚 相关文档

- 调度器文档: `server/services/system/scheduler.js`
- 发布中心文档: `server/services/publish/`
- 测试文档: `server/services/publish/__tests__/scheduling.test.js`

## 🙏 致谢

感谢发现并报告此 bug！这是一个关键的生产环境问题，如果不修复会导致定时发布功能完全失效。

---

**修复日期**: 2026-03-31  
**修复版本**: 当前版本  
**测试状态**: ✅ 60/60 测试通过  
**部署状态**: 待部署
