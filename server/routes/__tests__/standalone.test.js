const { registerStandaloneRoute } = require('../standalone');

describe('standalone routes', () => {
  test('registers vertical material task listing endpoint', () => {
    const app = {
      get: jest.fn(),
      post: jest.fn()
    };
    const standalone = {
      middleware: jest.fn(),
      handler: jest.fn(),
      listMaterialTasks: jest.fn()
    };

    registerStandaloneRoute(app, standalone);

    expect(app.get).toHaveBeenCalledWith('/api/vertical/material-tasks', standalone.listMaterialTasks);
    expect(app.post).toHaveBeenCalledWith('/api/generate-vertical-standalone', standalone.middleware, standalone.handler);
  });
});
