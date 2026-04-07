const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createTaskInput,
  createTaskResult,
  createTaskFailure,
  writeTaskInput,
  readTaskInput,
  writeTaskResult,
  readTaskResult,
  writeTaskFailure,
  readTaskFailure,
  readTaskOutput,
  isTaskCompleted,
  resolveArtifactPaths
} = require('../taskProtocol');

describe('taskProtocol', () => {
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-protocol-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createTaskInput', () => {
    it('should create task input object with all fields', () => {
      const taskInput = createTaskInput('task_123', 'vertical_queue', { videoUrl: 'https://example.com/video.mp4' }, '/work/dir');

      expect(taskInput.taskId).toBe('task_123');
      expect(taskInput.type).toBe('vertical_queue');
      expect(taskInput.input.videoUrl).toBe('https://example.com/video.mp4');
      expect(taskInput.workDir).toBe('/work/dir');
      expect(taskInput.createdAt).toBeDefined();
    });

    it('should handle empty input and workDir', () => {
      const taskInput = createTaskInput('task_123', 'pipeline', null, null);

      expect(taskInput.input).toEqual({});
      expect(taskInput.workDir).toBe('');
    });
  });

  describe('createTaskResult', () => {
    it('should create task result object with artifacts and metadata', () => {
      const artifacts = { video: 'output.mp4', subtitles: 'subtitles.json' };
      const metadata = { duration: 30.5, resolution: '1080x1920' };
      const taskResult = createTaskResult('task_123', artifacts, metadata);

      expect(taskResult.taskId).toBe('task_123');
      expect(taskResult.status).toBe('success');
      expect(taskResult.artifacts).toEqual(artifacts);
      expect(taskResult.metadata).toEqual(metadata);
      expect(taskResult.completedAt).toBeDefined();
    });

    it('should handle empty artifacts and metadata', () => {
      const taskResult = createTaskResult('task_123', null, null);

      expect(taskResult.artifacts).toEqual({});
      expect(taskResult.metadata).toEqual({});
    });
  });

  describe('createTaskFailure', () => {
    it('should create task failure object with error details', () => {
      const error = {
        code: 'DOWNLOAD_FAILED',
        message: 'Failed to download video',
        stage: 'download',
        details: 'Connection timeout'
      };
      const taskFailure = createTaskFailure('task_123', error);

      expect(taskFailure.taskId).toBe('task_123');
      expect(taskFailure.status).toBe('failed');
      expect(taskFailure.error.code).toBe('DOWNLOAD_FAILED');
      expect(taskFailure.error.message).toBe('Failed to download video');
      expect(taskFailure.error.stage).toBe('download');
      expect(taskFailure.error.details).toBe('Connection timeout');
      expect(taskFailure.failedAt).toBeDefined();
    });

    it('should use default values for missing error fields', () => {
      const taskFailure = createTaskFailure('task_123', {});

      expect(taskFailure.error.code).toBe('UNKNOWN_ERROR');
      expect(taskFailure.error.message).toBe('Unknown error');
      expect(taskFailure.error.stage).toBe('unknown');
      expect(taskFailure.error.details).toBe('');
    });
  });

  describe('writeTaskInput and readTaskInput', () => {
    it('should write and read task input', () => {
      const taskInput = createTaskInput('task_123', 'vertical_queue', { videoUrl: 'https://example.com/video.mp4' }, testDir);

      writeTaskInput(testDir, taskInput);
      const read = readTaskInput(testDir);

      expect(read).toEqual(taskInput);
    });

    it('should return null if task.json does not exist', () => {
      const read = readTaskInput(testDir);
      expect(read).toBeNull();
    });

    it('should return null if task.json is invalid JSON', () => {
      fs.writeFileSync(path.join(testDir, 'task.json'), 'invalid json', 'utf-8');
      const read = readTaskInput(testDir);
      expect(read).toBeNull();
    });
  });

  describe('writeTaskResult and readTaskResult', () => {
    it('should write and read task result', () => {
      const taskResult = createTaskResult('task_123', { video: 'output.mp4' }, { duration: 30.5 });

      writeTaskResult(testDir, taskResult);
      const read = readTaskResult(testDir);

      expect(read).toEqual(taskResult);
    });

    it('should return null if result.json does not exist', () => {
      const read = readTaskResult(testDir);
      expect(read).toBeNull();
    });
  });

  describe('writeTaskFailure and readTaskFailure', () => {
    it('should write and read task failure', () => {
      const taskFailure = createTaskFailure('task_123', { code: 'DOWNLOAD_FAILED', message: 'Failed', stage: 'download', details: 'Timeout' });

      writeTaskFailure(testDir, taskFailure);
      const read = readTaskFailure(testDir);

      expect(read).toEqual(taskFailure);
    });

    it('should return null if failure.json does not exist', () => {
      const read = readTaskFailure(testDir);
      expect(read).toBeNull();
    });
  });

  describe('readTaskOutput', () => {
    it('should return result.json if it exists', () => {
      const taskResult = createTaskResult('task_123', { video: 'output.mp4' }, {});
      writeTaskResult(testDir, taskResult);

      const output = readTaskOutput(testDir);
      expect(output).toEqual(taskResult);
      expect(output.status).toBe('success');
    });

    it('should return failure.json if result.json does not exist', () => {
      const taskFailure = createTaskFailure('task_123', { code: 'FAILED', message: 'Error', stage: 'test', details: '' });
      writeTaskFailure(testDir, taskFailure);

      const output = readTaskOutput(testDir);
      expect(output).toEqual(taskFailure);
      expect(output.status).toBe('failed');
    });

    it('should return null if neither file exists', () => {
      const output = readTaskOutput(testDir);
      expect(output).toBeNull();
    });
  });

  describe('isTaskCompleted', () => {
    it('should return true if result.json exists', () => {
      writeTaskResult(testDir, createTaskResult('task_123', {}, {}));
      expect(isTaskCompleted(testDir)).toBe(true);
    });

    it('should return true if failure.json exists', () => {
      writeTaskFailure(testDir, createTaskFailure('task_123', {}));
      expect(isTaskCompleted(testDir)).toBe(true);
    });

    it('should return false if neither file exists', () => {
      expect(isTaskCompleted(testDir)).toBe(false);
    });
  });

  describe('resolveArtifactPaths', () => {
    it('should resolve relative paths to absolute paths', () => {
      const artifacts = {
        video: 'output.mp4',
        subtitles: 'subtitles.json'
      };

      const resolved = resolveArtifactPaths(testDir, artifacts);

      expect(resolved.video).toBe(path.join(testDir, 'output.mp4'));
      expect(resolved.subtitles).toBe(path.join(testDir, 'subtitles.json'));
    });

    it('should keep absolute paths unchanged', () => {
      const absolutePath = path.join(testDir, 'output.mp4');
      const artifacts = { video: absolutePath };

      const resolved = resolveArtifactPaths(testDir, artifacts);

      expect(resolved.video).toBe(absolutePath);
    });

    it('should handle empty artifacts', () => {
      const resolved = resolveArtifactPaths(testDir, null);
      expect(resolved).toEqual({});
    });

    it('should handle non-string values', () => {
      const artifacts = {
        video: 'output.mp4',
        count: 5,
        enabled: true
      };

      const resolved = resolveArtifactPaths(testDir, artifacts);

      expect(resolved.video).toBe(path.join(testDir, 'output.mp4'));
      expect(resolved.count).toBe(5);
      expect(resolved.enabled).toBe(true);
    });
  });
});
