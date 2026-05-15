const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  AVATAR_RENDER_STATE_FILE,
  QWEN_TTS_METADATA_FILE,
  createAvatarGenerationService,
  readAvatarRenderState
} = require('../avatarGeneration');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-generation-'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function createBaseProject() {
  const projectRoot = makeTempProject();
  const outputPath = path.join(projectRoot, 'projects', 'material_job');
  const audioPresetDir = path.join(projectRoot, 'public', 'presets', 'audio');
  const imagePresetDir = path.join(projectRoot, 'public', 'presets', 'image');
  fs.mkdirSync(outputPath, { recursive: true });
  fs.mkdirSync(audioPresetDir, { recursive: true });
  fs.mkdirSync(imagePresetDir, { recursive: true });

  fs.writeFileSync(path.join(audioPresetDir, 'voice.mp3'), 'voice', 'utf8');
  fs.writeFileSync(path.join(imagePresetDir, 'avatar.png'), 'image', 'utf8');
  writeJson(path.join(outputPath, 'narration.json'), { full_text: '第一句口播。第二句口播。' });

  return {
    projectRoot,
    outputPath,
    paths: {
      PROJECT_ROOT: projectRoot,
      WORKFLOW_PATH: path.join(projectRoot, 'workflow.json')
    }
  };
}

