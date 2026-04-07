/**
 * 运行产物清理模块
 *
 * 提供自动清理旧运行产物的功能，减少磁盘占用和目录噪音。
 */

const fs = require('fs');
const path = require('path');

/**
 * 清理规则配置
 */
const DEFAULT_CLEANUP_RULES = {
  // 竖屏队列产物（public/xai_vertical_queue/）
  verticalQueue: {
    enabled: true,
    path: 'public/xai_vertical_queue',
    retentionDays: 7,
    pattern: '*',
    description: '竖屏队列渲染产物'
  },
  // 竖屏队列上传目录（data/uploads/xai_vertical_queue/）
  verticalQueueUploads: {
    enabled: true,
    path: 'data/uploads/xai_vertical_queue',
    retentionDays: 7,
    pattern: '*',
    description: '竖屏队列上传文件'
  },
  // Pipeline 临时文件（python/pipeline/*.mp4, *.json）
  // 注意：此规则默认禁用，因为 python/pipeline 是源码目录，混放了样例文件
  // 如需启用，请确保只清理明确的临时文件，避免误删样例和固定产物
  pipelineArtifacts: {
    enabled: false, // 默认禁用，避免误删源码目录中的样例文件
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
  },
  // 日志文件（data/logs/*.log）
  logs: {
    enabled: true,
    path: 'data/logs',
    retentionDays: 30,
    pattern: '*.log',
    description: '系统日志文件'
  },
  // 运行时任务目录（data/uploads/runtime_jobs/）
  runtimeJobs: {
    enabled: true,
    path: 'data/uploads/runtime_jobs',
    retentionDays: 7,
    pattern: '*',
    description: '运行时任务文件'
  }
};

/**
 * 获取清理配置
 */
function getCleanupConfig() {
  const enabled = process.env.AUTO_CLEANUP_ENABLED !== 'false';
  const dryRun = process.env.AUTO_CLEANUP_DRY_RUN === 'true';
  const schedule = process.env.AUTO_CLEANUP_SCHEDULE || '0 3 * * *'; // 默认每天凌晨3点

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

  return {
    enabled,
    dryRun,
    schedule,
    rules
  };
}

/**
 * 检查文件/目录是否过期
 */
function isExpired(filePath, retentionDays) {
  try {
    const stats = fs.statSync(filePath);
    const ageMs = Date.now() - stats.mtime.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays > retentionDays;
  } catch (err) {
    return false;
  }
}

/**
 * 检查路径是否匹配模式
 */
function matchesPattern(fileName, pattern) {
  if (Array.isArray(pattern)) {
    return pattern.some(p => matchesPattern(fileName, p));
  }

  if (pattern === '*') {
    return true;
  }

  // 简单的通配符匹配
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return regex.test(fileName);
}

/**
 * 检查是否在排除列表中
 */
function isExcluded(fileName, excludeList) {
  if (!excludeList || !Array.isArray(excludeList)) {
    return false;
  }
  return excludeList.some(pattern => matchesPattern(fileName, pattern));
}

/**
 * 递归删除目录
 */
function removeDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return;
  }

  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      removeDirectory(filePath);
    } else {
      fs.unlinkSync(filePath);
    }
  }

  fs.rmdirSync(dirPath);
}

/**
 * 清理单个规则
 */
function cleanupRule(baseDir, rule, dryRun = false) {
  const result = {
    rule: rule.description,
    path: rule.path,
    filesRemoved: 0,
    dirsRemoved: 0,
    bytesFreed: 0,
    errors: []
  };

  const targetPath = path.join(baseDir, rule.path);

  if (!fs.existsSync(targetPath)) {
    return result;
  }

  try {
    const items = fs.readdirSync(targetPath);

    for (const item of items) {
      const itemPath = path.join(targetPath, item);

      // 检查是否在排除列表中
      if (isExcluded(item, rule.exclude)) {
        continue;
      }

      // 检查是否匹配模式
      if (!matchesPattern(item, rule.pattern)) {
        continue;
      }

      // 检查是否过期
      if (!isExpired(itemPath, rule.retentionDays)) {
        continue;
      }

      try {
        const stats = fs.statSync(itemPath);
        const size = stats.isDirectory() ? getDirectorySize(itemPath) : stats.size;

        if (dryRun) {
          console.log(`[DRY RUN] Would remove: ${itemPath} (${formatBytes(size)})`);
        } else {
          if (stats.isDirectory()) {
            removeDirectory(itemPath);
            result.dirsRemoved++;
          } else {
            fs.unlinkSync(itemPath);
            result.filesRemoved++;
          }
        }

        result.bytesFreed += size;
      } catch (err) {
        result.errors.push({
          path: itemPath,
          error: err.message
        });
      }
    }
  } catch (err) {
    result.errors.push({
      path: targetPath,
      error: err.message
    });
  }

  return result;
}

