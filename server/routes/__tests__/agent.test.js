const { registerAgentRoutes } = require('../agent');

describe('agent routes', () => {
  test('registers the V0 agent endpoint surface', () => {
    const app = {
      get: jest.fn(),
      post: jest.fn()
    };
    const handlers = {
      health: jest.fn(),
      capabilities: jest.fn(),
      listHotspotPartitions: jest.fn(),
      getHotspotRefreshStatus: jest.fn(),
      refreshHotspotLeaderboard: jest.fn(),
      searchPosts: jest.fn(),
      generateVideoFromPost: jest.fn(),
      generateNarrationFromPost: jest.fn(),
      listVerticalJobs: jest.fn(),
      createVerticalFromPost: jest.fn(),
      createVerticalDirect: jest.fn(),
      createVerticalFromMaterialJob: jest.fn(),
      getVerticalJob: jest.fn(),
      listMaterialTasks: jest.fn(),
      getJob: jest.fn(),
      getWorkflowNextActions: jest.fn(),
      getNarrationDraft: jest.fn(),
      reviseNarrationDraft: jest.fn(),
      updateAvatarConfig: jest.fn(),
      generateAvatarVideo: jest.fn(),
      getAvatarStatus: jest.fn(),
      previewAvatarVideo: jest.fn(),
      renderFinalVideo: jest.fn(),
      continueWorkflowOneClick: jest.fn(),
      reviewVideo: jest.fn(),
      listReviewHistory: jest.fn(),
      getReviewRecord: jest.fn(),
      listPublishAssets: jest.fn(),
      listPublishDrafts: jest.fn(),
      getPublishScheduleSummary: jest.fn(),
      listScheduledPublishTasks: jest.fn(),
      getPublishTaskStatus: jest.fn(),
      getPublishAccountDashboard: jest.fn(),
      listPublishAccountJobs: jest.fn(),
      listPublishAccountFailures: jest.fn(),
      createPublishDraft: jest.fn(),
      confirmPublish: jest.fn(),
      listLoginStatuses: jest.fn(),
      getLoginStatus: jest.fn(),
      getLoginQrCode: jest.fn()
    };
    const authMiddleware = jest.fn();
    const auditLogger = { middleware: jest.fn() };

    registerAgentRoutes(app, handlers, { authMiddleware, auditLogger });

    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/health', [authMiddleware, auditLogger.middleware], handlers.health);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/capabilities', [authMiddleware, auditLogger.middleware], handlers.capabilities);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/hotspots/partitions', [authMiddleware, auditLogger.middleware], handlers.listHotspotPartitions);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/hotspots/status', [authMiddleware, auditLogger.middleware], handlers.getHotspotRefreshStatus);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/hotspots/refresh', [authMiddleware, auditLogger.middleware], handlers.refreshHotspotLeaderboard);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/posts/search', [authMiddleware, auditLogger.middleware], handlers.searchPosts);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/videos/generate-from-post', [authMiddleware, auditLogger.middleware], handlers.generateVideoFromPost);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/videos/generate-narration-from-post', [authMiddleware, auditLogger.middleware], handlers.generateNarrationFromPost);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/vertical/jobs', [authMiddleware, auditLogger.middleware], handlers.listVerticalJobs);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/vertical/from-post', [authMiddleware, auditLogger.middleware], handlers.createVerticalFromPost);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/vertical/direct', [authMiddleware, auditLogger.middleware], handlers.createVerticalDirect);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/vertical/from-material-job', [authMiddleware, auditLogger.middleware], handlers.createVerticalFromMaterialJob);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/vertical/jobs/:jobId', [authMiddleware, auditLogger.middleware], handlers.getVerticalJob);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/material/tasks', [authMiddleware, auditLogger.middleware], handlers.listMaterialTasks);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId', [authMiddleware, auditLogger.middleware], handlers.getJob);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/next-actions', [authMiddleware, auditLogger.middleware], handlers.getWorkflowNextActions);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/narration', [authMiddleware, auditLogger.middleware], handlers.getNarrationDraft);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/narration/revise', [authMiddleware, auditLogger.middleware], handlers.reviseNarrationDraft);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/avatar/config', [authMiddleware, auditLogger.middleware], handlers.updateAvatarConfig);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/avatar/generate', [authMiddleware, auditLogger.middleware], handlers.generateAvatarVideo);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/avatar', [authMiddleware, auditLogger.middleware], handlers.getAvatarStatus);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/avatar/preview', [authMiddleware, auditLogger.middleware], handlers.previewAvatarVideo);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/render-final', [authMiddleware, auditLogger.middleware], handlers.renderFinalVideo);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/jobs/:jobId/continue-one-click', [authMiddleware, auditLogger.middleware], handlers.continueWorkflowOneClick);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/videos/:jobId/review', [authMiddleware, auditLogger.middleware], handlers.reviewVideo);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/reviews', [authMiddleware, auditLogger.middleware], handlers.listReviewHistory);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/reviews/:reviewId', [authMiddleware, auditLogger.middleware], handlers.getReviewRecord);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/assets', [authMiddleware, auditLogger.middleware], handlers.listPublishAssets);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/drafts', [authMiddleware, auditLogger.middleware], handlers.listPublishDrafts);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/schedule', [authMiddleware, auditLogger.middleware], handlers.getPublishScheduleSummary);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/scheduled', [authMiddleware, auditLogger.middleware], handlers.listScheduledPublishTasks);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/tasks/:publishJobId', [authMiddleware, auditLogger.middleware], handlers.getPublishTaskStatus);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/accounts/dashboard', [authMiddleware, auditLogger.middleware], handlers.getPublishAccountDashboard);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/accounts/:accountId/jobs', [authMiddleware, auditLogger.middleware], handlers.listPublishAccountJobs);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/publish/accounts/:accountId/failures', [authMiddleware, auditLogger.middleware], handlers.listPublishAccountFailures);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/publish/draft', [authMiddleware, auditLogger.middleware], handlers.createPublishDraft);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/publish/confirm', [authMiddleware, auditLogger.middleware], handlers.confirmPublish);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/login-statuses', [authMiddleware, auditLogger.middleware], handlers.listLoginStatuses);
    expect(app.get).toHaveBeenCalledWith('/api/agent/v1/login-statuses/:accountId', [authMiddleware, auditLogger.middleware], handlers.getLoginStatus);
    expect(app.post).toHaveBeenCalledWith('/api/agent/v1/login-statuses/:accountId/qrcode', [authMiddleware, auditLogger.middleware], handlers.getLoginQrCode);
  });
});
