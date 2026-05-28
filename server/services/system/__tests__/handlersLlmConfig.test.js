const { createSystemHandlers } = require('../handlers');

function createJsonResponse() {
  return {
    statusCode: 200,
    body: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

function createHandlers({ envValues = {}, updateProjectEnv = jest.fn() } = {}) {
  return createSystemHandlers({
    fs: {},
    path: require('path'),
    sendError: (_res, options) => options,
    baseDir: 'C:\\project',
    pipelineDir: 'C:\\project\\python\\pipeline',
    selfCheckService: {},
    editableJsonFiles: new Set(),
    resolveEditableJsonPath: jest.fn(),
    workflowPath: '',
    readWorkflow: jest.fn(),
    extractWorkflowConfig: jest.fn(),
    applyWorkflowConfig: jest.fn(),
    writeWorkflow: jest.fn(),
    runPythonScript: jest.fn(),
    readProjectEnv: jest.fn(() => ({ values: envValues })),
    updateProjectEnv
  });
}

describe('system llm config handlers', () => {
  test('returns qwen as global provider while text processing uses vertex', () => {
    const handlers = createHandlers({
      envValues: {
        LLM_PROVIDER: 'qwen',
        TEXT_LLM_PROVIDER: 'vertex',
        VERTEX_AI_AUTH_MODE: 'api_key',
        VERTEX_AI_API_KEY: 'vertex-key',
        VERTEX_AI_PROJECT: 'yumeato',
        VERTEX_AI_LOCATION: 'global',
        GEMINI_MODEL: 'gemini-3.1-pro-preview',
        AI_REVIEW_GEMINI_MODEL: 'gemini-2.5-pro'
      }
    });
    const res = createJsonResponse();

    handlers.getLlmConfig({}, res);

    expect(res.body.success).toBe(true);
    expect(res.body.config.provider).toBe('qwen');
    expect(res.body.config.textProvider).toBe('vertex');
    expect(res.body.config.vertex).toEqual({
      authMode: 'api_key',
      apiKey: 'vertex-key',
      project: 'yumeato',
      location: 'global'
    });
    expect(res.body.config.gemini.model).toBe('gemini-3.1-pro-preview');
  });

  test('saves qwen global provider with vertex text processing settings', () => {
    const updateProjectEnv = jest.fn();
    const handlers = createHandlers({ updateProjectEnv });
    const req = {
      body: {
        provider: 'qwen',
        textProvider: 'vertex',
        gemini: {
          apiKey: 'gemini-key',
          googleApiKey: '',
          baseUrl: '',
          model: 'gemini-3.1-pro-preview',
          reviewModel: 'gemini-2.5-pro',
          publishDescriptionModel: 'gemini-2.5-pro'
        },
        qwen: {
          apiKey: 'qwen-key-1;qwen-key-2',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          vlModel: 'qwen3-vl-flash',
          asrModel: 'qwen3-asr-flash-filetrans',
          textModel: 'qwen3.5-plus'
        },
        vertex: {
          authMode: 'api_key',
          apiKey: 'vertex-key',
          project: 'yumeato',
          location: 'global'
        },
        deepseek: {
          apiKey: 'deepseek-key-1;deepseek-key-2',
          baseUrl: 'https://api.deepseek.com/v1',
          textModel: 'deepseek-chat'
        }
      }
    };
    const res = createJsonResponse();

    handlers.postLlmConfig(req, res);

    expect(res.body.success).toBe(true);
    expect(updateProjectEnv).toHaveBeenCalledWith('C:\\project', expect.objectContaining({
      LLM_PROVIDER: 'qwen',
      TEXT_LLM_PROVIDER: 'vertex',
      SCRIPT_LLM_PROVIDER: 'vertex',
      VERTEX_AI_AUTH_MODE: 'api_key',
      VERTEX_AI_API_KEY: 'vertex-key',
      VERTEX_AI_PROJECT: 'yumeato',
      VERTEX_AI_LOCATION: 'global',
      GEMINI_MODEL: 'gemini-3.1-pro-preview',
      QWEN_API_KEY: 'qwen-key-1;qwen-key-2',
      DASHSCOPE_API_KEY: 'qwen-key-1;qwen-key-2',
      DEEPSEEK_API_KEY: 'deepseek-key-1;deepseek-key-2',
      DEEPSEEK_TEXT_MODEL: 'deepseek-chat'
    }));
  });

  test('returns and saves deepseek provider config', () => {
    const updateProjectEnv = jest.fn();
    const handlers = createHandlers({
      envValues: {
        LLM_PROVIDER: 'deepseek',
        TEXT_LLM_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'deepseek-key-1;deepseek-key-2',
        DEEPSEEK_API_BASE_URL: 'https://api.deepseek.com/v1',
        DEEPSEEK_TEXT_MODEL: 'deepseek-chat'
      },
      updateProjectEnv
    });
    const res = createJsonResponse();

    handlers.getLlmConfig({}, res);

    expect(res.body.success).toBe(true);
    expect(res.body.config.provider).toBe('deepseek');
    expect(res.body.config.textProvider).toBe('deepseek');
    expect(res.body.config.deepseek).toEqual({
      apiKey: 'deepseek-key-1;deepseek-key-2',
      baseUrl: 'https://api.deepseek.com/v1',
      textModel: 'deepseek-chat'
    });

    handlers.postLlmConfig({
      body: {
        provider: 'deepseek',
        textProvider: 'deepseek',
        deepseek: {
          apiKey: 'deepseek-key-3,deepseek-key-4',
          baseUrl: 'https://api.deepseek.com/v1',
          textModel: 'deepseek-reasoner'
        }
      }
    }, createJsonResponse());

    expect(updateProjectEnv).toHaveBeenCalledWith('C:\\project', expect.objectContaining({
      LLM_PROVIDER: 'deepseek',
      TEXT_LLM_PROVIDER: 'deepseek',
      SCRIPT_LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'deepseek-key-3,deepseek-key-4',
      DEEPSEEK_TEXT_MODEL: 'deepseek-reasoner'
    }));
  });
});
