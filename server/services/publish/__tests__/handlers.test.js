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
});
