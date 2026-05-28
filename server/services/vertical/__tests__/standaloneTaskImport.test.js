const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { createStandaloneHandler } = require('../standalone');
const { spawn } = require('child_process');

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function mockSpawnExit(code = 0, stderr = '') {
  spawn.mockImplementation(() => {
    return {
      stdout: { on: jest.fn() },
      stderr: {
        on: jest.fn((event, callback) => {
          if (event === 'data' && stderr) callback(Buffer.from(stderr));
        })
      },
      on: jest.fn((event, callback) => {
        if (event === 'close') {
          setImmediate(() => callback(code));
        }
      }),
      kill: jest.fn()
    };
  });
}

function createMockTaskStore() {
  const tasks = new Map();
  return {
    tasks,
    createTask(type, metadata = {}, options = {}) {
      const task = {
        id: options.id || `task_${tasks.size + 1}`,
        taskKey: options.taskKey || null,
        type,
        status: options.status || 'queued',
        progress: options.progress || 0,
        message: options.message || '',
        logs: [],
        metadata,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: options.startedAt || null,
        completedAt: options.completedAt || null,
        durationSeconds: null
      };
      tasks.set(task.id, task);
      return task;
    },
    createOrReuseTask(type, taskKey, metadata = {}, options = {}) {
      const existing = this.findTaskByKey(type, taskKey);
      if (existing) {
        existing.metadata = { ...existing.metadata, ...metadata };
        return { task: existing, created: false };
      }
      return {
        task: this.createTask(type, metadata, { ...options, taskKey }),
        created: true
      };
    },
    updateTask(id, updates) {
      const task = tasks.get(id);
      Object.assign(task, updates, { updatedAt: new Date().toISOString() });
      if (updates.metadata) task.metadata = updates.metadata;
      return task;
    },
    appendLog(id, message) {
      const task = tasks.get(id);
      if (task) task.logs.push(message);
    },
    findTaskByKey(type, taskKey) {
      return Array.from(tasks.values()).find((task) => task.type === type && task.taskKey === taskKey) || null;
    },
    listTasks(type) {
      return Array.from(tasks.values()).filter((task) => task.type === type);
    },
    getTask(id) {
      return tasks.get(id) || null;
    }
  };
}

