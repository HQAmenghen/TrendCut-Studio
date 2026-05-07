const fs = require('fs');
const os = require('os');
const path = require('path');

const { createXaiService } = require('../service');

function createTempXaiService(overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xai-service-'));
  const resultPath = path.join(tempDir, 'result.json');
  const translateScriptPath = path.join(tempDir, 'translate_result_summaries.py');
  fs.writeFileSync(translateScriptPath, '# test script', 'utf-8');

  const deps = {
    sendError: jest.fn(),
    resultPath,
    partialPath: path.join(tempDir, 'result.partial.json'),
    logPath: path.join(tempDir, 'run_log.txt'),
    errorLogPath: path.join(tempDir, 'run_error.log'),
    accountsPath: path.join(tempDir, 'xai_accounts.json'),
    scriptPath: path.join(tempDir, 'run_xai_top10.py'),
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
});
