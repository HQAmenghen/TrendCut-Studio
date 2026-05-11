/**
 * 发布任务定时调度测试
 *
 * 测试目标：
 * - 确保定时任务字段名一致性（scheduledAt）
 * - 确保到期任务能被正确识别
 * - 确保状态检查正确（scheduled_wait）
 */

const path = require('path');
const fs = require('fs');

describe('发布任务定时调度', () => {
  let publishStore;
  let testJobsPath;
  let jobSeq;

  beforeEach(() => {
    jobSeq = 0;
    // 创建临时测试文件
    testJobsPath = path.join(__dirname, 'test_publish_jobs.json');

    // Mock 依赖
    const mockDeps = {
      publishJobsPath: testJobsPath,
      readJsonIfExists: (filePath) => {
        if (!fs.existsSync(filePath)) return { jobs: [] };
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      },
      makeJobId: jest.fn(() => `job_store_${++jobSeq}`),
      deepClone: (obj) => JSON.parse(JSON.stringify(obj)) // 简单的深拷贝实现
    };

    // 导入 store 模块
    const { createPublishStore } = require('../store');
    publishStore = createPublishStore(mockDeps);

    // 初始化空数据
    fs.writeFileSync(testJobsPath, JSON.stringify({ jobs: [] }), 'utf-8');
  });

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testJobsPath)) {
      fs.unlinkSync(testJobsPath);
    }
  });

  test('应该使用 scheduledAt 字段存储定时时间', () => {
    // 创建一个定时任务
    const job = {
      id: 'test-job-1',
      status: 'scheduled_wait',
      scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(),
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    publishStore.writePublishJobs({ jobs: [job] });

    // 读取并验证
    const payload = publishStore.readPublishJobs();
    expect(payload.jobs[0].scheduledAt).toBe(job.scheduledAt);
    expect(payload.jobs[0].scheduledTime).toBeUndefined(); // 不应该有 scheduledTime
  });

  test('应该向自动发布调度暴露注入的唯一任务 ID 生成器', () => {
    expect(publishStore.makeJobId()).toBe('job_store_1');
    expect(publishStore.makeJobId()).toBe('job_store_2');
  });

  test('应该正确识别到期的定时任务', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const nowTimestamp = now.getTime();

    const jobs = [
      {
        id: 'job-1',
        status: 'scheduled_wait',
        scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(), // 2小时前，应该到期
        archived: false
      },
      {
        id: 'job-2',
        status: 'scheduled_wait',
        scheduledAt: new Date('2026-04-01T14:00:00Z').toISOString(), // 2小时后，未到期
        archived: false
      },
      {
        id: 'job-3',
        status: 'ready', // 状态不是 scheduled_wait
        scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(),
        archived: false
      },
      {
        id: 'job-4',
        status: 'scheduled_wait',
        scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(),
        archived: true // 已归档
      }
    ];

    publishStore.writePublishJobs({ jobs });

    // 获取到期任务
    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 应该只返回 job-1
    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-1');
  });

  test('应该只返回状态为 scheduled_wait 的任务', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const nowTimestamp = now.getTime();
    const pastTime = new Date('2026-04-01T10:00:00Z').toISOString();

    const jobs = [
      { id: 'job-1', status: 'scheduled_wait', scheduledAt: pastTime, archived: false },
      { id: 'job-2', status: 'pending', scheduledAt: pastTime, archived: false },
      { id: 'job-3', status: 'ready', scheduledAt: pastTime, archived: false },
      { id: 'job-4', status: 'published', scheduledAt: pastTime, archived: false }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 只有 scheduled_wait 状态的任务
    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-1');
    expect(dueJobs[0].status).toBe('scheduled_wait');
  });

  test('应该修复带 scheduledAt 但平台任务仍为可发布状态的定时任务', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const pastTime = new Date('2026-04-01T10:00:00Z').toISOString();
    const jobs = [
      {
        id: 'job-pending-scheduled',
        status: 'pending',
        scheduledAt: pastTime,
        archived: false,
        platformTasks: [
          { platform: 'wechatChannels', status: 'rpa_available' }
        ]
      }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(now.getTime());

    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-pending-scheduled');
    expect(dueJobs[0].status).toBe('scheduled_wait');
    expect(dueJobs[0].platformTasks[0].status).toBe('scheduled_wait');
  });

  test('应该忽略没有 scheduledAt 字段的任务', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const nowTimestamp = now.getTime();

    const jobs = [
      {
        id: 'job-1',
        status: 'scheduled_wait',
        scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(),
        archived: false
      },
      {
        id: 'job-2',
        status: 'scheduled_wait',
        // 没有 scheduledAt 字段
        archived: false
      }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 只返回有 scheduledAt 的任务
    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-1');
  });

  test('应该忽略已归档的任务', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const nowTimestamp = now.getTime();
    const pastTime = new Date('2026-04-01T10:00:00Z').toISOString();

    const jobs = [
      { id: 'job-1', status: 'scheduled_wait', scheduledAt: pastTime, archived: false },
      { id: 'job-2', status: 'scheduled_wait', scheduledAt: pastTime, archived: true }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 只返回未归档的任务
    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-1');
  });

  test('边界情况：scheduledAt 正好等于当前时间', () => {
    const now = new Date('2026-04-01T12:00:00Z');
    const nowTimestamp = now.getTime();

    const jobs = [
      {
        id: 'job-1',
        status: 'scheduled_wait',
        scheduledAt: now.toISOString(), // 正好等于当前时间
        archived: false
      }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 应该包含这个任务（<=）
    expect(dueJobs).toHaveLength(1);
    expect(dueJobs[0].id).toBe('job-1');
  });

  test('边界情况：scheduledAt 比当前时间晚 1 毫秒', () => {
    const now = new Date('2026-04-01T12:00:00.000Z');
    const nowTimestamp = now.getTime();
    const futureTime = new Date(nowTimestamp + 1).toISOString();

    const jobs = [
      {
        id: 'job-1',
        status: 'scheduled_wait',
        scheduledAt: futureTime,
        archived: false
      }
    ];

    publishStore.writePublishJobs({ jobs });

    const dueJobs = publishStore.getDueScheduledJobs(nowTimestamp);

    // 不应该包含这个任务
    expect(dueJobs).toHaveLength(0);
  });
});
