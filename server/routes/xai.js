function registerXaiRoutes(app, handlers) {
  app.get('/api/xai-top10/result', handlers.getResult);
  app.get('/api/xai-top10/status', handlers.getStatus);
  app.get('/api/xai-top10/config', handlers.getConfig);
  app.post('/api/xai-top10/config', handlers.postConfig);
  app.post('/api/xai-top10/run', handlers.run);
  app.post('/api/xai-top10/import-url', handlers.importUrl);
}

module.exports = {
  registerXaiRoutes
};
