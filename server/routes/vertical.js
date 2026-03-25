function registerVerticalRoutes(app, handlers) {
  app.get('/api/xai-top10/vertical-jobs', handlers.getStatus);
  app.post('/api/xai-top10/vertical-jobs', handlers.enqueue);
  app.post('/api/xai-top10/vertical-jobs/:jobId/cancel', handlers.cancel);
  app.delete('/api/xai-top10/vertical-jobs/:jobId', handlers.remove);
}

module.exports = {
  registerVerticalRoutes
};
