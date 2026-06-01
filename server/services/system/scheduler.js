const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { readProjectEnv } = require('../../../scripts/utils/env');
const { registerCleanupScheduler } = require('./schedulerCleanup');
const { registerLoginCheckScheduler } = require('./schedulerLoginCheck');
const { createPublishScheduler } = require('./schedulerPublish');
const { createAutoPilotScheduler } = require('./schedulerAutoPilot');
const {
  buildLoginCheckScheduleConfig,
  formatJobBrief,
  isLoginCheckDue
} = require('./schedulerUtils');

const SCHEDULER_TIME_ZONE = 'Asia/Shanghai';
const SCHEDULER_LOG_PATH = path.join(__dirname, '../../../data/logs/scheduler.log');
const LOGIN_CHECK_CRON_EXPRESSION = '* * * * *';

function readLoginCheckScheduleConfig(baseDir) {
  const { values } = readProjectEnv(baseDir);
  return buildLoginCheckScheduleConfig(values);
}

function ensureSchedulerLogDir() {
  fs.mkdirSync(path.dirname(SCHEDULER_LOG_PATH), { recursive: true });
}

function appendSchedulerLog(level, message, extra = null) {
  try {
    ensureSchedulerLogDir();
    const line = [
      `[${new Date().toISOString()}]`,
      `[${level}]`,
      message,
      extra ? JSON.stringify(extra, null, 0) : ''
    ].filter(Boolean).join(' ');
    fs.appendFileSync(SCHEDULER_LOG_PATH, `${line}\n`, 'utf8');
  } catch (_err) {}
}

function logInfo(message, extra = null) {
  console.log(message, extra || '');
  appendSchedulerLog('INFO', message, extra);
}

function logWarn(message, extra = null) {
  console.warn(message, extra || '');
  appendSchedulerLog('WARN', message, extra);
}

function logError(message, error = null, extra = null) {
  const payload = {
    ...(extra || {}),
    ...(error ? { error: error.message || String(error) } : {})
  };
  console.error(message, payload);
  appendSchedulerLog('ERROR', message, payload);
}

function startScheduler({ publishStore, wechatRpaService, xaiService, verticalQueueService, taskStore, generatePublishDescription, publishAssetsService, loginStatusService, materialDrivenStarter }) {
  logInfo('[Scheduler] 初始化定时调度引擎 - node-cron', {
    timeZone: SCHEDULER_TIME_ZONE,
    logPath: SCHEDULER_LOG_PATH
  });

  const publishScheduler = createPublishScheduler({
    cron,
    publishStore,
    wechatRpaService,
    formatJobBrief,
    logInfo,
    logWarn,
    logError
  });

  const autoPilotScheduler = createAutoPilotScheduler({
    cron,
    publishStore,
    xaiService,
    verticalQueueService,
    taskStore,
    generatePublishDescription,
    publishAssetsService,
    materialDrivenStarter,
    publishScheduler,
    logInfo,
    logWarn,
    logError
  });

  publishScheduler.registerArchiveJob();
  registerCleanupScheduler({
    cron,
    taskStore,
    verticalQueueService,
    timeZone: SCHEDULER_TIME_ZONE,
    logInfo,
    logWarn,
    logError
  });
  registerLoginCheckScheduler({
    cron,
    loginStatusService,
    cronExpression: LOGIN_CHECK_CRON_EXPRESSION,
    timeZone: SCHEDULER_TIME_ZONE,
    readLoginCheckScheduleConfig,
    isLoginCheckDue,
    logInfo,
    logWarn,
    logError
  });

  return {
    recoverAutoPilotVerticalJobs: autoPilotScheduler.recoverAutoPilotVerticalJobs,
    triggerAutoPilotNow: autoPilotScheduler.triggerAutoPilotNow
  };
}

module.exports = {
  startScheduler
};
