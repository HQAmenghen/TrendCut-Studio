const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPythonScript, summarizePythonError } = require('../python');
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

  describe('runPythonScript', () => {
    test('includes protocol error details in thrown message', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-protocol-error-'));
      const scriptPath = path.join(tempDir, 'fail_with_protocol.py');
      fs.writeFileSync(scriptPath, [
        'import json',
        'import sys',
        'payload = {',
        '    "type": "error",',
        '    "code": "AVATAR_MOTION_PLAN_FAILED",',
        '    "message": "数字人动作计划生成失败",',
        '    "stage": "avatar_motion_plan",',
        '    "details": "数字人动作 LLM 多次判断均未选择任何出镜动作",',
        '    "hint": ""',
        '}',
        'print("__CODEX_PYTHON__" + json.dumps(payload, ensure_ascii=False), flush=True)',
        'sys.exit(1)'
      ].join('\n'), 'utf8');

      try {
        await expect(runPythonScript(scriptPath, [], { cwd: tempDir })).rejects.toMatchObject({
          code: 'AVATAR_MOTION_PLAN_FAILED',
          details: '数字人动作 LLM 多次判断均未选择任何出镜动作',
          message: expect.stringContaining('数字人动作计划生成失败: 数字人动作 LLM 多次判断均未选择任何出镜动作')
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
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
