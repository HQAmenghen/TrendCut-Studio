const fs = require('fs');
const os = require('os');
const path = require('path');

const { createAgentHandlers } = require('../handlers');
const { createAgentAuthMiddleware } = require('../auth');

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

function sendError(res, options) {
  return res.status(options.status || 500).json({
    success: false,
    error: options.error,
    code: options.code,
    stage: options.stage,
    details: options.details || '',
    hint: options.hint || ''
  });
}

function createDeps(overrides = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-handlers-'));
  const publishPayload = { jobs: [] };
  const xaiResult = {
    partition: { id: 'crypto', label: '加密' },
    items: [
      {
        rank: 1,
        author: 'alice',
        post_id: 'post_1',
        post_url: 'https://x.com/alice/status/1',
        video_url: 'https://video.twimg.com/1.mp4',
        author_summary_zh: '稳定币支付正在加速',
        hot_score: 98
      },
      {
        rank: 2,
        author: 'bob',
        post_id: 'post_2',
        post_url: 'https://x.com/bob/status/2',
        author_summary_zh: '没有视频的条目'
      }
    ]
  };
  const deps = {
    sendError,
    paths: {
      PROJECT_ROOT: tempRoot,
      PROJECTS_DIR: path.join(tempRoot, 'projects'),
      DATA_DIR: path.join(tempRoot, 'data'),
      PUBLISH_CENTER_DIR: path.join(tempRoot, 'python', 'publish'),
      WECHAT_RPA_PROFILE_ROOT: path.join(tempRoot, 'python', 'publish', 'browser_profiles', 'wechatChannels'),
      PLATFORM_RPA_PROFILE_ROOT: path.join(tempRoot, 'python', 'publish', 'browser_profiles'),
      VERTICAL_QUEUE_ROOT: path.join(tempRoot, 'data', 'uploads', 'xai_vertical_queue'),
      VERTICAL_PUBLIC_DIR: path.join(tempRoot, 'public', 'xai_vertical_queue')
    },
    selfCheckService: {
      run: jest.fn(() => ({
        summary: { status: 'ok', failCount: 0, warnCount: 0, okCount: 1 },
        groups: []
      }))
    },
    xaiService: {
      ensureTranslatedResult: jest.fn(() => xaiResult),
      readConfig: jest.fn(() => ({
        activePartitionId: 'crypto',
        partitions: [
          { id: 'crypto', label: '加密', description: 'Crypto / Web3', accounts: ['alice', 'bob'] },
          { id: 'ai', label: 'AI', description: 'AI news', accounts: [] }
        ]
      })),
      getStatus: jest.fn(() => ({
        running: false,
        partition: { id: 'crypto', label: '加密' },
        stage: null,
        hasResult: true,
        resultUpdatedAt: '2026-05-20T00:00:00.000Z',
        translation: { running: false },
        logTail: [],
        errorTail: []
      })),
      run: jest.fn(async (_clientId, res, partitionId) => res.json({
        success: true,
        result: { partition: { id: partitionId, label: '加密' }, items: [] },
        status: { running: false, partition: { id: partitionId, label: '加密' } }
      }))
    },
    materialDrivenStarter: {
      start: jest.fn(async () => ({ jobId: 'material_job_1', outputPath: 'material_material_job_1' })),
      getStatus: jest.fn(() => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'completed',
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1',
          narration: {
            full_text: '第一句口播。第二句口播。'
          },
          scriptUnits: {
            version: 'v1',
            script_units: [
              { id: 'script_001', text: '第一句口播。' },
              { id: 'script_002', text: '第二句口播。' }
            ]
          },
          sourcePost: {
            title: '稳定币支付正在加速',
            body: '稳定币支付正在加速',
            author: 'alice',
            postUrl: 'https://x.com/alice/status/1'
          },
          sourceMeta: {
            sourceAuthor: 'alice',
            sourcePostId: 'post_1',
            sourcePartitionId: 'crypto',
            sourcePartitionLabel: '加密',
            sourceRank: 1,
            videoUrl: 'https://video.twimg.com/1.mp4',
            postUrl: 'https://x.com/alice/status/1'
          }
        }
      })),
      retryStep: jest.fn(async () => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'waiting_avatar',
          currentStep: 5,
          progress: 80,
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1'
        }
      })),
      generateAvatarOnly: jest.fn(async () => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'generating_avatar',
          currentStep: 6,
          progress: 86,
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1'
        }
      })),
      updateAvatarConfig: jest.fn(async (_jobId, _outputPath, options = {}) => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'waiting_avatar',
          currentStep: 5,
          progress: 80,
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1',
          avatarConfig: options.avatarConfig || {}
        }
      })),
      renderFinal: jest.fn(async () => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'running',
          currentStep: 7,
          progress: 90,
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1'
        }
      })),
      continueOneClick: jest.fn(async () => ({
        success: true,
        task: {
          id: 'material_job_1',
          status: 'generating_avatar',
          currentStep: 6,
          progress: 86,
          outputPath: 'material_material_job_1',
          outputDir: 'material_material_job_1'
        }
      }))
    },
    reviewHandlers: {
      reviewVideo: jest.fn(),
      getHistory: jest.fn((_req, res) => res.json({
        success: true,
        records: [
          {
            id: 'review-1',
            asset_id: 'asset-1',
            video_path: 'video.mp4',
            review_status: 'failed',
            overall_score: 58,
            created_at: '2026-05-22T00:00:00.000Z',
            fix_suggestions: ['字幕需要提前']
          }
        ],
        total: 1,
        limit: 50,
        offset: 0
      })),
      getReview: jest.fn((req, res) => res.json({
        success: true,
        record: {
          id: req.params.reviewId,
          asset_id: 'asset-1',
          video_path: 'video.mp4',
          review_status: 'passed',
          overall_score: 88
        }
      }))
    },
    verticalQueueService: {
      getStatus: jest.fn(() => ({
        concurrency: 2,
        running: 0,
        queued: 0,
        jobs: []
      })),
      getJob: jest.fn(() => null),
      enqueue: jest.fn((item) => ({
        id: 'vertical_job_1',
        status: 'queued',
        progress: 0,
        message: '',
        createdAt: '2026-05-22T00:00:00.000Z',
        updatedAt: '2026-05-22T00:00:00.000Z',
        logs: [],
        ...item
      }))
    },
    taskStore: {
      listTasks: jest.fn(() => []),
      getTask: jest.fn(() => null)
    },
    publishStore: {
      makeJobId: jest.fn(() => 'publish_job_1'),
      readPublishConfig: jest.fn(() => ({
        wechatChannels: { enabled: true }
      })),
      readPublishJobs: jest.fn(() => publishPayload),
      writePublishJobs: jest.fn((payload) => {
        publishPayload.jobs = payload.jobs;
      })
    },
    publishAssetsService: {
      collectPublishAssets: jest.fn(() => [])
    },
    loginStatusService: {
      getAllStatus: jest.fn(() => [
        {
          accountId: 'wechat-1',
          accountLabel: '视频号 A',
          status: 'need_login',
          lastCheck: 1710000000000,
          qrCodePath: 'qrcode.png'
        }
      ]),
      getAccountStatus: jest.fn((accountId) => ({
        status: 'logged_in',
        lastCheck: 1710000000000,
        account: { displayName: `账号 ${accountId}` }
      })),
      requestLatestQrCode: jest.fn(async (accountId) => ({
        success: true,
        accountId,
        status: 'need_login',
        qrCodePath: path.join(tempRoot, 'python', 'publish', 'temp_qrcode.png'),
        refreshQrUrl: `/api/login-status/request-latest-qr/${accountId}`
      }))
    },
    accountDashboardService: {
      getAccountDashboard: jest.fn(async () => ({
        summary: {
          totalAccounts: 1,
          loggedInAccounts: 0,
          needLoginAccounts: 1
        },
        accounts: [
          {
            accountId: 'wechat-1',
            platform: 'wechatChannels',
            displayName: '视频号 A',
            loginStatus: { status: 'need_login' },
            stats: { totalJobs: 1, failureCount: 1 }
          }
        ]
      })),
      getAccountJobs: jest.fn(() => [
        {
          id: 'publish-job-1',
          status: 'failed',
          archived: false,
          selectedPlatforms: ['wechatChannels'],
          publishData: { title: '失败视频' },
          platformTasks: [
            { platform: 'wechatChannels', status: 'failed', accountId: 'wechat-1' }
          ]
        }
      ]),
      getAccountFailedJobs: jest.fn(() => [
        {
          id: 'publish-job-1',
          status: 'failed',
          archived: false,
          selectedPlatforms: ['wechatChannels'],
          publishData: { title: '失败视频' },
          platformTasks: [
            { platform: 'wechatChannels', status: 'failed', accountId: 'wechat-1' }
          ]
        }
      ])
    },
    generatePublishDescription: jest.fn(async () => '发布描述'),
    buildPublishTask: jest.fn((platform, publishData, videoUrl) => ({
      platform,
      title: publishData.title,
      description: publishData.description,
      videoUrl,
      status: 'rpa_available',
      requiredFields: []
    })),
    buildShortTitle: jest.fn((title) => title.slice(0, 16)),
    resetPublishAssetsCache: jest.fn(),
    startWechatRpa: jest.fn(),
    startPlatformRpa: jest.fn(),
    ...overrides
  };

  return { tempRoot, deps, publishPayload };
}

