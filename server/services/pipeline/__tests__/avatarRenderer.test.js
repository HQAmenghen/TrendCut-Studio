const {
  createAvatarRenderer,
  resolveAvatarRenderProvider
} = require('../avatarRenderer');

describe('avatar render provider selection', () => {
  test('keeps native ComfyUI as the default provider', () => {
    expect(resolveAvatarRenderProvider({})).toBe('comfyui');
    expect(resolveAvatarRenderProvider({ renderProvider: 'native' })).toBe('comfyui');
    expect(resolveAvatarRenderProvider({ renderProvider: 'runninghub' })).toBe('runninghub');
  });

  test('dispatches RunningHub renders without requiring native ComfyUI workflow submission', async () => {
    const nativeClient = {
      render: jest.fn()
    };
    const runningHubClient = {
      render: jest.fn(async () => ({
        provider: 'runninghub',
        taskId: 'task-1',
        videoUrl: 'https://example.com/avatar.mp4',
        remoteAudioName: 'api/avatar.wav',
        remoteImageName: 'api/avatar.png'
      }))
    };
    const renderer = createAvatarRenderer({ nativeClient, runningHubClient });

    await expect(renderer.render({
      avatarConfig: {
        renderProvider: 'runninghub',
        runningHubWorkflowId: '2051840324212936706',
        runningHubAudioNodeId: '6',
        runningHubImageNodeId: '180'
      },
      audioPath: 'C:/tmp/avatar.wav',
      imagePath: 'C:/tmp/avatar.png'
    })).resolves.toMatchObject({
      provider: 'runninghub',
      taskId: 'task-1',
      videoUrl: 'https://example.com/avatar.mp4'
    });

    expect(nativeClient.render).not.toHaveBeenCalled();
    expect(runningHubClient.render).toHaveBeenCalledWith(expect.objectContaining({
      audioPath: 'C:/tmp/avatar.wav',
      imagePath: 'C:/tmp/avatar.png'
    }));
  });

  test('passes the synthesized speech audio to RunningHub instead of the voice reference audio', async () => {
    const runningHubClient = {
      render: jest.fn(async () => ({
        provider: 'runninghub',
        taskId: 'task-1',
        videoUrl: 'https://example.com/avatar.mp4'
      }))
    };
    const renderer = createAvatarRenderer({
      nativeClient: { render: jest.fn() },
      runningHubClient
    });

    await renderer.render({
      avatarConfig: {
        renderProvider: 'runninghub'
      },
      speechAudioPath: 'C:/tmp/avatar_qwen3tts.wav',
      referenceAudioPath: 'C:/tmp/reference_voice.wav',
      imagePath: 'C:/tmp/avatar.png'
    });

    expect(runningHubClient.render).toHaveBeenCalledWith(expect.objectContaining({
      audioPath: 'C:/tmp/avatar_qwen3tts.wav',
      referenceAudioPath: 'C:/tmp/reference_voice.wav'
    }));
  });

  test('forwards motion source video to InfiniteTalk RunningHub defaults', async () => {
    const runningHubClient = {
      render: jest.fn(async () => ({
        provider: 'runninghub',
        taskId: 'task-1',
        videoUrl: 'https://example.com/avatar.mp4'
      }))
    };
    const renderer = createAvatarRenderer({
      nativeClient: { render: jest.fn() },
      runningHubClient
    });

    await renderer.render({
      avatarConfig: {
        renderProvider: 'runninghub'
      },
      speechAudioPath: 'C:/tmp/avatar_qwen3tts.wav',
      imagePath: 'C:/tmp/avatar.png',
      posePath: 'C:/tmp/avatar_motion_source.mp4'
    });

    expect(runningHubClient.render).toHaveBeenCalledWith(expect.objectContaining({
      posePath: 'C:/tmp/avatar_motion_source.mp4',
      poseNodeId: '279',
      poseFieldName: 'video'
    }));
  });

  test('does not retry a RunningHub render after a task id has already been submitted', async () => {
    const submittedError = Object.assign(new Error('Request failed with status code 504'), {
      code: 'RUNNINGHUB_TASK_SUBMITTED_POLLING_FAILED',
      submitted: true,
      runningHubTaskId: 'task-submitted'
    });
    const runningHubClient = {
      render: jest.fn(async () => {
        throw submittedError;
      })
    };
    const renderer = createAvatarRenderer({
      nativeClient: { render: jest.fn() },
      runningHubClient
    });

    await expect(renderer.render({
      avatarConfig: {
        renderProvider: 'runninghub'
      },
      speechAudioPath: 'C:/tmp/avatar_qwen3tts.wav',
      imagePath: 'C:/tmp/avatar.png'
    })).rejects.toThrow('504');

    expect(runningHubClient.render).toHaveBeenCalledTimes(1);
  });
});
