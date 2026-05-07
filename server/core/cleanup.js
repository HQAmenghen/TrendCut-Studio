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

const DEFAULT_TASK_CLEANUP_CONFIG = {
  enabled: true,
  retentionDays: 7,
  invalidGraceHours: 24,
  scanLimit: 5000,
  materialDriven: {
    enabled: true,
    projectsPath: 'projects'
  },
  verticalQueue: {
    enabled: true,
    uploadPath: 'data/uploads/xai_vertical_queue',
    publicPath: 'public/xai_vertical_queue'
  }
};

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted'
]);

const TASK_AWARE_VERTICAL_RULES = new Set([
  'verticalQueue',
  'verticalQueueUploads'
]);

function parseNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function cloneRule(rule) {
  return {
    ...rule,
    pattern: Array.isArray(rule.pattern) ? [...rule.pattern] : rule.pattern,
    exclude: Array.isArray(rule.exclude) ? [...rule.exclude] : rule.exclude
  };
}

/**
 * 获取清理配置
 */
function getCleanupConfig() {
  const enabled = process.env.AUTO_CLEANUP_ENABLED !== 'false';
  const dryRun = process.env.AUTO_CLEANUP_DRY_RUN === 'true';
  const schedule = process.env.AUTO_CLEANUP_SCHEDULE || '0 3 * * *'; // 默认每天凌晨3点

  // 允许通过环境变量覆盖保留天数和启用状态
  const rules = Object.fromEntries(
    Object.entries(DEFAULT_CLEANUP_RULES).map(([key, rule]) => [key, cloneRule(rule)])
  );
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
    rules,
    taskWorkspaces: getTaskCleanupConfig()
  };
}

