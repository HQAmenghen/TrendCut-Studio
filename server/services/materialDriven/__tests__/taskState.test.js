const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createDefaultTaskState,
  readTaskState,
  writeTaskState
} = require('../taskState');

describe('material-driven task state persistence', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'material-driven-task-state-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('persists and restores avatar presets and workflow flags', () => {
    const snapshot = {
      useSmartClip: false,
      useCache: true,
      autoGenerate: true,
      sourceMeta: {
        sourceAuthor: 'BMNRBullz',
        sourcePostId: '2052826049046536201',
        sourcePartitionId: 'finance',
        sourcePartitionLabel: '金融',
        sourceRank: 2,
        videoUrl: 'https://video.twimg.com/example.mp4',
        postUrl: 'https://x.com/BMNRBullz/status/2052826049046536201'
      },
      avatarConfig: {
        genText: 'test narration',
        renderProvider: 'runninghub',
        serverUrl: 'https://example.com',
        runningHubBaseUrl: 'https://www.runninghub.cn/openapi/v2',
        runningHubWorkflowId: '2051840324212936706',
        runningHubRunPath: '',
        runningHubAccessPassword: '',
        runningHubInstanceType: 'plus',
        runningHubUsePersonalQueue: false,
        runningHubRetainSeconds: 0,
        runningHubAudioNodeId: '6',
        runningHubAudioFieldName: 'audio',
        runningHubImageNodeId: '180',
        runningHubImageFieldName: 'image',
        runningHubOutputNodeId: '151',
        trimSeconds: 1.5,
        maxDuration: 42,
        audioPreset: 'new-voice.mp3',
        imagePreset: 'new-face.jpg',
        audioUploadPath: '',
        imageUploadPath: ''
      }
    };

    writeTaskState(tempDir, snapshot);
    const restored = readTaskState(tempDir);

    expect(restored).toEqual(snapshot);
  });

  test('normalizes source partition metadata from legacy top-level fields', () => {
    writeTaskState(tempDir, {
      sourcePartitionId: 'tech',
      sourcePartitionLabel: '科技',
      sourceRank: '3'
    });

    const restored = readTaskState(tempDir);

    expect(restored.sourceMeta).toEqual({
      sourceAuthor: '',
      sourcePostId: '',
      sourcePartitionId: 'tech',
      sourcePartitionLabel: '科技',
      sourceRank: 3,
      videoUrl: '',
      postUrl: ''
    });
  });

  test('normalizes source identity from source post style fields', () => {
    writeTaskState(tempDir, {
      author: 'DocumentingBTC',
      postId: '2052896454608330953',
      sourcePostUrl: 'https://x.com/DocumentingBTC/status/2052896454608330953',
      materialUrl: 'https://video.twimg.com/example-source.mp4'
    });

    const restored = readTaskState(tempDir);

    expect(restored.sourceMeta).toEqual({
      sourceAuthor: 'DocumentingBTC',
      sourcePostId: '2052896454608330953',
      sourcePartitionId: '',
      sourcePartitionLabel: '',
      sourceRank: 0,
      videoUrl: 'https://video.twimg.com/example-source.mp4',
      postUrl: 'https://x.com/DocumentingBTC/status/2052896454608330953'
    });
  });

  test('does not persist one-off RunningHub API keys in task state', () => {
    const snapshot = {
      avatarConfig: {
        renderProvider: 'runninghub',
        runningHubApiKey: 'secret-key',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    writeTaskState(tempDir, snapshot);
    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, 'task_state.json'), 'utf8'));

    expect(persisted.avatarConfig.runningHubApiKey).toBeUndefined();
    expect(readTaskState(tempDir).avatarConfig.runningHubApiKey).toBeUndefined();
  });

  test('falls back to default state when no persisted file exists', () => {
    expect(readTaskState(tempDir)).toEqual(createDefaultTaskState());
  });
});
