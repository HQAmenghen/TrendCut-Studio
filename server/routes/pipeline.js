function registerPipelineRoutes(app, upload, handlers) {
  app.post('/api/plan-pipeline', upload.fields([{ name: 'material' }]), handlers.handlePlanPipeline);
  app.get('/api/plan-pipeline-result', handlers.handleGetPlanPipelineResult);
  app.post('/api/run-pipeline', upload.fields([{ name: 'material' }]), handlers.handleRunPipeline);
}

module.exports = { registerPipelineRoutes };