describe('createAvatarGenerationService', () => {
  test('reuses cached Qwen3TTS audio when retrying avatar generation', async () => {
    const { outputPath, paths } = createBaseProject();
    const cachedAudioPath = path.join(outputPath, 'avatar_qwen3tts.wav');
    fs.writeFileSync(cachedAudioPath, 'cached-audio', 'utf8');
    const synthesizeSpeech = jest.fn();
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      nodeInfoList: [{ nodeId: '6', fieldName: 'audio' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      readWorkflowFile: () => ({}),
      rendererFactory: () => ({ render }),
      downloadFile
    });
    const task = {
      outputPath,
      progress: 80,
      logs: [],
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    await service.autoGenerateAvatar('job-1', task);

    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      speechAudioPath: cachedAudioPath
    }));
    expect(downloadFile).toHaveBeenCalledWith('https://example.com/avatar.mp4', path.join(outputPath, 'aiman.mp4'));
    expect(task.logs.map((item) => item.message)).toContain(`复用已生成的 Qwen3TTS 口播音频: ${path.basename(cachedAudioPath)}`);
  });

  test('reuses legacy Qwen3TTS audio even when retry trims a newer reference file', async () => {
    const { outputPath, paths } = createBaseProject();
    const cachedAudioPath = path.join(outputPath, 'avatar_qwen3tts.wav');
    fs.writeFileSync(cachedAudioPath, 'cached-audio', 'utf8');

    const now = new Date();
    const sourceAt = new Date(now.getTime() - 120_000);
    const cachedAt = new Date(now.getTime() - 60_000);
    const trimmedAt = new Date(now.getTime() + 60_000);
    fs.utimesSync(path.join(outputPath, 'narration.json'), sourceAt, sourceAt);
    fs.utimesSync(path.join(paths.PROJECT_ROOT, 'public', 'presets', 'audio', 'voice.mp3'), sourceAt, sourceAt);
    fs.utimesSync(cachedAudioPath, cachedAt, cachedAt);

    const synthesizeSpeech = jest.fn();
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      nodeInfoList: []
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      prepareReferenceAudioFn: ({ outputDir }) => {
        const trimmedPath = path.join(outputDir, 'avatar_reference_audio_trimmed.mp3');
        fs.writeFileSync(trimmedPath, 'trimmed-reference', 'utf8');
        fs.utimesSync(trimmedPath, trimmedAt, trimmedAt);
        return {
          audioPath: trimmedPath,
          wasTrimmed: true,
          durationSeconds: 30
        };
      },
      readWorkflowFile: () => ({}),
      rendererFactory: () => ({ render }),
      downloadFile
    });
    const task = {
      outputPath,
      progress: 80,
      logs: [],
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    await service.autoGenerateAvatar('job-1', task);

    expect(synthesizeSpeech).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      speechAudioPath: cachedAudioPath,
      referenceAudioPath: path.join(outputPath, 'avatar_reference_audio_trimmed.mp3')
    }));
  });

  test('sends speech-safe bill identifiers to Qwen3TTS without changing narration source text', async () => {
    const { outputPath, paths } = createBaseProject();
    writeJson(path.join(outputPath, 'narration.json'), {
      full_text: '法案编号HR 3000,633在投票中以多数通过'
    });
    const synthesizeSpeech = jest.fn(async () => ({
      outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
      model: 'qwen3-tts'
    }));
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      nodeInfoList: []
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      readWorkflowFile: () => ({}),
      rendererFactory: () => ({ render }),
      downloadFile
    });
    const task = {
      outputPath,
      progress: 80,
      logs: [],
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    await service.autoGenerateAvatar('job-1', task);

    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({
      text: '法案编号H R 三零零零，六三三在投票中以多数通过。'
    }));
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, 'narration.json'), 'utf8')).full_text)
      .toBe('法案编号HR 3000,633在投票中以多数通过');
  });

  test('stores RunningHub task id on submission and resumes it on retry', async () => {
    const { outputPath, paths } = createBaseProject();
    const renderCalls = [];
    const render = jest.fn(async (options) => {
      renderCalls.push(options);
      if (options.runningHubTaskId) {
        return {
          provider: 'runninghub',
          taskId: options.runningHubTaskId,
          resumed: true,
          videoUrl: 'https://example.com/resumed.mp4',
          remoteAudioName: options.runningHubRemoteAudioName,
          remoteImageName: options.runningHubRemoteImageName,
          nodeInfoList: options.runningHubNodeInfoList
        };
      }

      options.onRunningHubSubmitted({
        taskId: 'task-submitted',
        remoteAudioName: 'api/avatar.wav',
        remoteImageName: 'api/avatar.png',
        nodeInfoList: [{ nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' }]
      });
      throw Object.assign(new Error('Request failed with status code 504'), {
        runningHubTaskId: 'task-submitted',
        remoteAudioName: 'api/avatar.wav',
        remoteImageName: 'api/avatar.png',
        nodeInfoList: [{ nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' }]
      });
    });
    const synthesizeSpeech = jest.fn(async () => ({
      outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
      model: 'qwen3-tts'
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      readWorkflowFile: () => ({}),
      rendererFactory: () => ({ render }),
      downloadFile
    });
    const task = {
      outputPath,
      progress: 80,
      logs: [],
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow('504');

    const interruptedState = readAvatarRenderState(outputPath);
    expect(interruptedState).toMatchObject({
      provider: 'runninghub',
      status: 'polling_interrupted',
      taskId: 'task-submitted',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png'
    });
    expect(fs.existsSync(path.join(outputPath, QWEN_TTS_METADATA_FILE))).toBe(true);

    fs.writeFileSync(path.join(outputPath, 'avatar_qwen3tts.wav'), 'cached-audio', 'utf8');
    await service.autoGenerateAvatar('job-1', task);

    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(renderCalls[1]).toMatchObject({
      runningHubTaskId: 'task-submitted',
      runningHubRemoteAudioName: 'api/avatar.wav',
      runningHubRemoteImageName: 'api/avatar.png'
    });
    expect(downloadFile).toHaveBeenCalledWith('https://example.com/resumed.mp4', path.join(outputPath, 'aiman.mp4'));
    expect(readAvatarRenderState(outputPath)).toMatchObject({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'task-submitted',
      videoUrl: 'https://example.com/resumed.mp4'
    });
    expect(fs.existsSync(path.join(outputPath, AVATAR_RENDER_STATE_FILE))).toBe(true);
  });

  test('reuses downloaded aiman video when the previous RunningHub task already completed', async () => {
    const { outputPath, paths } = createBaseProject();
    const cachedAudioPath = path.join(outputPath, 'avatar_qwen3tts.wav');
    fs.writeFileSync(cachedAudioPath, 'cached-audio', 'utf8');
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-done',
      videoUrl: 'https://example.com/done.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      nodeInfoList: []
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      readWorkflowFile: () => ({}),
      rendererFactory: () => ({ render }),
      downloadFile
    });
    const task = {
      outputPath,
      progress: 80,
      logs: [],
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    await expect(service.autoGenerateAvatar('job-1', task)).resolves.toBeUndefined();
    render.mockClear();
    downloadFile.mockClear();

    await service.autoGenerateAvatar('job-1', task);

    expect(render).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(task.logs.map((item) => item.message)).toContain('复用已下载的数字人视频: aiman.mp4, taskId=task-done');
  });
});
