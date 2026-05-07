function registerStandaloneRoute(app, standalone) {
  app.get('/api/vertical/material-tasks', standalone.listMaterialTasks);
  app.post('/api/generate-vertical-standalone', standalone.middleware, standalone.handler);
}

module.exports = {
  registerStandaloneRoute
};
