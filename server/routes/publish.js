function registerPublishRoutes(app, handlers) {
  app.get('/api/publish/config', handlers.getConfig);
  app.post('/api/publish/config', handlers.postConfig);
  app.get('/api/publish/assets', handlers.getAssets);
  app.post('/api/publish/description', handlers.generateDescription);
  app.get('/api/publish/jobs', handlers.getJobs);
  app.delete('/api/publish/jobs/:jobId', handlers.deleteJob);
  app.delete('/api/publish/jobs', handlers.deleteAllJobs);
  app.post('/api/publish/jobs/:jobId/archive', handlers.archiveJob);
  app.post('/api/publish/jobs/:jobId/unarchive', handlers.unarchiveJob);
  app.post('/api/publish/jobs/archive-completed', handlers.archiveCompleted);
  app.post('/api/publish/jobs', handlers.createJob);
  app.post('/api/publish/jobs/:jobId/regenerate-description', handlers.regenerateDescription);
  app.post("/api/publish/jobs/wechat-channels/start-all", handlers.startAllWechat);
  app.post('/api/publish/jobs/:jobId/wechat-channels', handlers.runWechat);
  app.post('/api/publish/jobs/:jobId/wechat-channels/retry', handlers.retryWechat);
  app.post('/api/publish/jobs/:jobId/wechat-channels/cancel', handlers.cancelWechat);
  app.post('/api/publish/wechat/test-login/:accountId', handlers.testWechatLogin);
}

module.exports = {
  registerPublishRoutes
};
