const { summarizePythonError } = require('../python');
const {
  loadPythonProtocolSchema,
  validatePythonProtocolEvent
} = require('../pythonProtocol');

describe('Python 子进程管理', () => {
  describe('summarizePythonError', () => {
    test('提取 stderr 和 stdout 尾部', () => {
      const error = {
        message: 'Script failed',
        code: 'PYTHON_SCRIPT_FAILED',
        stderr: 'line1\nline2\nline3\nline4\nline5',
        stdout: 'out1\nout2\nout3'
      };

      const summary = summarizePythonError(error, 2, 1);

      expect(summary.stderrTail).toEqual(['line4', 'line5']);
      expect(summary.stdoutTail).toEqual(['out3']);
      expect(summary.message).toBe('Script failed');
      expect(summary.code).toBe('PYTHON_SCRIPT_FAILED');
    });

    test('处理空 stderr/stdout', () => {
      const error = {
        message: 'Test error',
        code: 'TEST_CODE'
      };

      const summary = summarizePythonError(error);

      expect(summary.stderrTail).toEqual([]);
      expect(summary.stdoutTail).toEqual([]);
    });

    test('默认提取 20 行 stderr 和 12 行 stdout', () => {
      const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
      const error = {
        stderr: lines.join('\n'),
        stdout: lines.join('\n')
      };

      const summary = summarizePythonError(error);

      expect(summary.stderrTail.length).toBe(20);
      expect(summary.stdoutTail.length).toBe(12);
    });
  });

  describe('Python protocol contract', () => {
    test('loads the checked-in protocol schema', () => {
      const schema = loadPythonProtocolSchema();

      expect(schema.title).toBe('TrendCut Python Protocol Event');
      expect(schema.oneOf).toHaveLength(3);
    });

    test('accepts valid protocol events', () => {
      expect(validatePythonProtocolEvent({
        type: 'stage',
        stage: 'subtitle_reference_authority',
        message: 'working'
      })).toBe(true);
      expect(validatePythonProtocolEvent({
        type: 'result',
        message: 'done'
      })).toBe(true);
      expect(validatePythonProtocolEvent({
        type: 'error',
        code: 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED',
        message: 'failed',
        stage: 'subtitle_reference_authority',
        details: '',
        hint: ''
      })).toBe(true);
    });

    test('rejects malformed protocol events before they reach runtime state', () => {
      expect(() => validatePythonProtocolEvent({
        type: 'error',
        code: 'bad-code',
        message: 'failed',
        stage: 'subtitle_reference_authority',
        details: '',
        hint: ''
      })).toThrow(/UPPER_SNAKE_CASE/);

      expect(() => validatePythonProtocolEvent({
        type: 'stage',
        message: 'missing stage'
      })).toThrow(/missing stage/);
    });
  });
});
