const { registerSystemRoutes } = require('../system');

describe('system routes', () => {
  test('registers unified task endpoint', () => {
    const app = {
      get: jest.fn(),
      post: jest.fn()
    };
    const handlers = {
      getSelfCheck: jest.fn(),
      getUnifiedTasks: jest.fn(),
      getPresets: jest.fn(),
      getWorkflowConfig: jest.fn(),
      postWorkflowConfig: jest.fn(),
      listJsonFiles: jest.fn(),
      getJsonFile: jest.fn(),
      postJsonFile: jest.fn(),
      optimizeText: jest.fn(),
      convertVideo: jest.fn(),
      getFeishuConfig: jest.fn(),
      postFeishuConfig: jest.fn(),
      getLoginCheckConfig: jest.fn(),
      postLoginCheckConfig: jest.fn(),
      getLlmConfig: jest.fn(),
      postLlmConfig: jest.fn()
    };

    registerSystemRoutes(app, handlers);

    expect(app.get).toHaveBeenCalledWith('/api/system/tasks', handlers.getUnifiedTasks);
  });
});