function getTaskCleanupConfig() {
  return {
    enabled: process.env.AUTO_CLEANUP_TASK_WORKSPACES_ENABLED !== 'false',
    retentionDays: parseNonNegativeNumber(
      process.env.AUTO_CLEANUP_TASK_RETENTION_DAYS,
      DEFAULT_TASK_CLEANUP_CONFIG.retentionDays
    ),
    invalidGraceHours: parseNonNegativeNumber(
      process.env.AUTO_CLEANUP_INVALID_TASK_GRACE_HOURS,
      DEFAULT_TASK_CLEANUP_CONFIG.invalidGraceHours
    ),
    scanLimit: Math.max(1, Math.floor(parseNonNegativeNumber(
      process.env.AUTO_CLEANUP_TASK_SCAN_LIMIT,
      DEFAULT_TASK_CLEANUP_CONFIG.scanLimit
    ))),
    materialDriven: {
      ...DEFAULT_TASK_CLEANUP_CONFIG.materialDriven,
      enabled: process.env.AUTO_CLEANUP_MATERIAL_TASKS_ENABLED !== 'false'
    },
    verticalQueue: {
      ...DEFAULT_TASK_CLEANUP_CONFIG.verticalQueue,
      enabled: process.env.AUTO_CLEANUP_VERTICAL_TASKS_ENABLED !== 'false'
    }
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

function isUsableFile(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch (_err) {
    return false;
  }
}

function getNewestMtimeMs(targetPath) {
  try {
    if (!targetPath || !fs.existsSync(targetPath)) {
      return 0;
    }

    const stats = fs.statSync(targetPath);
    let newest = stats.mtime.getTime();
    if (!stats.isDirectory()) {
      return newest;
    }

    for (const item of fs.readdirSync(targetPath)) {
      newest = Math.max(newest, getNewestMtimeMs(path.join(targetPath, item)));
    }
    return newest;
  } catch (_err) {
    return 0;
  }
}

function dateToMs(value) {
  const timestamp = new Date(value || '').getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getAgeHours(nowMs, timestampMs) {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    return 0;
  }
  return Math.max(0, (nowMs - timestampMs) / (1000 * 60 * 60));
}

function listChildDirectories(rootPath) {
  try {
    if (!fs.existsSync(rootPath)) return [];
    return fs.readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (_err) {
    return [];
  }
}

function resolveSafeChild(rootPath, childName) {
  const name = String(childName || '').trim();
  if (!name || name !== path.basename(name)) {
    return null;
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

function createTaskCleanupSummary(config) {
  return {
    startedAt: new Date().toISOString(),
    dryRun: Boolean(config.dryRun),
    retentionDays: config.retentionDays,
    invalidGraceHours: config.invalidGraceHours,
    materialDriven: {
      scanned: 0,
      dirsRemoved: 0,
      bytesFreed: 0,
      removed: [],
      errors: []
    },
    verticalQueue: {
      scanned: 0,
      dirsRemoved: 0,
      taskRecordsRemoved: 0,
      bytesFreed: 0,
      removed: [],
      errors: []
    },
    totalDirsRemoved: 0,
    totalTaskRecordsRemoved: 0,
    totalBytesFreed: 0,
    totalErrors: 0
  };
}

function recordDirRemoval(summary, sectionName, dirPath, item) {
  const section = summary[sectionName];
  if (!dirPath || !fs.existsSync(dirPath)) {
    return;
  }

  try {
    const bytesFreed = getDirectorySize(dirPath);
    if (!summary.dryRun) {
      removeDirectory(dirPath);
    }
    section.dirsRemoved += 1;
    section.bytesFreed += bytesFreed;
    section.removed.push({
      ...item,
      path: dirPath,
      bytesFreed
    });
    summary.totalDirsRemoved += 1;
    summary.totalBytesFreed += bytesFreed;
  } catch (err) {
    section.errors.push({
      path: dirPath,
      error: err.message
    });
    summary.totalErrors += 1;
  }
}

function cleanupMaterialDrivenWorkspaces(baseDir, config, summary) {
  if (!config.materialDriven?.enabled) {
    return;
  }

  const projectsDir = path.join(baseDir, config.materialDriven.projectsPath || 'projects');
  for (const taskDir of listChildDirectories(projectsDir)) {
    if (!/^material_[A-Za-z0-9_.-]+$/.test(taskDir)) {
      continue;
    }

    const taskPath = resolveSafeChild(projectsDir, taskDir);
    if (!taskPath) {
      continue;
    }

    summary.materialDriven.scanned += 1;
    const ageHours = getAgeHours(config.nowMs, getNewestMtimeMs(taskPath));
    const isStale = ageHours / 24 > config.retentionDays;
    const isInvalid = !isUsableFile(path.join(taskPath, 'output_final.mp4')) && ageHours > config.invalidGraceHours;
    const reason = isStale ? 'stale' : (isInvalid ? 'invalid' : '');
    if (!reason) {
      continue;
    }

    recordDirRemoval(summary, 'materialDriven', taskPath, {
      id: taskDir,
      reason
    });
  }
}

function listTaskStoreVerticalTasks(taskStore, scanLimit) {
  if (!taskStore) {
    return [];
  }
  if (taskStore.db && typeof taskStore.db.prepare === 'function') {
    const rows = taskStore.db.prepare(`
      SELECT * FROM tasks
      WHERE type = ?
      ORDER BY updatedAt ASC
      LIMIT ?
    `).all('vertical_queue', scanLimit);
    return rows.map((row) => ({
      ...row,
      logs: JSON.parse(row.logs || '[]'),
      metadata: JSON.parse(row.metadata || '{}')
    }));
  }
  if (typeof taskStore.listTasks !== 'function') {
    return [];
  }
  return taskStore.listTasks('vertical_queue', scanLimit);
}

function addVerticalCandidate(candidates, id, patch = {}) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    return;
  }
  const current = candidates.get(normalizedId) || { id: normalizedId };
  candidates.set(normalizedId, { ...current, ...patch });
}

function isActiveMemoryJob(verticalQueueService, jobId) {
  if (!verticalQueueService || typeof verticalQueueService.getJob !== 'function') {
    return false;
  }
  try {
    const job = verticalQueueService.getJob(jobId);
    return Boolean(job && !TERMINAL_TASK_STATUSES.has(String(job.status || '')));
  } catch (_err) {
    return false;
  }
}

function maxPastTimestampMs(nowMs, values) {
  return values
    .filter((value) => Number.isFinite(value) && value > 0 && value <= nowMs)
    .reduce((max, value) => Math.max(max, value), 0);
}

function getVerticalCandidateMtimeMs(candidate, nowMs) {
  const task = candidate.task || {};
  return maxPastTimestampMs(nowMs, [
    dateToMs(task.completedAt),
    dateToMs(task.updatedAt),
    dateToMs(task.createdAt),
    getNewestMtimeMs(candidate.uploadDir),
    getNewestMtimeMs(candidate.publicDir)
  ]);
}

function cleanupVerticalQueueWorkspaces(baseDir, config, summary) {
  if (!config.verticalQueue?.enabled) {
    return;
  }

  const uploadRoot = path.join(baseDir, config.verticalQueue.uploadPath || 'data/uploads/xai_vertical_queue');
  const publicRoot = path.join(baseDir, config.verticalQueue.publicPath || 'public/xai_vertical_queue');
  const candidates = new Map();

  try {
    for (const task of listTaskStoreVerticalTasks(config.taskStore, config.scanLimit)) {
      addVerticalCandidate(candidates, task.id, { task });
    }
  } catch (err) {
    summary.verticalQueue.errors.push({
      path: 'taskStore',
      error: err.message
    });
    summary.totalErrors += 1;
  }

  for (const dirName of listChildDirectories(uploadRoot)) {
    const uploadDir = resolveSafeChild(uploadRoot, dirName);
    addVerticalCandidate(candidates, dirName, { uploadDir });
  }
  for (const dirName of listChildDirectories(publicRoot)) {
    const publicDir = resolveSafeChild(publicRoot, dirName);
    addVerticalCandidate(candidates, dirName, { publicDir });
  }

  for (const candidate of candidates.values()) {
    const uploadDir = candidate.uploadDir || resolveSafeChild(uploadRoot, candidate.id);
    const publicDir = candidate.publicDir || resolveSafeChild(publicRoot, candidate.id);
    if (!uploadDir && !publicDir) {
      continue;
    }

    summary.verticalQueue.scanned += 1;
    if (isActiveMemoryJob(config.verticalQueueService, candidate.id)) {
      continue;
    }

    const status = String(candidate.task?.status || '').trim();
    const terminalOrOrphan = !candidate.task || TERMINAL_TASK_STATUSES.has(status);
    const hasPublicOutput = publicDir ? isUsableFile(path.join(publicDir, 'vertical_output.mp4')) : false;
    const ageHours = getAgeHours(config.nowMs, getVerticalCandidateMtimeMs({
      ...candidate,
      uploadDir,
      publicDir
    }, config.nowMs));
    const isStale = ageHours / 24 > config.retentionDays;
    const isInvalid = !hasPublicOutput && terminalOrOrphan && ageHours > config.invalidGraceHours;
    const reason = isStale ? 'stale' : (isInvalid ? 'invalid' : '');
    if (!reason) {
      continue;
    }

    recordDirRemoval(summary, 'verticalQueue', uploadDir, {
      id: candidate.id,
      reason,
      area: 'upload'
    });
    recordDirRemoval(summary, 'verticalQueue', publicDir, {
      id: candidate.id,
      reason,
      area: 'public'
    });

    if (candidate.task && config.taskStore && typeof config.taskStore.deleteTask === 'function') {
      summary.verticalQueue.taskRecordsRemoved += 1;
      summary.totalTaskRecordsRemoved += 1;
      if (!summary.dryRun) {
        try {
          config.taskStore.deleteTask(candidate.id);
        } catch (err) {
          summary.verticalQueue.errors.push({
            path: `taskStore:${candidate.id}`,
            error: err.message
          });
          summary.totalErrors += 1;
        }
      }
    }
  }
}

function cleanupTaskWorkspaces(baseDir, options = {}) {
  const defaults = getTaskCleanupConfig();
  const now = options.now ? new Date(options.now) : new Date();
  const config = {
    ...defaults,
    ...options,
    retentionDays: parseNonNegativeNumber(options.retentionDays, defaults.retentionDays),
    invalidGraceHours: parseNonNegativeNumber(options.invalidGraceHours, defaults.invalidGraceHours),
    scanLimit: Math.max(1, Math.floor(parseNonNegativeNumber(options.scanLimit, defaults.scanLimit))),
    dryRun: Boolean(options.dryRun),
    nowMs: Number.isFinite(now.getTime()) ? now.getTime() : Date.now(),
    materialDriven: {
      ...defaults.materialDriven,
      ...(options.materialDriven || {})
    },
    verticalQueue: {
      ...defaults.verticalQueue,
      ...(options.verticalQueue || {})
    }
  };
  const summary = createTaskCleanupSummary(config);

  cleanupMaterialDrivenWorkspaces(baseDir, config, summary);
  cleanupVerticalQueueWorkspaces(baseDir, config, summary);

  summary.completedAt = new Date().toISOString();
  return summary;
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
  const taskCleanupConfig = {
    ...config.taskWorkspaces,
    taskStore: options.taskStore,
    verticalQueueService: options.verticalQueueService
  };

  const summary = {
    startedAt: new Date().toISOString(),
    dryRun,
    results: [],
    totalFilesRemoved: 0,
    totalDirsRemoved: 0,
    totalTaskRecordsRemoved: 0,
    totalBytesFreed: 0,
    totalErrors: 0
  };

  console.log(`[Cleanup] 开始清理运行产物 (${dryRun ? 'DRY RUN' : 'LIVE'})`);

  for (const [key, rule] of Object.entries(config.rules)) {
    if (!rule.enabled) {
      continue;
    }
    if (taskCleanupConfig.enabled && TASK_AWARE_VERTICAL_RULES.has(key)) {
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

  if (taskCleanupConfig.enabled) {
    console.log(
      `[Cleanup] 清理规则: AI剪辑/竖屏任务工作区 (保留 ${taskCleanupConfig.retentionDays} 天, 残缺宽限 ${taskCleanupConfig.invalidGraceHours} 小时)`
    );
    const taskSummary = cleanupTaskWorkspaces(baseDir, {
      ...taskCleanupConfig,
      dryRun
    });
    summary.taskWorkspaces = taskSummary;
    summary.results.push({
      rule: 'AI剪辑/竖屏任务工作区',
      path: 'projects/material_* + xai_vertical_queue',
      filesRemoved: 0,
      dirsRemoved: taskSummary.totalDirsRemoved,
      taskRecordsRemoved: taskSummary.totalTaskRecordsRemoved,
      bytesFreed: taskSummary.totalBytesFreed,
      errors: [
        ...taskSummary.materialDriven.errors,
        ...taskSummary.verticalQueue.errors
      ]
    });
    summary.totalDirsRemoved += taskSummary.totalDirsRemoved;
    summary.totalTaskRecordsRemoved += taskSummary.totalTaskRecordsRemoved;
    summary.totalBytesFreed += taskSummary.totalBytesFreed;
    summary.totalErrors += taskSummary.totalErrors;

    if (taskSummary.totalDirsRemoved > 0 || taskSummary.totalTaskRecordsRemoved > 0) {
      console.log(
        `[Cleanup]   已清理任务工作区: ${taskSummary.totalDirsRemoved} 目录, ${taskSummary.totalTaskRecordsRemoved} 记录, ${formatBytes(taskSummary.totalBytesFreed)}`
      );
    }
  }

  summary.completedAt = new Date().toISOString();

  console.log('[Cleanup] 清理完成:');
  console.log(`[Cleanup]   文件: ${summary.totalFilesRemoved}`);
  console.log(`[Cleanup]   目录: ${summary.totalDirsRemoved}`);
  console.log(`[Cleanup]   任务记录: ${summary.totalTaskRecordsRemoved}`);
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

  for (const rule of Object.values(config.rules)) {
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
  getTaskCleanupConfig,
  runCleanup,
  cleanupTaskWorkspaces,
  getCleanupStats,
  formatBytes,
  DEFAULT_CLEANUP_RULES,
  DEFAULT_TASK_CLEANUP_CONFIG
};