describe('agent auth', () => {
  test('rejects requests when token is not configured', () => {
    const middleware = createAgentAuthMiddleware({ token: '' });
    const req = {
      headers: {},
      query: {},
      ip: '127.0.0.1',
      get: jest.fn()
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('AGENT_AUTH_TOKEN_NOT_CONFIGURED');
  });

  test('accepts bearer token when configured', () => {
    const middleware = createAgentAuthMiddleware({ token: 'secret' });
    const req = {
      headers: { authorization: 'Bearer secret' },
      query: {},
      get: jest.fn((name) => req.headers[String(name).toLowerCase()])
    };
    const res = createMockResponse();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('agent handlers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('searchPosts filters existing xAI results and requires video by default', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.searchPosts({ body: { query: '稳定币', limit: 5 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0]).toEqual(expect.objectContaining({
      author: 'alice',
      postId: 'post_1',
      videoUrl: 'https://video.twimg.com/1.mp4'
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listHotspotPartitions returns partition metadata without account names', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listHotspotPartitions({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.partitions).toEqual([
      expect.objectContaining({ id: 'crypto', label: '加密', accountCount: 2 }),
      expect.objectContaining({ id: 'ai', label: 'AI', accountCount: 0 })
    ]);
    expect(JSON.stringify(res.body)).not.toContain('alice');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getHotspotRefreshStatus normalizes partition aliases', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.getHotspotRefreshStatus({ query: { partitionId: '加密' } }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.xaiService.getStatus).toHaveBeenCalledWith('crypto');
    expect(res.body.status.hasResult).toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('refreshHotspotLeaderboard runs xAI refresh for selected partition', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.refreshHotspotLeaderboard({
      body: { partitionId: 'ai' }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.xaiService.run).toHaveBeenCalledWith(expect.stringMatching(/^agent-ai-/), expect.any(Object), 'ai');
    expect(res.body.partitionId).toBe('ai');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('generateVideoFromPost dedupes repeated requests by idempotency key', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const firstRes = createMockResponse();
    const secondRes = createMockResponse();
    const req = {
      body: {
        idempotencyKey: 'same-request',
        post: {
          postId: 'post_1',
          partitionId: 'crypto'
        }
      },
      get: jest.fn()
    };

    await handlers.generateVideoFromPost(req, firstRes);
    await handlers.generateVideoFromPost(req, secondRes);

    expect(deps.materialDrivenStarter.start).toHaveBeenCalledTimes(1);
    expect(firstRes.body.job.jobId).toBe('material_job_1');
    expect(secondRes.body.idempotent).toBe(true);
    expect(secondRes.body.job.jobId).toBe('material_job_1');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('generateNarrationFromPost starts narration-first workflow without auto avatar generation', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.generateNarrationFromPost({
      body: {
        post: {
          postId: 'post_1',
          partitionId: 'crypto'
        }
      },
      get: jest.fn()
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.materialDrivenStarter.start).toHaveBeenCalledWith(expect.objectContaining({
      autoGenerate: false
    }));
    expect(res.body.job.workflowMode).toBe('narration_first');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('createVerticalFromMaterialJob imports completed material job with source task dirs and local video path', () => {
    const { tempRoot, deps } = createDeps();
    const projectDir = path.join(tempRoot, 'projects', 'material_material_job_1');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'output_final.mp4'), 'video');
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.createVerticalFromMaterialJob({
      body: {
        jobId: 'material_job_1',
        outputPath: '/mnt/c/Users/PC/Desktop/comfy_panel_demo/projects/material_material_job_1/output_final.mp4'
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'agent_material_job',
      sourceTaskDir: 'material_material_job_1',
      materialTaskDir: 'material_material_job_1',
      renderOptions: expect.objectContaining({
        originalVideoPath: path.join(projectDir, 'output_final.mp4'),
        sourceTaskDir: 'material_material_job_1',
        materialTaskDir: 'material_material_job_1'
      })
    }));
    expect(res.body.source.materialTaskDir).toBe('material_material_job_1');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('createVerticalFromPost queues vertical job from leaderboard rank', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.createVerticalFromPost({
      body: {
        partitionId: 'crypto',
        rank: 1
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'agent_hotspot',
      postId: 'post_1',
      videoUrl: 'https://video.twimg.com/1.mp4',
      sourcePartitionId: 'crypto',
      sourceRank: 1
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('createVerticalDirect queues no-avatar vertical job from local project video', () => {
    const { tempRoot, deps } = createDeps();
    const videoPath = path.join(tempRoot, 'data', 'uploads', 'source direct.mp4');
    fs.mkdirSync(path.dirname(videoPath), { recursive: true });
    fs.writeFileSync(videoPath, 'video');
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.createVerticalDirect({
      body: {
        videoPath,
        title: '直接竖屏',
        outputPath: 'material_material_job_1'
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.verticalQueueService.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'agent_direct_vertical',
      title: '直接竖屏',
      videoUrl: videoPath,
      sourceTaskDir: 'material_material_job_1',
      materialTaskDir: 'material_material_job_1',
      renderOptions: expect.objectContaining({
        originalVideoPath: videoPath,
        sourceTaskDir: 'material_material_job_1',
        materialTaskDir: 'material_material_job_1'
      })
    }));
    expect(res.body.message).toContain('不会生成口播稿或数字人');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('createVerticalDirect rejects local video paths outside allowed workspace roots', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.createVerticalDirect({
      body: {
        videoPath: path.join(os.tmpdir(), 'outside-video.mp4')
      }
    }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('AGENT_VERTICAL_SOURCE_MISSING');
    expect(deps.verticalQueueService.enqueue).not.toHaveBeenCalled();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listVerticalJobs returns queue snapshot with artifacts', () => {
    const { tempRoot, deps } = createDeps();
    const publicDir = path.join(tempRoot, 'public', 'xai_vertical_queue', 'vertical_job_1');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'vertical_output.mp4'), 'video');
    deps.verticalQueueService.getStatus.mockReturnValue({
      concurrency: 2,
      running: 0,
      queued: 0,
      jobs: [
        {
          id: 'vertical_job_1',
          status: 'completed',
          progress: 100,
          materialTaskDir: 'material_material_job_1',
          logs: ['done']
        }
      ]
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listVerticalJobs({ query: { materialTaskDir: 'material_material_job_1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].artifacts.resultVideo.publicUrl).toBe('/xai_vertical_queue/vertical_job_1/vertical_output.mp4');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listMaterialTasks returns completed material outputs for agent import', () => {
    const { tempRoot, deps } = createDeps();
    const projectDir = path.join(tempRoot, 'projects', 'material_material_job_1');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'output_final.mp4'), 'video');
    fs.writeFileSync(path.join(projectDir, 'source_post.json'), JSON.stringify({
      title: '稳定币支付正在加速',
      postUrl: 'https://x.com/alice/status/1'
    }));
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listMaterialTasks({ query: { limit: 10 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.tasks).toEqual([expect.objectContaining({
      outputDir: 'material_material_job_1',
      title: '稳定币支付正在加速',
      videoUrl: '/projects/material_material_job_1/output_final.mp4'
    })]);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getNarrationDraft returns script text and next action choices', () => {
    const { tempRoot, deps } = createDeps();
    deps.materialDrivenStarter.getStatus.mockReturnValue({
      success: true,
      task: {
        id: 'material_job_1',
        status: 'waiting_avatar',
        currentStep: 5,
        progress: 80,
        outputPath: 'material_material_job_1',
        outputDir: 'material_material_job_1',
        narration: {
          full_text: '第一句口播。第二句口播。'
        },
        scriptUnits: {
          version: 'v1',
          script_units: [
            { id: 'script_001', text: '第一句口播。' },
            { id: 'script_002', text: '第二句口播。' }
          ]
        }
      }
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.getNarrationDraft({
      params: { jobId: 'material_job_1' },
      query: { outputPath: 'material_material_job_1' }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.text).toContain('第一句口播');
    expect(res.body.next.actions.map((item) => item.name)).toContain('generate_avatar_video');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('reviseNarrationDraft writes manual narration and removes downstream artifacts before rebuilding step 5', async () => {
    const { tempRoot, deps } = createDeps();
    const projectDir = path.join(tempRoot, 'projects', 'material_material_job_1');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'aiman.mp4'), 'old-avatar');
    fs.writeFileSync(path.join(projectDir, 'output_final.mp4'), 'old-final');
    deps.materialDrivenStarter.getStatus.mockReturnValue({
      success: true,
      task: {
        id: 'material_job_1',
        status: 'waiting_avatar',
        outputPath: 'material_material_job_1',
        outputDir: 'material_material_job_1'
      }
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.reviseNarrationDraft({
      params: { jobId: 'material_job_1' },
      body: {
        outputPath: 'material_material_job_1',
        narrationText: '这是用户确认后的新版口播。'
      },
      query: {}
    }, res);

    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(projectDir, 'manual_narration.txt'), 'utf8')).toBe('这是用户确认后的新版口播。');
    expect(fs.existsSync(path.join(projectDir, 'aiman.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(projectDir, 'output_final.mp4'))).toBe(false);
    expect(deps.materialDrivenStarter.retryStep).toHaveBeenCalledWith('material_job_1', 'material_material_job_1', 5, expect.objectContaining({
      autoGenerate: false
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('updateAvatarConfig saves top-level RunningHub render provider into avatar config', async () => {
    const { tempRoot, deps } = createDeps();
    deps.materialDrivenStarter.getStatus.mockReturnValue({
      success: true,
      task: {
        id: 'material_job_1',
        status: 'waiting_avatar',
        outputPath: 'material_material_job_1',
        outputDir: 'material_material_job_1',
        avatarConfig: { renderProvider: 'comfyui' }
      }
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.updateAvatarConfig({
      params: { jobId: 'material_job_1' },
      body: {
        outputPath: 'material_material_job_1',
        renderProvider: 'runninghub',
        runningHubWorkflowId: 'workflow-1',
        runningHubOutputNodeId: '151'
      },
      query: {}
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.materialDrivenStarter.updateAvatarConfig).toHaveBeenCalledWith('material_job_1', 'material_material_job_1', {
      avatarConfig: expect.objectContaining({
        renderProvider: 'runninghub',
        runningHubWorkflowId: 'workflow-1',
        runningHubOutputNodeId: '151'
      })
    });
    expect(res.body.avatarConfig.renderProvider).toBe('runninghub');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('generateAvatarVideo forwards top-level RunningHub provider into avatar config', async () => {
    const { tempRoot, deps } = createDeps();
    deps.materialDrivenStarter.getStatus.mockReturnValue({
      success: true,
      task: {
        id: 'material_job_1',
        status: 'waiting_avatar',
        outputPath: 'material_material_job_1',
        outputDir: 'material_material_job_1',
        avatarConfig: { renderProvider: 'comfyui' }
      }
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.generateAvatarVideo({
      params: { jobId: 'material_job_1' },
      body: {
        outputPath: 'material_material_job_1',
        renderProvider: 'runninghub',
        runningHubWorkflowId: 'workflow-1',
        force: true
      },
      query: {}
    }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.materialDrivenStarter.generateAvatarOnly).toHaveBeenCalledWith('material_job_1', 'material_material_job_1', {
      avatarConfig: expect.objectContaining({
        renderProvider: 'runninghub',
        runningHubWorkflowId: 'workflow-1'
      }),
      force: true
    });

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('createPublishDraft creates a draft from a completed material job without publishing', async () => {
    const { tempRoot, deps, publishPayload } = createDeps();
    const projectDir = path.join(tempRoot, 'projects', 'material_material_job_1');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'output_final.mp4'), 'video');
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.createPublishDraft({
      body: {
        jobId: 'material_job_1',
        outputPath: 'material_material_job_1',
        platforms: ['wechatChannels']
      }
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.requiresConfirmation).toBe(true);
    expect(publishPayload.jobs).toHaveLength(1);
    expect(deps.startWechatRpa).not.toHaveBeenCalled();
    expect(publishPayload.jobs[0]).toEqual(expect.objectContaining({
      id: 'publish_job_1',
      agentCreated: true,
      status: 'ready'
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listReviewHistory and getReviewRecord expose review observability', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const historyRes = createMockResponse();
    const detailRes = createMockResponse();

    await handlers.listReviewHistory({ query: { limit: 10 } }, historyRes);
    await handlers.getReviewRecord({ params: { reviewId: 'review-1' }, query: {} }, detailRes);

    expect(historyRes.statusCode).toBe(200);
    expect(historyRes.body.records[0]).toEqual(expect.objectContaining({
      id: 'review-1',
      status: 'failed',
      overallScore: 58
    }));
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body.record).toEqual(expect.objectContaining({
      id: 'review-1',
      status: 'passed',
      overallScore: 88
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listPublishAssets filters available publish assets', () => {
    const { tempRoot, deps } = createDeps({
      publishAssetsService: {
        collectPublishAssets: jest.fn(() => [
          { id: 'asset-1', label: '加密成片', sourceType: 'material_driven', metadata: { suggestedTitle: '稳定币' } },
          { id: 'asset-2', label: 'AI 成片', sourceType: 'xai_queue', metadata: { suggestedTitle: '模型新闻' } }
        ])
      }
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listPublishAssets({ query: { query: '稳定', limit: 10 } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].id).toBe('asset-1');

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listPublishDrafts returns non-archived drafts by default', () => {
    const { tempRoot, deps, publishPayload } = createDeps();
    publishPayload.jobs = [
      { id: 'draft-1', status: 'ready', archived: false },
      { id: 'draft-2', status: 'ready', archived: true }
    ];
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listPublishDrafts({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toEqual([expect.objectContaining({ id: 'draft-1' })]);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getPublishScheduleSummary counts frontend scheduled publish jobs', () => {
    const { tempRoot, deps, publishPayload } = createDeps();
    publishPayload.jobs = [
      {
        id: 'scheduled-1',
        status: 'scheduled_wait',
        archived: false,
        scheduledAt: '2026-05-21T00:00:00.000Z',
        selectedPlatforms: ['wechatChannels'],
        publishData: { title: '定时视频' },
        platformTasks: [
          {
            platform: 'wechatChannels',
            status: 'scheduled_wait',
            accountId: 'acc-1',
            accountLabel: '视频号 A'
          }
        ]
      },
      {
        id: 'published-1',
        status: 'published',
        archived: false,
        selectedPlatforms: ['wechatChannels'],
        publishData: { title: '已发布视频' },
        platformTasks: [
          { platform: 'wechatChannels', status: 'published' }
        ]
      },
      {
        id: 'archived-1',
        status: 'failed',
        archived: true,
        selectedPlatforms: ['wechatChannels'],
        platformTasks: [
          { platform: 'wechatChannels', status: 'failed' }
        ]
      }
    ];
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.getPublishScheduleSummary({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.scheduled).toBe(1);
    expect(res.body.summary.due).toBe(1);
    expect(res.body.summary.published).toBe(1);
    expect(res.body.summary.byStatus).toEqual(expect.objectContaining({
      scheduled_wait: 1,
      published: 1
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('listScheduledPublishTasks only returns scheduled jobs', () => {
    const { tempRoot, deps, publishPayload } = createDeps();
    publishPayload.jobs = [
      {
        id: 'scheduled-1',
        status: 'scheduled_wait',
        archived: false,
        scheduledAt: '2026-05-23T00:00:00.000Z',
        selectedPlatforms: ['wechatChannels'],
        publishData: { title: '定时视频' },
        platformTasks: [
          { platform: 'wechatChannels', status: 'scheduled_wait' }
        ]
      },
      {
        id: 'ready-1',
        status: 'ready',
        archived: false,
        selectedPlatforms: ['wechatChannels'],
        publishData: { title: '普通草稿' },
        platformTasks: [
          { platform: 'wechatChannels', status: 'rpa_available' }
        ]
      }
    ];
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.listScheduledPublishTasks({ query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.jobs).toEqual([expect.objectContaining({
      id: 'scheduled-1',
      scheduled: true
    })]);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getPublishTaskStatus returns one publish job detail', () => {
    const { tempRoot, deps, publishPayload } = createDeps();
    publishPayload.jobs = [
      {
        id: 'scheduled-1',
        status: 'scheduled_wait',
        archived: false,
        scheduledAt: '2026-05-23T00:00:00.000Z',
        selectedPlatforms: ['wechatChannels'],
        publishData: { title: '定时视频' },
        platformTasks: [
          { platform: 'wechatChannels', status: 'scheduled_wait', accountLabel: '视频号 A' }
        ]
      }
    ];
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    handlers.getPublishTaskStatus({ params: { publishJobId: 'scheduled-1' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.job.title).toBe('定时视频');
    expect(res.body.job.platformTasks[0]).toEqual(expect.objectContaining({
      platform: 'wechatChannels',
      accountLabel: '视频号 A'
    }));

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('publish account dashboard and account jobs are exposed read-only', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const dashboardRes = createMockResponse();
    const jobsRes = createMockResponse();
    const failuresRes = createMockResponse();

    await handlers.getPublishAccountDashboard({}, dashboardRes);
    handlers.listPublishAccountJobs({
      params: { accountId: 'wechat-1' },
      query: { platform: 'wechatChannels' }
    }, jobsRes);
    handlers.listPublishAccountFailures({
      params: { accountId: 'wechat-1' },
      query: { platform: 'wechatChannels' }
    }, failuresRes);

    expect(dashboardRes.statusCode).toBe(200);
    expect(dashboardRes.body.summary.needLoginAccounts).toBe(1);
    expect(jobsRes.body.jobs[0]).toEqual(expect.objectContaining({
      id: 'publish-job-1',
      status: 'failed'
    }));
    expect(failuresRes.body.total).toBe(1);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('login status handlers read cached statuses without triggering checks', () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const listRes = createMockResponse();
    const singleRes = createMockResponse();

    handlers.listLoginStatuses({ query: {} }, listRes);
    handlers.getLoginStatus({ params: { accountId: 'wechat-1' }, query: {} }, singleRes);

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.summary.needLogin).toBe(1);
    expect(listRes.body.statuses[0]).toEqual(expect.objectContaining({
      accountId: 'wechat-1',
      status: 'need_login',
      hasQrCode: true
    }));
    expect(singleRes.body.status).toEqual(expect.objectContaining({
      accountId: 'wechat-1',
      status: 'logged_in'
    }));
    expect(deps.loginStatusService.requestLatestQrCode).not.toHaveBeenCalled();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getLoginQrCode refreshes and returns a safe image payload', async () => {
    const { tempRoot, deps } = createDeps();
    fs.mkdirSync(deps.paths.PUBLISH_CENTER_DIR, { recursive: true });
    const qrPath = path.join(deps.paths.PUBLISH_CENTER_DIR, 'temp_qrcode.png');
    fs.writeFileSync(qrPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    deps.loginStatusService.requestLatestQrCode.mockResolvedValueOnce({
      success: true,
      accountId: 'wechat-1',
      status: 'need_login',
      qrCodePath: qrPath,
      refreshQrUrl: '/api/login-status/request-latest-qr/wechat-1'
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.getLoginQrCode({ params: { accountId: 'wechat-1' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(deps.loginStatusService.requestLatestQrCode).toHaveBeenCalledWith('wechat-1', {
      notifyFeishu: false,
      trigger: 'agent_qrcode_request'
    });
    expect(res.body).toEqual(expect.objectContaining({
      success: true,
      accountId: 'wechat-1',
      status: 'need_login',
      requiresScan: true
    }));
    expect(res.body.image).toEqual(expect.objectContaining({
      hasQrCode: true,
      localQrCodePath: qrPath,
      mimeType: 'image/png',
      qrCodeBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')
    }));
    expect(res.body.image.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('getLoginQrCode does not read QR screenshots outside allowed roots', async () => {
    const { tempRoot, deps } = createDeps();
    const outsidePath = path.join(os.tmpdir(), `outside-qrcode-${Date.now()}.png`);
    fs.writeFileSync(outsidePath, Buffer.from('not allowed'));
    deps.loginStatusService.requestLatestQrCode.mockResolvedValueOnce({
      success: true,
      accountId: 'wechat-1',
      status: 'need_login',
      qrCodePath: outsidePath,
      refreshQrUrl: '/api/login-status/request-latest-qr/wechat-1'
    });
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.getLoginQrCode({ params: { accountId: 'wechat-1' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.requiresScan).toBe(false);
    expect(res.body.image).toEqual(expect.objectContaining({
      qrCodePath: outsidePath,
      localQrCodePath: '',
      hasQrCode: false,
      qrCodeBase64: ''
    }));

    fs.rmSync(outsidePath, { force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('confirmPublish refuses direct publish without explicit confirmation', async () => {
    const { tempRoot, deps } = createDeps();
    const handlers = createAgentHandlers(deps);
    const res = createMockResponse();

    await handlers.confirmPublish({
      body: {
        publishJobId: 'publish_job_1',
        platform: 'wechatChannels'
      }
    }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('AGENT_PUBLISH_CONFIRMATION_REQUIRED');
    expect(deps.startWechatRpa).not.toHaveBeenCalled();

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});
