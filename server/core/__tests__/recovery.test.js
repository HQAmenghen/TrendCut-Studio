/**
 * 任务恢复服务测试
 *
 * 测试目标：
 * - 确保恢复服务能扫描到所有中断的任务
 * - 确保恢复逻辑正确工作
 */

const path = require('path');
const fs = require('fs');
const { TaskStore } = require('../taskStore');
const { createRecoveryService } = require('../recovery');

describe('任务恢复服务', () => {
  let taskStore;
  let recoveryService;
  let testDbPath;
  let mockVerticalQueueService;

  beforeEach(() => {
    // 创建临时测试数据库
    testDbPath = path.join(__dirname, 'test_recovery.db');
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // 忽略
      }
    }

    taskStore = new TaskStore(testDbPath);

    // Mock verticalQueueService
    mockVerticalQueueService = {
      enqueue: jest.fn(),
      recoverPersistedJobs: jest.fn(() => ({ recovered: 1, completed: 0, requeued: 1 }))
    };

    recoveryService = createRecoveryService({
      taskStore,
      verticalQueueService: mockVerticalQueueService
    });
  });

  afterEach(() => {
    // 清理恢复服务的定时器
    if (recoveryService && typeof recoveryService.cleanup === 'function') {
      recoveryService.cleanup();
    }

    // 关闭数据库连接
    if (taskStore && taskStore.db) {
      taskStore.db.close();
    }

    // 清理测试数据库
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch (err) {
        // 忽略删除失败（可能被锁定）
      }
    }
  });

  test('应该能扫描到所有类型的中断任务', () => {
    // 创建不同类型的运行中任务
    const task1 = taskStore.createTask('vertical_queue', {
      originalItem: { title: 'Test Video' }
    });
    taskStore.updateTask(task1.id, { status: 'running', progress: 50, message: 'Processing video' });

    const task2 = taskStore.createTask('xai_top10', {});
    taskStore.updateTask(task2.id, { status: 'running', progress: 30, message: 'Fetching rankings' });

    const task3 = taskStore.createTask('wechat_rpa', {});
    taskStore.updateTask(task3.id, { status: 'running', progress: 70, message: 'Publishing to WeChat' });

    // 扫描中断任务
    const interrupted = recoveryService.scanInterruptedTasks();

    // 应该找到所有 3 个任务
    expect(interrupted).toHaveLength(3);
    expect(interrupted.map(t => t.type).sort()).toEqual(['vertical_queue', 'wechat_rpa', 'xai_top10']);
  });

  test('应该忽略非运行状态的任务', () => {
    // 创建各种状态的任务
    const task1 = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task1.id, { status: 'running', progress: 50 });

    const _task2 = taskStore.createTask('vertical_queue', {});
    // task2 保持 queued 状态

    const task3 = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task3.id, { status: 'completed', progress: 100 });

    const task4 = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task4.id, { status: 'failed', progress: 50 });

    // 扫描中断任务
    const interrupted = recoveryService.scanInterruptedTasks();

    // 只应该找到 running 状态的任务
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].status).toBe('running');
  });

  test('应该正确标记任务为中断', () => {
    const task = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task.id, { status: 'running', progress: 50 });

    // 标记为中断
    recoveryService.markAsInterrupted(taskStore.getTask(task.id), 'service_restart');

    // 验证任务状态
    const updatedTask = taskStore.getTask(task.id);
    expect(updatedTask.status).toBe('interrupted');
    expect(updatedTask.message).toContain('任务中断');
    expect(updatedTask.metadata.interruptedAt).toBeDefined();
    expect(updatedTask.metadata.interruptReason).toBe('service_restart');
  });

  test('应该根据任务类型选择正确的恢复策略', () => {
    // 创建自动恢复任务
    const autoTask = taskStore.createTask('vertical_queue', {
      originalItem: { title: 'Test' }
    });
    taskStore.updateTask(autoTask.id, { status: 'running', progress: 50 });

    // 创建手动恢复任务
    const manualTask = taskStore.createTask('wechat_rpa', {});
    taskStore.updateTask(manualTask.id, { status: 'running', progress: 70 });

    // 标记为中断
    recoveryService.markAsInterrupted(taskStore.getTask(autoTask.id), 'test');
    recoveryService.markAsInterrupted(taskStore.getTask(manualTask.id), 'test');

    // 验证恢复策略
    const autoTaskUpdated = taskStore.getTask(autoTask.id);
    const manualTaskUpdated = taskStore.getTask(manualTask.id);

    expect(autoTaskUpdated.metadata.recoveryStrategy).toBe('auto');
    expect(manualTaskUpdated.metadata.recoveryStrategy).toBe('manual');
  });

  test('启动恢复应该处理所有中断的任务', async () => {
    // 创建多个很久没更新的任务
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const task1 = taskStore.createTask('vertical_queue', {
      originalItem: { title: 'Test 1' }
    });
    taskStore.updateTask(task1.id, { status: 'running', progress: 50, updatedAt: tenMinutesAgo });

    const task2 = taskStore.createTask('xai_top10', {});
    taskStore.updateTask(task2.id, { status: 'running', progress: 30, updatedAt: tenMinutesAgo });

    // 执行启动恢复
    const results = await recoveryService.recoverOnStartup();

    // 应该恢复所有任务
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.success || r.action === 'still_alive')).toBe(true);
  });

  test('手动重试竖屏任务应该按原任务 ID 恢复队列而不是创建新任务', async () => {
    // 创建一个中断的任务
    const task = taskStore.createTask('vertical_queue', {
      originalItem: { title: 'Test' },
      retryCount: 1
    });
    taskStore.updateTask(task.id, { status: 'interrupted', progress: 50 });

    // 手动重试
    const result = await recoveryService.manualRetry(task.id);

    // 应该成功
    expect(result.success).toBe(true);

    // 任务应该被重置为 pending，并由竖屏队列服务按原 ID 恢复
    const updatedTask = taskStore.getTask(task.id);
    expect(updatedTask.status).toBe('pending');
    expect(updatedTask.progress).toBe(0);
    expect(updatedTask.metadata.retryCount).toBe(2);
    expect(mockVerticalQueueService.recoverPersistedJobs).toHaveBeenCalledWith({ includeCompletedArtifacts: false });
    expect(mockVerticalQueueService.enqueue).not.toHaveBeenCalled();
  });

  test('应该自动恢复中断的 RunningHub 数字人任务并继续素材链路', async () => {
    const outputDir = 'material_recover_avatar';
    const outputPath = path.join(path.dirname(testDbPath), outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    const continueOneClick = jest.fn(async () => ({ success: true }));
    recoveryService = createRecoveryService({
      taskStore,
      verticalQueueService: mockVerticalQueueService,
      materialDrivenStarter: { continueOneClick }
    });
    const task = taskStore.createTask('avatar_generation', {
      outputDir,
      outputPath,
      provider: 'runninghub',
      providerTaskId: 'rh_task_1',
      sourceMaterialTaskKey: `material:${outputDir}`,
      stage: 'polling_interrupted',
      resumeKey: 'resume-key',
      remoteAudioName: 'audio.wav',
      remoteImageName: 'image.png'
    });
    taskStore.updateTask(task.id, {
      status: 'interrupted',
      progress: 88,
      message: '数字人合成中断'
    });

    const results = await recoveryService.recoverOnStartup();
    const updatedTask = taskStore.getTask(task.id);
    const statePath = path.join(outputPath, 'avatar_render_state.json');

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: task.id,
        type: 'avatar_generation',
        action: 'avatar_continue_started'
      })
    ]));
    expect(continueOneClick).toHaveBeenCalledWith('recover_avatar', outputDir, expect.objectContaining({ useCache: true }));
    expect(updatedTask.status).toBe('running');
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual(expect.objectContaining({
      provider: 'runninghub',
      taskId: 'rh_task_1',
      resumeKey: 'resume-key'
    }));
  });

  test('手动恢复 RunningHub 数字人任务也应该继续素材链路', async () => {
    const outputDir = 'material_manual_avatar';
    const outputPath = path.join(path.dirname(testDbPath), outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    const continueOneClick = jest.fn(async () => ({ success: true }));
    recoveryService = createRecoveryService({
      taskStore,
      verticalQueueService: mockVerticalQueueService,
      materialDrivenStarter: { continueOneClick }
    });
    const task = taskStore.createTask('avatar_generation', {
      outputDir,
      outputPath,
      provider: 'runninghub',
      providerTaskId: 'rh_manual_1',
      sourceMaterialTaskKey: `material:${outputDir}`,
      stage: 'submitted',
      resumeKey: 'manual-resume'
    });
    taskStore.updateTask(task.id, { status: 'interrupted', progress: 90 });

    const result = await recoveryService.manualRetry(task.id);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      action: 'avatar_continue_started'
    }));
    expect(continueOneClick).toHaveBeenCalledWith('manual_avatar', outputDir, expect.objectContaining({ useCache: true }));
    expect(taskStore.getTask(task.id).status).toBe('running');
  });

  test('取消中断任务应该更新状态', () => {
    // 创建一个中断的任务
    const task = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task.id, { status: 'interrupted', progress: 50 });

    // 取消任务
    const result = recoveryService.cancelInterrupted(task.id);

    // 应该成功
    expect(result.success).toBe(true);

    // 任务应该被标记为 cancelled
    const updatedTask = taskStore.getTask(task.id);
    expect(updatedTask.status).toBe('cancelled');
    expect(updatedTask.completedAt).toBeDefined();
  });

  test('获取恢复状态应该返回所有中断任务', () => {
    // 创建一些运行中的任务
    const task1 = taskStore.createTask('vertical_queue', {});
    taskStore.updateTask(task1.id, { status: 'running', progress: 50 });

    const task2 = taskStore.createTask('wechat_rpa', {});
    taskStore.updateTask(task2.id, { status: 'running', progress: 70 });

    // 获取恢复状态
    const status = recoveryService.getRecoveryStatus();

    // 应该包含所有中断任务
    expect(status.enabled).toBe(true);
    expect(status.interruptedCount).toBe(2);
    expect(status.tasks).toHaveLength(2);
  });
});
