const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWechatProcessService } = require('../wechatRpa.process');

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createJob(id, assetPath, accountId = 'acct_1', metadata = {}) {
  return {
    id,
    asset: {
      path: assetPath,
      metadata
    },
    publishData: {
      title: `Title ${id}`,
      description: `Description ${id}`,
      tags: []
    },
    platformTasks: [{
      platform: 'wechatChannels',
      status: 'scheduled_wait',
      accountId,
      requiredFields: []
    }]
  };
}

function createService(overrides = {}) {
  const account = overrides.account || { id: 'acct_1', displayName: 'Account 1' };
  const jobs = overrides.jobs || [];
  return createWechatProcessService({
    fs: overrides.fs || fs,
    path,
    runPythonScriptCancellable: overrides.runPythonScriptCancellable || jest.fn(() => ({
      process: {},
      promise: Promise.resolve(),
      cancel: jest.fn()
    })),
    publishCenterDir: overrides.publishCenterDir || __dirname,
    wechatRpaScript: overrides.wechatRpaScript || path.join(__dirname, 'wechat_channels_rpa.py'),
    wechatRpaTaskDir: overrides.wechatRpaTaskDir || __dirname,
    readPublishJobs: overrides.readPublishJobs || jest.fn(() => ({ jobs })),
    readPublishConfig: overrides.readPublishConfig || jest.fn(() => ({
      wechatChannels: { enabled: true, accounts: [account] }
    })),
    validateWechatTaskConfig: overrides.validateWechatTaskConfig || jest.fn(() => ({
      missingFields: [],
      missingFieldLabels: [],
      account
    })),
    buildWechatPublishPayload: overrides.buildWechatPublishPayload || jest.fn((job, wechatAccount) => ({
      title: job.publishData?.title || '',
      description: job.publishData?.description || '',
      tags: [],
      publishMode: 'draft',
      videoPath: job.asset?.path || '',
      userDataDir: path.join(os.tmpdir(), `wechat-profile-${wechatAccount.id}`)
    })),
    parseWechatRpaLine: overrides.parseWechatRpaLine || jest.fn(() => null),
    parseWechatLogLine: overrides.parseWechatLogLine || jest.fn(() => null),
    getWechatStateProgress: overrides.getWechatStateProgress || jest.fn(() => 0),
    readWechatRuntimeLogs: overrides.readWechatRuntimeLogs || jest.fn(() => []),
    appendWechatRuntimeLog: overrides.appendWechatRuntimeLog || jest.fn(),
    safeUpdatePublishPlatformTask: overrides.safeUpdatePublishPlatformTask || jest.fn()
  });
}

describe('wechat RPA process service', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-rpa-process-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses standalone runtime video path instead of mutable public alias', async () => {
    const taskDir = path.join(tempRoot, 'data', 'uploads', 'runtime_jobs', 'standalone_1');
    const taskDirVideo = path.join(taskDir, 'standalone_output_vertical.mp4');
    const publicVideo = path.join(tempRoot, 'public', 'standalone_output_vertical.mp4');
    const scriptPath = path.join(tempRoot, 'wechat_channels_rpa.py');
    const taskPayloadDir = path.join(tempRoot, 'wechat_channels_tasks');

    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(path.dirname(publicVideo), { recursive: true });
    fs.mkdirSync(taskPayloadDir, { recursive: true });
    fs.writeFileSync(taskDirVideo, 'stable task video');
    fs.writeFileSync(publicVideo, 'mutable latest video');
    fs.writeFileSync(scriptPath, 'print("ok")');

    const job = createJob('job_1', publicVideo, 'acct_1', { taskDir });
    const service = createService({
      jobs: [job],
      publishCenterDir: tempRoot,
      wechatRpaScript: scriptPath,
      wechatRpaTaskDir: taskPayloadDir
    });

    await service.startWechatRpa('job_1', 'publish');

    const payloadPath = path.join(taskPayloadDir, 'job_1_wechatChannels.json');
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    expect(payload.videoPath).toBe(taskDirVideo);
  });

  test('reserves account runtime before async payload write completes', async () => {
    const firstWrite = createDeferred();
    let writeCount = 0;
    const fakeFs = {
      existsSync: jest.fn(() => true),
      statSync: jest.fn(() => ({ isFile: () => true })),
      promises: {
        writeFile: jest.fn(() => {
          writeCount += 1;
          return writeCount === 1 ? firstWrite.promise : Promise.resolve();
        })
      }
    };
    const runPythonScriptCancellable = jest.fn(() => ({
      process: {},
      promise: new Promise(() => {}),
      cancel: jest.fn()
    }));
    const jobs = [
      createJob('job_1', path.join(tempRoot, 'one.mp4')),
      createJob('job_2', path.join(tempRoot, 'two.mp4'))
    ];
    const service = createService({
      fs: fakeFs,
      jobs,
      runPythonScriptCancellable,
      publishCenterDir: tempRoot,
      wechatRpaScript: path.join(tempRoot, 'wechat_channels_rpa.py'),
      wechatRpaTaskDir: tempRoot
    });

    const firstStart = service.startWechatRpa('job_1', 'publish');

    await expect(service.startWechatRpa('job_2', 'publish')).rejects.toThrow('当前已有发布任务在运行');
    expect(fakeFs.promises.writeFile).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await firstStart;
    expect(runPythonScriptCancellable).toHaveBeenCalledTimes(1);
  });
});
