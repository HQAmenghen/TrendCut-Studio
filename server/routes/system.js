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
  app.get('/api/system/feishu-config', handlers.getFeishuConfig);
  app.post('/api/system/feishu-config', handlers.postFeishuConfig);
  app.get('/api/system/login-check-config', handlers.getLoginCheckConfig);
  app.post('/api/system/login-check-config', handlers.postLoginCheckConfig);
  app.get('/api/system/llm-config', handlers.getLlmConfig);
  app.post('/api/system/llm-config', handlers.postLlmConfig);
}

module.exports = {
  registerSystemRoutes
};
