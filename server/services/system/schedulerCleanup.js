const path = require('path');

const { runCleanup, getCleanupConfig } = require('../../core/cleanup');

function registerCleanupScheduler({
  cron,
  taskStore,
  verticalQueueService,
  timeZone,
  logInfo,
  logWarn,
  logError
}) {
  const cleanupConfig = getCleanupConfig();
  if (!cleanupConfig.enabled) {
    logInfo('[Scheduler] 运行产物自动清理已禁用');
    return;
  }

  const baseDir = path.join(__dirname, '../../..');

  logInfo('[Scheduler] 启动运行产物自动清理', {
    schedule: cleanupConfig.schedule,
    dryRun: cleanupConfig.dryRun,
    rules: Object.keys(cleanupConfig.rules).filter(k => cleanupConfig.rules[k].enabled)
  });

  cron.schedule(cleanupConfig.schedule, () => {
    logInfo('[Scheduler -> 清理] 开始执行定时清理任务');

    try {
      const summary = runCleanup(baseDir, {
        dryRun: cleanupConfig.dryRun,
        taskStore,
        verticalQueueService
      });

      logInfo('[Scheduler -> 清理] 清理任务完成', {
        filesRemoved: summary.totalFilesRemoved,
        dirsRemoved: summary.totalDirsRemoved,
        taskRecordsRemoved: summary.totalTaskRecordsRemoved,
        bytesFreed: summary.totalBytesFreed,
        errors: summary.totalErrors,
        dryRun: summary.dryRun
      });

      if (summary.totalErrors > 0) {
        summary.results.forEach(result => {
          if (result.errors.length > 0) {
            logWarn('[Scheduler -> 清理] 清理规则执行出错', {
              rule: result.rule,
              errors: result.errors
            });
          }
        });
      }
    } catch (err) {
      logError('[Scheduler -> 清理] 清理任务失败', err);
    }
  }, {
    timezone: timeZone
  });
}

module.exports = {
  registerCleanupScheduler
};
