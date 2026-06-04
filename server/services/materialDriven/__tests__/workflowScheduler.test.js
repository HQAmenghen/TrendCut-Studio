const { activeTasks, taskClients } = require('../sharedState');
const { createMaterialWorkflowScheduler } = require('../workflowScheduler');

describe('material workflow scheduler', () => {
  beforeEach(() => {
    activeTasks.clear();
    taskClients.clear();
  });

  afterEach(() => {
    activeTasks.clear();
    taskClients.clear();
  });

  function createTask(id) {
    return {
      id,
      status: 'queued',
      progress: 1,
      statusText: 'waiting',
      logs: [],
      outputPath: `C:/tmp/material_${id}`,
      outputDir: `material_${id}`
    };
  }

  test('runs two complete workflows and queues the third until a slot is released', () => {
    const scheduler = createMaterialWorkflowScheduler({ concurrency: 2 });
    const started = [];
    const task1 = createTask('job-1');
    const task2 = createTask('job-2');
    const task3 = createTask('job-3');

    const first = scheduler.submit('job-1', task1, () => {
      started.push('job-1');
    });
    const second = scheduler.submit('job-2', task2, () => {
      started.push('job-2');
    });
    const third = scheduler.submit('job-3', task3, () => {
      started.push('job-3');
    });

    expect(first.queued).toBe(false);
    expect(second.queued).toBe(false);
    expect(third).toMatchObject({ queued: true, queuePosition: 1 });
    expect(started).toEqual(['job-1', 'job-2']);
    expect(task3).toMatchObject({
      status: 'queued',
      statusText: '完整流程排队中，等待空闲执行位'
    });

    task1.status = 'completed';
    scheduler.release('job-1');

    expect(started).toEqual(['job-1', 'job-2', 'job-3']);
    expect(task3.status).toBe('running');
    expect(scheduler.getStatus()).toMatchObject({
      concurrency: 2,
      running: 2,
      queued: 0
    });
  });

  test('removes a queued workflow before it starts', () => {
    const scheduler = createMaterialWorkflowScheduler({ concurrency: 1 });
    const started = [];
    const task1 = createTask('job-1');
    const task2 = createTask('job-2');

    scheduler.submit('job-1', task1, () => {
      started.push('job-1');
    });
    scheduler.submit('job-2', task2, () => {
      started.push('job-2');
    });

    expect(scheduler.remove('job-2')).toBe(true);
    task1.status = 'completed';
    scheduler.release('job-1');

    expect(started).toEqual(['job-1']);
    expect(scheduler.getStatus()).toMatchObject({
      running: 0,
      queued: 0
    });
  });
});
