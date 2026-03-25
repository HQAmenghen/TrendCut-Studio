function registerStandaloneRoute(app, standalone) {
  app.post('/api/generate-vertical-standalone', standalone.middleware, standalone.handler);
}

module.exports = {
  registerStandaloneRoute
};
