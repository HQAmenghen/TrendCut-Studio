const {
  buildRunningHubRunUrl,
  createRunningHubClient,
  extractRunningHubOutputUrl
} = require('../runningHub');

describe('RunningHub workflow API helpers', () => {
  test('builds v2 workflow run URLs from base URL and workflow id', () => {
    expect(buildRunningHubRunUrl({
      baseUrl: 'https://www.runninghub.cn/openapi/v2/',
      workflowId: '2051840324212936706'
    })).toBe('https://www.runninghub.cn/openapi/v2/run/workflow/2051840324212936706');

    expect(buildRunningHubRunUrl({
      baseUrl: 'https://www.runninghub.cn/openapi/v2',
      runPath: '/run/workflow/2051840324212936706'
    })).toBe('https://www.runninghub.cn/openapi/v2/run/workflow/2051840324212936706');
  });

  test('uploads media with bearer auth and returns the ComfyUI node fileName', async () => {
    const posts = [];
    const fakeAxios = {
      post: jest.fn(async (url, body, options) => {
        posts.push({ url, body, options });
        return {
          data: {
            code: 0,
            data: {
              fileName: 'api/avatar.wav',
              type: 'audio'
            }
          }
        };
      })
    };
    const fakeForm = {
      append: jest.fn(),
      getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=test' })
    };
    const client = createRunningHubClient({
      axiosClient: fakeAxios,
      formDataFactory: () => fakeForm,
      fsImpl: {
        createReadStream: (filePath) => ({ filePath })
      }
    });

    await expect(client.uploadResource('C:/tmp/avatar.wav', {
      apiKey: 'rh-key',
      baseUrl: 'https://www.runninghub.cn/openapi/v2'
    })).resolves.toBe('api/avatar.wav');

    expect(posts[0].url).toBe('https://www.runninghub.cn/openapi/v2/media/upload/binary');
    expect(posts[0].options.headers.Authorization).toBe('Bearer rh-key');
    expect(fakeForm.append).toHaveBeenCalledWith('file', { filePath: 'C:/tmp/avatar.wav' });
  });

  test('submits workflow with nodeInfoList using fieldValue entries', async () => {
    const fakeAxios = {
      post: jest.fn(async () => ({
        data: {
          code: 0,
          data: {
            taskId: 'task-1',
            taskStatus: 'RUNNING'
          }
        }
      }))
    };
    const client = createRunningHubClient({ axiosClient: fakeAxios });

    await expect(client.submitWorkflow({
      apiKey: 'rh-key',
      baseUrl: 'https://www.runninghub.cn/openapi/v2',
      workflowId: '2051840324212936706',
      nodeInfoList: [
        { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
        { nodeId: '180', fieldName: 'image', fieldValue: 'api/avatar.png' }
      ],
      instanceType: 'plus'
    })).resolves.toMatchObject({
      taskId: 'task-1',
      status: 'RUNNING'
    });

    expect(fakeAxios.post).toHaveBeenCalledWith(
      'https://www.runninghub.cn/openapi/v2/run/workflow/2051840324212936706',
      expect.objectContaining({
        apiKey: 'rh-key',
        workflowId: '2051840324212936706',
        instanceType: 'plus',
        nodeInfoList: [
          { nodeId: '6', fieldName: 'audio', fieldValue: 'api/avatar.wav' },
          { nodeId: '180', fieldName: 'image', fieldValue: 'api/avatar.png' }
        ]
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer rh-key'
        })
      })
    );
  });

  test('adds InfiniteTalk reference video input to RunningHub nodeInfoList by default', async () => {
    const responses = [
      { data: { code: 0, data: { fileName: 'api/avatar.wav' } } },
      { data: { code: 0, data: { fileName: 'api/avatar.png' } } },
      { data: { code: 0, data: { fileName: 'api/avatar_pose.json' } } },
      { data: { code: 0, data: { taskId: 'task-1', taskStatus: 'RUNNING' } } },
      {
        data: {
          code: 0,
          data: {
            taskStatus: 'SUCCESS',
            results: [{ fileUrl: 'https://example.com/avatar.mp4', fileType: 'mp4' }]
          }
        }
      }
    ];
    const fakeAxios = {
      post: jest.fn(async () => responses.shift())
    };
    const fakeForm = {
      append: jest.fn(),
      getHeaders: () => ({ 'content-type': 'multipart/form-data; boundary=test' })
    };
    const client = createRunningHubClient({
      axiosClient: fakeAxios,
      formDataFactory: () => fakeForm,
      fsImpl: {
        createReadStream: (filePath) => ({ filePath })
      },
      setTimeoutFn: (callback) => callback()
    });

    await expect(client.renderExternalAudio({
      apiKey: 'rh-key',
      baseUrl: 'https://www.runninghub.cn/openapi/v2',
      workflowId: '2051840324212936706',
      audioPath: 'C:/tmp/avatar.wav',
      imagePath: 'C:/tmp/avatar.png',
      posePath: 'C:/tmp/avatar_motion_source.mp4',
      maxAttempts: 1,
      pollIntervalMs: 1
    })).resolves.toMatchObject({
      remotePoseName: 'api/avatar_pose.json',
      nodeInfoList: expect.arrayContaining([
        { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_pose.json' }
      ])
    });

    expect(fakeAxios.post).toHaveBeenNthCalledWith(
      4,
      'https://www.runninghub.cn/openapi/v2/run/workflow/2051840324212936706',
      expect.objectContaining({
        nodeInfoList: expect.arrayContaining([
          { nodeId: '279', fieldName: 'video', fieldValue: 'api/avatar_pose.json' }
        ])
      }),
      expect.any(Object)
    );
  });

  test('extracts the requested video output URL from flexible query responses', () => {
    const outputUrl = extractRunningHubOutputUrl({
      data: {
        status: 'SUCCESS',
        results: [
          { fileUrl: 'https://example.com/thumb.png', fileType: 'png', nodeId: '10' },
          { fileUrl: 'https://example.com/avatar.mp4', fileType: 'mp4', nodeId: '151' }
        ]
      }
    }, { outputNodeId: '151' });

    expect(outputUrl).toBe('https://example.com/avatar.mp4');
  });

  test.each([504, 554])('keeps polling when a RunningHub query returns a transient %s', async (statusCode) => {
    const fakeAxios = {
      post: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error(`Request failed with status code ${statusCode}`), {
          response: { status: statusCode }
        }))
        .mockResolvedValueOnce({
          data: {
            code: 0,
            data: {
              taskStatus: 'SUCCESS',
              results: [
                { fileUrl: 'https://example.com/avatar.mp4', fileType: 'mp4' }
              ]
            }
          }
        })
    };
    const client = createRunningHubClient({
      axiosClient: fakeAxios,
      setTimeoutFn: (callback) => callback()
    });

    await expect(client.waitForOutputs({
      apiKey: 'rh-key',
      baseUrl: 'https://www.runninghub.cn/openapi/v2',
      taskId: 'task-1',
      maxAttempts: 3,
      pollIntervalMs: 1
    })).resolves.toMatchObject({
      outputUrl: 'https://example.com/avatar.mp4',
      status: 'SUCCESS'
    });

    expect(fakeAxios.post).toHaveBeenCalledTimes(2);
  });

  test('resumes an existing RunningHub task without uploading or submitting again', async () => {
    const fakeAxios = {
      post: jest.fn(async () => ({
        data: {
          code: 0,
          data: {
            taskStatus: 'SUCCESS',
            results: [
              { fileUrl: 'https://example.com/resumed.mp4', fileType: 'mp4' }
            ]
          }
        }
      }))
    };
    const createReadStream = jest.fn();
    const client = createRunningHubClient({
      axiosClient: fakeAxios,
      fsImpl: { createReadStream }
    });

    await expect(client.renderExternalAudio({
      apiKey: 'rh-key',
      baseUrl: 'https://www.runninghub.cn/openapi/v2',
      resumeTaskId: 'task-resume',
      audioPath: 'C:/tmp/avatar.wav',
      imagePath: 'C:/tmp/avatar.png'
    })).resolves.toMatchObject({
      provider: 'runninghub',
      taskId: 'task-resume',
      resumed: true,
      videoUrl: 'https://example.com/resumed.mp4'
    });

    expect(createReadStream).not.toHaveBeenCalled();
    expect(fakeAxios.post).toHaveBeenCalledWith(
      'https://www.runninghub.cn/openapi/v2/query',
      expect.objectContaining({ taskId: 'task-resume' }),
      expect.any(Object)
    );
  });
});
