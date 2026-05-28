const { createUnifiedTaskView, normalizeStatus } = require('../taskView');

describe('unified task view', () => {
  test('normalizes task status groups', () => {
    expect(normalizeStatus('scheduled_wait')).toBe('queued');
    expect(normalizeStatus('draft_preparing')).toBe('running');
    expect(normalizeStatus('ready_for_manual_publish')).toBe('completed');
  });

  test('combines taskStore, publishStore, and xai task projections', () => {
    const taskStore = {
      db: {
        prepare: () => ({
          all: () => [{
            id: 'task_1',
            taskKey: 'material:material_1',
            type: 'material_driven',
            status: 'running',
            progress: 42,
            message: '处理中',
            metadata: JSON.stringify({ outputDir: 'material_1' }),
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:03:00.000Z',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: null
          }]
        })
      }
    };
    const publishStore = {
      readPublishJobs: () => ({
        jobs: [{
          id: 'publish_1',
          status: 'ready',
          publishData: { title: '发布标题' },
          createdAt: '2026-01-01T00:01:00.000Z',
          updatedAt: '2026-01-01T00:02:00.000Z',
          platformTasks: [{
            platform: 'wechatChannels',
            status: 'draft_preparing',
            runtime: { progress: 30, lastMessage: '正在打开浏览器' }
          }]
        }]
      })
    };
    const xaiService = {
      getStatus: () => ({
        running: true,
        progressPercent: 55,
        progressMessage: '正在抓榜',
        updatedAt: '2026-01-01T00:04:00.000Z'
      })
    };

    const tasks = createUnifiedTaskView({ taskStore, publishStore, xaiService }).listTasks();

    expect(tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'material_driven', source: 'taskStore' }),
      expect.objectContaining({ type: 'publish', source: 'publishStore' }),
      expect.objectContaining({ type: 'publish_platform', status: 'running' }),
      expect.objectContaining({ type: 'xai_top10', progress: 55 })
    ]));
  });

  test('shows awaiting manual recovery tasks as interrupted even when raw status is running', () => {
    const taskStore = {
      db: {
        prepare: () => ({
          all: () => [{
            id: 'standalone_1',
            taskKey: 'sourceTaskDir:material_1',
            type: 'standalone_vertical',
            status: 'running',
            progress: 18,
            message: '正在刷新素材任务字幕',
            metadata: JSON.stringify({
              sourceTaskDir: 'material_1',
              awaitingManualRecovery: true
            }),
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:03:00.000Z',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: null
          }]
        })
      }
    };

    const tasks = createUnifiedTaskView({ taskStore }).listTasks();

    expect(tasks[0]).toEqual(expect.objectContaining({
      id: 'standalone_1',
      status: 'interrupted',
      rawStatus: 'running',
      message: '等待手动恢复：正在刷新素材任务字幕'
    }));
  });
});
