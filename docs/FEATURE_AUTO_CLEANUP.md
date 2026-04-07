# 自动清理旧运行产物功能

## 功能概述

自动清理旧运行产物功能可以定期清理过期的临时文件和目录，减少磁盘占用和目录噪音，保持项目目录整洁。

## 清理规则

### 默认清理规则

| 规则名称 | 路径 | 保留天数 | 默认状态 | 说明 |
|---------|------|---------|---------|------|
| **竖屏队列产物** | `public/xai_vertical_queue/` | 7 天 | 启用 | 竖屏队列渲染的视频产物 |
| **竖屏队列上传** | `data/uploads/xai_vertical_queue/` | 7 天 | 启用 | 竖屏队列上传的源文件 |
| **Pipeline 临时文件** | `python/pipeline/` | 3 天 | **禁用** | Pipeline 生成的临时视频和 JSON 文件（默认禁用，避免误删源码目录样例文件） |
| **日志文件** | `data/logs/` | 30 天 | 启用 | 系统运行日志 |
| **运行时任务** | `data/uploads/runtime_jobs/` | 7 天 | 启用 | 运行时任务文件 |

### 保护机制

- **配置文件保护**：Pipeline 目录中的配置文件（`audio.json`, `director.json`, `glossary.json`）不会被清理
- **样例文件保护**：Pipeline 目录中的样例文件（`aiman.mp4`, `material.mp4`, `result.json`, `subtitles.json` 等）不会被清理
- **默认禁用高风险规则**：Pipeline 清理规则默认禁用，避免误删源码目录中的文件
- **时间判断**：只清理超过保留天数的文件/目录
- **模式匹配**：支持通配符模式，精确控制清理范围

## 配置选项

### 环境变量

在 `.env` 文件中配置：

```bash
# 启用自动清理
AUTO_CLEANUP_ENABLED=true

# 试运行模式（只显示将要删除的文件，不实际删除）
AUTO_CLEANUP_DRY_RUN=false

# 清理计划（Cron 表达式）
# 默认：每天凌晨 3 点执行
AUTO_CLEANUP_SCHEDULE=0 3 * * *

# 覆盖特定规则的保留天数（可选）
AUTO_CLEANUP_VERTICALQUEUE_RETENTION_DAYS=7
AUTO_CLEANUP_VERTICALQUEUEUPLOADS_RETENTION_DAYS=7
AUTO_CLEANUP_PIPELINEARTIFACTS_RETENTION_DAYS=3
AUTO_CLEANUP_LOGS_RETENTION_DAYS=30
AUTO_CLEANUP_RUNTIMEJOBS_RETENTION_DAYS=7
```

### Cron 表达式说明

Cron 表达式格式：`分钟 小时 日 月 星期`

常用示例：
- `0 3 * * *` - 每天凌晨 3 点
- `0 */6 * * *` - 每 6 小时
- `0 0 * * 0` - 每周日凌晨
- `0 2 1 * *` - 每月 1 号凌晨 2 点

## 使用方式

### 1. 启用自动清理

在 `.env` 文件中设置：

```bash
AUTO_CLEANUP_ENABLED=true
AUTO_CLEANUP_SCHEDULE=0 3 * * *
```

重启服务后，清理任务将按计划自动执行。

### 2. 试运行模式

在实际清理前，可以先使用试运行模式查看将要删除的文件：

```bash
AUTO_CLEANUP_DRY_RUN=true
```

试运行模式下，系统会输出将要删除的文件列表，但不会实际删除。

### 3. 手动执行清理

可以通过 Node.js 脚本手动执行清理：

```javascript
const { runCleanup } = require('./server/core/cleanup');
const path = require('path');

const baseDir = path.join(__dirname);
const summary = runCleanup(baseDir, { dryRun: false });

console.log('清理完成:', summary);
```

### 4. 查看清理统计

查看当前有多少过期文件可以清理：

```javascript
const { getCleanupStats } = require('./server/core/cleanup');
const path = require('path');

const baseDir = path.join(__dirname);
const stats = getCleanupStats(baseDir);

console.log('清理统计:', stats);
console.log(`可释放空间: ${formatBytes(stats.totalExpiredBytes)}`);
```

## 清理日志

清理任务执行时会输出详细日志：

