const { createAgentAuthMiddleware } = require('../services/agent/auth');
const { createAgentAuditLogger } = require('../services/agent/auditLog');

function registerAgentRoutes(app, handlers, options = {}) {
  const auth = options.authMiddleware || createAgentAuthMiddleware({ token: options.token });
  const auditLogger = options.auditLogger || createAgentAuditLogger({ logPath: options.auditLogPath });
  const middleware = [auth, auditLogger.middleware].filter(Boolean);

  app.get('/api/agent/v1/health', middleware, handlers.health);
  app.get('/api/agent/v1/capabilities', middleware, handlers.capabilities);
  app.get('/api/agent/v1/hotspots/partitions', middleware, handlers.listHotspotPartitions);
  app.get('/api/agent/v1/hotspots/status', middleware, handlers.getHotspotRefreshStatus);
  app.post('/api/agent/v1/hotspots/refresh', middleware, handlers.refreshHotspotLeaderboard);
  app.post('/api/agent/v1/posts/search', middleware, handlers.searchPosts);
  app.post('/api/agent/v1/videos/generate-from-post', middleware, handlers.generateVideoFromPost);
  app.post('/api/agent/v1/videos/generate-narration-from-post', middleware, handlers.generateNarrationFromPost);
  app.get('/api/agent/v1/vertical/jobs', middleware, handlers.listVerticalJobs);
  app.post('/api/agent/v1/vertical/from-post', middleware, handlers.createVerticalFromPost);
  app.post('/api/agent/v1/vertical/direct', middleware, handlers.createVerticalDirect);
  app.post('/api/agent/v1/vertical/from-material-job', middleware, handlers.createVerticalFromMaterialJob);
  app.get('/api/agent/v1/vertical/jobs/:jobId', middleware, handlers.getVerticalJob);
  app.get('/api/agent/v1/material/tasks', middleware, handlers.listMaterialTasks);
  app.get('/api/agent/v1/jobs/:jobId', middleware, handlers.getJob);
  app.get('/api/agent/v1/jobs/:jobId/next-actions', middleware, handlers.getWorkflowNextActions);
  app.get('/api/agent/v1/jobs/:jobId/narration', middleware, handlers.getNarrationDraft);
  app.post('/api/agent/v1/jobs/:jobId/narration/revise', middleware, handlers.reviseNarrationDraft);
  app.post('/api/agent/v1/jobs/:jobId/avatar/config', middleware, handlers.updateAvatarConfig);
  app.post('/api/agent/v1/jobs/:jobId/avatar/generate', middleware, handlers.generateAvatarVideo);
  app.get('/api/agent/v1/jobs/:jobId/avatar', middleware, handlers.getAvatarStatus);
  app.get('/api/agent/v1/jobs/:jobId/avatar/preview', middleware, handlers.previewAvatarVideo);
  app.post('/api/agent/v1/jobs/:jobId/render-final', middleware, handlers.renderFinalVideo);
  app.post('/api/agent/v1/jobs/:jobId/continue-one-click', middleware, handlers.continueWorkflowOneClick);
  app.post('/api/agent/v1/videos/:jobId/review', middleware, handlers.reviewVideo);
  app.get('/api/agent/v1/reviews', middleware, handlers.listReviewHistory);
  app.get('/api/agent/v1/reviews/:reviewId', middleware, handlers.getReviewRecord);
  app.get('/api/agent/v1/publish/assets', middleware, handlers.listPublishAssets);
  app.get('/api/agent/v1/publish/drafts', middleware, handlers.listPublishDrafts);
  app.get('/api/agent/v1/publish/schedule', middleware, handlers.getPublishScheduleSummary);
  app.get('/api/agent/v1/publish/scheduled', middleware, handlers.listScheduledPublishTasks);
  app.get('/api/agent/v1/publish/tasks/:publishJobId', middleware, handlers.getPublishTaskStatus);
  app.get('/api/agent/v1/publish/accounts/dashboard', middleware, handlers.getPublishAccountDashboard);
  app.get('/api/agent/v1/publish/accounts/:accountId/jobs', middleware, handlers.listPublishAccountJobs);
  app.get('/api/agent/v1/publish/accounts/:accountId/failures', middleware, handlers.listPublishAccountFailures);
  app.post('/api/agent/v1/publish/draft', middleware, handlers.createPublishDraft);
  app.post('/api/agent/v1/publish/confirm', middleware, handlers.confirmPublish);
  app.get('/api/agent/v1/login-statuses', middleware, handlers.listLoginStatuses);
  app.get('/api/agent/v1/login-statuses/:accountId', middleware, handlers.getLoginStatus);
  app.post('/api/agent/v1/login-statuses/:accountId/qrcode', middleware, handlers.getLoginQrCode);
}

module.exports = {
  registerAgentRoutes
};
