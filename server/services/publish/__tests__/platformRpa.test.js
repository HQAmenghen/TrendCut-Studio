const fs = require('fs');
const os = require('os');
const path = require('path');

const { BROWSER_RPA_PLATFORMS, createPlatformRpaService } = require('../platformRpa');

function createJob(id, assetPath, platform = 'douyin') {
  return {
    id,
    asset: {
      path: assetPath,
      label: 'Asset Label',
      metadata: {
        suggestedTitle: 'Suggested Title',
        suggestedDescription: 'Suggested Description'
      }
    },
    publishData: {
      title: 'Publish Title',
      description: 'Publish Description',
      tags: ['ai', 'video']
    },
    platformTasks: [{
      platform,
      status: 'rpa_available',
      runtime: { logs: [] }
    }]
  };
}

function createService(overrides = {}) {
  const jobs = overrides.jobs || [];
  const config = overrides.config || {
    douyin: { enabled: true, displayName: 'Douyin Account', openId: 'open_1', sauAccountName: 'dy_sau' },
    xiaohongshu: { enabled: true, displayName: 'XHS Account', accountId: 'xhs_1', sauAccountName: 'xhs_sau' }
  };
  return createPlatformRpaService({
    fs,
    path,
    slugifyText: overrides.slugifyText || ((value, fallback) => String(value || fallback).replace(/[^a-z0-9_-]+/gi, '-')),
    runPythonScriptCancellable: overrides.runPythonScriptCancellable || jest.fn(() => ({
      process: {},
      promise: Promise.resolve(),
      cancel: jest.fn()
    })),
    publishCenterDir: overrides.publishCenterDir || __dirname,
    platformRpaScript: overrides.platformRpaScript || path.join(__dirname, 'browser_platform_rpa.py'),
    socialAutoUploadAdapterScript: overrides.socialAutoUploadAdapterScript || path.join(__dirname, 'social_auto_upload_adapter.py'),
    platformRpaTaskDir: overrides.platformRpaTaskDir || __dirname,
    platformRpaProfileRoot: overrides.platformRpaProfileRoot || path.join(os.tmpdir(), 'platform-rpa-profiles'),
    socialAutoUploadDir: overrides.socialAutoUploadDir || '',
    socialAutoUploadPython: overrides.socialAutoUploadPython || '',
    readPublishJobs: overrides.readPublishJobs || jest.fn(() => ({ jobs })),
    readPublishConfig: overrides.readPublishConfig || jest.fn(() => config),
    updatePublishPlatformTask: overrides.updatePublishPlatformTask || jest.fn(),
    startWechatRpa: jest.fn(),
    retryWechatRpa: jest.fn(),
    cancelWechatRpa: jest.fn()
  });
}

describe('platform RPA service', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-rpa-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('exposes browser RPA platform definitions for douyin and xiaohongshu', () => {
    expect(BROWSER_RPA_PLATFORMS.douyin.uploadUrl).toContain('creator.douyin.com');
    expect(BROWSER_RPA_PLATFORMS.xiaohongshu.uploadUrl).toContain('creator.xiaohongshu.com');
  });

  test('writes douyin browser payload with account-scoped profile', async () => {
    const videoPath = path.join(tempRoot, 'video.mp4');
    const scriptPath = path.join(tempRoot, 'browser_platform_rpa.py');
    const payloadDir = path.join(tempRoot, 'tasks');
    const profileRoot = path.join(tempRoot, 'profiles');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(scriptPath, 'print("ok")');

    const runPythonScriptCancellable = jest.fn(() => ({
      process: {},
      promise: Promise.resolve(),
      cancel: jest.fn()
    }));
    const service = createService({
      jobs: [createJob('job_1', videoPath, 'douyin')],
      publishCenterDir: tempRoot,
      platformRpaScript: scriptPath,
      platformRpaTaskDir: payloadDir,
      platformRpaProfileRoot: profileRoot,
      runPythonScriptCancellable
    });

    await service.startPlatformRpa('job_1', 'douyin', 'draft');

    const payload = JSON.parse(fs.readFileSync(path.join(payloadDir, 'job_1_douyin.json'), 'utf8'));
    expect(payload.platform).toBe('douyin');
    expect(payload.uploadUrl).toBe(BROWSER_RPA_PLATFORMS.douyin.uploadUrl);
    expect(payload.videoPath).toBe(videoPath);
    expect(payload.title).toBe('Publish Title');
    expect(payload.description).toBe('Publish Description');
    expect(payload.tags).toEqual(['ai', 'video']);
    expect(payload.userDataDir).toBe(path.join(profileRoot, 'douyin', 'open_1'));
    expect(runPythonScriptCancellable).toHaveBeenCalledWith(
      scriptPath,
      ['--payload', path.join(payloadDir, 'job_1_douyin.json')],
      expect.objectContaining({ cwd: tempRoot })
    );
  });

  test('uses direct social-auto-upload adapter when configured', async () => {
    const videoPath = path.join(tempRoot, 'video.mp4');
    const sauDir = path.join(tempRoot, 'social-auto-upload');
    const adapterScript = path.join(tempRoot, 'social_auto_upload_adapter.py');
    const payloadDir = path.join(tempRoot, 'payloads');
    fs.writeFileSync(videoPath, 'video');
    fs.mkdirSync(sauDir, { recursive: true });
    fs.writeFileSync(adapterScript, 'print("ok")');

    const runPythonScriptCancellable = jest.fn(() => ({
      process: {},
      promise: Promise.resolve(),
      cancel: jest.fn()
    }));
    const service = createService({
      jobs: [createJob('job_1', videoPath, 'douyin')],
      socialAutoUploadDir: sauDir,
      socialAutoUploadPython: 'C:/Python/python.exe',
      socialAutoUploadAdapterScript: adapterScript,
      platformRpaTaskDir: payloadDir,
      runPythonScriptCancellable
    });

    await service.startPlatformRpa('job_1', 'douyin', 'draft');

    expect(runPythonScriptCancellable).toHaveBeenCalledWith(
      adapterScript,
      ['--payload', path.join(payloadDir, 'job_1_douyin_social_auto_upload.json'), '--social-auto-upload-dir', sauDir],
      expect.objectContaining({ cwd: __dirname, command: 'C:/Python/python.exe' })
    );
    const payload = JSON.parse(fs.readFileSync(path.join(payloadDir, 'job_1_douyin_social_auto_upload.json'), 'utf8'));
    expect(payload).toMatchObject({
      platform: 'douyin',
      publishMode: 'draft',
      accountName: 'dy_sau',
      videoPath
    });
  });
});
