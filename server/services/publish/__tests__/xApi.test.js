const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildXPostText, createXApiPublisher } = require('../xApi');

function createService(overrides = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'x-api-publish-'));
  const videoPath = path.join(tempRoot, 'video.mp4');
  fs.writeFileSync(videoPath, Buffer.alloc(16));
  const jobs = overrides.jobs || [{
    id: 'job_x',
    asset: { path: videoPath, label: 'Asset Label', metadata: {} },
    publishData: {
      title: 'Market update',
      description: 'Short summary',
      tags: ['AI']
    },
    platformTasks: [{
      platform: 'x',
      accountId: 'x_main',
      runtime: { logs: [] }
    }]
  }];
  const config = overrides.config || {
    x: {
      enabled: true,
      accounts: [{
        id: 'x_main',
        username: 'comfy_ops',
        accessToken: 'token'
      }]
    }
  };
  const readPublishJobs = jest.fn(() => ({ jobs }));
  const updatePublishPlatformTask = jest.fn((jobId, platformKey, patch) => {
    const job = jobs.find((item) => item.id === jobId);
    const task = job.platformTasks.find((item) => item.platform === platformKey);
    Object.assign(task, patch);
  });
  const service = createXApiPublisher({
    fs,
    path,
    axios: overrides.axios,
    FormData: overrides.FormData,
    readPublishJobs,
    readPublishConfig: jest.fn(() => config),
    writePublishConfig: overrides.writePublishConfig || jest.fn(),
    updatePublishPlatformTask,
    uploadChunkBytes: 8
  });
  return { tempRoot, videoPath, jobs, service, updatePublishPlatformTask };
}

describe('X API publisher', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('builds compact post text with tags under X text limit', () => {
    const text = buildXPostText({
      publishData: {
        title: 'A'.repeat(200),
        description: 'B'.repeat(200),
        tags: ['crypto', '#ai']
      }
    });

    expect(text.length).toBeLessThanOrEqual(280);
    expect(text.endsWith('…')).toBe(true);
  });

  test('starts async X publish and records successful post result', async () => {
    jest.useFakeTimers();
    const calls = [];
    const axios = jest.fn(async (options) => {
      calls.push(options);
      return { data: { data: {} } };
    });
    axios.post = jest.fn(async (url, data) => {
      calls.push({ method: 'post', url, data });
      if (String(url).includes('/initialize')) {
        return { data: { data: { id: 'media_1' } } };
      }
      if (String(url).includes('/finalize')) {
        return { data: { data: { processing_info: { state: 'succeeded' } } } };
      }
      if (String(url).endsWith('/tweets')) {
        return { data: { data: { id: 'post_1', text: data.text } } };
      }
      return { data: {} };
    });

    const { service, jobs, tempRoot } = createService({ axios });
    try {
      await expect(service.startXPublish('job_x', 'publish')).resolves.toMatchObject({
        started: true,
        platform: 'x'
      });
      await service.getRuntimeProcess('job_x').promise;

      expect(axios.post).toHaveBeenCalledTimes(4);
      expect(calls.some((call) => String(call.url).endsWith('/tweets'))).toBe(true);
      expect(jobs[0].platformTasks[0]).toMatchObject({
        status: 'published',
        publishResult: {
          platform: 'x',
          postId: 'post_1',
          postUrl: 'https://x.com/comfy_ops/status/post_1'
        }
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('rejects draft mode before making API calls', async () => {
    const axios = jest.fn();
    const { service, tempRoot } = createService({ axios });
    try {
      await expect(service.startXPublish('job_x', 'draft')).rejects.toThrow('X API 暂不支持草稿模式');
      expect(axios).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
