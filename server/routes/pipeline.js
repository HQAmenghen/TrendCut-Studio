function registerPipelineRoutes(app, upload, handlers) {
  app.post('/api/generate', upload.fields([{ name: 'audio' }, { name: 'image' }]), handlers.handleGenerate);
  app.post('/api/run-pipeline', upload.fields([{ name: 'aiman' }, { name: 'material' }]), handlers.handleRunPipeline);
}

module.exports = { registerPipelineRoutes };
