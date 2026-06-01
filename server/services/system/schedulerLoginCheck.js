const path = require('path');

function registerLoginCheckScheduler({
  cron,
  loginStatusService,
  cronExpression,
  timeZone,
  readLoginCheckScheduleConfig,
  isLoginCheckDue,
  logInfo,
  logWarn,
  logError
}) {
  if (!loginStatusService) {
    return;
  }

  const schedulerBaseDir = path.join(__dirname, '../../..');
  const initialLoginCheckConfig = readLoginCheckScheduleConfig(schedulerBaseDir);
  const loginCheckState = {
    lastStartedAt: Date.now(),
    running: false
  };

  logInfo('[Scheduler] 启动登录状态定时检测', {
    interval: `${initialLoginCheckConfig.checkInterval} 分钟`,
    cronExpression,
    scheduleMode: 'elapsed_interval_gate',
    enabled: initialLoginCheckConfig.loginCheckEnabled
  });

  cron.schedule(cronExpression, async () => {
    const { checkInterval, loginCheckEnabled } = readLoginCheckScheduleConfig(schedulerBaseDir);
    if (!loginCheckEnabled) {
      return;
    }

    if (loginCheckState.running) {
      logWarn('[Scheduler -> 登录检测] 上一次检测尚未结束，跳过本轮');
      return;
    }

    const nowMs = Date.now();
    if (!isLoginCheckDue(loginCheckState, nowMs, checkInterval)) {
      return;
    }

    loginCheckState.lastStartedAt = nowMs;
    loginCheckState.running = true;

    try {
      logInfo('[Scheduler -> 登录检测] 开始定时检测登录状态', {
        interval: `${checkInterval} 分钟`
      });
      const summary = await loginStatusService.checkAllAccounts({ notifyFeishu: false });

      logInfo('[Scheduler -> 登录检测] 检测完成', {
        checked: summary.checked,
        logged_in: summary.logged_in,
        need_login: summary.need_login,
        error: summary.error
      });
    } catch (err) {
      logError('[Scheduler -> 登录检测] 定时检测失败', err);
    } finally {
      loginCheckState.running = false;
    }
  }, {
    timezone: timeZone
  });
}

module.exports = {
  registerLoginCheckScheduler
};
