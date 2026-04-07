const { sendError } = require('../http');

describe('HTTP 错误处理', () => {
  let mockRes;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('sendError', () => {
    test('发送标准错误响应', () => {
      sendError(mockRes, {
        status: 400,
        code: 'TEST_ERROR',
        stage: 'test',
        error: 'Test error message',
        details: 'Test details',
        hint: 'Test hint'
      });

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Test error message',
        code: 'TEST_ERROR',
        stage: 'test',
        details: 'Test details',
        hint: 'Test hint'
      });
    });

    test('支持直接传入 Error 对象', () => {
      const error = new Error('Test error');
      error.code = 'TEST_CODE';
      error.stage = 'test.stage';
      error.details = 'Error details';
      error.hint = 'Error hint';
      error.status = 404;

      sendError(mockRes, error);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Test error',
        code: 'TEST_CODE',
        stage: 'test.stage',
        details: 'Error details',
        hint: 'Error hint'
      });
    });

    test('Error 对象缺少字段时使用默认值', () => {
      const error = new Error('Simple error');

      sendError(mockRes, error);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Simple error',
        code: 'INTERNAL_ERROR',
        stage: 'request',
        details: '',
        hint: ''
      });
    });

    test('使用默认值', () => {
      sendError(mockRes, {});

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: '请求失败',
        code: 'INTERNAL_ERROR',
        stage: 'request',
        details: '',
        hint: ''
      });
    });
  });
});
