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

  test('recovers DB task with completed artifact as a completed runtime job', () => {
    const taskUpdates = [];
    const appendedLogs = [];
    const taskStore = {
      listTasks: jest.fn(() => [{
        id: 'queue_recovered',
        type: 'vertical_queue',
        status: 'reviewing',
        progress: 92,
        message: '正在执行 AI 审核...',
        metadata: {
          sourceType: 'xai_top10_cached',
          title: 'Recovered title',
          summary: 'Recovered summary',
          videoUrl: 'https://cdn.example.com/source.mp4',
          postId: 'post-recovered',
          author: 'author-a',
          originalItem: {
            sourceType: 'xai_top10_cached',
            title: 'Recovered title',
            summary: 'Recovered summary',
            videoUrl: 'https://cdn.example.com/source.mp4',
            postId: 'post-recovered',
            author: 'author-a'
          }
        },
        logs: [],
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:10:00.000Z',
        startedAt: '2026-04-27T00:00:00.000Z'
      }]),
      updateTask: jest.fn((id, updates) => {
        taskUpdates.push({ id, updates });
        return { id, ...updates };
      }),
      appendLog: jest.fn((id, message) => {
        appendedLogs.push({ id, message });
      })
    };

    fs.mkdirSync(path.join(verticalPublicDir, 'queue_recovered'), { recursive: true });
    fs.writeFileSync(path.join(verticalPublicDir, 'queue_recovered', 'vertical_output.mp4'), 'video');

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
      runPythonScript: jest.fn(),
      spawnScriptCancellable: jest.fn(),
      writeJsonFile: (filePath, payload) => fs.writeFileSync(filePath, JSON.stringify(payload)),
      readMediaMetadata: () => ({}),
      writeMediaMetadata: jest.fn(),
      taskStore,
      triggerAutoReview: null
    });

    const result = service.recoverPersistedJobs();
    const recovered = service.getJob('queue_recovered');

    expect(result).toEqual({ recovered: 1, completed: 1, requeued: 0 });
    expect(recovered).toEqual(expect.objectContaining({
      id: 'queue_recovered',
      status: 'completed',
      progress: 100,
      resultVideoUrl: expect.stringContaining('/xai_vertical_queue/queue_recovered/vertical_output.mp4')
    }));
    expect(taskStore.updateTask).toHaveBeenCalledWith('queue_recovered', expect.objectContaining({
      status: 'completed',
      progress: 100
    }));
    expect(appendedLogs.map((entry) => entry.message).join('\n')).toContain('启动恢复');
    expect(taskUpdates[0].updates.message).toContain('启动时从已生成成片恢复');
  });

  test('can skip completed artifact recovery for scheduler autopilot scans', () => {
    const taskStore = {
      listTasks: jest.fn(() => [{
        id: 'queue_recovered',
        type: 'vertical_queue',
        status: 'reviewing',
        progress: 92,
        message: '正在执行 AI 审核...',
        metadata: {
          sourceType: 'xai_top10_cached',
          title: 'Recovered title',
          videoUrl: 'https://cdn.example.com/source.mp4',
          originalItem: {
            sourceType: 'xai_top10_cached',
            title: 'Recovered title',
            videoUrl: 'https://cdn.example.com/source.mp4'
          }
        },
        logs: [],
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:10:00.000Z',
        startedAt: '2026-04-27T00:00:00.000Z'
      }]),
      updateTask: jest.fn(),
      appendLog: jest.fn()
    };

    fs.mkdirSync(path.join(verticalPublicDir, 'queue_recovered'), { recursive: true });
    fs.writeFileSync(path.join(verticalPublicDir, 'queue_recovered', 'vertical_output.mp4'), 'video');

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
      runPythonScript: jest.fn(),
      spawnScriptCancellable: jest.fn(),
      writeJsonFile: (filePath, payload) => fs.writeFileSync(filePath, JSON.stringify(payload)),
      readMediaMetadata: () => ({}),
      writeMediaMetadata: jest.fn(),
      taskStore,
      triggerAutoReview: null
    });

    const result = service.recoverPersistedJobs({ includeCompletedArtifacts: false });

    expect(result).toEqual({ recovered: 0, completed: 0, requeued: 0 });
    expect(service.getJob('queue_recovered')).toBeNull();
    expect(taskStore.updateTask).not.toHaveBeenCalled();
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

  test('passes material-driven full narration as ASR reference for avatar queue jobs', async () => {
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
    fs.writeFileSync(path.join(materialDir, 'narration.json'), JSON.stringify({
      full_text: '完整口播稿用于一次性全局对齐'
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
        time: [0, 6],
        zh: '完整口播稿用于一次性全局对齐',
        text: '完整口播稿用于一次性全局对齐'
      })
    ]);
  });

  test('falls back to execution plan reference when narration is unavailable for avatar queue jobs', async () => {
    const calls = [];
    const projectsDir = path.join(tempRoot, 'projects');
    const materialDir = path.join(projectsDir, 'material_1778543460029_582511b3');
    fs.mkdirSync(materialDir, { recursive: true });
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
            { time: [0, 1.2], zh: '最终时间线开头' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 1.2, text: '最终时间线开头' }
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
      makeJobId: () => 'job_material_execution_plan',
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
      videoUrl: 'http://localhost:3001/projects/material_1778543460029_582511b3/output_final.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCall = calls.find((call) => call.scriptPath.endsWith('run_asr.py'));
    const referencePath = asrCall.args[asrCall.args.indexOf('--reference-subtitles-json') + 1];
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

  test('preserves existing public metadata title during subtitle regeneration rerender', async () => {
    const calls = [];
    const runPythonScript = jest.fn(async () => '不应重新生成标题');
    const writeMediaMetadata = jest.fn();
    const existingPublicMeta = {
      title: '原审核中心标题',
      suggestedTitle: '原审核中心标题',
      aiReview: {
        reviewId: 'review_previous',
        status: 'failed'
      }
    };
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 1.2], zh: '修复后的字幕' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 1.2, text: '修复后的字幕' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'speaker_scene.json'), JSON.stringify({ timeline: [] }));
        }
        if (scriptPath.endsWith('make_vertical_video.py')) {
          const outputPath = args[args.indexOf('--output') + 1];
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 2.4], zh: '渲染后延长的字幕' }
          ]));
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
      makeJobId: () => 'job_regen_title',
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
      readMediaMetadata: () => existingPublicMeta,
      writeMediaMetadata,
      taskStore: null,
      triggerAutoReview: null
    });

    const originalVideoPath = path.join(tempRoot, 'source.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      title: '',
      summary: '帖子摘要',
      videoUrl: 'https://cdn.example.com/source.mp4',
      renderOptions: {
        isRegeneration: true,
        originalVideoPath,
        repairFocus: ['subtitle']
      }
    });

    await waitFor(() => job.status === 'completed');

    expect(runPythonScript).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(verticalQueueRoot, job.id, 'content.json'), 'utf8'))).toEqual({
      title: '原审核中心标题'
    });
    expect(writeMediaMetadata).toHaveBeenCalledWith(
      path.join(verticalPublicDir, job.id, 'vertical_output.mp4'),
      expect.objectContaining({
        title: '原审核中心标题',
        suggestedTitle: '原审核中心标题',
        subtitles: [
          expect.objectContaining({
            time: [0, 2.4],
            zh: '渲染后延长的字幕'
          })
        ],
        regeneration: expect.objectContaining({
          status: 'completed'
        })
      })
    );
    expect(calls.some((call) => call.scriptPath.endsWith('make_vertical_video.py'))).toBe(true);
  });

  test('retries ASR when strict reference authority alignment fails once', async () => {
    const calls = [];
    const projectsDir = path.join(tempRoot, 'projects');
    const materialDir = path.join(projectsDir, 'material_1778543460029_582511b3');
    fs.mkdirSync(materialDir, { recursive: true });
    fs.writeFileSync(path.join(materialDir, 'execution_plan.json'), JSON.stringify([
      {
        start_time: 0,
        end_time: 5.2,
        subtitle_text: '这意味着比特币正被认真考虑作为国家层面的价值储存工具'
      }
    ]));

    const runPythonScript = jest.fn(async () => '测试标题');
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const asrAttempt = calls.filter((call) => call.scriptPath.endsWith('run_asr.py')).length;
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          if (asrAttempt === 1) {
            const err = new Error('参考文本字幕时间轴未通过严格校验');
            err.code = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
            err.stage = 'subtitle_reference_authority';
            err.details = '参考文本权威分配结果未通过原文校验';
            throw err;
          }
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 5.2], zh: '这意味着比特币正被认真考虑作为国家层面的价值储存工具' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 5.2, text: '这意味着比特币正被认真考虑作为国家层面的价值储存工具' }
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
      makeJobId: () => 'job_reference_retry',
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
      videoUrl: 'http://localhost:3001/projects/material_1778543460029_582511b3/output_final.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCalls = calls.filter((call) => call.scriptPath.endsWith('run_asr.py'));
    expect(asrCalls).toHaveLength(2);
    expect(asrCalls[0].args).toContain('--reference-text-authority');
    expect(calls.some((call) => call.scriptPath.endsWith('make_vertical_video.py'))).toBe(true);
  });

  test('falls back to normal ASR when strict reference authority keeps failing', async () => {
    const calls = [];
    const writeMediaMetadata = jest.fn();
    const projectsDir = path.join(tempRoot, 'projects');
    const materialDir = path.join(projectsDir, 'material_1778543460029_582511b3');
    fs.mkdirSync(materialDir, { recursive: true });
    fs.writeFileSync(path.join(materialDir, 'execution_plan.json'), JSON.stringify([
      {
        start_time: 0,
        end_time: 5.2,
        subtitle_text: '这意味着比特币正被认真考虑作为国家层面的价值储存工具'
      }
    ]));

    const runPythonScript = jest.fn(async () => '测试标题');
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const asrAttempt = calls.filter((call) => call.scriptPath.endsWith('run_asr.py')).length;
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          if (asrAttempt <= 2) {
            const err = new Error('参考文本字幕时间轴未通过严格校验');
            err.code = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
            err.stage = 'subtitle_reference_authority';
            err.details = 'atom_span_not_contiguous:expected_0_got_1';
            throw err;
          }
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 5.2], zh: '普通 ASR 字幕继续成片' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 5.2, text: '普通 ASR 字幕继续成片' }
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
      makeJobId: () => 'job_reference_fallback',
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
      writeMediaMetadata,
      taskStore: null,
      triggerAutoReview: null
    });

    const originalVideoPath = path.join(tempRoot, 'avatar-output.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      sourceType: 'material_driven_avatar',
      title: '测试任务',
      videoUrl: 'http://localhost:3001/projects/material_1778543460029_582511b3/output_final.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    const asrCalls = calls.filter((call) => call.scriptPath.endsWith('run_asr.py'));
    expect(asrCalls).toHaveLength(3);
    expect(asrCalls[0].args).toContain('--reference-text-authority');
    expect(asrCalls[1].args).toContain('--reference-text-authority');
    expect(asrCalls[2].args).not.toContain('--reference-text-authority');
    expect(asrCalls[2].args).not.toContain('--reference-subtitles-json');
    expect(calls.some((call) => call.scriptPath.endsWith('make_vertical_video.py'))).toBe(true);
    expect(writeMediaMetadata).toHaveBeenCalledWith(
      path.join(verticalPublicDir, job.id, 'vertical_output.mp4'),
      expect.objectContaining({
        referenceSubtitleFallbackUsed: true
      })
    );
  });

  test('uses local fallback title when hot title generation fails', async () => {
    const calls = [];
    const runPythonScript = jest.fn(async () => {
      throw new Error('自动标题生成失败: Error code: 402');
    });
    const spawnScriptCancellable = jest.fn((scriptPath, args, options = {}) => {
      calls.push({ scriptPath, args });
      const promise = Promise.resolve().then(() => {
        if (scriptPath.endsWith('run_asr.py')) {
          fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
            { time: [0, 2.4], zh: '本地兜底标题来自字幕' }
          ]));
          fs.writeFileSync(path.join(options.cwd, 'audio.json'), JSON.stringify([
            { start: 0, end: 2.4, text: '本地兜底标题来自字幕' }
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
    const writeMediaMetadata = jest.fn();

    const service = createVerticalQueueService({
      baseDir: tempRoot,
      verticalQueueRoot,
      verticalPublicDir,
      pipelineDir,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      makeJobId: () => 'job_title_fallback',
      slugifyText: (value) => String(value || 'video').replace(/[^a-z0-9]+/gi, '_'),
      sanitizeProcessLogLines: (chunk) => String(chunk || '').split(/\r?\n/).filter(Boolean),
      formatElapsedSeconds: (seconds) => `${seconds}s`,
      stopProcessTree: jest.fn(),
      removeDirIfExists: jest.fn(),
      buildFallbackTitleFromSubtitles: () => '本地兜底标题',
      runPythonScript,
      spawnScriptCancellable,
      writeJsonFile: (filePath, payload) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      },
      readMediaMetadata: () => ({}),
      writeMediaMetadata,
      taskStore: null,
      triggerAutoReview: null
    });

    const originalVideoPath = path.join(tempRoot, 'source.mp4');
    fs.writeFileSync(originalVideoPath, 'source video');
    const job = service.enqueue({
      videoUrl: 'https://cdn.example.com/source.mp4',
      renderOptions: {
        originalVideoPath
      }
    });

    await waitFor(() => job.status === 'completed');

    expect(runPythonScript).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(path.join(verticalQueueRoot, job.id, 'content.json'), 'utf8'))).toEqual({
      title: '本地兜底标题'
    });
    expect(job.title).toBe('本地兜底标题');
    expect(writeMediaMetadata).toHaveBeenCalledWith(
      path.join(verticalPublicDir, job.id, 'vertical_output.mp4'),
      expect.objectContaining({
        title: '本地兜底标题',
        suggestedTitle: '本地兜底标题'
      })
    );
  });
});
