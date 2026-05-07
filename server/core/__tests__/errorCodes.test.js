const { createError, ERROR_CODES } = require('../errorCodes');

describe('错误码注册表', () => {
  describe('createError', () => {
    test('创建标准错误对象', () => {
      const error = createError('PYTHON_SCRIPT_FAILED', 'test details', 'test hint');

      expect(error.code).toBe('PYTHON_SCRIPT_FAILED');
      expect(error.stage).toBe('python');
      expect(error.message).toBe('Python 脚本执行失败');
      expect(error.details).toBe('test details');
      expect(error.hint).toBe('test hint');
      expect(error instanceof Error).toBe(true);
    });

    test('未知错误码返回带警告的错误', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const error = createError('UNKNOWN_CODE', 'some details');

      expect(error.code).toBe('UNKNOWN_CODE');
      expect(error.stage).toBe('unknown');
      expect(error.details).toBe('some details');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown error code'));

      consoleSpy.mockRestore();
    });

    test('details 和 hint 参数可选', () => {
      const error = createError('PYTHON_SCRIPT_FAILED');

      expect(error.details).toBe('');
      expect(error.hint).toBe('');
    });
  });

  describe('ERROR_CODES', () => {
    test('所有错误码都有 stage 和 message', () => {
      Object.entries(ERROR_CODES).forEach(([_code, template]) => {
        expect(template).toHaveProperty('stage');
        expect(template).toHaveProperty('message');
        expect(typeof template.stage).toBe('string');
        expect(typeof template.message).toBe('string');
        expect(template.stage.length).toBeGreaterThan(0);
        expect(template.message.length).toBeGreaterThan(0);
      });
    });

    test('错误码数量符合预期', () => {
      const codeCount = Object.keys(ERROR_CODES).length;
      expect(codeCount).toBeGreaterThan(60); // 至少 60 个错误码
    });

    test('关键错误码存在', () => {
      const criticalCodes = [
        'PYTHON_SCRIPT_FAILED',
        'VERTICAL_QUEUE_ENQUEUE_FAILED',
        'PUBLISH_WECHAT_START_FAILED',
        'REVIEW_EXECUTE_FAILED'
      ];

      criticalCodes.forEach(code => {
        expect(ERROR_CODES).toHaveProperty(code);
      });
    });
  });
});
