const { LoginStatusService } = require('../loginStatus');

describe('LoginStatusService Feishu notification defaults', () => {
  const originalEnv = process.env;
  let consoleWarnSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      FEISHU_NOTIFY_LOGIN_STATUS: 'true'
    };
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function createService(overrides = {}) {
    return new LoginStatusService({
      checkWechatLogin: jest.fn(async () => ({
        success: true,
        status: 'need_login',
        qrCodePath: 'C:\\tmp\\login_qr.png'
      })),
      feishuService: {
        sendLoginAlert: jest.fn(),
        sendLatestQrCode: jest.fn()
      },
      readPublishConfig: jest.fn(() => ({
        wechatChannels: {
          enabled: true,
          accounts: [{ id: 'wechat_a', displayName: 'Account A' }]
        }
      })),
      ...overrides
    });
  }

  test('checkAllAccounts does not notify Feishu unless explicitly requested', async () => {
    const service = createService();

    const summary = await service.checkAllAccounts();

    expect(summary.need_login).toBe(1);
    expect(service.feishuService.sendLoginAlert).not.toHaveBeenCalled();
  });

  test('requestLatestQrCode refreshes local QR cache without notifying Feishu by default', async () => {
    const service = createService();

    const result = await service.requestLatestQrCode('wechat_a');

    expect(result.success).toBe(true);
    expect(result.qrCodePath).toBe('C:\\tmp\\login_qr.png');
    expect(service.feishuService.sendLatestQrCode).not.toHaveBeenCalled();
  });
});
