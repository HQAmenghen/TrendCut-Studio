const { createPublishHandlers } = require('../handlers');

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

describe('publish handlers', () => {
  test('deleteAsset removes the selected publish asset and returns refreshed assets', () => {
    const asset = {
      id: 'asset_delete_1',
      label: 'Delete me',
      compactLabel: 'Delete me',
      path: 'C:\\videos\\delete-me.mp4',
      url: '/videos/delete-me.mp4',
      metadata: {}
    };
    const deletePublishAsset = jest.fn(() => ({
      asset,
      deletedPath: asset.path,
      deletedMetadata: true
    }));
    const getCachedPublishAssets = jest.fn(() => []);

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: jest.fn(),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets,
      readPublishJobs: jest.fn(),
      writePublishJobs: jest.fn(),
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: jest.fn(),
      deletePublishAsset,
      makeJobId: jest.fn(),
      buildShortTitle: jest.fn(),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: jest.fn(),
      buildPublishTask: jest.fn(),
      validateWechatTaskConfig: jest.fn(),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager: jest.fn(),
      triggerAutoPilotNow: jest.fn()
    });

    const req = { params: { assetId: asset.id } };
    const res = createMockResponse();

    handlers.deleteAsset(req, res);

    expect(res.statusCode).toBe(200);
    expect(deletePublishAsset).toHaveBeenCalledWith(asset.id);
    expect(getCachedPublishAssets).toHaveBeenCalledWith(true);
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      deletedAsset: asset,
      deletedPath: asset.path,
      deletedMetadata: true,
      assets: []
    }));
  });

  test('createJob defaults publish descriptions to model tags when strategy is omitted', async () => {
    const asset = {
      id: 'asset_model_default',
      label: 'Model default asset',
      compactLabel: 'Model default asset',
      path: 'C:\\videos\\model-default.mp4',
      url: '/videos/model-default.mp4',
      metadata: {
        sourceSummary: 'summary for model description'
      }
    };
    const payload = { jobs: [] };
    const writePublishJobs = jest.fn((nextPayload) => {
      payload.jobs = nextPayload.jobs;
    });
    const generatePublishDescription = jest.fn(async () => 'Model generated copy #Topic');

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        wechatChannels: {
          enabled: true,
          accounts: [{ id: 'acct_1', displayName: 'Account 1' }]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: () => payload,
      writePublishJobs,
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: () => [asset],
      makeJobId: () => 'job_publish_1',
      buildShortTitle: (title) => title.slice(0, 16),
      generatePublishDescription,
      getWechatAccountMap: () => new Map([['acct_1', { id: 'acct_1', displayName: 'Account 1' }]]),
      buildPublishTask: (platform, publishData, videoUrl, _platformConfig, selection) => ({
        platform,
        title: publishData.title,
        description: publishData.description,
        tags: publishData.tags,
        videoUrl,
        status: 'rpa_available',
        accountId: selection.accountId,
        requiredFields: []
      }),
      validateWechatTaskConfig: () => ({
        missingFields: [],
        missingFieldLabels: [],
        account: { id: 'acct_1', displayName: 'Account 1' }
      }),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager: jest.fn(),
      triggerAutoPilotNow: jest.fn()
    });

    const req = {
      body: {
        assetId: asset.id,
        platforms: ['wechatChannels'],
        platformSelections: {
          wechatChannels: { accountId: 'acct_1' }
        },
        title: 'Model default publish',
        description: '',
        tags: ['system tag']
      }
    };
    const res = createMockResponse();

    await handlers.createJob(req, res);

    expect(res.statusCode).toBe(200);
    expect(generatePublishDescription).toHaveBeenCalledWith('summary for model description', expect.objectContaining({
      includeTags: true
    }));
    expect(payload.jobs[0].publishData).toEqual(expect.objectContaining({
      description: 'Model generated copy #Topic',
      tagStrategy: 'model',
      tags: []
    }));
  });

  test('createJob no longer blocks assets that have not passed AI review', async () => {
    const asset = {
      id: 'asset_failed_review',
      label: 'Failed review asset',
      compactLabel: 'Failed review asset',
      path: 'C:\\videos\\failed-review.mp4',
      url: '/videos/failed-review.mp4',
      metadata: {
        sourceSummary: 'summary',
        aiReview: {
          status: 'failed',
          overallScore: 42,
          manuallySkipped: false
        }
      }
    };
    const payload = { jobs: [] };
    const writePublishJobs = jest.fn((nextPayload) => {
      payload.jobs = nextPayload.jobs;
    });
    const readReviewConfig = jest.fn(() => ({
      enabled: true,
      require_manual_confirm: true,
      min_pass_score: 80
    }));
    const readMediaMetadata = jest.fn(() => ({
      aiReview: asset.metadata.aiReview
    }));

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        wechatChannels: {
          enabled: true,
          accounts: [{ id: 'acct_1', displayName: 'Account 1' }]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: () => payload,
      writePublishJobs,
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: () => [asset],
      makeJobId: () => 'job_publish_1',
      buildShortTitle: (title) => title.slice(0, 16),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: () => new Map([['acct_1', { id: 'acct_1', displayName: 'Account 1' }]]),
      buildPublishTask: (platform, publishData, videoUrl, _platformConfig, selection) => ({
        platform,
        title: publishData.title,
        description: publishData.description,
        videoUrl,
        status: 'rpa_available',
        accountId: selection.accountId,
        requiredFields: []
      }),
      validateWechatTaskConfig: () => ({
        missingFields: [],
        missingFieldLabels: [],
        account: { id: 'acct_1', displayName: 'Account 1' }
      }),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager: jest.fn(),
      triggerAutoPilotNow: jest.fn(),
      readReviewConfig,
      readMediaMetadata
    });

    const req = {
      body: {
        assetId: asset.id,
        platforms: ['wechatChannels'],
        platformSelections: {
          wechatChannels: { accountId: 'acct_1' }
        },
        title: 'Failed review can publish',
        description: 'Description from operator',
        tags: []
      }
    };
    const res = createMockResponse();

    await handlers.createJob(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ success: true }));
    expect(writePublishJobs).toHaveBeenCalledTimes(1);
    expect(payload.jobs[0]).toEqual(expect.objectContaining({
      id: 'job_publish_1',
      asset,
      status: 'ready'
    }));
    expect(readReviewConfig).not.toHaveBeenCalled();
    expect(readMediaMetadata).not.toHaveBeenCalled();
  });

  test('createJob creates a xiaohongshu task for the selected account', async () => {
    const asset = {
      id: 'asset_xhs',
      label: 'XHS asset',
      compactLabel: 'XHS asset',
      path: 'C:\\videos\\xhs.mp4',
      url: '/videos/xhs.mp4',
      metadata: {
        sourceSummary: 'summary'
      }
    };
    const account = { id: 'xhs_a', displayName: '小红书 A', sauAccountName: 'xhs_main' };
    const payload = { jobs: [] };
    const writePublishJobs = jest.fn((nextPayload) => {
      payload.jobs = nextPayload.jobs;
    });
    const validateSauTaskConfig = jest.fn(() => ({
      missingFields: [],
      missingFieldLabels: [],
      account
    }));

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        xiaohongshu: {
          enabled: true,
          accounts: [account]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: () => payload,
      writePublishJobs,
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: () => [asset],
      makeJobId: () => 'job_xhs_1',
      buildShortTitle: (title) => title.slice(0, 16),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: () => new Map(),
      getSauAccountMap: () => new Map([[account.id, account]]),
      buildPublishTask: (platform, publishData, videoUrl, _platformConfig, selection) => ({
        platform,
        title: publishData.title,
        description: publishData.description,
        videoUrl,
        status: 'rpa_available',
        accountId: selection.accountId,
        accountLabel: selection.accountLabel,
        sauAccountName: selection.sauAccountName,
        requiredFields: ['sauAccountName']
      }),
      validateWechatTaskConfig: jest.fn(),
      validateSauTaskConfig,
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      startPlatformRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager: jest.fn(),
      triggerAutoPilotNow: jest.fn()
    });

    const req = {
      body: {
        assetId: asset.id,
        platforms: ['xiaohongshu'],
        platformSelections: {
          xiaohongshu: { accountId: account.id }
        },
        title: 'XHS publish',
        description: 'Operator description',
        tags: []
      }
    };
    const res = createMockResponse();

    await handlers.createJob(req, res);

    expect(res.statusCode).toBe(200);
    expect(validateSauTaskConfig).toHaveBeenCalledWith('xiaohongshu', expect.any(Object), expect.objectContaining({
      platform: 'xiaohongshu',
      accountId: account.id
    }));
    expect(writePublishJobs).toHaveBeenCalledTimes(1);
    expect(payload.jobs[0]).toEqual(expect.objectContaining({
      id: 'job_xhs_1',
      status: 'ready',
      selectedPlatforms: ['xiaohongshu']
    }));
    expect(payload.jobs[0].platformTasks[0]).toEqual(expect.objectContaining({
      platform: 'xiaohongshu',
      accountId: account.id,
      accountLabel: account.displayName,
      sauAccountName: account.sauAccountName,
      validation: expect.objectContaining({ missingFields: [] })
    }));
  });

  test('createJob falls back to asset metadata title for xiaohongshu', async () => {
    const asset = {
      id: 'asset_xhs_title',
      label: 'XHS title asset',
      compactLabel: 'XHS title asset',
      path: 'C:\\videos\\xhs-title.mp4',
      url: '/videos/xhs-title.mp4',
      metadata: {
        suggestedTitle: '前序文件标题',
        sourceSummary: 'summary'
      }
    };
    const account = { id: 'xhs_a', displayName: '小红书 A', sauAccountName: 'xhs_main' };
    const payload = { jobs: [] };
    const writePublishJobs = jest.fn((nextPayload) => {
      payload.jobs = nextPayload.jobs;
    });

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        xiaohongshu: {
          enabled: true,
          accounts: [account]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: () => payload,
      writePublishJobs,
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: () => [asset],
      makeJobId: () => 'job_xhs_title',
      buildShortTitle: (title) => title.slice(0, 16),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: () => new Map(),
      getSauAccountMap: () => new Map([[account.id, account]]),
      buildPublishTask: (platform, publishData, videoUrl, _platformConfig, selection) => ({
        platform,
        title: publishData.title,
        description: publishData.description,
        videoUrl,
        status: 'rpa_available',
        accountId: selection.accountId,
        requiredFields: ['sauAccountName']
      }),
      validateWechatTaskConfig: jest.fn(),
      validateSauTaskConfig: jest.fn(() => ({
        missingFields: [],
        missingFieldLabels: [],
        account
      })),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      startPlatformRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager: jest.fn(),
      triggerAutoPilotNow: jest.fn()
    });

    const req = {
      body: {
        assetId: asset.id,
        platforms: ['xiaohongshu'],
        platformSelections: {
          xiaohongshu: { accountId: account.id }
        },
        title: '',
        description: 'Operator description',
        tags: []
      }
    };
    const res = createMockResponse();

    await handlers.createJob(req, res);

    expect(res.statusCode).toBe(200);
    expect(payload.jobs[0].publishData).toEqual(expect.objectContaining({
      title: '前序文件标题',
      shortTitle: '前序文件标题'
    }));
    expect(payload.jobs[0].platformTasks[0]).toEqual(expect.objectContaining({
      platform: 'xiaohongshu',
      title: '前序文件标题',
      accountId: account.id
    }));
  });

  test('runPlatform starts the selected xiaohongshu platform task', async () => {
    const startPlatformRpa = jest.fn(async () => undefined);
    const jobsPayload = {
      jobs: [{
        id: 'job_xhs_1',
        platformTasks: [{ platform: 'xiaohongshu', accountId: 'xhs_a', status: 'draft_preparing' }]
      }]
    };
    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishJobs: () => jobsPayload,
      startPlatformRpa
    });
    const req = {
      params: {
        jobId: 'job_xhs_1',
        platformKey: 'xiaohongshu'
      },
      body: {
        mode: 'draft'
      }
    };
    const res = createMockResponse();

    await handlers.runPlatform(req, res);

    expect(startPlatformRpa).toHaveBeenCalledWith('job_xhs_1', 'xiaohongshu', 'draft');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, jobs: jobsPayload.jobs });
  });

  test('openWechatContentManager validates account before opening account-scoped browser', async () => {
    const openWechatContentManager = jest.fn(async () => ({
      status: 'opened',
      url: 'https://channels.weixin.qq.com/platform/post/list'
    }));

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        wechatChannels: {
          enabled: true,
          accounts: [{ id: 'acct_1', displayName: 'Account 1' }]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: jest.fn(),
      writePublishJobs: jest.fn(),
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: jest.fn(),
      makeJobId: jest.fn(),
      buildShortTitle: jest.fn(),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: () => new Map([['acct_1', { id: 'acct_1', displayName: 'Account 1' }]]),
      buildPublishTask: jest.fn(),
      validateWechatTaskConfig: jest.fn(),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager,
      triggerAutoPilotNow: jest.fn()
    });

    const req = { params: { accountId: 'acct_1' } };
    const res = createMockResponse();

    await handlers.openWechatContentManager(req, res);

    expect(res.statusCode).toBe(200);
    expect(openWechatContentManager).toHaveBeenCalledWith('acct_1');
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      status: 'opened',
      accountId: 'acct_1'
    }));
  });

  test('openWechatContentManager forwards need-login result without marking it successful', async () => {
    const openWechatContentManager = jest.fn(async () => ({
      success: false,
      status: 'need_login',
      error: '账号未登录或登录态已失效，请先扫码登录'
    }));

    const handlers = createPublishHandlers({
      sendError: (res, options) => res.status(options.status || 500).json({ success: false, ...options }),
      readPublishConfig: () => ({
        wechatChannels: {
          enabled: true,
          accounts: [{ id: 'acct_1', displayName: 'Account 1' }]
        }
      }),
      maskPlatformConfig: jest.fn(),
      sanitizePlatformConfigInput: jest.fn(),
      writePublishConfig: jest.fn(),
      reconcileAndPersistPublishJobs: jest.fn(),
      getCachedPublishAssets: jest.fn(),
      readPublishJobs: jest.fn(),
      writePublishJobs: jest.fn(),
      updatePublishJob: jest.fn(),
      archivePublishJob: jest.fn(),
      archiveCompletedPublishJobs: jest.fn(),
      collectPublishAssets: jest.fn(),
      makeJobId: jest.fn(),
      buildShortTitle: jest.fn(),
      generatePublishDescription: jest.fn(),
      getWechatAccountMap: () => new Map([['acct_1', { id: 'acct_1', displayName: 'Account 1' }]]),
      buildPublishTask: jest.fn(),
      validateWechatTaskConfig: jest.fn(),
      collectPlatformValidation: jest.fn(),
      startWechatRpa: jest.fn(),
      retryWechatRpa: jest.fn(),
      cancelWechatRpa: jest.fn(),
      checkWechatLogin: jest.fn(),
      openWechatContentManager,
      triggerAutoPilotNow: jest.fn()
    });

    const req = { params: { accountId: 'acct_1' } };
    const res = createMockResponse();

    await handlers.openWechatContentManager(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      status: 'need_login',
      accountId: 'acct_1'
    }));
  });
});
