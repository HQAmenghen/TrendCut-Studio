const fs = require('fs');
const os = require('os');
const path = require('path');

const { TaskStore } = require('../../../core/taskStore');
const {
  AVATAR_RENDER_STATE_FILE,
  NARRATION_SPEECH_METADATA_FILE,
  NARRATION_SPEECH_TEXT_FILE,
  QWEN_TTS_METADATA_FILE,
  createAvatarGenerationService,
  generateDeepSeekSpeechNarration,
  readAvatarRenderState
} = require('../avatarGeneration');

function makeTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-generation-'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function mockSpeechNarration() {
  return jest.fn(async ({ fallbackText }) => ({
    speechText: fallbackText,
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    normalizations: []
  }));
}

function mockAvatarMotion(outputPath) {
  const motionSourcePath = path.join(outputPath, 'avatar_motion_source.mp4');
  return jest.fn(async () => {
    fs.writeFileSync(motionSourcePath, 'motion', 'utf8');
    return {
      enabled: true,
      motionSourcePath,
      poseInputPath: motionSourcePath,
      motionSignature: 'motion-sig',
      segmentCount: 1
    };
  });
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
  test('parses DeepSeek speech narration protocol result', async () => {
    const runPython = jest.fn(async () => ({
      protocol: {
        result: {
          speechText: '十二万五千美元',
          provider: 'deepseek',
          model: 'deepseek-v4-flash',
          changes: [
            { raw: '12万5美元', reading: '十二万五千美元', reason: '价格缩写' }
          ]
        }
      }
    }));

    const result = await generateDeepSeekSpeechNarration({
      sourceText: '12万5美元',
      fallbackText: '12万5美元',
      outputDir: 'C:\\work',
      runPython
    });

    expect(result).toEqual({
      speechText: '十二万五千美元',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      normalizations: [
        { kind: 'llm', raw: '12万5美元', reading: '十二万五千美元', reason: '价格缩写' }
      ]
    });
    expect(runPython.mock.calls[0][1]).toEqual([
      '--source-text',
      '12万5美元',
      '--fallback-text',
      '12万5美元'
    ]);
  });

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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '6', fieldName: 'audio' },
        { nodeId: '279', fieldName: 'video' }
      ]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/avatar.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.objectContaining({
        timeout: 180000,
        headers: expect.objectContaining({
          'User-Agent': expect.any(String)
        })
      })
    );
    expect(task.logs.map((item) => item.message)).toContain(`复用已生成的 Qwen3TTS 口播音频: ${path.basename(cachedAudioPath)}`);
  });

  test('persists detailed avatar motion planning failures and does not render', async () => {
    const { outputPath, paths } = createBaseProject();
    const taskStore = new TaskStore(path.join(paths.projectRoot || path.dirname(paths.WORKFLOW_PATH), 'tasks.db'));
    const render = jest.fn();
    const synthesizeSpeech = jest.fn(async () => {
      const outputPathForSpeech = path.join(outputPath, 'avatar_qwen3tts.wav');
      fs.writeFileSync(outputPathForSpeech, 'speech', 'utf8');
      return {
        outputPath: outputPathForSpeech,
        model: 'qwen3-tts'
      };
    });
    const details = '数字人动作 LLM 多次判断均未选择任何出镜动作';
    const generateAvatarMotionFn = jest.fn(async () => {
      const error = new Error('数字人动作计划生成失败');
      error.code = 'AVATAR_MOTION_PLAN_FAILED';
      error.stage = 'avatar_motion_plan';
      error.details = details;
      throw error;
    });
    const service = createAvatarGenerationService({
      paths,
      taskStore,
      synthesizeSpeech,
      generateAvatarMotionFn,
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
      rendererFactory: () => ({ render }),
      downloadFile: jest.fn()
    });
    const task = {
      outputPath,
      outputDir: 'material_job',
      progress: 80,
      currentStep: 5,
      logs: [],
      status: 'waiting_avatar',
      statusText: '等待数字人',
      autoGenerate: true,
      useSmartClip: true,
      useCache: true,
      avatarConfig: {
        renderProvider: 'runninghub',
        audioPreset: 'voice.mp3',
        imagePreset: 'avatar.png',
        runningHubWorkflowId: '2051840324212936706'
      }
    };

    try {
      await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow(details);
      expect(render).not.toHaveBeenCalled();
      expect(task.error).toContain(details);
      expect(task.logs.map((item) => item.message).join('\n')).toContain(details);
      const stored = taskStore.findTaskByKey('material_driven', 'material:material_job');
      expect(stored.status).toBe('failed');
      expect(stored.message).toContain(details);
      expect(stored.logs.map((item) => item.message).join('\n')).toContain(details);
      expect(stored.metadata).toMatchObject({
        errorCode: 'AVATAR_MOTION_PLAN_FAILED',
        errorStage: 'avatar_motion_plan',
        errorDetails: details
      });
    } finally {
      taskStore.close();
    }
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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
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
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

  test('writes speech-only narration artifacts and keeps display narration unchanged', async () => {
    const { outputPath, paths } = createBaseProject();
    writeJson(path.join(outputPath, 'narration.json'), {
      full_text: '预计收入达到60.000美元，同比增长12.5%。'
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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: jest.fn(async () => ({
        speechText: '预计收入达到六万美元，同比增长百分之十二点五。',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        normalizations: [
          { kind: 'llm', raw: '60.000美元', reading: '六万美元', reason: '金额读法' },
          { kind: 'llm', raw: '12.5%', reading: '百分之十二点五', reason: '百分比读法' }
        ]
      })),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
      text: '预计收入达到六万美元，同比增长百分之十二点五。'
    }));
    expect(fs.readFileSync(path.join(outputPath, NARRATION_SPEECH_TEXT_FILE), 'utf8'))
      .toBe('预计收入达到六万美元，同比增长百分之十二点五。');
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, NARRATION_SPEECH_METADATA_FILE), 'utf8')))
      .toMatchObject({
        source: 'deepseek_speech_normalizer',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        displayText: '预计收入达到60.000美元，同比增长12.5%。',
        speechText: '预计收入达到六万美元，同比增长百分之十二点五。',
        changed: true,
        normalizations: [
          { kind: 'llm', raw: '60.000美元', reading: '六万美元', reason: '金额读法' },
          { kind: 'llm', raw: '12.5%', reading: '百分之十二点五', reason: '百分比读法' }
        ]
      });
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, 'narration.json'), 'utf8')).full_text)
      .toBe('预计收入达到60.000美元，同比增长12.5%。');
  });

  test('uses DeepSeek speech narration when it resolves contextual shorthand', async () => {
    const { outputPath, paths } = createBaseProject();
    writeJson(path.join(outputPath, 'narration.json'), {
      full_text: '十月高点大约12万5，现在回到6万附近。一家公司计划买下150万枚比特币。'
    });
    const synthesizeSpeech = jest.fn(async () => ({
      outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
      model: 'qwen3-tts'
    }));
    const generateSpeechNarration = jest.fn(async () => ({
      speechText: '十月高点大约十二万五千，现在回到六万附近。一家公司计划买下一百五十万枚比特币。',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      normalizations: [
        { kind: 'llm', raw: '12万5', reading: '十二万五千', reason: '市场价格缩写' },
        { kind: 'llm', raw: '6万附近', reading: '六万附近', reason: '价格数量读法' },
        { kind: 'llm', raw: '150万枚比特币', reading: '一百五十万枚比特币', reason: '带单位数量' }
      ]
    }));
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration,
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    expect(generateSpeechNarration).toHaveBeenCalledWith({
      sourceText: '十月高点大约12万5，现在回到6万附近。一家公司计划买下150万枚比特币。',
      fallbackText: '十月高点大约12万5，现在回到6万附近。一家公司计划买下150万枚比特币。',
      outputDir: outputPath
    });
    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({
      text: '十月高点大约十二万五千，现在回到六万附近。一家公司计划买下一百五十万枚比特币。'
    }));
  });

  test('falls back to rule-based speech narration when DeepSeek fails', async () => {
    const { outputPath, paths } = createBaseProject();
    writeJson(path.join(outputPath, 'narration.json'), {
      full_text: '预计收入达到60.000美元，同比增长12.5%。'
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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: jest.fn(async () => {
        throw new Error('deepseek unavailable');
      }),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
      text: '预计收入达到六万美元，同比增长百分之十二点五。'
    }));
    expect(JSON.parse(fs.readFileSync(path.join(outputPath, NARRATION_SPEECH_METADATA_FILE), 'utf8')))
      .toMatchObject({
        source: 'rule_based_numeric_normalizer',
        speechText: '预计收入达到六万美元，同比增长百分之十二点五。'
      });
    expect(task.logs.some((item) => item.message.includes('DeepSeek 口播专用稿生成失败'))).toBe(true);
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
          remotePoseName: options.runningHubRemotePoseName,
          nodeInfoList: options.runningHubNodeInfoList
        };
      }

      options.onRunningHubSubmitted({
        taskId: 'task-submitted',
        remoteAudioName: 'api/avatar.wav',
        remoteImageName: 'api/avatar.png',
        remotePoseName: 'api/avatar_motion_source.mp4',
        nodeInfoList: [
          { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
          { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
        ]
      });
      throw Object.assign(new Error('Request failed with status code 504'), {
        runningHubTaskId: 'task-submitted',
        remoteAudioName: 'api/avatar.wav',
        remoteImageName: 'api/avatar.png',
        remotePoseName: 'api/avatar_motion_source.mp4',
        nodeInfoList: [
          { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
          { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
        ]
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
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
      runningHubRemoteImageName: 'api/avatar.png',
      runningHubRemotePoseName: 'api/avatar_motion_source.mp4'
    });
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/resumed.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.objectContaining({
        timeout: 180000
      })
    );
    expect(readAvatarRenderState(outputPath)).toMatchObject({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'task-submitted',
      videoUrl: 'https://example.com/resumed.mp4'
    });
    expect(fs.existsSync(path.join(outputPath, AVATAR_RENDER_STATE_FILE))).toBe(true);
  });

  test('does not resume a RunningHub task submitted before the current speech audio existed', async () => {
    const { outputPath, paths } = createBaseProject();
    writeJson(path.join(outputPath, AVATAR_RENDER_STATE_FILE), {
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'old-task',
      submittedAt: '2000-01-01T00:00:00.000Z',
      remoteAudioName: 'api/old.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/avatar_motion_source.mp4',
      videoUrl: 'https://example.com/old.mp4'
    });

    const render = jest.fn(async (options) => {
      options.onRunningHubSubmitted({
        taskId: 'new-task',
        remoteAudioName: 'api/new.wav',
        remoteImageName: 'api/avatar.png',
        remotePoseName: 'api/avatar_motion_source.mp4',
        nodeInfoList: [
          { nodeId: '6', fieldName: 'audio', fieldValue: 'api/new.wav' },
          { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
        ]
      });
      return {
        provider: 'runninghub',
        taskId: 'new-task',
        videoUrl: 'https://example.com/new.mp4',
        remoteAudioName: 'api/new.wav',
        remoteImageName: 'api/avatar.png',
        remotePoseName: 'api/avatar_motion_source.mp4',
        nodeInfoList: [{ nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }]
      };
    });
    const synthesizeSpeech = jest.fn(async () => {
      const outputFile = path.join(outputPath, 'avatar_qwen3tts.wav');
      fs.writeFileSync(outputFile, 'new-audio', 'utf8');
      return {
        outputPath: outputFile,
        model: 'qwen3-tts'
      };
    });
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech,
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      runningHubTaskId: '',
      runningHubRemoteAudioName: '',
      runningHubRemoteImageName: ''
    }));
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/new.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.any(Object)
    );
    expect(task.logs.some((item) => item.message.includes('早于当前口播音频'))).toBe(true);
  });

  test('does not reuse a terminally failed RunningHub task id on retry', async () => {
    const { outputPath, paths } = createBaseProject();
    const render = jest
      .fn()
      .mockImplementationOnce(async (options) => {
        options.onRunningHubSubmitted({
          taskId: 'task-false-failed',
          remoteAudioName: 'api/avatar.wav',
          remoteImageName: 'api/avatar.png',
          remotePoseName: 'api/avatar_motion_source.mp4',
          nodeInfoList: [
            { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
            { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
          ]
        });
        throw Object.assign(new Error('[RunningHub 任务失败] temporary false negative'), {
          runningHubTaskId: 'task-false-failed',
          remoteAudioName: 'api/avatar.wav',
          remoteImageName: 'api/avatar.png',
          remotePoseName: 'api/avatar_motion_source.mp4',
          nodeInfoList: [
            { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
            { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
          ]
        });
      })
      .mockImplementationOnce(async () => ({
        provider: 'runninghub',
        taskId: 'task-after-terminal-failure',
        videoUrl: 'https://example.com/retried.mp4',
        remoteAudioName: 'api/retried.wav',
        remoteImageName: 'api/avatar.png',
        remotePoseName: 'api/avatar_motion_source.mp4',
        nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
      }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(async () => ({
        outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
        model: 'qwen3-tts'
      })),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow('temporary false negative');
    expect(readAvatarRenderState(outputPath)).toMatchObject({
      status: 'failed',
      taskId: 'task-false-failed'
    });
    fs.writeFileSync(path.join(outputPath, 'avatar_qwen3tts.wav'), 'cached-audio', 'utf8');

    await service.autoGenerateAvatar('job-1', task);

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      runningHubTaskId: '',
      runningHubRemoteAudioName: '',
      runningHubRemoteImageName: ''
    }));
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/retried.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.any(Object)
    );
    expect(task.logs.some((item) => item.message.includes('已结束且不可恢复'))).toBe(true);
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
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

  test('stops before rendering when avatar motion generation fails', async () => {
    const { outputPath, paths } = createBaseProject();
    const render = jest.fn();
    const downloadFile = jest.fn();
    const generateAvatarMotionFn = jest.fn(async () => {
      throw new Error('motion builder crashed');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(async () => ({
        outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
        model: 'qwen3-tts'
      })),
      generateAvatarMotionFn,
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow('motion builder crashed');

    expect(generateAvatarMotionFn).toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test('does not download or reuse a RunningHub result without motion reference node proof', async () => {
    const { outputPath, paths } = createBaseProject();
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-no-pose',
      videoUrl: 'https://example.com/no-pose.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: '',
      nodeInfoList: [
        { nodeId: '6', fieldName: 'audio' },
        { nodeId: '180', fieldName: 'image' },
        { nodeId: '279', fieldName: 'video', fieldValue: '' }
      ]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(async () => ({
        outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
        model: 'qwen3-tts'
      })),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow('未提交动作参考视频节点输入');

    expect(downloadFile).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outputPath, 'aiman.mp4'))).toBe(false);
    expect(readAvatarRenderState(outputPath)).toEqual({});
  });

  test('does not call the renderer when avatar motion generation fails', async () => {
    const { outputPath, paths } = createBaseProject();
    const render = jest.fn();
    const downloadFile = jest.fn();
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(async () => ({
        outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
        model: 'qwen3-tts'
      })),
      generateAvatarMotionFn: jest.fn(async () => {
        throw new Error('motion builder failed');
      }),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    await expect(service.autoGenerateAvatar('job-1', task)).rejects.toThrow('motion builder failed');

    expect(render).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });

  test('does not reuse cached aiman video when RunningHub state has no pose node proof', async () => {
    const { outputPath, paths } = createBaseProject();
    fs.writeFileSync(path.join(outputPath, 'avatar_qwen3tts.wav'), 'cached-audio', 'utf8');
    fs.writeFileSync(path.join(outputPath, 'aiman.mp4'), 'stale-video', 'utf8');
    writeJson(path.join(outputPath, AVATAR_RENDER_STATE_FILE), {
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'old-no-pose-task',
      videoUrl: 'https://example.com/old-no-pose.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: '',
      nodeInfoList: [
        { nodeId: '6', fieldName: 'audio' },
        { nodeId: '180', fieldName: 'image' },
        { nodeId: '279', fieldName: 'video', fieldValue: '' }
      ]
    });
    const render = jest.fn(async (options) => ({
      provider: 'runninghub',
      taskId: 'new-pose-task',
      videoUrl: 'https://example.com/new-pose.mp4',
      remoteAudioName: 'api/new.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
      ],
      receivedResumeTaskId: options.runningHubTaskId
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'new-video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      runningHubTaskId: '',
      runningHubRemotePoseName: ''
    }));
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/new-pose.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.any(Object)
    );
    expect(fs.readFileSync(path.join(outputPath, 'aiman.mp4'), 'utf8')).toBe('new-video');
    expect(task.logs.some((item) => item.message.includes('缺少动作参考视频节点输入'))).toBe(true);
  });

  test('does not reuse cached RunningHub output when pose signature is missing', async () => {
    const { outputPath, paths } = createBaseProject();
    fs.writeFileSync(path.join(outputPath, 'avatar_qwen3tts.wav'), 'cached-audio', 'utf8');
    fs.writeFileSync(path.join(outputPath, 'aiman.mp4'), 'stale-video', 'utf8');
    writeJson(path.join(outputPath, AVATAR_RENDER_STATE_FILE), {
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'old-unsigned-pose-task',
      videoUrl: 'https://example.com/old-unsigned-pose.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_motion_source.mp4' }
      ]
    });
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'new-signed-pose-task',
      videoUrl: 'https://example.com/new-signed-pose.mp4',
      remoteAudioName: 'api/new.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/new_avatar_motion_source.mp4',
      nodeInfoList: [
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/new_avatar_motion_source.mp4' }
      ]
    }));
    const downloadFile = jest.fn(async (_url, outputFile) => {
      fs.writeFileSync(outputFile, 'new-video', 'utf8');
    });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      runningHubTaskId: '',
      runningHubRemotePoseName: ''
    }));
    expect(downloadFile).toHaveBeenCalledWith(
      'https://example.com/new-signed-pose.mp4',
      path.join(outputPath, 'aiman.mp4'),
      expect.any(Object)
    );
    expect(fs.readFileSync(path.join(outputPath, 'aiman.mp4'), 'utf8')).toBe('new-video');
    expect(readAvatarRenderState(outputPath)).toMatchObject({
      taskId: 'new-signed-pose-task',
      remotePoseSignature: 'motion-sig'
    });
    expect(task.logs.some((item) => item.message.includes('动作参考签名不匹配'))).toBe(true);
  });

  test('retries avatar video download before marking RunningHub task downloaded', async () => {
    const { outputPath, paths } = createBaseProject();
    const render = jest.fn(async () => ({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4',
      remoteAudioName: 'api/avatar.wav',
      remoteImageName: 'api/avatar.png',
      remotePoseName: 'api/avatar_motion_source.mp4',
      nodeInfoList: [{ nodeId: '279', fieldName: 'video' }]
    }));
    const downloadFile = jest
      .fn()
      .mockRejectedValueOnce(new Error('Request failed with status code 554'))
      .mockImplementationOnce(async (_url, outputFile) => {
        fs.writeFileSync(outputFile, 'video', 'utf8');
      });
    const service = createAvatarGenerationService({
      paths,
      synthesizeSpeech: jest.fn(async () => ({
        outputPath: path.join(outputPath, 'avatar_qwen3tts.wav'),
        model: 'qwen3-tts'
      })),
      generateAvatarMotionFn: mockAvatarMotion(outputPath),
      prepareReferenceAudioFn: ({ inputPath }) => ({
        audioPath: inputPath,
        wasTrimmed: false,
        durationSeconds: 8
      }),
      generateSpeechNarration: mockSpeechNarration(),
      readWorkflowFile: () => ({}),
      ensureSpeechAlignmentFn: jest.fn(async () => ({ enabled: false })),
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
    const previousRetries = process.env.AVATAR_DOWNLOAD_RETRIES;
    const previousDelay = process.env.AVATAR_DOWNLOAD_RETRY_DELAY_MS;
    process.env.AVATAR_DOWNLOAD_RETRIES = '6';
    process.env.AVATAR_DOWNLOAD_RETRY_DELAY_MS = '1';
    try {
      await service.autoGenerateAvatar('job-1', task);
    } finally {
      if (previousRetries === undefined) {
        delete process.env.AVATAR_DOWNLOAD_RETRIES;
      } else {
        process.env.AVATAR_DOWNLOAD_RETRIES = previousRetries;
      }
      if (previousDelay === undefined) {
        delete process.env.AVATAR_DOWNLOAD_RETRY_DELAY_MS;
      } else {
        process.env.AVATAR_DOWNLOAD_RETRY_DELAY_MS = previousDelay;
      }
    }

    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(task.logs.some((item) => item.message.includes('数字人视频下载失败，准备重试 1/6'))).toBe(true);
    expect(readAvatarRenderState(outputPath)).toMatchObject({
      provider: 'runninghub',
      status: 'downloaded',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4'
    });
  });
});
