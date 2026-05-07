const fs = require('fs');

describe('system scheduler autopilot safeguards', () => {
  let scheduledTasks;
  let appendFileSpy;
  let mkdirSpy;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-27T00:30:00.000Z'));

    scheduledTasks = [];

    jest.doMock('node-cron', () => ({
      schedule: jest.fn((expression, callback) => {
        scheduledTasks.push({ expression, callback });
        return { stop: jest.fn() };
      })
    }));

    jest.doMock('../../../core/cleanup', () => ({
      getCleanupConfig: jest.fn(() => ({ enabled: false })),
      runCleanup: jest.fn()
    }));

    jest.doMock('../../review/store', () => ({
      readReviewConfig: jest.fn(() => ({
        enabled: false,
        require_manual_confirm: false
      }))
    }));

    appendFileSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    appendFileSpy.mockRestore();
    mkdirSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.dontMock('node-cron');
    jest.dontMock('../../../core/cleanup');
    jest.dontMock('../../review/store');
  });

  function createBaseConfig(overrides = {}) {
    return {
      global: {
        autoPilotEnabled: true,
        autoPilotUseCurrentRanking: true,
        autoPilotCount: 2,
        autoPilotAccountIds: ['wechat_a', 'wechat_b'],
        autoPilotTimes: ['08:00', '08:02'],
        ...overrides.global
      },
      wechatChannels: {
        accounts: [
          { id: 'wechat_a', displayName: 'Account A' },
          { id: 'wechat_b', displayName: 'Account B' }
        ],
        ...overrides.wechatChannels
      }
    };
  }

  function createPublishStore(config, existingJobs = []) {
    const payload = { jobs: existingJobs };
    return {
      readPublishConfig: jest.fn(() => config),
      makeJobId: jest.fn(() => 'job_new'),
      readPublishJobs: jest.fn(() => payload),
      writePublishJobs: jest.fn((nextPayload) => {
        payload.jobs = nextPayload.jobs;
      }),
      reconcileAndPersistPublishJobs: jest.fn(() => payload),
      getDueScheduledJobs: jest.fn(() => [])
    };
  }

  test('dedupes current ranking items by source video URL and fills the next slot from lower results', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig();
    const sharedVideoUrl = 'https://video.twimg.com/amplify_video/1/vid/avc1/source.mp4?tag=14';
    const distinctVideoUrl = 'https://video.twimg.com/amplify_video/2/vid/avc1/distinct.mp4';
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [
          {
            title: 'first post',
            video_url: sharedVideoUrl,
            post_id: 'post-1',
            author: 'author-a'
          },
          {
            title: 'second post',
            video_url: 'https://video.twimg.com/amplify_video/1/vid/avc1/source.mp4?tag=15',
            post_id: 'post-2',
            author: 'author-b'
          },
          {
            title: 'third post',
            video_url: distinctVideoUrl,
            post_id: 'post-3',
            author: 'author-c'
          }
        ]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn((item) => ({ id: `queue_${item.postId}` }))
    };

    const scheduler = startScheduler({
      publishStore: createPublishStore(config),
      xaiService,
      verticalQueueService
    });

    await scheduler.triggerAutoPilotNow(config, { reason: 'test' });

    expect(verticalQueueService.enqueue).toHaveBeenCalledTimes(2);
    expect(verticalQueueService.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      postId: 'post-1',
      videoUrl: sharedVideoUrl
    }));
    expect(verticalQueueService.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      postId: 'post-3',
      videoUrl: distinctVideoUrl
    }));
  });

  test('skips existing source video publish jobs and fills from lower ranking items', async () => {
    const { startScheduler } = require('../scheduler');
    const duplicateVideoUrl = 'https://video.twimg.com/amplify_video/3/vid/avc1/duplicate.mp4';
    const distinctVideoUrl = 'https://video.twimg.com/amplify_video/4/vid/avc1/distinct.mp4';
    const config = createBaseConfig({ global: { autoPilotCount: 1, autoPilotAccountIds: ['wechat_a'] } });
    const publishStore = createPublishStore(config, [{
      id: 'job_existing',
      archived: false,
      asset: {
        metadata: {
          videoUrl: duplicateVideoUrl
        }
      }
    }]);
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [
          {
            title: 'already used source',
            video_url: duplicateVideoUrl,
            post_id: 'post-1',
            author: 'author-a'
          },
          {
            title: 'replacement source',
            video_url: distinctVideoUrl,
            post_id: 'post-2',
            author: 'author-b'
          }
        ]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn((item) => ({ id: `queue_${item.postId}` }))
    };

    const scheduler = startScheduler({
      publishStore,
      xaiService,
      verticalQueueService
    });

    await scheduler.triggerAutoPilotNow(config, { reason: 'test' });

    expect(verticalQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      postId: 'post-2',
      videoUrl: distinctVideoUrl
    }));
  });

  test('skips publish job creation when a non-archived job already uses the same source video', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig({ global: { autoPilotCount: 1 } });
    const sourceVideoUrl = 'https://video.twimg.com/amplify_video/2/vid/avc1/source.mp4';
    const existingJob = {
      id: 'job_existing',
      archived: false,
      scheduledAt: '2026-04-27T00:00:00.000Z',
      asset: {
        path: 'C:\\existing\\vertical_output.mp4',
        metadata: {
          videoUrl: sourceVideoUrl,
          postId: 'other-post'
        }
      },
      platformSelections: {
        wechatChannels: {
          accountId: 'wechat_b',
          accountLabel: 'Account B'
        }
      }
    };
    const publishStore = createPublishStore(config, []);
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [
          {
            title: 'new post with same source video',
            video_url: sourceVideoUrl,
            post_id: 'new-post',
            author: 'author-a'
          }
        ]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn(() => ({ id: 'queue_1' })),
      getJob: jest.fn(() => ({ id: 'queue_1', status: 'completed', title: 'ready video' }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [{
        label: 'Generated asset',
        compactLabel: 'Generated asset',
        path: 'C:\\new\\vertical_output.mp4',
        url: '/xai_vertical_queue/queue_1/vertical_output.mp4',
        metadata: {
          videoUrl: sourceVideoUrl,
          postId: 'new-post'
        }
      }])
    };
    const generatePublishDescription = jest.fn(async () => 'publish description');

    const scheduler = startScheduler({
      publishStore,
      xaiService,
      verticalQueueService,
      publishAssetsService,
      generatePublishDescription
    });

    await scheduler.triggerAutoPilotNow(config, { reason: 'test' });
    publishStore.readPublishJobs().jobs.push(existingJob);
    await scheduledTasks[0].callback();

    expect(publishAssetsService.resetPublishAssetsCache).toHaveBeenCalledTimes(1);
    expect(generatePublishDescription).not.toHaveBeenCalled();
    expect(publishStore.writePublishJobs).not.toHaveBeenCalled();
    expect(publishStore.reconcileAndPersistPublishJobs).not.toHaveBeenCalled();
  });
});
