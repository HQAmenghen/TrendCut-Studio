# Bug 修复：自动清理规则误删 Pipeline 源码目录样例文件

## 问题描述

自动清理规则会误删 `python/pipeline` 里源码旁边的旧样例/产物文件，风险偏高。

## 根本原因

`server/core/cleanup.js` (line 30) 的 `pipelineArtifacts` 规则把整个 `python/pipeline` 目录下所有过期的 `*.mp4`、`*.json` 和 `subtitle_cards` 都当成"可删运行产物"。

但这个目录当前混放了：
- 脚本源码（.py 文件）
- 固定配置文件（audio.json, director.json, glossary.json）
- **样例文件**（aiman.mp4, material.mp4, result.json, subtitles.json, output_final.mp4 等）
- 临时产物目录（subtitle_cards）

这意味着定时清理不是只清 runtime 目录，而是会直接删源码目录里的老文件，后续排障、演示或回归都可能被误伤。

## 风险分析

### 高风险文件

以下文件可能被误删：
- `aiman.mp4` (4.3 MB) - 数字人样例视频
- `material.mp4` (5.3 MB) - 素材样例视频
- `result.json` - 结果样例
- `subtitles.json` - 字幕样例
- `output_final.mp4` (3.4 MB) - 最终产物样例
- `standalone_input.mp4` (5.1 MB) - 独立模式输入样例
- `standalone_output_vertical.mp4` (10.2 MB) - 独立模式输出样例
- `subtitle_cards/` - 字幕卡片目录

### 影响

- 演示和测试依赖的样例文件丢失
- 排障时无法参考历史产物
- 回归测试失败
- 开发体验下降

## 修复方案

### 方案 1：扩展排除列表（已实施）

在 `pipelineArtifacts` 规则中添加所有已知样例文件到排除列表：

```javascript
exclude: [
  // 配置文件
  'audio.json',
  'director.json',
  'glossary.json',
  // 样例文件和固定产物
  'aiman.mp4',
  'material.mp4',
  'result.json',
  'subtitles.json',
  'subtitles.srt',
  'output_final.mp4',
  'standalone_input.mp4',
  'standalone_output_vertical.mp4',
  'background_generated.png'
]
```

### 方案 2：默认禁用规则（已实施，推荐）

将 `pipelineArtifacts` 规则默认设置为 `enabled: false`，因为：
1. `python/pipeline` 是源码目录，不应该作为自动清理的目标
2. 真正的临时产物应该放在 `data/uploads/runtime_jobs/` 或其他专门的临时目录
3. 避免误删任何未来可能添加的样例文件

```javascript
pipelineArtifacts: {
  enabled: false, // 默认禁用，避免误删源码目录中的样例文件
  path: 'python/pipeline',
  retentionDays: 3,
  pattern: ['*.mp4', '*.json', 'subtitle_cards'],
  exclude: [...],
  description: 'Pipeline 临时产物（默认禁用）'
}
```

### 方案 3：支持环境变量覆盖启用状态（已实施）

允许通过环境变量覆盖规则的 `enabled` 状态：

```javascript
// 覆盖启用状态
const enabledEnvKey = `AUTO_CLEANUP_${key.toUpperCase()}_ENABLED`;
const enabledEnvValue = process.env[enabledEnvKey];
if (enabledEnvValue !== undefined) {
  rules[key].enabled = enabledEnvValue === 'true';
}
```

## 修复位置

**文件**: `server/core/cleanup.js`

### 修改 1: 扩展排除列表 (line 30-50)

```javascript
pipelineArtifacts: {
  enabled: false, // 默认禁用
  path: 'python/pipeline',
  retentionDays: 3,
  pattern: ['*.mp4', '*.json', 'subtitle_cards'],
  exclude: [
    // 配置文件
    'audio.json',
    'director.json',
    'glossary.json',
    // 样例文件和固定产物
    'aiman.mp4',
    'material.mp4',
    'result.json',
    'subtitles.json',
    'subtitles.srt',
    'output_final.mp4',
    'standalone_input.mp4',
    'standalone_output_vertical.mp4',
    'background_generated.png'
  ],
  description: 'Pipeline 临时产物（默认禁用）'
}
```

