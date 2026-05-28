const fs = require('fs');
const os = require('os');
const path = require('path');

const { TaskStore } = require('../../../core/taskStore');
const { activeTasks, taskClients } = require('../sharedState');
const { createMaterialDrivenTaskRegistry, mergeSourceMeta } = require('../taskRegistry');

describe('material-driven task registry source metadata', () => {
  let tempRoot;
  let projectsDir;
  let taskStore;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-driven-registry-'));
    projectsDir = path.join(tempRoot, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    taskStore = new TaskStore(path.join(tempRoot, 'tasks.db'));
    activeTasks.clear();
    taskClients.clear();
  });

  afterEach(() => {
    taskStore.close();
    activeTasks.clear();
    taskClients.clear();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('merges task source metadata with source_post fallback', () => {
    expect(mergeSourceMeta(
      { sourceAuthor: 'BMNRBullz', sourceRank: 0 },
      {
        postId: '2052826049046536201',
        sourceRank: 1,
        materialUrl: 'https://video.twimg.com/bmnr.mp4',
        postUrl: 'https://x.com/BMNRBullz/status/2052826049046536201'
      }
    )).toEqual({
      sourceAuthor: 'BMNRBullz',
      sourcePostId: '2052826049046536201',
      sourcePartitionId: '',
      sourcePartitionLabel: '',
      sourceRank: 1,
      videoUrl: 'https://video.twimg.com/bmnr.mp4',
      postUrl: 'https://x.com/BMNRBullz/status/2052826049046536201'
    });
  });

  test('exposes source_post identity when recovering a legacy task', () => {
    const outputDir = 'material_legacy';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, 'source_post.json'), JSON.stringify({
      title: '股市首次触及7400点',
      body: 'Tom Lee预测年底前将达到7700点以上',
      author: 'BMNRBullz',
      postId: '2052826049046536201',
      sourceRank: 1,
      postUrl: 'https://x.com/BMNRBullz/status/2052826049046536201',
      materialUrl: 'https://video.twimg.com/bmnr.mp4'
    }), 'utf8');

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const task = registry.resolveTask('job-legacy', outputDir);
    const payload = registry.buildStatusPayload(task);

    expect(payload.task.sourceMeta).toEqual({
      sourceAuthor: 'BMNRBullz',
      sourcePostId: '2052826049046536201',
      sourcePartitionId: '',
      sourcePartitionLabel: '',
      sourceRank: 1,
      videoUrl: 'https://video.twimg.com/bmnr.mp4',
      postUrl: 'https://x.com/BMNRBullz/status/2052826049046536201'
    });
  });

  test('versions recovered final video URL by file mtime', () => {
    const outputDir = 'material_done';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, 'output_final.mp4'), 'video', 'utf8');

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const task = registry.resolveTask('job-done', outputDir);
    const payload = registry.buildStatusPayload(task);

    expect(payload.task.videoUrl).toMatch(new RegExp(`^/projects/${outputDir}/output_final\\.mp4\\?v=\\d+$`));
  });

  test('lists active task status payloads for dashboard queues', () => {
    const outputDir = 'material_active_avatar';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    activeTasks.set('job-avatar', {
      id: 'job-avatar',
      status: 'generating_avatar',
      currentStep: 6,
      progress: 86,
      statusText: '正在自动生成数字人...',
      outputPath,
      outputDir,
      logs: [{ time: '2026-05-27T00:00:00.000Z', message: '字幕已生成，进入数字人合成', type: 'info' }],
      startedAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:01:00.000Z',
      sourceMeta: { sourceAuthor: 'Cathie Wood' },
      avatarConfig: {}
    });

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'job-avatar',
      status: 'generating_avatar',
      currentStep: 6,
      progress: 86,
      statusText: '正在自动生成数字人...',
      outputPath: outputDir
    });
    expect(tasks[0].logs[0].message).toBe('字幕已生成，进入数字人合成');
  });

  test('merges active material and avatar tasks from database by output directory', () => {
    const material = taskStore.createTask('material_driven', {
      outputDir: 'material_db',
      outputPath: path.join(projectsDir, 'material_db'),
      stage: 'generating_avatar',
      currentStep: 6
    }, {
      taskKey: 'material:material_db'
    });
    taskStore.updateTask(material.id, {
      status: 'running',
      progress: 86,
      message: '数据库恢复的素材任务'
    });
    const avatar = taskStore.createTask('avatar_generation', {
      outputDir: 'material_db',
      provider: 'runninghub',
      providerTaskId: '2059444888252145666',
      stage: 'submitted'
    }, {
      taskKey: 'runninghub:2059444888252145666'
    });
    taskStore.updateTask(avatar.id, {
      status: 'running',
      progress: 86,
      message: '数据库恢复的 RunningHub 任务'
    });

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir }, { taskStore });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      outputPath: 'material_db',
      status: 'generating_avatar',
      statusText: '数据库恢复的素材任务',
      fromTaskStore: true,
      taskKey: 'material:material_db',
      avatarRenderState: expect.objectContaining({
        taskId: '2059444888252145666'
      })
    });
  });

  test('does not show stale avatar task after material output is completed', () => {
    const outputDir = 'material_done_with_avatar';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, 'output_final.mp4'), 'video', 'utf8');
    const avatar = taskStore.createTask('avatar_generation', {
      outputDir,
      provider: 'runninghub',
      providerTaskId: '2059444888252145666',
      stage: 'submitted'
    }, {
      taskKey: 'runninghub:2059444888252145666'
    });
    taskStore.updateTask(avatar.id, {
      status: 'running',
      progress: 99,
      message: '历史 RunningHub 任务仍在 DB 中'
    });

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir }, { taskStore });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(0);
  });

  test('does not promote failed RunningHub avatar state to active generation', () => {
    const material = taskStore.createTask('material_driven', {
      outputDir: 'material_failed_avatar',
      outputPath: path.join(projectsDir, 'material_failed_avatar'),
      stage: 'generating_avatar',
      currentStep: 6,
      avatarRenderState: {
        provider: 'runninghub',
        taskId: '2059844361310666754',
        status: 'failed',
        error: '[RunningHub 任务失败] torch.OutOfMemoryError'
      }
    }, {
      taskKey: 'material:material_failed_avatar'
    });
    taskStore.updateTask(material.id, {
      status: 'running',
      progress: 86,
      message: '数据库恢复的素材任务'
    });
    const avatar = taskStore.createTask('avatar_generation', {
      outputDir: 'material_failed_avatar',
      provider: 'runninghub',
      providerTaskId: '2059844361310666754',
      stage: 'failed',
      error: '[RunningHub 任务失败] torch.OutOfMemoryError'
    }, {
      taskKey: 'runninghub:2059844361310666754'
    });
    taskStore.updateTask(avatar.id, {
      status: 'failed',
      progress: 86,
      message: '[RunningHub 任务失败] torch.OutOfMemoryError'
    });

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir }, { taskStore });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      outputPath: 'material_failed_avatar',
      status: 'failed',
      error: '[RunningHub 任务失败] torch.OutOfMemoryError',
      progress: 86
    });
    expect(tasks[0].status).not.toBe('generating_avatar');
  });

  test('recovers RunningHub avatar tasks from project files without memory state', () => {
    const outputDir = 'material_1779844527596_f5e5b8d4';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, 'narration.json'), JSON.stringify({ full_text: '口播稿' }), 'utf8');
    fs.writeFileSync(path.join(outputPath, 'source_post.json'), JSON.stringify({
      title: 'Cathie Wood坚持比特币125万美元的预测',
      author: 'BitcoinArchive',
      savedAt: '2026-05-27T01:15:27.597Z'
    }), 'utf8');
    fs.writeFileSync(path.join(outputPath, 'avatar_render_state.json'), JSON.stringify({
      provider: 'runninghub',
      status: 'polling_interrupted',
      taskId: '2059444888252145666',
      submittedAt: '2026-05-27T01:21:39.490Z',
      updatedAt: '2026-05-27T01:22:32.784Z',
      error: 'api queue limit reached'
    }), 'utf8');

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: '1779844527596_f5e5b8d4',
      status: 'generating_avatar',
      currentStep: 6,
      progress: 86,
      statusText: 'RunningHub 数字人任务正在远端运行，可恢复查询，taskId=2059444888252145666',
      error: '',
      outputPath: outputDir,
      sourcePost: expect.objectContaining({
        title: 'Cathie Wood坚持比特币125万美元的预测'
      }),
      avatarRenderState: expect.objectContaining({
        taskId: '2059444888252145666'
      })
    });
  });

  test('keeps in-memory resume progress ahead of older disk recovery state', () => {
    const outputDir = 'material_1779844527596_f5e5b8d4';
    const outputPath = path.join(projectsDir, outputDir);
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, 'narration.json'), JSON.stringify({ full_text: '口播稿' }), 'utf8');
    fs.writeFileSync(path.join(outputPath, 'avatar_render_state.json'), JSON.stringify({
      provider: 'runninghub',
      status: 'polling_interrupted',
      taskId: '2059444888252145666',
      updatedAt: '2026-05-27T01:22:32.784Z'
    }), 'utf8');
    activeTasks.set('1779844527596_f5e5b8d4', {
      id: '1779844527596_f5e5b8d4',
      status: 'generating_avatar',
      currentStep: 6,
      progress: 87,
      statusText: '正在恢复数字人合成结果...',
      outputPath,
      outputDir,
      logs: [],
      updatedAt: '2026-05-27T01:30:00.000Z',
      avatarConfig: {}
    });

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const tasks = registry.listActiveStatusPayloads();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: '1779844527596_f5e5b8d4',
      progress: 87,
      statusText: '正在恢复数字人合成结果...'
    });
  });

  test('returns the latest completed material task from disk for dashboard restore', () => {
    const olderDir = path.join(projectsDir, 'material_older');
    const newerDir = path.join(projectsDir, 'material_newer');
    fs.mkdirSync(olderDir, { recursive: true });
    fs.mkdirSync(newerDir, { recursive: true });
    fs.writeFileSync(path.join(olderDir, 'output_final.mp4'), 'old', 'utf8');
    fs.writeFileSync(path.join(newerDir, 'output_final.mp4'), 'new', 'utf8');
    fs.writeFileSync(path.join(newerDir, 'source_post.json'), JSON.stringify({
      title: '最新成片',
      savedAt: '2026-05-27T02:00:00.000Z'
    }), 'utf8');
    const olderTime = new Date('2026-05-27T01:00:00.000Z');
    const newerTime = new Date('2026-05-27T02:45:34.000Z');
    fs.utimesSync(path.join(olderDir, 'output_final.mp4'), olderTime, olderTime);
    fs.utimesSync(path.join(newerDir, 'output_final.mp4'), newerTime, newerTime);

    const registry = createMaterialDrivenTaskRegistry({ PROJECTS_DIR: projectsDir });
    const task = registry.getLatestCompletedStatusPayload();

    expect(task).toMatchObject({
      id: 'newer',
      status: 'completed',
      currentStep: 7,
      progress: 100,
      outputPath: 'material_newer',
      sourcePost: expect.objectContaining({
        title: '最新成片'
      })
    });
    expect(task.videoUrl).toMatch(/^\/projects\/material_newer\/output_final\.mp4\?v=\d+$/);
  });
});
