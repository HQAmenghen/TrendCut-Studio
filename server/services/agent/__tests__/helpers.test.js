const os = require('os');
const path = require('path');

const {
  createHttpError,
  extractMaterialOutputDir,
  normalizeAgentError,
  normalizeLocalPathCandidate,
  normalizePartitionId,
  normalizePost,
  postMatchesQuery,
  resolveAgentLocalVideoPath,
  stableHash
} = require('../helpers');

describe('agent helpers', () => {
  test('normalizes known partition aliases', () => {
    expect(normalizePartitionId('加密')).toBe('crypto');
    expect(normalizePartitionId(' 人工智能 ')).toBe('ai');
    expect(normalizePartitionId('finance')).toBe('finance');
    expect(normalizePartitionId('')).toBe('crypto');
  });

  test('extracts material output directories from local and URL-like values', () => {
    const projectRoot = path.join(os.tmpdir(), 'trendcut-agent-helper');
    const paths = {
      PROJECT_ROOT: projectRoot,
      PROJECTS_DIR: path.join(projectRoot, 'projects')
    };

    expect(extractMaterialOutputDir('/projects/material_job-1/output_final.mp4', paths)).toBe('material_job-1');
    expect(extractMaterialOutputDir('http://localhost:3001/projects/material_job-2/output_final.mp4?x=1', paths)).toBe('material_job-2');
    expect(extractMaterialOutputDir(path.join(paths.PROJECTS_DIR, 'material_job-3', 'output_final.mp4'), paths)).toBe('material_job-3');
  });

  test('keeps local video paths inside allowed roots only', () => {
    const root = path.join(os.tmpdir(), 'trendcut-agent-helper-root');
    const inside = path.join(root, 'projects', 'material_a', 'output_final.mp4');
    const outside = path.join(os.tmpdir(), 'outside.mp4');
    const paths = {
      PROJECT_ROOT: root,
      PROJECTS_DIR: path.join(root, 'projects')
    };

    expect(resolveAgentLocalVideoPath(inside, paths)).toBe(path.resolve(inside));
    expect(resolveAgentLocalVideoPath(outside, paths)).toBe('');
  });

  test('normalizes post identity and query matching consistently', () => {
    const post = normalizePost({
      rank: 1,
      author: 'alice',
      post_id: 'post_1',
      post_url: 'https://x.com/alice/status/1',
      video_url: 'https://video.example/1.mp4',
      author_summary_zh: '稳定币支付正在加速',
      hot_score: 98
    }, {
      partitionId: 'crypto',
      partitionLabel: '加密'
    });

    expect(post.id).toBe(stableHash({
      postId: 'post_1',
      postUrl: 'https://x.com/alice/status/1',
      videoUrl: 'https://video.example/1.mp4',
      author: 'alice',
      rank: 1,
      partitionId: 'crypto'
    }));
    expect(post.hotScore).toBe(98);
    expect(postMatchesQuery(post, '稳定币')).toBe(true);
    expect(postMatchesQuery(post, 'missing')).toBe(false);
  });

  test('normalizes local path variants and agent errors', () => {
    expect(normalizeLocalPathCandidate('/mnt/c/Users/PC/video.mp4')).toBe('C:\\Users\\PC\\video.mp4');

    const err = createHttpError(409, 'AGENT_CONFLICT', 'agent.test', '冲突', 'details', 'hint');
    expect(normalizeAgentError(err)).toEqual({
      status: 409,
      code: 'AGENT_CONFLICT',
      stage: 'agent.test',
      error: '冲突',
      details: 'details',
      hint: 'hint'
    });
  });
});
