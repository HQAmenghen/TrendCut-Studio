/**
 * 账号看板服务
 *
 * 提供账号维度的统计和管理功能
 */

function createAccountDashboardService(deps) {
  const {
    readPublishConfig,
    readPublishJobs,
    loginStatusService,
    getSauPlatformAccounts,
    checkPlatformLoginStatus
  } = deps;

  const platformLabels = {
    wechatChannels: '微信视频号',
    douyin: '抖音',
    xiaohongshu: '小红书'
  };

  function getAccountKey(platformKey, accountId) {
    return `${platformKey}:${accountId}`;
  }

  function getTaskAccountValue(task) {
    return String(task?.accountId || task?.sauAccountName || '').trim();
  }

  function matchesAccountTask(task, platformKey, account) {
    if (!task || task.platform !== platformKey) return false;
    const accountId = String(account?.id || '').trim();
    if (String(task.accountId || '').trim() === accountId) return true;
    if (platformKey === 'wechatChannels') return false;
    const taskAccount = getTaskAccountValue(task);
    return [
      accountId,
      String(account?.sauAccountName || '').trim(),
      String(account?.accountId || '').trim(),
      String(account?.openId || '').trim(),
      String(account?.displayName || '').trim()
    ].filter(Boolean).includes(taskAccount);
  }

  /**
   * 获取账号统计数据
   */
  function getAccountStats(platformKey, account, jobs) {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const accountJobs = jobs.filter(job => {
      const task = (job.platformTasks || []).find(t => matchesAccountTask(t, platformKey, account));
      return task;
    });

    // 统计近 7 天的任务
    const recentJobs = accountJobs.filter(job => {
      const createdAt = new Date(job.createdAt).getTime();
      return createdAt >= sevenDaysAgo;
    });

    // 统计成功和失败数
    let successCount = 0;
    let failureCount = 0;
    let runningCount = 0;
    let lastPublishedAt = null;
    let lastFailure = null;

    for (const job of accountJobs) {
      const task = (job.platformTasks || []).find(t => matchesAccountTask(t, platformKey, account));

      if (!task) continue;

      // 统计运行中的任务
      if (['starting', 'navigating', 'login_ready', 'uploading', 'editing', 'publishing'].includes(task.status)) {
        runningCount++;
      }

      // 统计近 7 天的成功和失败
      const createdAt = new Date(job.createdAt).getTime();
      if (createdAt >= sevenDaysAgo) {
        if (task.status === 'published') {
          successCount++;

          // 记录最近发布时间
          const publishedAt = new Date(job.updatedAt).getTime();
          if (!lastPublishedAt || publishedAt > lastPublishedAt) {
            lastPublishedAt = publishedAt;
          }
        } else if (task.status === 'failed') {
          failureCount++;

          // 记录最近失败
          if (task.failureSummary) {
            const failedAt = new Date(task.failureSummary.failedAt).getTime();
            if (!lastFailure || failedAt > new Date(lastFailure.failedAt).getTime()) {
              lastFailure = {
                jobId: job.id,
                jobTitle: job.publishData?.title || job.asset?.label || '',
                ...task.failureSummary
              };
            }
          }
        }
      }
    }

    return {
      totalJobs: accountJobs.length,
      recentJobs: recentJobs.length,
      successCount,
      failureCount,
      runningCount,
      lastPublishedAt: lastPublishedAt ? new Date(lastPublishedAt).toISOString() : null,
      lastFailure
    };
  }

  /**
   * 获取账号看板数据
   */
  async function getAccountDashboard() {
    const config = readPublishConfig();
    const jobs = (readPublishJobs()?.jobs || []);
    const accountsData = [];

    for (const account of config?.wechatChannels?.accounts || []) {
      const accountId = account.id;
      const accountKey = getAccountKey('wechatChannels', accountId);

      // 获取登录状态
      let loginStatus = null;
      if (loginStatusService && typeof loginStatusService.getAccountStatus === 'function') {
        try {
          loginStatus = await loginStatusService.getAccountStatus(accountId);
        } catch (err) {
          // 忽略错误
        }
      }

      // 获取统计数据
      const stats = getAccountStats('wechatChannels', account, jobs);

      accountsData.push({
        id: accountKey,
        accountId,
        platform: 'wechatChannels',
        platformLabel: platformLabels.wechatChannels,
        displayName: account.displayName || account.helperAccount || account.finderUserName || accountId,
        finderUserName: account.finderUserName || '',
        helperAccount: account.helperAccount || '',
        enabled: true, // 微信账号默认启用
        loginStatus: loginStatus ? {
          status: loginStatus.status,
          lastCheckedAt: loginStatus.lastCheck ? new Date(loginStatus.lastCheck).toISOString() : null,
          message: loginStatus.message || null
        } : null,
        stats
      });
    }

    for (const platformKey of ['douyin', 'xiaohongshu']) {
      const platformConfig = config?.[platformKey] || {};
      const accounts = typeof getSauPlatformAccounts === 'function'
        ? getSauPlatformAccounts(platformKey, config)
        : (Array.isArray(platformConfig.accounts) ? platformConfig.accounts : []);
      for (const account of accounts) {
        const accountId = String(account.id || '').trim();
        if (!accountId) continue;
        let loginStatus = null;
        if (typeof checkPlatformLoginStatus === 'function') {
          try {
            loginStatus = checkPlatformLoginStatus(platformKey, account);
          } catch (_err) {}
        }
        const stats = getAccountStats(platformKey, account, jobs);
        accountsData.push({
          id: getAccountKey(platformKey, accountId),
          accountId,
          platform: platformKey,
          platformLabel: platformLabels[platformKey] || platformKey,
          displayName: account.displayName || account.sauAccountName || account.accountId || account.openId || accountId,
          sauAccountName: account.sauAccountName || '',
          enabled: Boolean(platformConfig.enabled),
          loginStatus,
          stats
        });
      }
    }

    return {
      accounts: accountsData,
      summary: {
        totalAccounts: accountsData.length,
        loggedInAccounts: accountsData.filter(a => a.loginStatus?.status === 'logged_in').length,
        needLoginAccounts: accountsData.filter(a => a.loginStatus?.status === 'need_login').length,
        runningTasks: accountsData.reduce((sum, a) => sum + a.stats.runningCount, 0),
        totalSuccessLast7Days: accountsData.reduce((sum, a) => sum + a.stats.successCount, 0),
        totalFailuresLast7Days: accountsData.reduce((sum, a) => sum + a.stats.failureCount, 0)
      }
    };
  }

  /**
   * 获取账号的任务列表
   */
  function getAccountJobs(accountId, options = {}) {
    const jobs = (readPublishJobs()?.jobs || []);
    const { status, limit = 50, platform = 'wechatChannels' } = options;
    const config = readPublishConfig();
    const sourceAccounts = platform === 'wechatChannels'
      ? (config?.wechatChannels?.accounts || [])
      : (typeof getSauPlatformAccounts === 'function' ? getSauPlatformAccounts(platform, config) : (config?.[platform]?.accounts || []));
    const account = sourceAccounts.find((item) => String(item.id || '').trim() === String(accountId || '').trim()) || { id: accountId };

    let accountJobs = jobs.filter(job => {
      const task = (job.platformTasks || []).find(t => matchesAccountTask(t, platform, account));
      return task;
    });

    // 按状态过滤
    if (status) {
      accountJobs = accountJobs.filter(job => {
        const task = (job.platformTasks || []).find(t => matchesAccountTask(t, platform, account));
        return task && task.status === status;
      });
    }

    // 限制数量
    accountJobs = accountJobs.slice(0, limit);

    return accountJobs;
  }

  /**
   * 获取账号的失败任务列表
   */
  function getAccountFailedJobs(accountId, limit = 20, platform = 'wechatChannels') {
    return getAccountJobs(accountId, { status: 'failed', limit, platform });
  }

  return {
    getAccountDashboard,
    getAccountJobs,
    getAccountFailedJobs
  };
}

module.exports = {
  createAccountDashboardService
};
