const fs = require('fs');
const os = require('os');
const path = require('path');

const { activeTasks, taskClients } = require('../sharedState');
const { spawn } = require('child_process');
const { createMaterialDrivenPipelineRunner } = require('../pipelineProcess');

jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const { EventEmitter } = require('events');
    return {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      on: jest.fn()
    };
  })
}));

describe('material-driven pipeline process recovery', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-process-'));
    activeTasks.clear();
    taskClients.clear();
    spawn.mockClear();
  });

  afterEach(() => {
    activeTasks.clear();
    taskClients.clear();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('continues through avatar recovery before step 6 when aiman.mp4 is missing', async () => {
    const outputPath = path.join(tempRoot, 'material_job');
    fs.mkdirSync(outputPath, { recursive: true });
    const order = [];
    const autoGenerateAvatar = jest.fn(async (_jobId, task) => {
      order.push('avatar');
      fs.writeFileSync(path.join(task.outputPath, 'aiman.mp4'), 'video', 'utf8');
    });
    const runner = createMaterialDrivenPipelineRunner({ autoGenerateAvatar });
    const task = {
      id: 'job',
      outputPath,
      autoGenerate: true,
      progress: 80,
      logs: []
    };

    runner.continueFromAvatarStep('job', task);
    expect(spawn).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    if (spawn.mock.calls.length) order.push('spawn');

    expect(autoGenerateAvatar).toHaveBeenCalledWith('job', task);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['avatar', 'spawn']);
    expect(task.status).toBe('running');
    expect(task.statusText).toBe('继续处理数字人映射并执行混剪');
  });

  test('reuses in-flight avatar recovery when continue is clicked repeatedly', async () => {
    const outputPath = path.join(tempRoot, 'material_duplicate');
    fs.mkdirSync(outputPath, { recursive: true });
    let releaseAvatar;
    const autoGenerateAvatar = jest.fn(() => new Promise((resolve) => {
      releaseAvatar = resolve;
    }));
    const runner = createMaterialDrivenPipelineRunner({ autoGenerateAvatar });
    const task = {
      id: 'job',
      outputPath,
      autoGenerate: true,
      progress: 80,
      logs: []
    };

    const first = runner.continueFromAvatarStep('job', task);
    const second = runner.continueFromAvatarStep('job', task);

    expect(autoGenerateAvatar).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ reused: false, alreadyRunning: false });
    expect(second).toMatchObject({ reused: true, alreadyRunning: true });
    expect(spawn).not.toHaveBeenCalled();

    fs.writeFileSync(path.join(outputPath, 'aiman.mp4'), 'video', 'utf8');
    releaseAvatar();
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('retrying step 6 clears terminal RunningHub state before submitting a new avatar render', async () => {
    const outputPath = path.join(tempRoot, 'material_retry_failed_avatar');
    fs.mkdirSync(outputPath, { recursive: true });
    let avatarStateAtSubmit;
    let releaseAvatar;
    const autoGenerateAvatar = jest.fn((_jobId, task) => new Promise((resolve) => {
      avatarStateAtSubmit = task.avatarRenderState;
      releaseAvatar = () => {
        task.avatarRenderState = {
          provider: 'runninghub',
          status: 'submitted',
          taskId: 'new-runninghub-task'
        };
        fs.writeFileSync(path.join(task.outputPath, 'aiman.mp4'), 'video', 'utf8');
        resolve();
      };
    }));
    const runner = createMaterialDrivenPipelineRunner({ autoGenerateAvatar });
    const task = {
      id: 'job',
      outputPath,
      outputDir: 'material_retry_failed_avatar',
      autoGenerate: true,
      progress: 86,
      status: 'failed',
      error: '[RunningHub 任务失败] old failure',
      logs: [],
      avatarRenderState: {
        provider: 'runninghub',
        status: 'failed',
        taskId: 'old-runninghub-task',
        error: '[RunningHub 任务失败] old failure'
      }
    };

    const result = runner.startRetryPipeline('job', task, 6);

    expect(result).toMatchObject({
      reused: false,
      alreadyRunning: false
    });
    expect(task).toMatchObject({
      status: 'generating_avatar',
      error: '',
      avatarRenderState: expect.objectContaining({
        status: 'retrying',
        taskId: '',
        previousTaskId: 'old-runninghub-task'
      })
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(autoGenerateAvatar).toHaveBeenCalledWith('job', task);
    expect(avatarStateAtSubmit).toMatchObject({
      status: 'retrying',
      taskId: '',
      previousTaskId: 'old-runninghub-task'
    });
    releaseAvatar();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
