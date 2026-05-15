const { createAccountDashboardService } = require('../accountDashboard');

describe('account dashboard service', () => {
  test('includes douyin and xiaohongshu accounts with account-scoped stats', async () => {
    const service = createAccountDashboardService({
      readPublishConfig: () => ({
        wechatChannels: { accounts: [] },
        douyin: {
          enabled: true,
          accounts: [{ id: 'dy_a', displayName: '抖音 A', sauAccountName: 'dy_a' }]
        },
        xiaohongshu: {
          enabled: true,
          accounts: [{ id: 'xhs_a', displayName: '小红书 A', sauAccountName: 'xhs_a' }]
        }
      }),
      readPublishJobs: () => ({
        jobs: [
          {
            id: 'job_dy',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            publishData: { title: '抖音任务' },
            platformTasks: [{ platform: 'douyin', accountId: 'dy_a', status: 'published' }]
          },
          {
            id: 'job_xhs',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            publishData: { title: '小红书任务' },
            platformTasks: [{ platform: 'xiaohongshu', accountId: 'xhs_a', status: 'failed', failureSummary: { failedAt: new Date().toISOString(), errorMessage: 'failed' } }]
          }
        ]
      }),
      loginStatusService: null,
      getSauPlatformAccounts: (platformKey, config) => config[platformKey].accounts,
      checkPlatformLoginStatus: (platformKey, account) => ({
        status: 'unknown',
        lastCheckedAt: null,
        message: `${platformKey}:${account.id}`
      })
    });

    const dashboard = await service.getAccountDashboard();

    expect(dashboard.accounts.map((account) => account.id)).toEqual(['douyin:dy_a', 'xiaohongshu:xhs_a']);
    expect(dashboard.accounts[0]).toMatchObject({
      platform: 'douyin',
      accountId: 'dy_a',
      stats: { totalJobs: 1, successCount: 1 }
    });
    expect(dashboard.accounts[1]).toMatchObject({
      platform: 'xiaohongshu',
      accountId: 'xhs_a',
      stats: { totalJobs: 1, failureCount: 1 }
    });
  });
});
