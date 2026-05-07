const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVerticalQueueService } = require('../queue');

function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('vertical queue ASR file URL handoff', () => {
  let tempRoot;
  let verticalQueueRoot;
  let verticalPublicDir;
  let pipelineDir;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vertical-queue-asr-url-'));
    verticalQueueRoot = path.join(tempRoot, 'queue');
    verticalPublicDir = path.join(tempRoot, 'public');
    pipelineDir = path.join(tempRoot, 'python', 'pipeline');
    fs.mkdirSync(verticalQueueRoot, { recursive: true });
    fs.mkdirSync(verticalPublicDir, { recursive: true });
    fs.mkdirSync(pipelineDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('passes original public video URL to run_asr for Filetrans-capable jobs', async () => {
    const calls = [];
    const runPythonScript = jest.fn(async () => '测试标题');
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 1.2], zh: '一句字幕' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 1.2, text: '一句字幕' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'speaker_scene.json'), JSON.stringify({ timeline: [] }));
        }
        if (scriptPath.endsWith('make_vertical_video.py')) {
          const outputPath = args[args.indexOf('--output') + 1];
          fs.writeFileSync(outputPath, 'vertical video');
        }
      });
      return {
        promise,
        cancel: jest.fn()
      };
    });

    const service = createVerticalQueueService({
      baseDir: tempRoot,
      verticalQueueRoot,
      verticalPublicDir,
      pipelineDir,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      makeJobId: () => 'job_1',
      slugifyText: (value) => String(value || 'video').replace(/[^a-z0-9]+/gi, '_'),
      sanitizeProcessLogLines: (chunk) => String(chunk || '').split(/\r?\n/).filter(Boolean),
      formatElapsedSeconds: (seconds) => `${seconds}s`,
      stopProcessTree: jest.fn(),
      removeDirIfExists: jest.fn(),
      buildFallbackTitleFromSubtitles: () => '测试任务',
      runPythonScript,
      spawnScriptCancellable,
      writeJsonFile: (filePath, payload) => fs.writeFileSync(filePath, JSON.stringify(payload)),
      readMediaMetadata: () => ({}),
      writeMediaMetadata: jest.fn(),
      taskStore: null,
      triggerAutoReview: null
    });

    const originalVideoPath = path.join(tempRoot, 'original.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      title: '测试任务',
      videoUrl: 'https://cdn.example.com/interview.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCall = calls.find((call) => call.scriptPath.endsWith('run_asr.py'));
    expect(asrCall).toBeTruthy();
    expect(asrCall.args).toEqual(expect.arrayContaining([
      '--file-url',
      'https://cdn.example.com/interview.mp4'
    ]));
  });
});
