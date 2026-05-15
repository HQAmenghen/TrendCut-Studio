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
      'https://cdn.example.com/interview.mp4',
      '--translate-subtitles',
      '--refine-subtitles'
    ]));
  });

  test('does not pass localhost video URLs to cloud Filetrans ASR', async () => {
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
      makeJobId: () => 'job_localhost',
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
      videoUrl: 'http://localhost:3001/projects/material_1778713650778_c69b32a5/output_final.mp4?v=1',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCall = calls.find((call) => call.scriptPath.endsWith('run_asr.py'));
    expect(asrCall).toBeTruthy();
    expect(asrCall.args).not.toContain('--file-url');
    expect(asrCall.args).toEqual(expect.arrayContaining([
      '--translate-subtitles',
      '--refine-subtitles'
    ]));
  });

  test('passes material-driven final timeline subtitles as ASR reference for avatar queue jobs', async () => {
    const calls = [];
    const projectsDir = path.join(tempRoot, 'projects');
    const materialDir = path.join(projectsDir, 'material_1778543460029_582511b3');
    fs.mkdirSync(materialDir, { recursive: true });
    fs.writeFileSync(path.join(materialDir, 'avatar_segments.json'), JSON.stringify({
      segments: [
        {
          start: 0,
          end: 12.37,
          text: 'Vivek4real 刚刚爆料：美国参议院今天将对亲比特币的联储主席提名人凯文·沃什进行首次程序性投票。'
        }
      ]
    }));
    fs.writeFileSync(path.join(materialDir, 'execution_plan.json'), JSON.stringify([
      {
        start_time: 0,
        end_time: 5.2,
        subtitle_text: '最终时间线开头'
      },
      {
        start_time: 5.2,
        end_time: 12.37,
        subtitle_text: '最终时间线结尾'
      }
    ]));

    const runPythonScript = jest.fn(async () => '测试标题');
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args, cwd: options.cwd });
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 1.2], zh: 'Vivek4real 刚刚爆料' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 1.2, text: 'Vivek4real 刚刚爆料' }
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
      projectsDir,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      makeJobId: () => 'job_material',
      slugifyText: (value) => String(value || 'video').replace(/[^a-z0-9]+/gi, '_'),
      sanitizeProcessLogLines: (chunk) => String(chunk || '').split(/\r?\n/).filter(Boolean),
      formatElapsedSeconds: (seconds) => `${seconds}s`,
      stopProcessTree: jest.fn(),
      removeDirIfExists: jest.fn(),
      buildFallbackTitleFromSubtitles: () => '测试任务',
      runPythonScript,
      spawnScriptCancellable,
      writeJsonFile: (filePath, payload) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      },
      readMediaMetadata: () => ({}),
      writeMediaMetadata: jest.fn(),
      taskStore: null,
      triggerAutoReview: null
    });

    const originalVideoPath = path.join(tempRoot, 'avatar-output.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      sourceType: 'material_driven_avatar',
      title: '测试任务',
      videoUrl: 'http://localhost:3001/projects/material_1778543460029_582511b3/output_final.mp4?v=1778545406661',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCall = calls.find((call) => call.scriptPath.endsWith('run_asr.py'));
    expect(asrCall).toBeTruthy();
    const referenceArgIndex = asrCall.args.indexOf('--reference-subtitles-json');
    expect(referenceArgIndex).toBeGreaterThan(-1);
    expect(asrCall.args).toEqual(expect.arrayContaining([
      '--reference-text-authority'
    ]));
    const referencePath = asrCall.args[referenceArgIndex + 1];
    expect(path.basename(referencePath)).toBe('reference_subtitles.json');
    expect(JSON.parse(fs.readFileSync(referencePath, 'utf8'))).toEqual([
      expect.objectContaining({
        time: [0, 5.2],
        zh: '最终时间线开头',
        text: '最终时间线开头'
      }),
      expect.objectContaining({
        time: [5.2, 12.37],
        zh: '最终时间线结尾',
        text: '最终时间线结尾'
      })
    ]);
  });

  test('skips rendering when ASR returns no usable subtitle content', async () => {
    const calls = [];
    const runPythonScript = jest.fn(async () => '这条消息可能正在改变支付格局');
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([]));
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
      makeJobId: () => 'job_silent',
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

    const originalVideoPath = path.join(tempRoot, 'silent.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      title: '',
      summary: '帖子摘要',
      videoUrl: 'https://cdn.example.com/silent.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'skipped');

    expect(runPythonScript).not.toHaveBeenCalled();
    expect(calls.some((call) => call.scriptPath.endsWith('make_vertical_video.py'))).toBe(false);
    expect(fs.existsSync(path.join(verticalPublicDir, job.id, 'vertical_output.mp4'))).toBe(false);
    expect(job.message).toContain('有效口播字幕');
  });
});
