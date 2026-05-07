const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskStore } = require('../taskStore');
const { cleanupTaskWorkspaces } = require('../cleanup');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content = 'x') {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function touchTree(targetPath, date) {
  if (!fs.existsSync(targetPath)) return;
  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath)) {
      touchTree(path.join(targetPath, entry), date);
    }
  }
  fs.utimesSync(targetPath, date, date);
}

describe('task-aware cleanup', () => {
  let baseDir;
  let taskStore;

  const now = new Date('2026-04-24T00:00:00.000Z');

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-cleanup-'));
  });

  afterEach(() => {
    if (taskStore) {
      taskStore.close();
      taskStore = null;
    }
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  test('removes stale complete and invalid material-driven task directories', () => {
    const projectsDir = path.join(baseDir, 'projects');
    const staleComplete = path.join(projectsDir, 'material_stale_complete');
    const invalidIncomplete = path.join(projectsDir, 'material_invalid_incomplete');
    const recentIncomplete = path.join(projectsDir, 'material_recent_incomplete');
    const recentComplete = path.join(projectsDir, 'material_recent_complete');

    writeFile(path.join(staleComplete, 'output_final.mp4'), 'video');
    writeFile(path.join(invalidIncomplete, 'material.mp4'), 'source');
    writeFile(path.join(recentIncomplete, 'material.mp4'), 'source');
    writeFile(path.join(recentComplete, 'output_final.mp4'), 'video');

    touchTree(staleComplete, new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000));
    touchTree(invalidIncomplete, new Date(now.getTime() - 25 * 60 * 60 * 1000));
    touchTree(recentIncomplete, new Date(now.getTime() - 2 * 60 * 60 * 1000));
    touchTree(recentComplete, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));

    const summary = cleanupTaskWorkspaces(baseDir, {
      now,
      retentionDays: 7,
      invalidGraceHours: 24
    });

    expect(fs.existsSync(staleComplete)).toBe(false);
    expect(fs.existsSync(invalidIncomplete)).toBe(false);
    expect(fs.existsSync(recentIncomplete)).toBe(true);
    expect(fs.existsSync(recentComplete)).toBe(true);
    expect(summary.materialDriven.dirsRemoved).toBe(2);
    expect(summary.materialDriven.removed.map((item) => item.reason).sort()).toEqual(['invalid', 'stale']);
  });

  test('cleans vertical queue records and paired directories without deleting active memory jobs', () => {
    taskStore = new TaskStore(path.join(baseDir, 'tasks.db'));
    const staleTask = taskStore.createTask('vertical_queue', { title: 'old completed' });
    const invalidTask = taskStore.createTask('vertical_queue', { title: 'bad failed' });
    const runningTask = taskStore.createTask('vertical_queue', { title: 'active running' });

    const oldIso = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const invalidIso = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    taskStore.updateTask(staleTask.id, {
      status: 'completed',
      updatedAt: oldIso,
      completedAt: oldIso
    });
    taskStore.updateTask(invalidTask.id, {
      status: 'failed',
      updatedAt: invalidIso,
      completedAt: invalidIso
    });
    taskStore.updateTask(runningTask.id, {
      status: 'running',
      updatedAt: oldIso,
      startedAt: oldIso
    });

    const uploadRoot = path.join(baseDir, 'data', 'uploads', 'xai_vertical_queue');
    const publicRoot = path.join(baseDir, 'public', 'xai_vertical_queue');
    writeFile(path.join(uploadRoot, staleTask.id, 'source.mp4'), 'source');
    writeFile(path.join(publicRoot, staleTask.id, 'vertical_output.mp4'), 'video');
    writeFile(path.join(uploadRoot, invalidTask.id, 'source.mp4'), 'source');
    writeFile(path.join(uploadRoot, runningTask.id, 'source.mp4'), 'source');

    touchTree(path.join(uploadRoot, staleTask.id), new Date(oldIso));
    touchTree(path.join(publicRoot, staleTask.id), new Date(oldIso));
    touchTree(path.join(uploadRoot, invalidTask.id), new Date(invalidIso));
    touchTree(path.join(uploadRoot, runningTask.id), new Date(oldIso));

    const verticalQueueService = {
      getJob: (jobId) => (jobId === runningTask.id ? { id: runningTask.id, status: 'running' } : null)
    };

    const summary = cleanupTaskWorkspaces(baseDir, {
      now,
      retentionDays: 7,
      invalidGraceHours: 24,
      taskStore,
      verticalQueueService
    });

    expect(taskStore.getTask(staleTask.id)).toBeNull();
    expect(taskStore.getTask(invalidTask.id)).toBeNull();
    expect(taskStore.getTask(runningTask.id)).not.toBeNull();
    expect(fs.existsSync(path.join(uploadRoot, staleTask.id))).toBe(false);
    expect(fs.existsSync(path.join(publicRoot, staleTask.id))).toBe(false);
    expect(fs.existsSync(path.join(uploadRoot, invalidTask.id))).toBe(false);
    expect(fs.existsSync(path.join(uploadRoot, runningTask.id))).toBe(true);
    expect(summary.verticalQueue.taskRecordsRemoved).toBe(2);
    expect(summary.verticalQueue.dirsRemoved).toBe(3);
  });

  test('dry run reports task cleanup without deleting files or task records', () => {
    taskStore = new TaskStore(path.join(baseDir, 'tasks.db'));
    const task = taskStore.createTask('vertical_queue', { title: 'old completed' });
    const oldIso = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    taskStore.updateTask(task.id, {
      status: 'completed',
      updatedAt: oldIso,
      completedAt: oldIso
    });

    const jobDir = path.join(baseDir, 'data', 'uploads', 'xai_vertical_queue', task.id);
    const publicDir = path.join(baseDir, 'public', 'xai_vertical_queue', task.id);
    writeFile(path.join(jobDir, 'source.mp4'), 'source');
    writeFile(path.join(publicDir, 'vertical_output.mp4'), 'video');
    touchTree(jobDir, new Date(oldIso));
    touchTree(publicDir, new Date(oldIso));

    const summary = cleanupTaskWorkspaces(baseDir, {
      now,
      retentionDays: 7,
      invalidGraceHours: 24,
      dryRun: true,
      taskStore
    });

    expect(taskStore.getTask(task.id)).not.toBeNull();
    expect(fs.existsSync(jobDir)).toBe(true);
    expect(fs.existsSync(publicDir)).toBe(true);
    expect(summary.verticalQueue.taskRecordsRemoved).toBe(1);
    expect(summary.verticalQueue.dirsRemoved).toBe(2);
    expect(summary.dryRun).toBe(true);
  });

  test('scans oldest vertical task records first when cleanup scan limit is reached', () => {
    taskStore = new TaskStore(path.join(baseDir, 'tasks.db'));
    const oldTask = taskStore.createTask('vertical_queue', { title: 'old failed' });
    const recentTask = taskStore.createTask('vertical_queue', { title: 'recent completed' });
    const oldIso = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const recentIso = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();

    taskStore.updateTask(oldTask.id, {
      status: 'failed',
      updatedAt: oldIso,
      completedAt: oldIso
    });
    taskStore.updateTask(recentTask.id, {
      status: 'completed',
      updatedAt: recentIso,
      completedAt: recentIso
    });

    const uploadRoot = path.join(baseDir, 'data', 'uploads', 'xai_vertical_queue');
    writeFile(path.join(uploadRoot, oldTask.id, 'source.mp4'), 'source');
    writeFile(path.join(uploadRoot, recentTask.id, 'source.mp4'), 'source');
    touchTree(path.join(uploadRoot, oldTask.id), new Date(oldIso));
    touchTree(path.join(uploadRoot, recentTask.id), new Date(recentIso));

    cleanupTaskWorkspaces(baseDir, {
      now,
      retentionDays: 7,
      invalidGraceHours: 24,
      scanLimit: 1,
      taskStore
    });

    expect(taskStore.getTask(oldTask.id)).toBeNull();
    expect(taskStore.getTask(recentTask.id)).not.toBeNull();
  });
});
