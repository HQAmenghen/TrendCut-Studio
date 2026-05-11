const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStandaloneHandler } = require('../standalone');

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

describe('standalone vertical task import', () => {
  let tempRoot;
  let projectsDir;
  let pipelineDir;
  let runtimeDir;
  let publicDir;

  beforeEach(() => {
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

  test('prefers avatar segment subtitles over execution plan subtitles for imported material tasks', async () => {
    const sourceDir = path.join(projectsDir, 'material_avatar_refresh_001');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'output_final.mp4'), 'task video');
    fs.writeFileSync(path.join(sourceDir, 'aiman.mp4'), 'avatar video');
    writeJson(path.join(sourceDir, 'source_post.json'), {
      title: '任务标题',
      body: '任务正文'
    });
    writeJson(path.join(sourceDir, 'narration.json'), {
      full_text: '任务口播'
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
      { start_time: 0, end_time: 3, subtitle_text: '旧执行计划字幕' }
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
      '--reference-subtitles-json',
      path.join(sourceDir, 'aiman_reference_subtitles.json'),
      '--refine-subtitles'
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'aiman_subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.15], zh: '数字人句一' },
      { time: [1.15, 2.7], zh: '数字人句二' }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.15], zh: '数字人句一' },
      { time: [1.15, 2.7], zh: '数字人句二' }
    ]);
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
      '--refine-subtitles'
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.4], zh: 'Kalshi 的成交量在波动。', en: 'Kalshi volume is moving.', text: 'Kalshi 的成交量在波动。' }
    ]);
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
});
