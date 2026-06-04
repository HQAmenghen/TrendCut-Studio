const path = require('path');

const { createVerticalQueueService } = require('../queue');

describe('vertical queue removal', () => {
  test('deletes paired taskStore record when removing a terminal job', () => {
    const taskStore = {
      listTasks: jest.fn(() => [{
        id: 'queue_done',
        type: 'vertical_queue',
        status: 'completed',
        progress: 100,
        message: 'done',
        metadata: {
          title: 'Completed queue item',
          videoUrl: 'https://cdn.example.com/video.mp4'
        },
        logs: [],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:01:00.000Z',
        startedAt: '2026-06-02T00:00:00.000Z',
        completedAt: '2026-06-02T00:01:00.000Z'
      }]),
      deleteTask: jest.fn()
    };
    const removeDirIfExists = jest.fn();
    const service = createVerticalQueueService({
      baseDir: __dirname,
      pipelineDir: __dirname,
      projectsDir: __dirname,
      verticalQueueRoot: path.join(__dirname, 'queue'),
      verticalPublicDir: path.join(__dirname, 'public'),
      taskStore,
      ensureDir: jest.fn(),
      makeJobId: jest.fn(),
      slugifyText: (value) => String(value || 'video'),
      sanitizeProcessLogLines: jest.fn(() => []),
      formatElapsedSeconds: jest.fn(),
      stopProcessTree: jest.fn(),
      removeDirIfExists,
      spawnScriptCancellable: jest.fn(),
      writeJsonFile: jest.fn(),
      runPythonScript: jest.fn(),
      writeMediaMetadata: jest.fn(),
      readMediaMetadata: jest.fn(),
      triggerAutoReview: jest.fn()
    });

    service.recoverPersistedJobs();
    service.remove('queue_done');

    expect(taskStore.deleteTask).toHaveBeenCalledWith('queue_done');
    expect(removeDirIfExists).toHaveBeenCalledWith(path.join(__dirname, 'queue', 'queue_done'));
    expect(removeDirIfExists).toHaveBeenCalledWith(path.join(__dirname, 'public', 'queue_done'));
  });
});
