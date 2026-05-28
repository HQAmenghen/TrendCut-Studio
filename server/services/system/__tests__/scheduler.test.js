const fs = require('fs');

describe('system scheduler autopilot safeguards', () => {
  let scheduledTasks;
  let appendFileSpy;
  let mkdirSpy;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;
  let reviewConfig;
  let mockEnvValues;
  let originalLoginCheckEnabled;
  let originalLoginCheckIntervalMinutes;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-27T00:30:00.000Z'));

    scheduledTasks = [];
    mockEnvValues = {};
    originalLoginCheckEnabled = process.env.LOGIN_CHECK_ENABLED;
    originalLoginCheckIntervalMinutes = process.env.LOGIN_CHECK_INTERVAL_MINUTES;
    delete process.env.LOGIN_CHECK_ENABLED;
    delete process.env.LOGIN_CHECK_INTERVAL_MINUTES;
    reviewConfig = {
      enabled: false,
      require_manual_confirm: false
    };

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

    jest.doMock('../../../../scripts/utils/env', () => ({
      readProjectEnv: jest.fn(() => ({
        envPath: 'C:\\mock\\.env',
        values: mockEnvValues
      }))
    }));

    jest.doMock('../../review/store', () => ({
      readReviewConfig: jest.fn(() => reviewConfig)
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
    if (originalLoginCheckEnabled === undefined) {
      delete process.env.LOGIN_CHECK_ENABLED;
    } else {
      process.env.LOGIN_CHECK_ENABLED = originalLoginCheckEnabled;
    }
    if (originalLoginCheckIntervalMinutes === undefined) {
      delete process.env.LOGIN_CHECK_INTERVAL_MINUTES;
    } else {
      process.env.LOGIN_CHECK_INTERVAL_MINUTES = originalLoginCheckIntervalMinutes;
    }
    jest.dontMock('node-cron');
    jest.dontMock('../../../core/cleanup');
    jest.dontMock('../../../../scripts/utils/env');
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

  function createPublishStore(config, existingJobs = [], overrides = {}) {
    const payload = { jobs: existingJobs };
    return {
      readPublishConfig: jest.fn(() => config),
      makeJobId: jest.fn(() => 'job_new'),
      readPublishJobs: jest.fn(() => payload),
      writePublishJobs: jest.fn((nextPayload) => {
        payload.jobs = nextPayload.jobs;
      }),
      updatePublishJob: jest.fn((jobId, updater) => {
        const index = payload.jobs.findIndex((job) => job.id === jobId);
        if (index === -1) throw new Error('job not found');
        payload.jobs[index] = updater ? updater(payload.jobs[index]) || payload.jobs[index] : payload.jobs[index];
        return payload.jobs[index];
      }),
      reconcileAndPersistPublishJobs: jest.fn(() => payload),
      getDueScheduledJobs: jest.fn(() => []),
      ...overrides
    };
  }

  function createRecoveredAutoPilotTask(overrides = {}) {
    return {
      id: 'queue_recovered',
      type: 'vertical_queue',
      status: 'reviewing',
      progress: 92,
      message: 'recovering',
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:10:00.000Z',
      startedAt: '2026-04-27T00:00:00.000Z',
      completedAt: null,
      logs: [],
      metadata: {
        sourceType: 'xai_top10_cached',
        sourceRank: 1,
        title: 'Recovered source',
        summary: 'Recovered summary',
        videoUrl: 'https://video.twimg.com/amplify_video/recovered/vid/avc1/source.mp4',
        postId: 'post-recovered',
        author: 'author-a',
        autoPilot: {
          rank: 0,
          pipelineMode: 'vertical',
          platforms: ['wechatChannels'],
          sourceVideoUrl: 'https://video.twimg.com/amplify_video/recovered/vid/avc1/source.mp4',
          sourcePostId: 'post-recovered',
          sourceRank: 1
        }
      },
      ...overrides
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

  test('uses per-slot xAI partitions when preparing autopilot items', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig({
      global: {
        autoPilotCount: 2,
        autoPilotModeSchedules: {
          vertical: {
            accountIds: ['wechat_a', 'wechat_b'],
            times: ['08:00', '08:02'],
            partitionIds: ['finance', 'ai'],
            sourceRanks: ['1', '1']
          }
        }
      }
    });
    const xaiService = {
      ensureTranslatedResult: jest.fn((partitionId) => ({
        partition: { id: partitionId, label: partitionId === 'finance' ? '金融' : 'AI' },
        items: [{
          title: `${partitionId} item`,
          video_url: `https://video.twimg.com/${partitionId}/source.mp4`,
          post_id: `${partitionId}-post`,
          author: `${partitionId}-author`
        }]
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

    expect(xaiService.ensureTranslatedResult).toHaveBeenCalledWith('finance');
    expect(xaiService.ensureTranslatedResult).toHaveBeenCalledWith('ai');
    expect(verticalQueueService.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      postId: 'finance-post',
      sourcePartitionId: 'finance',
      sourcePartitionLabel: '金融',
      sourceRank: 1
    }));
    expect(verticalQueueService.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      postId: 'ai-post',
      sourcePartitionId: 'ai',
      sourcePartitionLabel: 'AI',
      sourceRank: 1
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

  test('recovers unfinished completed-artifact queue tasks without preexisting in-memory autopilot jobs', async () => {
    const { startScheduler } = require('../scheduler');
    const sourceVideoUrl = 'https://video.twimg.com/amplify_video/recovered/vid/avc1/source.mp4';
    const config = createBaseConfig({ global: { autoPilotCount: 1, autoPilotAccountIds: ['wechat_a'] } });
    const publishStore = createPublishStore(config, []);
    const taskStore = {
      listTasks: jest.fn()
        .mockReturnValueOnce([createRecoveredAutoPilotTask()])
        .mockReturnValueOnce([createRecoveredAutoPilotTask({ status: 'completed', progress: 100 })]),
      updateTask: jest.fn(),
      appendLog: jest.fn()
    };
    const verticalQueueService = {
      recoverPersistedJobs: jest.fn(),
      getJob: jest.fn(() => ({ id: 'queue_recovered', status: 'completed', title: 'Recovered source' }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [{
        label: 'Recovered asset',
        compactLabel: 'Recovered asset',
        path: 'C:\\out\\queue_recovered.mp4',
        url: '/xai_vertical_queue/queue_recovered/vertical_output.mp4',
        metadata: {
          videoUrl: sourceVideoUrl,
          postId: 'post-recovered',
          sourceSummary: 'Recovered summary'
        }
      }])
    };
    const generatePublishDescription = jest.fn(async () => 'publish description');

    startScheduler({
      publishStore,
      verticalQueueService,
      taskStore,
      publishAssetsService,
      generatePublishDescription
    });

    await scheduledTasks[0].callback();

    const jobs = publishStore.readPublishJobs().jobs;
    expect(verticalQueueService.recoverPersistedJobs).toHaveBeenCalledTimes(1);
    expect(publishAssetsService.resetPublishAssetsCache).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({
      status: 'scheduled_wait',
      autoPilot: expect.objectContaining({
        queueJobId: 'queue_recovered',
        pipelineMode: 'vertical'
      })
    }));
  });

  test('does not recover historical completed vertical queue tasks into new publish jobs', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig({ global: { autoPilotCount: 1, autoPilotAccountIds: ['wechat_a'] } });
    const publishStore = createPublishStore(config, []);
    const taskStore = {
      listTasks: jest.fn(() => [createRecoveredAutoPilotTask({
        id: 'queue_historical',
        status: 'completed',
        progress: 100,
        completedAt: '2026-04-26T00:20:00.000Z'
      })]),
      updateTask: jest.fn(),
      appendLog: jest.fn()
    };
    const verticalQueueService = {
      recoverPersistedJobs: jest.fn(),
      getJob: jest.fn(() => ({ id: 'queue_historical', status: 'completed', title: 'Old output' }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [{
        label: 'Old asset',
        compactLabel: 'Old asset',
        path: 'C:\\out\\queue_historical.mp4',
        url: '/xai_vertical_queue/queue_historical/vertical_output.mp4',
        metadata: {
          videoUrl: 'https://video.twimg.com/amplify_video/old/vid/avc1/source.mp4',
          sourceSummary: 'Old summary'
        }
      }])
    };
    const generatePublishDescription = jest.fn(async () => 'publish description');

    startScheduler({
      publishStore,
      verticalQueueService,
      taskStore,
      publishAssetsService,
      generatePublishDescription
    });

    await scheduledTasks[0].callback();

    expect(verticalQueueService.recoverPersistedJobs).toHaveBeenCalledTimes(1);
    expect(verticalQueueService.getJob).not.toHaveBeenCalled();
    expect(publishAssetsService.resetPublishAssetsCache).not.toHaveBeenCalled();
    expect(generatePublishDescription).not.toHaveBeenCalled();
    expect(publishStore.readPublishJobs().jobs).toHaveLength(0);
  });

  test('creates autopilot publish jobs even when AI review did not pass', async () => {
    const { startScheduler } = require('../scheduler');
    reviewConfig = {
      enabled: true,
      require_manual_confirm: true,
      min_pass_score: 80
    };
    const sourceVideoUrl = 'https://video.twimg.com/amplify_video/5/vid/avc1/source.mp4';
    const config = createBaseConfig({ global: { autoPilotCount: 1, autoPilotAccountIds: ['wechat_a'] } });
    const publishStore = createPublishStore(config, []);
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [{
          title: 'failed review source',
          video_url: sourceVideoUrl,
          post_id: 'post-failed-review',
          author: 'author-a'
        }]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn(() => ({ id: 'queue_failed_review' })),
      getJob: jest.fn(() => ({ id: 'queue_failed_review', status: 'completed', title: 'failed review ready' }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [{
        label: 'Failed review asset',
        compactLabel: 'Failed review asset',
        path: 'C:\\new\\failed_review.mp4',
        url: '/xai_vertical_queue/queue_failed_review/vertical_output.mp4',
        metadata: {
          videoUrl: sourceVideoUrl,
          sourceSummary: 'summary',
          aiReview: {
            status: 'failed',
            overallScore: 42,
            manuallySkipped: false
          }
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
    await scheduledTasks[0].callback();

    const jobs = publishStore.readPublishJobs().jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({
      id: 'job_new',
      status: 'scheduled_wait'
    }));
    expect(jobs[0].asset.metadata.aiReview.status).toBe('failed');
    expect(generatePublishDescription).toHaveBeenCalledTimes(1);
    expect(generatePublishDescription).toHaveBeenCalledWith('summary', expect.objectContaining({
      includeTags: true
    }));
    expect(jobs[0].publishData).toEqual(expect.objectContaining({
      tagStrategy: 'model',
      tags: []
    }));
    expect(publishStore.writePublishJobs).toHaveBeenCalledTimes(1);
  });

  test('creates separate scheduled publish jobs for vertical and avatar autopilot modes', async () => {
    const { startScheduler } = require('../scheduler');
    const sourceVideoUrl = 'https://video.twimg.com/amplify_video/9/vid/avc1/source.mp4';
    const config = createBaseConfig({
      global: {
        autoPilotCount: 1,
        autoPilotPipelineModes: ['vertical', 'avatar'],
        autoPilotModeSchedules: {
          vertical: { accountIds: ['wechat_a'], times: ['12:00'] },
          avatar: { accountIds: ['wechat_b'], times: ['08:00'] }
        }
      }
    });
    const publishStore = createPublishStore(config, [], {
      makeJobId: jest.fn()
        .mockReturnValueOnce('job_vertical')
        .mockReturnValueOnce('job_avatar')
    });
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [{
          title: 'dual mode item',
          video_url: sourceVideoUrl,
          post_id: 'post-9',
          author: 'author-a'
        }]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn((item) => ({
        id: item.sourceType === 'material_driven_avatar' ? 'queue_avatar' : 'queue_vertical'
      })),
      getJob: jest.fn((id) => ({ id, status: 'completed', title: `${id} ready` }))
    };
    const materialDrivenStarter = {
      start: jest.fn(async () => ({ jobId: 'avatar_job', outputPath: 'C:\\avatar\\output_final.mp4' })),
      getStatus: jest.fn(() => ({ status: 'completed', videoUrl: '/projects/avatar_job/output_final.mp4' }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [
        {
          label: 'Vertical asset',
          compactLabel: 'Vertical asset',
          path: 'C:\\out\\queue_vertical.mp4',
          url: '/xai_vertical_queue/queue_vertical/vertical_output.mp4',
          metadata: { videoUrl: sourceVideoUrl, sourceSummary: 'summary' }
        },
        {
          label: 'Avatar asset',
          compactLabel: 'Avatar asset',
          path: 'C:\\out\\queue_avatar.mp4',
          url: '/xai_vertical_queue/queue_avatar/vertical_output.mp4',
          metadata: { videoUrl: sourceVideoUrl, sourceSummary: 'summary' }
        }
      ])
    };
    const generatePublishDescription = jest.fn(async () => 'publish description');

    const scheduler = startScheduler({
      publishStore,
      xaiService,
      verticalQueueService,
      publishAssetsService,
      generatePublishDescription,
      materialDrivenStarter
    });

    await scheduler.triggerAutoPilotNow(config, { reason: 'test' });
    await scheduledTasks[0].callback();

    const jobs = publishStore.readPublishJobs().jobs;
    expect(verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'xai_top10_cached' }));
    expect(verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'material_driven_avatar' }));
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.id).sort()).toEqual(['job_avatar', 'job_vertical']);
    expect(jobs.map((job) => job.autoPilot.pipelineMode).sort()).toEqual(['avatar', 'vertical']);
    expect(jobs.find((job) => job.autoPilot.pipelineMode === 'avatar')?.platformSelections.wechatChannels.accountId).toBe('wechat_b');
    expect(jobs.find((job) => job.autoPilot.pipelineMode === 'vertical')?.platformSelections.wechatChannels.accountId).toBe('wechat_a');
    expect(jobs.find((job) => job.autoPilot.pipelineMode === 'avatar')?.scheduledAt).toBe('2026-04-27T00:00:00.000Z');
    expect(jobs.find((job) => job.autoPilot.pipelineMode === 'vertical')?.scheduledAt).toBe('2026-04-27T04:00:00.000Z');
    expect(jobs.every((job) => job.status === 'scheduled_wait' && job.scheduledAt)).toBe(true);
    expect(jobs.every((job) => job.publishData?.tagStrategy === 'model')).toBe(true);
    expect(jobs.every((job) => Array.isArray(job.publishData?.tags) && job.publishData.tags.length === 0)).toBe(true);
    expect(generatePublishDescription).toHaveBeenCalledWith('summary', expect.objectContaining({
      includeTags: true
    }));
  });

  test('replaces a failed avatar autopilot source with the next ranking item for the same slot', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig({
      global: {
        autoPilotCount: 1,
        autoPilotPipelineModes: ['avatar'],
        autoPilotModeSchedules: {
          avatar: { accountIds: ['wechat_a'], times: ['08:00'] }
        }
      }
    });
    const publishStore = createPublishStore(config, [], {
      makeJobId: jest.fn(() => 'job_avatar_replacement')
    });
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [
          {
            title: 'bad avatar item',
            video_url: 'https://video.twimg.com/amplify_video/11/vid/avc1/bad.mp4',
            post_id: 'post-bad',
            author: 'author-a',
            author_summary: 'bad summary'
          },
          {
            title: 'replacement avatar item',
            video_url: 'https://video.twimg.com/amplify_video/12/vid/avc1/good.mp4',
            post_id: 'post-good',
            author: 'author-b',
            author_summary: 'good summary'
          }
        ]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn(() => ({ id: 'queue_avatar_good' })),
      getJob: jest.fn(() => ({ id: 'queue_avatar_good', status: 'completed', title: 'replacement ready' }))
    };
    const materialDrivenStarter = {
      start: jest.fn()
        .mockResolvedValueOnce({ jobId: 'avatar_bad', outputPath: 'C:\\avatar\\bad' })
        .mockResolvedValueOnce({ jobId: 'avatar_good', outputPath: 'C:\\avatar\\good' }),
      getStatus: jest.fn((jobId) => {
        if (jobId === 'avatar_bad') return { status: 'failed', error: 'script validation failed' };
        return { status: 'completed', videoUrl: '/projects/avatar_good/output_final.mp4' };
      })
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn(() => [
        {
          label: 'Replacement asset',
          compactLabel: 'Replacement asset',
          path: 'C:\\out\\queue_avatar_good.mp4',
          url: '/xai_vertical_queue/queue_avatar_good/vertical_output.mp4',
          metadata: {
            videoUrl: 'https://video.twimg.com/amplify_video/12/vid/avc1/good.mp4',
            sourceSummary: 'good summary'
          }
        }
      ])
    };
    const generatePublishDescription = jest.fn(async () => 'publish description');

    const scheduler = startScheduler({
      publishStore,
      xaiService,
      verticalQueueService,
      publishAssetsService,
      generatePublishDescription,
      materialDrivenStarter
    });

    await scheduler.triggerAutoPilotNow(config, { reason: 'test' });
    await scheduledTasks[0].callback();
    await scheduledTasks[0].callback();

    const jobs = publishStore.readPublishJobs().jobs;
    expect(materialDrivenStarter.start).toHaveBeenCalledTimes(2);
    expect(materialDrivenStarter.start.mock.calls[1][0]).toEqual(expect.objectContaining({
      videoUrl: 'https://video.twimg.com/amplify_video/12/vid/avc1/good.mp4',
      sourceRank: 2
    }));
    expect(verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'material_driven_avatar',
      sourceRank: 2
    }));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe('job_avatar_replacement');
    expect(jobs[0].autoPilot.sourceRank).toBe(2);
    expect(jobs[0].status).toBe('scheduled_wait');
  });

  test('does not create autopilot publish jobs for skipped silent queue outputs', async () => {
    const { startScheduler } = require('../scheduler');
    const sourceVideoUrl = 'https://video.twimg.com/amplify_video/10/vid/avc1/silent.mp4';
    const config = createBaseConfig({ global: { autoPilotCount: 1, autoPilotAccountIds: ['wechat_a'] } });
    const publishStore = createPublishStore(config, []);
    const xaiService = {
      ensureTranslatedResult: jest.fn(() => ({
        items: [{
          title: 'silent source',
          video_url: sourceVideoUrl,
          post_id: 'post-silent',
          author: 'author-a'
        }]
      }))
    };
    const verticalQueueService = {
      enqueue: jest.fn(() => ({ id: 'queue_silent' })),
      getJob: jest.fn(() => ({
        id: 'queue_silent',
        status: 'skipped',
        title: '这条消息可能正在改变支付格局'
      }))
    };
    const publishAssetsService = {
      resetPublishAssetsCache: jest.fn(),
      collectPublishAssets: jest.fn()
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
    await scheduledTasks[0].callback();

    expect(verticalQueueService.enqueue).toHaveBeenCalledTimes(1);
    expect(publishAssetsService.resetPublishAssetsCache).not.toHaveBeenCalled();
    expect(publishAssetsService.collectPublishAssets).not.toHaveBeenCalled();
    expect(generatePublishDescription).not.toHaveBeenCalled();
    expect(publishStore.writePublishJobs).not.toHaveBeenCalled();
    expect(publishStore.readPublishJobs().jobs).toHaveLength(0);
  });

  test('keeps due scheduled jobs retryable when a same-account RPA start is busy', async () => {
    const { startScheduler } = require('../scheduler');
    const config = createBaseConfig();
    const dueJobs = [
      {
        id: 'job_1',
        status: 'scheduled_wait',
        scheduledAt: '2026-04-27T00:00:00.000Z',
        archived: false,
        publishData: { title: 'job 1' },
        platformTasks: [{ platform: 'wechatChannels', status: 'scheduled_wait' }]
      },
      {
        id: 'job_2',
        status: 'scheduled_wait',
        scheduledAt: '2026-04-27T00:00:00.000Z',
        archived: false,
        publishData: { title: 'job 2' },
        platformTasks: [{ platform: 'wechatChannels', status: 'scheduled_wait' }]
      }
    ];
    const publishStore = createPublishStore(config, dueJobs, {
      getDueScheduledJobs: jest.fn(() => dueJobs)
    });
    const wechatRpaService = {
      startWechatRpa: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('账号当前已有发布任务在运行'))
    };

    startScheduler({
      publishStore,
      wechatRpaService
    });

    await scheduledTasks[0].callback();
    await Promise.resolve();

    expect(wechatRpaService.startWechatRpa).toHaveBeenCalledTimes(2);
    expect(publishStore.updatePublishJob).not.toHaveBeenCalled();
    expect(publishStore.readPublishJobs().jobs.map((job) => job.status)).toEqual(['scheduled_wait', 'scheduled_wait']);
  });

  test('runs scheduled login checks without sending Feishu alerts', async () => {
    const { startScheduler } = require('../scheduler');
    mockEnvValues.LOGIN_CHECK_INTERVAL_MINUTES = '30';
    const loginStatusService = {
      checkAllAccounts: jest.fn(async () => ({
        checked: 1,
        logged_in: 0,
        need_login: 1,
        error: 0,
        results: [{ accountId: 'wechat_a', accountLabel: 'Account A', status: 'need_login' }]
      }))
    };
    const feishuService = {
      sendText: jest.fn()
    };

    startScheduler({
      loginStatusService,
      feishuService
    });

    const loginCheckTask = scheduledTasks[scheduledTasks.length - 1];
    expect(loginCheckTask).toBeTruthy();
    expect(loginCheckTask.expression).toBe('* * * * *');

    await loginCheckTask.callback();
    expect(loginStatusService.checkAllAccounts).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-04-27T01:00:00.000Z'));
    await loginCheckTask.callback();

    expect(loginStatusService.checkAllAccounts).toHaveBeenCalledWith({ notifyFeishu: false });
    expect(feishuService.sendText).not.toHaveBeenCalled();
  });

  test('honors login check intervals above the cron minute field range', async () => {
    const { startScheduler } = require('../scheduler');
    mockEnvValues.LOGIN_CHECK_INTERVAL_MINUTES = '600';
    const loginStatusService = {
      checkAllAccounts: jest.fn(async () => ({
        checked: 1,
        logged_in: 1,
        need_login: 0,
        error: 0,
        results: [{ accountId: 'wechat_a', accountLabel: 'Account A', status: 'logged_in' }]
      }))
    };

    startScheduler({
      loginStatusService
    });

    const loginCheckTask = scheduledTasks[scheduledTasks.length - 1];
    expect(loginCheckTask.expression).toBe('* * * * *');

    await loginCheckTask.callback();
    expect(loginStatusService.checkAllAccounts).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-04-27T10:29:00.000Z'));
    await loginCheckTask.callback();
    expect(loginStatusService.checkAllAccounts).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-04-27T10:30:00.000Z'));
    await loginCheckTask.callback();
    expect(loginStatusService.checkAllAccounts).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-04-27T11:30:00.000Z'));
    await loginCheckTask.callback();
    expect(loginStatusService.checkAllAccounts).toHaveBeenCalledTimes(1);
  });
});
