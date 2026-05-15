const fs = require('fs');
const os = require('os');
const path = require('path');

const { activeTasks, taskClients } = require('../sharedState');
const { createMaterialDrivenTaskRegistry, mergeSourceMeta } = require('../taskRegistry');

describe('material-driven task registry source metadata', () => {
  let tempRoot;
  let projectsDir;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'material-driven-registry-'));
    projectsDir = path.join(tempRoot, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    activeTasks.clear();
    taskClients.clear();
  });

  afterEach(() => {
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
});