describe('standalone vertical task import', () => {
  let tempRoot;
  let projectsDir;
  let pipelineDir;
  let runtimeDir;
  let publicDir;

  beforeEach(() => {
    spawn.mockReset();
    mockSpawnExit(0);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-task-import-'));
    projectsDir = path.join(tempRoot, 'projects');
    pipelineDir = path.join(tempRoot, 'python', 'pipeline');
    runtimeDir = path.join(tempRoot, 'runtime');
    publicDir = path.join(tempRoot, 'public');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(pipelineDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(publicDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses selected material task video and JSON metadata without uploaded files', async () => {
    const sourceDir = path.join(projectsDir, 'material_ready');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    writeJson(path.join(sourceDir, 'source_post.json'), {
      title: '任务标题',
      body: '任务正文'
    });
    writeJson(path.join(sourceDir, 'narration.json'), {
      full_text: '任务口播'
    });
    writeJson(path.join(sourceDir, 'subtitles.json'), [
      { time: [0, 1.5], zh: '任务字幕', en: 'Task subtitle' }
    ]);
    const runPythonScript = jest.fn(async (_scriptPath, args) => {
      const outputPath = args[args.indexOf('--output') + 1];
      fs.writeFileSync(outputPath, 'vertical video');
    });
    const generateHotTitle = jest.fn(async () => 'fallback title');
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle,
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_ready',
        renderOptions: '{}'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      success: true,
      title: 'fallback title'
    });
    expect(generateHotTitle).toHaveBeenCalledTimes(1);
    expect(runPythonScript).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(runtimeDir, 'standalone_input.mp4'), 'utf8')).toBe('task video');
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.5], zh: '任务字幕', en: 'Task subtitle' }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'original_context.json'), 'utf8'))).toEqual({
      title: '任务标题',
      body: '任务正文'
    });
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'narration.json'), 'utf8'))).toEqual({
      full_text: '任务口播'
    });
    expect(fs.existsSync(path.join(runtimeDir, 'speaker_scene.json'))).toBe(false);
    expect(runPythonScript.mock.calls[0][1]).not.toEqual(expect.arrayContaining([
      '--plan',
      path.join(runtimeDir, 'speaker_scene.json')
    ]));
  });

  test('emits standalone render progress from frame output', async () => {
    const sourceDir = path.join(projectsDir, 'material_ready');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    writeJson(path.join(sourceDir, 'result.json'), { duration: 40 });
    writeJson(path.join(sourceDir, 'subtitles.json'), [
      { time: [0, 1.5], zh: '任务字幕' }
    ]);
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('make_vertical_video.py')) {
        options.onStderr?.('frame_index:  50%|█████     | 584/1168 [00:39<00:29, 19.24it/s, now=None]');
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });
    const sendProgressEvent = jest.fn();
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => ({}),
      sendProgressEvent,
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_ready',
        renderOptions: '{}',
        useASR: 'false'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(sendProgressEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      type: 'progress',
      percent: 76,
      msg: '正在渲染竖屏视频 76%'
    }));
  });

  test('persists standalone material vertical task and reuses completed database record', async () => {
    const sourceDir = path.join(projectsDir, 'material_ready');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    writeJson(path.join(sourceDir, 'subtitles.json'), [
      { time: [0, 1.5], zh: '任务字幕' }
    ]);
    const taskStore = createMockTaskStore();
    const runPythonScript = jest.fn(async (_scriptPath, args) => {
      const outputPath = args[args.indexOf('--output') + 1];
      fs.writeFileSync(outputPath, 'vertical video');
    });
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => ({}),
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript,
      taskStore
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_ready',
        renderOptions: '{}',
        useASR: 'false'
      },
      files: {}
    };

    const firstRes = createResponse();
    await handler.handler(req, firstRes);

    expect(firstRes.statusCode).toBe(200);
    const storedTask = taskStore.findTaskByKey('standalone_vertical', 'sourceTaskDir:material_ready');
    expect(storedTask).toMatchObject({
      status: 'completed',
      progress: 100
    });
    expect(storedTask.metadata).toMatchObject({
      sourceTaskDir: 'material_ready',
      stage: 'completed'
    });

    const secondRes = createResponse();
    await handler.handler(req, secondRes);

    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.payload).toMatchObject({
      success: true,
      reused: true,
      taskId: storedTask.id,
      sourceTaskDir: 'material_ready'
    });
    expect(runPythonScript).toHaveBeenCalledTimes(1);
  });

  test('returns running database standalone task without starting duplicate render', async () => {
    const sourceDir = path.join(projectsDir, 'material_ready');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    const taskStore = createMockTaskStore();
    const existing = taskStore.createTask('standalone_vertical', {
      sourceTaskDir: 'material_ready',
      stage: 'render'
    }, {
      taskKey: 'sourceTaskDir:material_ready',
      status: 'running',
      progress: 62,
      message: '正在渲染动态竖屏视频'
    });
    const runPythonScript = jest.fn();
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => ({}),
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript,
      taskStore
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_ready',
        renderOptions: '{}',
        useASR: 'false'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(res.payload).toMatchObject({
      success: true,
      reused: true,
      taskId: existing.id,
      status: 'running',
      progress: 62
    });
    expect(runPythonScript).not.toHaveBeenCalled();
  });

  test('clears stale manual recovery marker when restarting interrupted standalone task', async () => {
    const sourceDir = path.join(projectsDir, 'material_ready');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    writeJson(path.join(sourceDir, 'aiman_subtitles.json'), [
      { time: [0, 1], zh: '一句字幕' }
    ]);
    const taskStore = createMockTaskStore();
    const existing = taskStore.createTask('standalone_vertical', {
      sourceTaskDir: 'material_ready',
      stage: 'refresh_subtitles',
      awaitingManualRecovery: true,
      manualRecoveryRequiredAt: '2026-01-01T00:00:00.000Z'
    }, {
      taskKey: 'sourceTaskDir:material_ready',
      status: 'interrupted',
      progress: 18,
      message: '任务中断，等待手动恢复'
    });
    const runPythonScript = jest.fn(async (_script, args, options = {}) => {
      if (args.includes('--output')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'vertical video');
      }
      if (options.cwd && args.includes('subtitles.json')) {
        fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([{ time: [0, 1], zh: '一句字幕' }]));
      }
    });
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => ({}),
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript,
      taskStore,
      validateDecodableMedia: jest.fn(async () => ({ ok: true, durationSeconds: 1 }))
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_ready',
        renderOptions: '{}',
        useASR: 'false'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    const updated = taskStore.getTask(existing.id);
    expect(updated.status).toBe('completed');
    expect(updated.metadata.awaitingManualRecovery).toBe(false);
    expect(updated.metadata.manualRecoveryRequiredAt).toBe('');
  });

  test('uses final video and full narration text for imported material task ASR refresh', async () => {
    const sourceDir = path.join(projectsDir, 'material_avatar_refresh_001');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    fs.writeFileSync(path.join(sourceDir, 'aiman.mp4'), 'avatar video');
    writeJson(path.join(sourceDir, 'source_post.json'), {
      title: '任务标题',
      body: '任务正文'
    });
    writeJson(path.join(sourceDir, 'narration.json'), {
      full_text: '任务口播完整文本'
    });
    writeJson(path.join(sourceDir, 'avatar_segments.json'), {
      avatar_video_ref: path.join(sourceDir, 'aiman.mp4'),
      audio_ref: null,
      timing_mode: 'estimated_scaled',
      segments: [
        {
          id: 'avatar_segment_001',
          script_ref: 'script_001',
          text: '数字人句一',
          start: 0,
          end: 1.15,
          duration: 1.15
        },
        {
          id: 'avatar_segment_002',
          script_ref: 'script_002',
          text: '数字人句二',
          start: 1.15,
          end: 2.7,
          duration: 1.55
        }
      ]
    });
    writeJson(path.join(sourceDir, 'execution_plan.json'), [
      { start_time: 0, end_time: 1.4, subtitle_text: '最终时间线句一' },
      { start_time: 1.4, end_time: 3.1, subtitle_text: '最终时间线句二' }
    ]);
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        const subtitlesPath = args.includes('--subtitles-json')
          ? args[args.indexOf('--subtitles-json') + 1]
          : path.join(options.cwd || sourceDir, 'subtitles.json');
        const audioPath = args.includes('--audio-json')
          ? args[args.indexOf('--audio-json') + 1]
          : path.join(options.cwd || sourceDir, 'audio.json');
        const referencePath = args[args.indexOf('--reference-subtitles-json') + 1];
        const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
        const aligned = reference.map((item) => ({
          ...item,
          text: item.zh
        }));
        fs.writeFileSync(audioPath, JSON.stringify(reference, null, 2));
        fs.writeFileSync(subtitlesPath, JSON.stringify(aligned, null, 2));
        fs.writeFileSync(path.join(sourceDir, 'aiman_audio.json'), JSON.stringify(reference, null, 2));
        fs.writeFileSync(path.join(sourceDir, 'aiman_subtitles.json'), JSON.stringify(aligned, null, 2));
        return;
      }

      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: 'material_avatar_refresh_001',
        useASR: 'true',
        renderOptions: '{}'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(runPythonScript).toHaveBeenCalledTimes(2);
    const asrCall = runPythonScript.mock.calls.find(([scriptPath]) => scriptPath.endsWith('run_asr.py'));
    expect(asrCall).toBeTruthy();
    expect(asrCall[1]).toEqual(expect.arrayContaining([
      '--input',
      path.join(sourceDir, 'output_final.mp4'),
      '--reference-subtitles-json',
      path.join(sourceDir, 'aiman_reference_subtitles.json'),
      '--reference-text-authority',
      '--refine-subtitles'
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'aiman_reference_subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 6], zh: '任务口播完整文本', text: '任务口播完整文本' }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'aiman_subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 6], zh: '任务口播完整文本' }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 6], zh: '任务口播完整文本' }
    ]);
  });

  test('passes uploaded outro video to standalone vertical renderer', async () => {
    const inputVideoPath = path.join(runtimeDir, 'upload.mp4');
    const outroUploadPath = path.join(runtimeDir, 'outro-upload.mp4');
    fs.writeFileSync(inputVideoPath, 'task video');
    fs.writeFileSync(outroUploadPath, 'outro video');
    const runPythonScript = jest.fn(async (_scriptPath, args) => {
      const outputPath = args[args.indexOf('--output') + 1];
      fs.writeFileSync(outputPath, 'vertical video with outro');
    });
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        useASR: 'false',
        title: '手动标题'
      },
      files: {
        video: [{ path: inputVideoPath }],
        outro: [{ path: outroUploadPath, originalname: 'brand-outro.mp4' }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(runPythonScript).toHaveBeenCalledTimes(1);
    const renderArgs = runPythonScript.mock.calls[0][1];
    expect(renderArgs).toEqual(expect.arrayContaining([
      '--outro',
      path.join(runtimeDir, 'standalone_outro.mp4')
    ]));
    expect(fs.readFileSync(path.join(runtimeDir, 'standalone_outro.mp4'), 'utf8')).toBe('outro video');
    expect(JSON.parse(fs.readFileSync(path.join(publicDir, 'standalone_output_vertical.mp4.meta.json'), 'utf8'))).toMatchObject({
      title: '手动标题',
      outroSource: 'brand-outro.mp4'
    });
  });

  test('uses reference subtitles as ASR alignment input when standalone is routed from vertical sync', async () => {
    const inputVideoPath = path.join(runtimeDir, 'upload.mp4');
    fs.writeFileSync(inputVideoPath, 'task video');
    const referencePayload = [
      { time: [0, 1.4], zh: 'Kalshi 的成交量在波动。', en: 'Kalshi volume is moving.' }
    ];
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        const subtitlesPath = args.includes('--subtitles-json')
          ? args[args.indexOf('--subtitles-json') + 1]
          : path.join(options.cwd || runtimeDir, 'subtitles.json');
        const audioPath = args.includes('--audio-json')
          ? args[args.indexOf('--audio-json') + 1]
          : path.join(options.cwd || runtimeDir, 'audio.json');
        const referencePath = args[args.indexOf('--reference-subtitles-json') + 1];
        const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
        fs.writeFileSync(audioPath, JSON.stringify(reference, null, 2));
        fs.writeFileSync(subtitlesPath, JSON.stringify(reference.map((item) => ({ ...item, text: item.zh })), null, 2));
        return;
      }

      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });

    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        useASR: 'true',
        subtitlesPayload: JSON.stringify(referencePayload)
      },
      files: {
        video: [{ path: inputVideoPath }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(runPythonScript).toHaveBeenCalledTimes(2);
    const asrCall = runPythonScript.mock.calls.find(([scriptPath]) => scriptPath.endsWith('run_asr.py'));
    expect(asrCall).toBeTruthy();
    expect(asrCall[1]).toEqual(expect.arrayContaining([
      '--reference-subtitles-json',
      path.join(runtimeDir, 'reference_subtitles.json'),
      '--reference-text-authority',
      '--refine-subtitles'
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.4], zh: 'Kalshi 的成交量在波动。', en: 'Kalshi volume is moving.', text: 'Kalshi 的成交量在波动。' }
    ]);
  });

  test('rerenders material final video before standalone compose when output_final is corrupt', async () => {
    const projectsDir = path.join(tempRoot, 'projects');
    const taskDir = path.join(projectsDir, 'material_1778543460029_582511b3');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'output_final.mp4'), 'corrupt video');
    fs.writeFileSync(path.join(taskDir, 'aiman.mp4'), 'clean avatar video');
    fs.writeFileSync(path.join(taskDir, 'material.mp4'), 'raw material video');
    fs.writeFileSync(path.join(taskDir, 'execution_plan.json'), '[]');
    fs.writeFileSync(path.join(taskDir, 'narration.json'), JSON.stringify({ full_text: '完整口播稿' }));

    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_material_driven.py')) {
        expect(args).toEqual(expect.arrayContaining([
          path.join(taskDir, 'material.mp4'),
          '--output-dir',
          taskDir,
          '--start-from',
          '7'
        ]));
        fs.writeFileSync(path.join(taskDir, 'output_final.mp4'), 'rerendered final composite');
        return;
      }
      if (scriptPath.endsWith('run_asr.py')) {
        fs.writeFileSync(path.join(options.cwd, 'subtitles.json'), JSON.stringify([
          { time: [0, 1.2], zh: '完整口播稿' }
        ]));
        return;
      }
      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });
    const sendProgressEvent = jest.fn();
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => ({}),
      sendProgressEvent,
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript,
      validateDecodableMedia: jest.fn(async (filePath) => {
        if (filePath.endsWith('output_final.mp4')) {
          const content = fs.readFileSync(filePath, 'utf8');
          return content.includes('rerendered')
            ? { ok: true, details: '' }
            : { ok: false, details: 'Invalid NAL unit size' };
        }
        return { ok: true, details: '' };
      })
    });

    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        sourceTaskDir: 'material_1778543460029_582511b3',
        useASR: 'true'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(runtimeDir, 'standalone_input.mp4'), 'utf8')).toBe('rerendered final composite');
    expect(runPythonScript).toHaveBeenCalledWith(
      expect.stringContaining('run_material_driven.py'),
      expect.any(Array),
      expect.objectContaining({ cwd: taskDir })
    );
    expect(sendProgressEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      msg: expect.stringContaining('正在修复源成片')
    }));
  });

  test('retries standalone ASR when strict reference authority alignment fails once', async () => {
    const inputVideoPath = path.join(runtimeDir, 'upload.mp4');
    fs.writeFileSync(inputVideoPath, 'task video');
    const referencePayload = [
      { time: [0, 2.4], zh: '更关键的是，机构采用已经落地。' }
    ];
    let asrAttempts = 0;
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        asrAttempts += 1;
        if (asrAttempts === 1) {
          const err = new Error('参考文本字幕时间轴未通过严格校验');
          err.code = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
          err.stage = 'subtitle_reference_authority';
          err.details = 'atom_span_not_contiguous:expected_0_got_1';
          throw err;
        }
        const subtitlesPath = path.join(options.cwd || runtimeDir, 'subtitles.json');
        const audioPath = path.join(options.cwd || runtimeDir, 'audio.json');
        const subtitles = referencePayload.map((item) => ({ ...item, text: item.zh }));
        fs.writeFileSync(audioPath, JSON.stringify(subtitles, null, 2));
        fs.writeFileSync(subtitlesPath, JSON.stringify(subtitles, null, 2));
        return;
      }

      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });

    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        useASR: 'true',
        subtitlesPayload: JSON.stringify(referencePayload)
      },
      files: {
        video: [{ path: inputVideoPath }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    const asrCalls = runPythonScript.mock.calls.filter(([scriptPath]) => scriptPath.endsWith('run_asr.py'));
    expect(asrCalls).toHaveLength(2);
    expect(runPythonScript.mock.calls.some(([scriptPath]) => scriptPath.endsWith('make_vertical_video.py'))).toBe(true);
  });

  test('falls back to plain standalone ASR when strict reference authority keeps failing', async () => {
    const inputVideoPath = path.join(runtimeDir, 'upload.mp4');
    fs.writeFileSync(inputVideoPath, 'task video');
    const referencePayload = [
      { time: [0, 2.4], zh: '更关键的是，机构采用已经落地。' }
    ];
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        const usesReferenceAuthority = args.includes('--reference-text-authority');
        if (usesReferenceAuthority) {
          const err = new Error('参考文本字幕时间轴未通过严格校验');
          err.code = 'REFERENCE_AUTHORITY_ALIGNMENT_FAILED';
          err.stage = 'subtitle_reference_authority';
          err.details = 'atom_span_not_contiguous:expected_0_got_1';
          throw err;
        }
        const subtitlesPath = path.join(options.cwd || runtimeDir, 'subtitles.json');
        const audioPath = path.join(options.cwd || runtimeDir, 'audio.json');
        const subtitles = [{ time: [0, 2.4], zh: '普通 ASR 字幕', text: '普通 ASR 字幕' }];
        fs.writeFileSync(audioPath, JSON.stringify(subtitles, null, 2));
        fs.writeFileSync(subtitlesPath, JSON.stringify(subtitles, null, 2));
        return;
      }

      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });

    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        useASR: 'true',
        subtitlesPayload: JSON.stringify(referencePayload)
      },
      files: {
        video: [{ path: inputVideoPath }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    const asrCalls = runPythonScript.mock.calls.filter(([scriptPath]) => scriptPath.endsWith('run_asr.py'));
    expect(asrCalls).toHaveLength(3);
    expect(asrCalls[0][1]).toContain('--reference-text-authority');
    expect(asrCalls[1][1]).toContain('--reference-text-authority');
    expect(asrCalls[2][1]).not.toContain('--reference-text-authority');
    expect(asrCalls[2][1]).not.toContain('--reference-subtitles-json');
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 2.4], zh: '普通 ASR 字幕', text: '普通 ASR 字幕' }
    ]);
    expect(runPythonScript.mock.calls.some(([scriptPath]) => scriptPath.endsWith('make_vertical_video.py'))).toBe(true);
  });

  test('returns task import validation errors with client status', async () => {
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: () => [],
      runPythonScript: jest.fn()
    });
    const req = {
      body: {
        clientId: 'client-1',
        sourceTaskDir: '../outside'
      },
      files: {}
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({
      code: 'STANDALONE_TASK_DIR_INVALID',
      stage: 'standalone.task_import'
    });
  });

  test('does not pass removed speaker scene plan to vertical render when ASR generates framing data', async () => {
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        writeJson(path.join(options.cwd, 'subtitles.json'), [
          { time: [0, 1.2], zh: '任务字幕', en: 'Task subtitle' }
        ]);
        writeJson(path.join(options.cwd, 'speaker_scene.json'), {
          timeline: [
            {
              start: 0,
              end: 1.2,
              crop_x_ratio: 0.72,
              crop_anchor: 'right',
              vertical_mode: 'follow_speaker'
            }
          ]
        });
        return;
      }

      if (scriptPath.endsWith('make_vertical_video.py')) {
        const outputPath = args[args.indexOf('--output') + 1];
        fs.writeFileSync(outputPath, 'vertical video');
      }
    });

    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: (filePath, fallback) => {
        if (!fs.existsSync(filePath)) return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      },
      runPythonScript
    });
    const inputVideoPath = path.join(runtimeDir, 'upload.mp4');
    fs.writeFileSync(inputVideoPath, 'task video');
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}',
        useASR: 'true'
      },
      files: {
        video: [{ path: inputVideoPath }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(runPythonScript).toHaveBeenCalledTimes(2);
    const renderCall = runPythonScript.mock.calls.find(([scriptPath]) => scriptPath.endsWith('make_vertical_video.py'));
    expect(renderCall).toBeTruthy();
    expect(renderCall[1]).not.toEqual(expect.arrayContaining(['--plan', path.join(runtimeDir, 'speaker_scene.json')]));
  });

  test('rejects uploaded videos that cannot be decoded', async () => {
    mockSpawnExit(1, 'Invalid data found when processing input');
    const handler = createStandaloneHandler({
      sendError: (res, options) => res.status(options.status || 500).json(options),
      baseDir: tempRoot,
      pipelineDir,
      projectsDir,
      upload: { fields: () => [] },
      getProgressClient: () => null,
      sendProgressEvent: jest.fn(),
      createRuntimeJobDir: () => runtimeDir,
      generateHotTitle: jest.fn(async () => 'fallback title'),
      writeJsonFile: (filePath, payload) => writeJson(filePath, payload),
      writeMediaMetadata: (filePath, payload) => writeJson(`${filePath}.meta.json`, payload),
      readJsonIfExists: () => [],
      runPythonScript: jest.fn(),
      validateDecodableMedia: jest.fn(async () => ({
        ok: false,
        details: 'Invalid data found when processing input'
      }))
    });
    const inputVideoPath = path.join(runtimeDir, 'bad-upload.mp4');
    fs.writeFileSync(inputVideoPath, 'not a decodable video');
    const req = {
      body: {
        clientId: 'client-1',
        renderOptions: '{}'
      },
      files: {
        video: [{ path: inputVideoPath }]
      }
    };
    const res = createResponse();

    await handler.handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.payload).toMatchObject({
      code: 'STANDALONE_UPLOADED_MEDIA_INVALID',
      stage: 'standalone.media'
    });
  });
});
