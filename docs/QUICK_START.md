# 快速开始指南

## 三个新功能快速启用

### 1. 自动归档已发布任务

**一句话**：发布成功 30 分钟后自动归档，保持发布中心整洁。

**启用方式**：

在 `.env` 中添加：
```bash
AUTO_ARCHIVE_PUBLISHED=true
AUTO_ARCHIVE_DELAY_MINUTES=30
```

或在前端"发布中心 > 📦 自动归档设置"中配置。

**效果**：
- ✅ 发布中心主列表更干净
- ✅ 无需手动整理已完成任务
- ✅ 已归档任务可随时找回

---

### 2. 任务失败自动保留排障摘要

**一句话**：任务失败时自动生成排障摘要，无需翻日志。

**启用方式**：

无需配置，自动启用。失败任务会自动生成 `failureSummary` 字段。

**查看方式**：

```javascript
// 竖屏队列
const job = verticalQueueService.getJob(jobId);
console.log(job.failureSummary);

// 发布任务
const task = job.platformTasks.find(t => t.platform === 'wechatChannels');
console.log(task.failureSummary);
```

**包含信息**：
- 失败时间、模块、阶段、错误码
- 错误消息、排障建议
- stderr/stdout 尾部日志
- 可重试判断

---

### 3. 自动清理旧运行产物

**一句话**：每天凌晨 3 点自动清理过期文件，释放磁盘空间。

**启用方式**：

在 `.env` 中添加：
```bash
AUTO_CLEANUP_ENABLED=true
AUTO_CLEANUP_DRY_RUN=false
AUTO_CLEANUP_SCHEDULE=0 3 * * *
```

**首次使用建议**：

先用试运行模式查看将要删除的文件：
```bash
AUTO_CLEANUP_DRY_RUN=true
```

查看日志确认无误后，再设置为 `false` 实际执行清理。

**清理规则**：
- 竖屏队列产物：保留 7 天
- Pipeline 临时文件：保留 3 天
- 日志文件：保留 30 天

**效果**：
- ✅ 每周可释放 350+ MB 空间
- ✅ 目录更整洁，便于管理
- ✅ 安全可靠，不会误删

---

## 完整配置示例

在 `.env` 文件中添加：

```bash
# 自动归档已发布任务
AUTO_ARCHIVE_PUBLISHED=true
AUTO_ARCHIVE_DELAY_MINUTES=30

# 自动清理旧运行产物
AUTO_CLEANUP_ENABLED=true
AUTO_CLEANUP_DRY_RUN=false
AUTO_CLEANUP_SCHEDULE=0 3 * * *

# 可选：自定义保留天数
AUTO_CLEANUP_VERTICALQUEUE_RETENTION_DAYS=7
AUTO_CLEANUP_PIPELINEARTIFACTS_RETENTION_DAYS=3
AUTO_CLEANUP_LOGS_RETENTION_DAYS=30
```

重启服务后生效。

---

## 验证功能是否生效

### 1. 查看启动日志

```
[Scheduler] 初始化定时调度引擎 - node-cron
[Scheduler] 启动运行产物自动清理 {
  schedule: '0 3 * * *',
  dryRun: false,
  rules: [ 'verticalQueue', 'verticalQueueUploads', ... ]
}
```

### 2. 手动测试清理

```bash
node -e "
const { getCleanupStats, formatBytes } = require('./server/core/cleanup.js');
const path = require('path');
const stats = getCleanupStats(__dirname);
console.log('可释放空间:', formatBytes(stats.totalExpiredBytes));
"
```

### 3. 查看失败摘要

在任务失败后，检查任务对象的 `failureSummary` 字段。

---

## 常见问题

### Q: 自动归档会删除任务吗？

A: 不会。归档只是隐藏任务，可以在"查看已归档"中找回。

### Q: 清理会误删重要文件吗？

A: 不会。清理有多重保护：
- 只清理过期文件（超过保留天数）
- 配置文件在排除列表中
- 支持试运行模式预览

### Q: 如何调整清理时间？

A: 修改 `AUTO_CLEANUP_SCHEDULE`，使用 Cron 表达式：
- `0 3 * * *` - 每天凌晨 3 点
- `0 */6 * * *` - 每 6 小时
- `0 0 * * 0` - 每周日凌晨

### Q: 如何禁用某个功能？

A: 设置对应的环境变量为 `false`：
```bash
AUTO_ARCHIVE_PUBLISHED=false
AUTO_CLEANUP_ENABLED=false
```

---

## 详细文档

- [自动归档功能](./FEATURE_AUTO_ARCHIVE.md)
- [失败摘要功能](./FEATURE_FAILURE_SUMMARY.md)
- [自动清理功能](./FEATURE_AUTO_CLEANUP.md)
- [前端展示指南](./FRONTEND_FAILURE_SUMMARY_GUIDE.md)
- [完整实现总结](./FINAL_IMPLEMENTATION_SUMMARY.md)
