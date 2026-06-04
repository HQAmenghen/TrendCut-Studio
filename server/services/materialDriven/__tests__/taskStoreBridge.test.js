const { TaskStore } = require('../../../core/taskStore');
const { getAvatarTaskKey, getMaterialTaskKey, syncAvatarTask, syncMaterialTask } = require('../taskStoreBridge');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('material driven task store bridge', () => {
  let tempDir;
  let taskStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-task-store-'));
    taskStore = new TaskStore(path.join(tempDir, 'tasks.db'));
  });

  afterEach(() => {
    taskStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('uses stable material task key from output directory', () => {
    const task = {
      outputPath: path.join(tempDir, 'material_123'),
      outputDir: 'material_123'
    };

    expect(getMaterialTaskKey(task)).toBe('material:material_123');
  });

  test('syncs material task status into database idempotently', () => {
    const task = {
      outputPath: path.join(tempDir, 'material_123'),
      outputDir: 'material_123',
      status: 'waiting_avatar',
      progress: 80,
      currentStep: 5,
      statusText: '等待数字人',
      startedAt: '2026-01-01T00:00:00.000Z',
      sourceMeta: { sourcePostId: 'post-1' },
      autoGenerate: true,
      useSmartClip: true,
      useCache: true
    };

    const first = syncMaterialTask(taskStore, task);
    task.progress = 86;
    task.status = 'generating_avatar';
    task.statusText = '数字人合成中';
    const second = syncMaterialTask(taskStore, task);

    expect(second.id).toBe(first.id);
    expect(second.taskKey).toBe('material:material_123');
    expect(second.status).toBe('running');
    expect(second.progress).toBe(86);
    expect(second.metadata).toMatchObject({
      outputDir: 'material_123',
      stage: 'generating_avatar',
      currentStep: 5,
      sourceMeta: { sourcePostId: 'post-1' }
    });
  });

  test('stores errored material tasks as failed records', () => {
    const task = {
      outputPath: path.join(tempDir, 'material_failed'),
      outputDir: 'material_failed',
      status: 'recovered',
      progress: 5,
      currentStep: 1,
      statusText: '已恢复初始素材状态',
      error: '进程退出，代码: 1'
    };

    const stored = syncMaterialTask(taskStore, task);

    expect(stored.status).toBe('failed');
    expect(stored.metadata).toMatchObject({
      outputDir: 'material_failed',
      stage: 'recovered',
      error: '进程退出，代码: 1'
    });
  });

  test('persists material task logs during status sync', () => {
    const task = {
      outputPath: path.join(tempDir, 'material_logs'),
      outputDir: 'material_logs',
      status: 'generating_avatar',
      progress: 86,
      currentStep: 6,
      statusText: '数字人动作计划生成失败: LLM 多次判断均未选择任何出镜动作',
      logs: [
        { time: '2026-01-01T00:00:00.000Z', message: '开始生成数字人动作计划与姿态序列', type: 'info' },
        { time: '2026-01-01T00:00:01.000Z', message: '数字人动作计划生成失败: LLM 多次判断均未选择任何出镜动作', type: 'error' }
      ]
    };

    const stored = syncMaterialTask(taskStore, task, { error: task.statusText });
    const reloaded = taskStore.getTask(stored.id);

    expect(reloaded.logs).toEqual(task.logs);
    expect(reloaded.status).toBe('failed');
  });

  test('syncs RunningHub avatar task with provider task key', () => {
    const task = {
      outputPath: path.join(tempDir, 'material_123'),
      outputDir: 'material_123',
      status: 'generating_avatar',
      progress: 86,
      statusText: 'RunningHub 数字人合成中'
    };
    const avatarState = {
      provider: 'runninghub',
      status: 'submitted',
      taskId: '2059444888252145666',
      resumeKey: 'resume-1',
      submittedAt: '2026-01-01T00:00:00.000Z'
    };

    const stored = syncAvatarTask(taskStore, task, avatarState);

    expect(getAvatarTaskKey(task, avatarState)).toBe('runninghub:2059444888252145666');
    expect(stored.type).toBe('avatar_generation');
    expect(stored.taskKey).toBe('runninghub:2059444888252145666');
    expect(stored.status).toBe('running');
    expect(stored.metadata).toMatchObject({
      outputDir: 'material_123',
      provider: 'runninghub',
      providerTaskId: '2059444888252145666',
      sourceMaterialTaskKey: 'material:material_123',
      resumeKey: 'resume-1'
    });
  });
});