/**
 * 获取目录大小
 */
function getDirectorySize(dirPath) {
  let totalSize = 0;

  try {
    const items = fs.readdirSync(dirPath);

    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);

      if (stats.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (err) {
    // 忽略错误
  }

  return totalSize;
}

/**
 * 格式化字节数
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 执行清理
 */
function runCleanup(baseDir, options = {}) {
  const config = getCleanupConfig();
  const dryRun = options.dryRun !== undefined ? options.dryRun : config.dryRun;

  const summary = {
    startedAt: new Date().toISOString(),
    dryRun,
    results: [],
    totalFilesRemoved: 0,
    totalDirsRemoved: 0,
    totalBytesFreed: 0,
    totalErrors: 0
  };

  console.log(`[Cleanup] 开始清理运行产物 (${dryRun ? 'DRY RUN' : 'LIVE'})`);

  for (const [key, rule] of Object.entries(config.rules)) {
    if (!rule.enabled) {
      continue;
    }

    console.log(`[Cleanup] 清理规则: ${rule.description} (保留 ${rule.retentionDays} 天)`);

    const result = cleanupRule(baseDir, rule, dryRun);
    summary.results.push(result);

    summary.totalFilesRemoved += result.filesRemoved;
    summary.totalDirsRemoved += result.dirsRemoved;
    summary.totalBytesFreed += result.bytesFreed;
    summary.totalErrors += result.errors.length;

    if (result.filesRemoved > 0 || result.dirsRemoved > 0) {
      console.log(`[Cleanup]   已清理: ${result.filesRemoved} 文件, ${result.dirsRemoved} 目录, ${formatBytes(result.bytesFreed)}`);
    }

    if (result.errors.length > 0) {
      console.log(`[Cleanup]   错误: ${result.errors.length} 个`);
      result.errors.forEach(err => {
        console.log(`[Cleanup]     - ${err.path}: ${err.error}`);
      });
    }
  }

  summary.completedAt = new Date().toISOString();

  console.log(`[Cleanup] 清理完成:`);
  console.log(`[Cleanup]   文件: ${summary.totalFilesRemoved}`);
  console.log(`[Cleanup]   目录: ${summary.totalDirsRemoved}`);
  console.log(`[Cleanup]   释放空间: ${formatBytes(summary.totalBytesFreed)}`);
  console.log(`[Cleanup]   错误: ${summary.totalErrors}`);

  return summary;
}

/**
 * 获取清理统计信息（不执行清理）
 */
function getCleanupStats(baseDir) {
  const config = getCleanupConfig();
  const stats = {
    rules: [],
    totalExpiredFiles: 0,
    totalExpiredDirs: 0,
    totalExpiredBytes: 0
  };

  for (const [key, rule] of Object.entries(config.rules)) {
    if (!rule.enabled) {
      continue;
    }

    const ruleStats = {
      name: rule.description,
      path: rule.path,
      retentionDays: rule.retentionDays,
      expiredFiles: 0,
      expiredDirs: 0,
      expiredBytes: 0
    };

    const targetPath = path.join(baseDir, rule.path);

    if (fs.existsSync(targetPath)) {
      try {
        const items = fs.readdirSync(targetPath);

        for (const item of items) {
          const itemPath = path.join(targetPath, item);

          if (isExcluded(item, rule.exclude)) {
            continue;
          }

          if (!matchesPattern(item, rule.pattern)) {
            continue;
          }

          if (isExpired(itemPath, rule.retentionDays)) {
            try {
              const stats = fs.statSync(itemPath);
              const size = stats.isDirectory() ? getDirectorySize(itemPath) : stats.size;

              if (stats.isDirectory()) {
                ruleStats.expiredDirs++;
              } else {
                ruleStats.expiredFiles++;
              }

              ruleStats.expiredBytes += size;
            } catch (err) {
              // 忽略错误
            }
          }
        }
      } catch (err) {
        // 忽略错误
      }
    }

    stats.rules.push(ruleStats);
    stats.totalExpiredFiles += ruleStats.expiredFiles;
    stats.totalExpiredDirs += ruleStats.expiredDirs;
    stats.totalExpiredBytes += ruleStats.expiredBytes;
  }

  return stats;
}

module.exports = {
  getCleanupConfig,
  runCleanup,
  getCleanupStats,
  formatBytes,
  DEFAULT_CLEANUP_RULES
};