```
[Scheduler] 启动运行产物自动清理 {
  schedule: '0 3 * * *',
  dryRun: false,
  rules: [
    'verticalQueue',
    'verticalQueueUploads',
    'pipelineArtifacts',
    'logs',
    'runtimeJobs'
  ]
}

[Scheduler -> 清理] 开始执行定时清理任务
[Cleanup] 开始清理运行产物 (LIVE)
[Cleanup] 清理规则: 竖屏队列渲染产物 (保留 7 天)
[Cleanup]   已清理: 15 文件, 10 目录, 2.5 GB
[Cleanup] 清理规则: Pipeline 临时产物 (保留 3 天)
[Cleanup]   已清理: 8 文件, 0 目录, 450 MB
[Cleanup] 清理完成:
[Cleanup]   文件: 23
[Cleanup]   目录: 10
[Cleanup]   释放空间: 2.95 GB
[Cleanup]   错误: 0

[Scheduler -> 清理] 清理任务完成 {
  filesRemoved: 23,
  dirsRemoved: 10,
  bytesFreed: 3168256000,
  errors: 0,
  dryRun: false
}
```

## 自定义清理规则

如果需要自定义清理规则，可以修改 `server/core/cleanup.js` 中的 `DEFAULT_CLEANUP_RULES`：

```javascript
const DEFAULT_CLEANUP_RULES = {
  // 添加新规则
  customRule: {
    enabled: true,
    path: 'path/to/directory',
    retentionDays: 7,
    pattern: '*.tmp',
    exclude: ['important.tmp'],
    description: '自定义清理规则'
  }
};
```

### 规则字段说明

- `enabled` - 是否启用该规则
- `path` - 相对于项目根目录的路径
- `retentionDays` - 保留天数
- `pattern` - 文件/目录匹配模式（支持通配符 `*` 和 `?`）
- `exclude` - 排除列表（可选）
- `description` - 规则描述

## 安全机制

### 1. 时间判断

只清理修改时间超过保留天数的文件/目录，确保不会误删正在使用的文件。

### 2. 模式匹配

通过精确的模式匹配，只清理符合规则的文件，避免误删。

### 3. 排除列表

支持排除特定文件，保护重要配置文件。

### 4. 试运行模式

提供试运行模式，可以在实际清理前预览将要删除的文件。

### 5. 错误处理

清理过程中的错误会被捕获并记录，不会中断整个清理流程。

## 收益

- ✅ **减少磁盘占用**：自动清理过期文件，释放磁盘空间
- ✅ **降低目录噪音**：保持项目目录整洁，便于管理
- ✅ **灵活配置**：支持自定义保留天数和清理计划
- ✅ **安全可靠**：多重保护机制，避免误删重要文件
- ✅ **透明可控**：详细的日志输出，支持试运行模式

## 注意事项

1. **首次启用**：建议先使用试运行模式（`AUTO_CLEANUP_DRY_RUN=true`）查看将要删除的文件
2. **保留天数**：根据实际需求调整保留天数，避免过早删除可能需要的文件
3. **清理时间**：建议在系统负载较低的时间执行清理（如凌晨）
4. **备份重要数据**：清理前确保重要数据已备份
5. **监控日志**：定期检查清理日志，确保清理正常执行

## 故障排查

### 清理未执行

检查：
- `AUTO_CLEANUP_ENABLED` 是否为 `true`
- Cron 表达式是否正确
- 服务是否正常运行

### 文件未被清理

检查：
- 文件是否超过保留天数
- 文件是否匹配清理规则的模式
- 文件是否在排除列表中

### 清理出错

查看日志中的错误信息：
- 权限问题：检查文件/目录权限
- 路径问题：检查路径是否存在
- 磁盘问题：检查磁盘空间和状态

## 相关文件

- `server/core/cleanup.js` - 清理核心模块
- `server/services/system/scheduler.js` - 调度器集成
- `.env.example` - 配置示例
- `docs/FEATURE_AUTO_CLEANUP.md` - 本文档

## API 参考

### runCleanup(baseDir, options)

执行清理任务。

**参数**：
- `baseDir` - 项目根目录路径
- `options.dryRun` - 是否试运行（可选，默认从配置读取）

**返回**：清理摘要对象

```javascript
{
  startedAt: "2026-04-01T03:00:00.000Z",
  completedAt: "2026-04-01T03:05:00.000Z",
  dryRun: false,
  results: [...],
  totalFilesRemoved: 23,
  totalDirsRemoved: 10,
  totalBytesFreed: 3168256000,
  totalErrors: 0
}
```

### getCleanupStats(baseDir)

获取清理统计信息（不执行清理）。

**参数**：
- `baseDir` - 项目根目录路径

**返回**：统计信息对象

```javascript
{
  rules: [...],
  totalExpiredFiles: 23,
  totalExpiredDirs: 10,
  totalExpiredBytes: 3168256000
}
```

### getCleanupConfig()

获取当前清理配置。

**返回**：配置对象

```javascript
{
  enabled: true,
  dryRun: false,
  schedule: "0 3 * * *",
  rules: {...}
}
```
