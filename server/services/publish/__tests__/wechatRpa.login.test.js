const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWechatLoginService } = require('../wechatRpa.login');

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.kill = jest.fn(() => {
    proc.killed = true;
  });
  return proc;
}

function createService(overrides = {}) {
  const publishCenterDir = overrides.publishCenterDir || fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-login-'));
  const scriptPath = path.join(publishCenterDir, 'wechat_open_content_manager.py');
  if (!fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, 'print("ok")');
  }
  return createWechatLoginService({
    fs,
    path,
    spawn: overrides.spawn || jest.fn(() => createMockProcess()),
    stopProcessTree: overrides.stopProcessTree || jest.fn(),
    publishCenterDir,
    buildWechatProfileDir: overrides.buildWechatProfileDir || ((accountId) => path.join(publishCenterDir, accountId)),
    getActiveWechatRuntimeForAccount: overrides.getActiveWechatRuntimeForAccount || jest.fn(() => null)
  });
}

describe('wechat login service content manager sessions', () => {
  test('starts a new content manager process after the previous browser session exits', async () => {
    const processes = [createMockProcess(), createMockProcess()];
    const spawn = jest.fn(() => processes.shift());
    const service = createService({ spawn });

    const firstOpen = service.openWechatContentManager('acct_1');
    spawn.mock.results[0].value.stdout.emit('data', 'CONTENT_MANAGER|READY|https://channels.weixin.qq.com/platform/post/list\n');

    await expect(firstOpen).resolves.toMatchObject({
      success: true,
      status: 'opened',
      accountId: 'acct_1'
    });

    spawn.mock.results[0].value.exitCode = 0;
    spawn.mock.results[0].value.emit('close', 0);

    const secondOpen = service.openWechatContentManager('acct_1');
    spawn.mock.results[1].value.stdout.emit('data', 'CONTENT_MANAGER|READY|https://channels.weixin.qq.com/platform/post/list\n');

    await expect(secondOpen).resolves.toMatchObject({
      success: true,
      status: 'opened',
      accountId: 'acct_1'
    });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('does not reuse a killed content manager process as already open', async () => {
    const processes = [createMockProcess(), createMockProcess()];
    const spawn = jest.fn(() => processes.shift());
    const service = createService({ spawn });

    const firstOpen = service.openWechatContentManager('acct_1');
    spawn.mock.results[0].value.stdout.emit('data', 'CONTENT_MANAGER|READY|https://channels.weixin.qq.com/platform/post/list\n');
    await expect(firstOpen).resolves.toMatchObject({ status: 'opened' });

    spawn.mock.results[0].value.killed = true;

    const secondOpen = service.openWechatContentManager('acct_1');
    spawn.mock.results[1].value.stdout.emit('data', 'CONTENT_MANAGER|READY|https://channels.weixin.qq.com/platform/post/list\n');
    await expect(secondOpen).resolves.toMatchObject({ status: 'opened' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