### 修改 2: 支持环境变量覆盖启用状态 (line 82-97)

```javascript
// 允许通过环境变量覆盖保留天数和启用状态
const rules = { ...DEFAULT_CLEANUP_RULES };
Object.keys(rules).forEach(key => {
  // 覆盖保留天数
  const retentionEnvKey = `AUTO_CLEANUP_${key.toUpperCase()}_RETENTION_DAYS`;
  const retentionEnvValue = process.env[retentionEnvKey];
  if (retentionEnvValue && !isNaN(parseInt(retentionEnvValue, 10))) {
    rules[key].retentionDays = parseInt(retentionEnvValue, 10);
  }

  // 覆盖启用状态
  const enabledEnvKey = `AUTO_CLEANUP_${key.toUpperCase()}_ENABLED`;
  const enabledEnvValue = process.env[enabledEnvKey];
  if (enabledEnvValue !== undefined) {
    rules[key].enabled = enabledEnvValue === 'true';
  }
});
```

## 配置说明

### 默认行为（推荐）

Pipeline 清理规则默认禁用，不会清理任何文件。

### 启用 Pipeline 清理（如果确实需要）

在 `.env` 文件中添加：

```bash
AUTO_CLEANUP_PIPELINEARTIFACTS_ENABLED=true
```

**注意**: 启用后，只会清理超过 3 天的文件，且排除列表中的文件会被保护。

### 调整保留天数

```bash
AUTO_CLEANUP_PIPELINEARTIFACTS_RETENTION_DAYS=7
```

## 测试验证

### 测试 1: 验证默认禁用

```bash
node -e "
const { getCleanupConfig } = require('./server/core/cleanup.js');
const config = getCleanupConfig();
console.log('Pipeline 规则启用状态:', config.rules.pipelineArtifacts.enabled);
"
```

**结果**: `false`

### 测试 2: 验证环境变量覆盖

```bash
AUTO_CLEANUP_PIPELINEARTIFACTS_ENABLED=true node -e "
const { getCleanupConfig } = require('./server/core/cleanup.js');
const config = getCleanupConfig();
console.log('Pipeline 规则启用状态:', config.rules.pipelineArtifacts.enabled);
"
```

**结果**: `true`

### 测试 3: 验证排除列表

```bash
node -e "
const { getCleanupConfig } = require('./server/core/cleanup.js');
const config = getCleanupConfig();
console.log('排除列表:');
config.rules.pipelineArtifacts.exclude.forEach(file => {
  console.log('  -', file);
});
"
```

**结果**: 显示所有被保护的样例文件

## 影响范围

- ✅ 修复了 Pipeline 清理规则误删样例文件的问题
- ✅ 默认禁用 Pipeline 清理，降低风险
- ✅ 支持环境变量灵活控制
- ✅ 不影响其他清理规则

## 建议

### 短期

1. **保持默认禁用**: 不要启用 Pipeline 清理规则
2. **手动清理**: 如需清理 Pipeline 临时文件，手动删除
3. **监控磁盘**: 定期检查 Pipeline 目录大小

### 长期

1. **分离目录**: 将临时产物移到专门的临时目录（如 `data/uploads/pipeline_temp/`）
2. **规范命名**: 临时文件使用特定前缀或后缀（如 `temp_*.mp4`）
3. **清理脚本**: 创建专门的 Pipeline 清理脚本，只清理明确的临时文件

## 相关文件

- `server/core/cleanup.js` - 清理核心模块
- `.env.example` - 配置示例
- `docs/FEATURE_AUTO_CLEANUP.md` - 自动清理功能文档
- `docs/BUGFIX_PIPELINE_CLEANUP.md` - 本文档

## 总结

修复后，Pipeline 清理规则：
- ✅ 默认禁用，避免误删
- ✅ 排除列表保护已知样例文件
- ✅ 支持环境变量灵活控制
- ✅ 降低了误删风险

**关键改进**:
- 从"默认启用，可能误删"变为"默认禁用，需要显式启用"
- 从"只排除配置文件"变为"排除所有已知样例文件"
- 从"只能覆盖保留天数"变为"可以覆盖启用状态和保留天数"
