const fs = require('fs');
const os = require('os');
const path = require('path');

const { createPublishConfigService } = require('../publishStore.config');

function createStore() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-config-'));
  const publishConfigPath = path.join(tempRoot, 'platform_config.json');
  const publishJobsPath = path.join(tempRoot, 'publish_jobs.json');
  const store = createPublishConfigService({
    publishConfigPath,
    wechatAccountFields: ['displayName', 'finderUserName', 'helperAccount', 'openPlatformAppId', 'appId', 'appSecret', 'refreshToken', 'accountId', 'notes'],
    readJsonIfExists: (filePath, fallback) => {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    },
    writeJsonFile: (filePath, payload) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    },
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    makeJobId: jest.fn(() => 'generated_id')
  });
  return { tempRoot, store };
}

describe('publish config social accounts', () => {
  test('migrates legacy douyin single account into accounts array', () => {
    const { tempRoot, store } = createStore();
    try {
      const config = store.normalizePublishConfig({
        douyin: {
          enabled: true,
          displayName: '主抖音',
          sauAccountName: 'douyin_main',
          openId: 'open_1',
          notes: 'legacy'
        }
      });

      expect(config.douyin.accounts).toHaveLength(1);
      expect(config.douyin.accounts[0]).toMatchObject({
        id: 'douyin_main',
        displayName: '主抖音',
        sauAccountName: 'douyin_main',
        openId: 'open_1',
        notes: 'legacy'
      });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('validates selected xiaohongshu account fields from account list', () => {
    const { tempRoot, store } = createStore();
    try {
      const config = store.normalizePublishConfig({
        xiaohongshu: {
          enabled: true,
          accounts: [{ id: 'xhs_a', displayName: '小红书 A', sauAccountName: 'xhs_a' }]
        }
      });

      const validation = store.validateSauTaskConfig('xiaohongshu', config.xiaohongshu, {
        accountId: 'xhs_a',
        requiredFields: ['sauAccountName']
      });

      expect(validation.missingFields).toEqual([]);
      expect(validation.account).toMatchObject({ id: 'xhs_a', sauAccountName: 'xhs_a' });
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
