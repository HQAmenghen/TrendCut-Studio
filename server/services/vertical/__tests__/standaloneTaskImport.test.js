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

  test('reruns avatar ASR for imported material tasks, writes back source subtitles, and uses avatar subtitles for standalone render', async () => {
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
    writeJson(path.join(sourceDir, 'execution_plan.json'), [
      { start_time: 0, end_time: 3, subtitle_text: '旧执行计划字幕' }
    ]);
    const runPythonScript = jest.fn(async (scriptPath, args, options = {}) => {
      if (scriptPath.endsWith('run_asr.py')) {
        writeJson(path.join(options.cwd, 'aiman_audio.json'), [
          { start: 0, end: 1.15, text: '数字人句一' },
          { start: 1.15, end: 2.7, text: '数字人句二' }
        ]);
        writeJson(path.join(options.cwd, 'aiman_subtitles.json'), [
          { time: [0, 1.15], zh: '数字人句一', en: 'Avatar line one' },
          { time: [1.15, 2.7], zh: '数字人句二', en: 'Avatar line two' }
        ]);
        writeJson(path.join(options.cwd, 'aiman_speaker_scene.json'), {
          timeline: [
            { start: 0, end: 1.15, crop_x_ratio: 0.5 }
          ]
        });
        return;
      }
      const outputPath = args[args.indexOf('--output') + 1];
      fs.writeFileSync(outputPath, 'vertical video');
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
      '--input',
      path.join(sourceDir, 'aiman.mp4'),
      '--audio-json',
      'aiman_audio.json',
      '--subtitles-json',
      'aiman_subtitles.json',
      '--speaker-scene-json',
      'aiman_speaker_scene.json'
    ]));
    expect(JSON.parse(fs.readFileSync(path.join(sourceDir, 'aiman_subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.15], zh: '数字人句一', en: 'Avatar line one' },
      { time: [1.15, 2.7], zh: '数字人句二', en: 'Avatar line two' }
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'subtitles.json'), 'utf8'))).toEqual([
      { time: [0, 1.15], zh: '数字人句一', en: 'Avatar line one' },
      { time: [1.15, 2.7], zh: '数字人句二', en: 'Avatar line two' }
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
