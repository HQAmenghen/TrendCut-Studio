const fs = require('fs');
const os = require('os');
const path = require('path');

const { createXaiService } = require('../service');

function createTempXaiService(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-service-'));
  const resultPath = path.join(tempDir, 'result.json');
  const scriptPath = path.join(tempDir, 'run_xai_top10.py');
  const translateScriptPath = path.join(tempDir, 'translate_result_summaries.py');
  fs.writeFileSync(scriptPath, '# test script', 'utf-8');
  fs.writeFileSync(translateScriptPath, '# test script', 'utf-8');

  const deps = {
    sendError: jest.fn(),
    resultPath,
    partialPath: path.join(tempDir, 'result.partial.json'),
    logPath: path.join(tempDir, 'run_log.txt'),
    errorLogPath: path.join(tempDir, 'run_error.log'),
    accountsPath: path.join(tempDir, 'xai_accounts.json'),
    scriptPath,
    translateScriptPath,
    scriptCwd: tempDir,
    fixedAccounts: [],
    readJsonIfExists: jest.fn((_file, fallback) => fallback),
    readTextIfExists: jest.fn(() => ''),
    tailLines: jest.fn(() => []),
    getProgressClient: jest.fn(() => null),
    sendProgressEvent: jest.fn(),
    runPythonScript: jest.fn(),
    runPythonScriptSync: jest.fn(),
    ...overrides
  };

  return {
    tempDir,
    resultPath,
    translateScriptPath,
    deps,
    service: createXaiService(deps)
  };
}

describe('createXaiService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('ensureTranslatedResult returns immediately while translation runs in background', () => {
    let resolveTranslation;
    const translationPromise = new Promise((resolve) => {
      resolveTranslation = resolve;
    });
    const { deps, resultPath, service } = createTempXaiService({
      runPythonScript: jest.fn(() => translationPromise)
    });
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        items: [
          {
            rank: 1,
            author_summary: '@Account - English summary'
          }
        ]
      }),
      'utf-8'
    );

    const result = service.ensureTranslatedResult();

    expect(result.items[0].author_summary_zh).toBeUndefined();
    expect(deps.runPythonScript).toHaveBeenCalledTimes(1);
    expect(typeof resolveTranslation).toBe('function');
  });

  test('ensureTranslatedResult does not start duplicate background translations', () => {
    const translationPromise = new Promise(() => {});
    const { deps, resultPath, service } = createTempXaiService({
      runPythonScript: jest.fn(() => translationPromise)
    });
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        items: [
          {
            rank: 1,
            author_summary: '@Account - English summary'
          }
        ]
      }),
      'utf-8'
    );

    service.ensureTranslatedResult();
    service.ensureTranslatedResult();

    expect(deps.runPythonScript).toHaveBeenCalledTimes(1);
  });

  test('ensureTranslatedResult bounds background translation with a timeout', () => {
    const { deps, resultPath, service } = createTempXaiService();
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        items: [
          {
            rank: 1,
            author_summary: '@Account - English summary'
          }
        ]
      }),
      'utf-8'
    );

    service.ensureTranslatedResult();

    const callOptions = deps.runPythonScript.mock.calls[0][2];
    expect(callOptions.timeout).toEqual(expect.any(Number));
    expect(callOptions.timeout).toBeGreaterThan(0);
  });

  test('readConfig migrates legacy accounts into default partition metadata', () => {
    const { service } = createTempXaiService({
      fixedAccounts: ['FixedAccount'],
      readJsonIfExists: jest.fn(() => ({ accounts: ['CustomAccount'] }))
    });

    const config = service.readConfig();

    expect(config.activePartitionId).toBe('crypto');
    expect(config.partitions.map((partition) => partition.id)).toEqual(expect.arrayContaining(['crypto', 'finance', 'tech', 'ai']));
    expect(config.partitions.find((partition) => partition.id === 'crypto').accounts).toEqual(['FixedAccount', 'CustomAccount']);
  });

  test('readConfig preserves saved partitions without re-adding defaults', () => {
    const { service } = createTempXaiService({
      readJsonIfExists: jest.fn(() => ({
        activePartitionId: 'news',
        partitions: [
          { id: 'news', label: '新闻', description: '新闻账号池', accounts: ['NewsAccount'] }
        ]
      }))
    });

    const config = service.readConfig();

    expect(config.activePartitionId).toBe('news');
    expect(config.partitions).toHaveLength(1);
    expect(config.partitions[0]).toEqual(expect.objectContaining({
      id: 'news',
      label: '新闻',
      description: '新闻账号池',
      accounts: ['NewsAccount']
    }));
  });

  test('run passes selected partition and partition-specific files to python script', async () => {
    const { deps, resultPath, service } = createTempXaiService({
      readJsonIfExists: jest.fn((file, fallback) => {
        if (String(file).endsWith('xai_accounts.json')) {
          return {
            activePartitionId: 'finance',
            partitions: [
              { id: 'finance', label: '金融', accounts: ['MarketWatch'] }
            ]
          };
        }
        return fallback;
      }),
      runPythonScript: jest.fn(async () => {
        const financeResultPath = resultPath.replace(/result\.json$/, 'result.finance.json');
        fs.writeFileSync(financeResultPath, JSON.stringify({
          partition: { id: 'finance', label: '金融' },
          items: []
        }), 'utf-8');
        return { protocol: { result: { message: 'done' } } };
      })
    });
    const res = {
      headersSent: false,
      json: jest.fn()
    };

    await service.run('client-1', res, 'finance');

    expect(deps.runPythonScript).toHaveBeenCalledWith(
      deps.scriptPath,
      expect.arrayContaining(['--partition-id', 'finance']),
      expect.objectContaining({ cwd: deps.scriptCwd })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      result: expect.objectContaining({
        partition: expect.objectContaining({ id: 'finance' })
      })
    }));
  });

  test('importUrl resolves one X link through manual script mode without overwriting leaderboard result', async () => {
    const importedPayload = {
      items: [
        {
          rank: 1,
          author: 'alice',
          author_summary: '@alice - imported post',
          post_url: 'https://x.com/alice/status/12345',
          video_url: 'https://video.twimg.com/ext_tw_video/123/vid/avc1/1280x720/video.mp4'
        }
      ]
    };
    const { deps, resultPath, service } = createTempXaiService({
      runPythonScript: jest.fn(async () => ({
        stdout: JSON.stringify(importedPayload),
        protocol: { result: { message: 'imported' } }
      }))
    });
    const req = {
      body: {
        url: 'https://x.com/alice/status/12345',
        partitionId: 'finance'
      }
    };
    const res = {
      json: jest.fn()
    };

    await service.importUrl(req, res);

    const [scriptPath, args, options] = deps.runPythonScript.mock.calls[0];
    expect(scriptPath).toBe(deps.scriptPath);
    expect(args).toEqual(expect.arrayContaining([
      '--import-url',
      'https://x.com/alice/status/12345',
      '--partition-id',
      'finance'
    ]));
    const resultArgIndex = args.indexOf('--result') + 1;
    expect(args[resultArgIndex]).toContain('manual_import.finance.');
    expect(args[resultArgIndex]).not.toBe(resultPath);
    expect(options).toEqual(expect.objectContaining({ cwd: deps.scriptCwd, timeout: expect.any(Number) }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      item: expect.objectContaining({
        post_url: 'https://x.com/alice/status/12345',
        video_url: expect.stringContaining('video.twimg.com')
      })
    }));
  });
});
