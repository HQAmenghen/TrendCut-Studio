function registerSystemRoutes(app, handlers) {
  app.get('/api/system/self-check', handlers.getSelfCheck);
  app.get('/api/presets', handlers.getPresets);
  app.get('/api/workflow-config', handlers.getWorkflowConfig);
  app.post('/api/workflow-config', handlers.postWorkflowConfig);
  app.get('/api/json-files', handlers.listJsonFiles);
  app.get('/api/json-files/:fileName', handlers.getJsonFile);
  app.post('/api/json-files/:fileName', handlers.postJsonFile);
  app.post('/api/optimize-text', handlers.optimizeText);
  app.post('/api/convert-video', handlers.convertVideo);
}

module.exports = {
  registerSystemRoutes
};
