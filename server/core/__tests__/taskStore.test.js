const { TaskStore } = require('../taskStore');
const fs = require('fs');
const path = require('path');

describe('统一任务存储', () => {
  let taskStore;
  const testDbPath = path.join(__dirname, 'test-tasks.db');

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    taskStore = new TaskStore(testDbPath);
  });

  afterEach(() => {
    taskStore.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
  });

  describe('createTask', () => {
    test('创建新任务', () => {
      const task = taskStore.createTask('vertical_queue', { videoUrl: 'test.mp4' });

      expect(task.id).toBeDefined();
      expect(task.taskKey).toBeNull();
      expect(task.type).toBe('vertical_queue');
      expect(task.status).toBe('queued');
      expect(task.progress).toBe(0);
      expect(task.metadata.videoUrl).toBe('test.mp4');
      expect(task.logs).toEqual([]);
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    test('任务 ID 唯一', () => {
      const task1 = taskStore.createTask('test');
      const task2 = taskStore.createTask('test');

      expect(task1.id).not.toBe(task2.id);
    });

    test('支持幂等任务键', () => {
      const task = taskStore.createTask('standalone_vertical', { sourceTaskDir: 'material_1' }, {
        taskKey: 'source:material_1'
      });

      expect(task.taskKey).toBe('source:material_1');
      expect(taskStore.findTaskByKey('standalone_vertical', 'source:material_1')).toEqual(task);
    });

    test('同类型同任务键只能创建一次', () => {
      taskStore.createTask('standalone_vertical', {}, { taskKey: 'source:material_1' });

      expect(() => {
        taskStore.createTask('standalone_vertical', {}, { taskKey: 'source:material_1' });
      }).toThrow();
    });
  });

  describe('createOrReuseTask', () => {
    test('复用同类型同任务键任务并合并元数据', () => {
      const first = taskStore.createOrReuseTask('standalone_vertical', 'source:material_1', {
        sourceTaskDir: 'material_1'
      });
      const second = taskStore.createOrReuseTask('standalone_vertical', 'source:material_1', {
        runtimeDir: 'standalone_123'
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.task.id).toBe(first.task.id);
      expect(second.task.metadata).toMatchObject({
        sourceTaskDir: 'material_1',
        runtimeDir: 'standalone_123'
      });
    });

    test('可按状态限制查找任务键', () => {
      const created = taskStore.createOrReuseTask('standalone_vertical', 'source:material_1', {});
      taskStore.updateTask(created.task.id, { status: 'completed', progress: 100 });

      expect(taskStore.findTaskByKey('standalone_vertical', 'source:material_1', {
        statuses: ['queued', 'running']
      })).toBeNull();
      expect(taskStore.findTaskByKey('standalone_vertical', 'source:material_1', {
        statuses: ['completed']
      })?.id).toBe(created.task.id);
    });
  });

  describe('updateTask', () => {
    test('更新任务状态', () => {
      const task = taskStore.createTask('vertical_queue');
      const originalUpdatedAt = task.updatedAt;

      taskStore.updateTask(task.id, { status: 'running', progress: 50, message: 'Processing...' });

      const updated = taskStore.getTask(task.id);
      expect(updated.status).toBe('running');
      expect(updated.progress).toBe(50);
      expect(updated.message).toBe('Processing...');
      // updatedAt 应该被更新（可能相同如果太快，但至少不会更早）
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime());
    });

    test('计算任务持续时间', () => {
      const task = taskStore.createTask('test');
      const startedAt = new Date('2024-01-01T10:00:00Z').toISOString();
      const completedAt = new Date('2024-01-01T10:05:30Z').toISOString();

      taskStore.updateTask(task.id, { startedAt, completedAt });

      const updated = taskStore.getTask(task.id);
      expect(updated.durationSeconds).toBe(330); // 5分30秒
    });

    test('任务不存在时抛出错误', () => {
      expect(() => {
        taskStore.updateTask('nonexistent', { status: 'running' });
      }).toThrow('Task not found');
    });
  });

  describe('getTask', () => {
    test('获取存在的任务', () => {
      const created = taskStore.createTask('test', { key: 'value' });
      const retrieved = taskStore.getTask(created.id);

      expect(retrieved).toEqual(created);
    });

    test('获取不存在的任务返回 null', () => {
      const task = taskStore.getTask('nonexistent');
      expect(task).toBeNull();
    });

    test('使用内存缓存', () => {
      const task = taskStore.createTask('test');

      // 第一次获取会从缓存
      const retrieved1 = taskStore.getTask(task.id);
      expect(retrieved1).toBe(task); // 同一个对象引用

      // 清除缓存后重新获取
      taskStore.memoryCache.clear();
      const retrieved2 = taskStore.getTask(task.id);
      expect(retrieved2).not.toBe(task); // 不同对象引用
      expect(retrieved2).toEqual(task); // 但内容相同
    });
  });

  describe('listTasks', () => {
    test('按类型查询任务', () => {
      taskStore.createTask('vertical_queue');
      taskStore.createTask('vertical_queue');
      taskStore.createTask('wechat_rpa');

      const tasks = taskStore.listTasks('vertical_queue');
      expect(tasks.length).toBe(2);
      expect(tasks.every(t => t.type === 'vertical_queue')).toBe(true);
    });

    test('按更新时间倒序排列', (done) => {
      const task1 = taskStore.createTask('test');
      setTimeout(() => {
        const task2 = taskStore.createTask('test');
        setTimeout(() => {
          const task3 = taskStore.createTask('test');

          const tasks = taskStore.listTasks('test');
          expect(tasks[0].id).toBe(task3.id);
          expect(tasks[1].id).toBe(task2.id);
          expect(tasks[2].id).toBe(task1.id);
          done();
        }, 5);
      }, 5);
    });

    test('限制返回数量', () => {
      for (let i = 0; i < 10; i++) {
        taskStore.createTask('test');
      }

      const tasks = taskStore.listTasks('test', 5);
      expect(tasks.length).toBe(5);
    });
  });

  describe('listActiveTasks', () => {
    test('只返回活跃任务', () => {
      const task1 = taskStore.createTask('test');
      const task2 = taskStore.createTask('test');
      const task3 = taskStore.createTask('test');

      taskStore.updateTask(task1.id, { status: 'running' });
      taskStore.updateTask(task2.id, { status: 'completed' });
      taskStore.updateTask(task3.id, { status: 'queued' });

      const activeTasks = taskStore.listActiveTasks('test');
      expect(activeTasks.length).toBe(2);
      expect(activeTasks.map(t => t.id).sort()).toEqual([task1.id, task3.id].sort());
    });
  });

  describe('appendLog', () => {
    test('添加日志', () => {
      const task = taskStore.createTask('test');
      taskStore.appendLog(task.id, 'Log message 1');
      taskStore.appendLog(task.id, 'Log message 2');

      const updated = taskStore.getTask(task.id);
      expect(updated.logs.length).toBe(2);
      expect(updated.logs[0]).toContain('Log message 1');
      expect(updated.logs[1]).toContain('Log message 2');
    });

    test('保留最近 120 条日志', () => {
      const task = taskStore.createTask('test');

      for (let i = 0; i < 150; i++) {
        taskStore.appendLog(task.id, `Log ${i}`);
      }

      const updated = taskStore.getTask(task.id);
      expect(updated.logs.length).toBe(120);
      expect(updated.logs[0]).toContain('Log 30'); // 前 30 条被丢弃
      expect(updated.logs[119]).toContain('Log 149');
    });

    test('任务不存在时静默失败', () => {
      expect(() => {
        taskStore.appendLog('nonexistent', 'test');
      }).not.toThrow();
    });
  });

  describe('deleteTask', () => {
    test('删除任务', () => {
      const task = taskStore.createTask('test');
      taskStore.deleteTask(task.id);

      const retrieved = taskStore.getTask(task.id);
      expect(retrieved).toBeNull();
    });

    test('从缓存中删除', () => {
      const task = taskStore.createTask('test');
      expect(taskStore.memoryCache.has(task.id)).toBe(true);

      taskStore.deleteTask(task.id);
      expect(taskStore.memoryCache.has(task.id)).toBe(false);
    });
  });
});
