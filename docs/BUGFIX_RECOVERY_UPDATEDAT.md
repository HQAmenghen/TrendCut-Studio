# Bug 修复：恢复服务无法识别中断任务

## 问题描述

**严重级别**: P1

启动恢复服务扫描不到大多数中断任务，导致恢复能力基本失效。

## 根本原因

`taskStore.updateTask()` 在 line 67 强制覆盖 `updatedAt` 为当前时间：

```javascript
Object.assign(task, updates, { updatedAt: new Date().toISOString() });
```

这导致两个问题：

1. **测试无法模拟旧任务**：即使测试中传入 `updatedAt: tenMinutesAgo`，也会被覆盖为当前时间
2. **恢复逻辑失效**：所有任务的 `updatedAt` 都是最新的，`isProcessAlive()` 判断永远返回 true，任务永远不会被识别为"进程已死亡"

## 影响范围

- `server/core/recovery.js` - 恢复服务的 `isProcessAlive()` 判断失效
- `server/core/__tests__/recovery.test.js` - 测试中的"启动恢复应该处理所有中断的任务"实际上没有真正测试恢复逻辑

## 修复方案

修改 `taskStore.updateTask()` 逻辑，只有在 `updates` 中没有明确提供 `updatedAt` 时，才自动设置为当前时间：

```javascript
// 修复前
Object.assign(task, updates, { updatedAt: new Date().toISOString() });

// 修复后
const updatedAt = updates.updatedAt || new Date().toISOString();
Object.assign(task, updates, { updatedAt });
```

## 验证结果

修复后，恢复测试正确识别"进程已死亡"的任务：

```
[Recovery] 开始扫描中断的任务...
[Recovery] 发现 2 个中断的任务
[Recovery] 任务 xxx (vertical_queue) 进程已死亡，开始恢复...
[Recovery] 任务 xxx (xai_top10) 进程已死亡，开始恢复...
```

所有 68 个测试通过。

## 相关文件

- `server/core/taskStore.js:63-67` - 修复 `updateTask()` 方法
- `server/core/recovery.js:54-63` - `isProcessAlive()` 依赖 `updatedAt` 判断
- `server/core/__tests__/recovery.test.js:141-159` - 恢复测试

## 修复时间

2026-03-31
