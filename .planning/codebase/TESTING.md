# Testing Patterns

**Analysis Date:** 2026-04-17

## Test Framework

**Runner:**
- Jest `^30.3.0`
- Config: `package.json` under the `jest` field

**Assertion Library:**
- Jest built-in `expect`

**Run Commands:**
```bash
npm test              # Run all Jest tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage for server/**/*.js
```

## Test File Organization

**Location:**
- Use co-located `__tests__` directories next to Node modules under `server/`.
- Current examples:
  - `server/core/__tests__/errorCodes.test.js`
  - `server/core/__tests__/http.test.js`
  - `server/core/__tests__/taskProtocol.test.js`
  - `server/core/__tests__/taskStore.test.js`
  - `server/core/__tests__/recovery.test.js`
  - `server/services/publish/__tests__/scheduling.test.js`

**Naming:**
- Use `*.test.js` for Jest-discovered files. This matches `package.json` `testMatch: ["**/__tests__/**/*.test.js"]`.
- `it(...)` and `test(...)` are both used inside suites. `server/core/__tests__/taskProtocol.test.js` uses `it`, while `server/core/__tests__/http.test.js` and `server/services/publish/__tests__/scheduling.test.js` use `test`.

**Structure:**
```text
server/
  <domain>/
    __tests__/
      *.test.js
```

**Out-of-band test scripts:**
- `scripts/smoke_test.js` is a manual HTTP smoke test, not a Jest test.
- `test_llm_modules.py`, `test_all_keys.py`, and `python/scripts/test_key_rotation.py` are standalone Python scripts, not part of `npm test`, CI unit-test discovery, or Jest coverage.
- No frontend test files were detected under `frontend/`.

## Test Structure

**Suite Organization:**
```javascript
describe('taskProtocol', () => {
  let testDir;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-protocol-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createTaskInput', () => {
    it('should create task input object with all fields', () => {
      const taskInput = createTaskInput('task_123', 'vertical_queue', {}, '/work/dir');
      expect(taskInput.taskId).toBe('task_123');
    });
  });
});
```

**Patterns:**
- Use nested `describe` blocks by exported function or behavior. `server/core/__tests__/taskStore.test.js` groups by `createTask`, `updateTask`, `getTask`, and related methods.
- Use `beforeEach` and `afterEach` for filesystem and database setup/cleanup.
- Prefer explicit assertions on complete object shapes for API helpers such as `sendError` in `server/core/__tests__/http.test.js`.
- Test both default behavior and edge cases. `server/services/publish/__tests__/scheduling.test.js` checks missing fields, archived jobs, equality boundaries, and status filtering.

## Mocking

**Framework:** Jest mocks and spies

**Patterns:**
```javascript
beforeEach(() => {
  mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
  };
});

const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
```

**Observed usage:**
- Use `jest.fn()` for lightweight collaborator mocks such as Express response objects in `server/core/__tests__/http.test.js` and queue services in `server/core/__tests__/recovery.test.js`.
- Use `jest.spyOn(...)` to observe side effects without replacing entire modules, as in `server/core/__tests__/errorCodes.test.js`.
- No sampled tests use `jest.mock(...)` for module-level mocking.
- No `sinon` usage was detected in `server/`, `scripts/`, or `frontend/` even though `sinon` is listed in `package.json`.

**What to Mock:**
- Mock boundary collaborators such as:
  - Express `res` objects in `server/core/__tests__/http.test.js`
  - service dependencies injected into factories, such as `verticalQueueService` in `server/core/__tests__/recovery.test.js`
- Keep mocks local to the test file. The repo does not use shared mock factories or a global test setup file.

**What NOT to Mock:**
- Do not mock pure helpers or storage format logic when the purpose is deterministic behavior. `server/core/__tests__/taskProtocol.test.js` uses real filesystem paths and reads/writes actual JSON files.
- Do not mock `TaskStore` in `server/core/__tests__/taskStore.test.js`; the test instantiates a real SQLite-backed store against a temporary database path.

## Fixtures and Factories

**Test Data:**
```javascript
const job = {
  id: 'test-job-1',
  status: 'scheduled_wait',
  scheduledAt: new Date('2026-04-01T10:00:00Z').toISOString(),
  archived: false
};
```

**Location:**
- Inline fixtures dominate. Each test file builds the data it needs near the assertions.
- Temporary artifacts are created beside or under the test runtime:
  - temporary directories via `fs.mkdtempSync(...)` in `server/core/__tests__/taskProtocol.test.js`
  - temporary SQLite files like `test-tasks.db` in `server/core/__tests__/taskStore.test.js`
  - temporary JSON job files like `test_publish_jobs.json` in `server/services/publish/__tests__/scheduling.test.js`
- A committed SQLite artifact exists at `server/services/publish/__tests__/test_publish_jobs.db`, but the scheduling test itself writes its own fixture file at runtime.

## Coverage

**Requirements:** None enforced

**Signals:**
- `package.json` collects coverage from `server/**/*.js` only.
- `coveragePathIgnorePatterns` excludes `/node_modules/` and `/__tests__/`.
- `npm run test:coverage` is the local coverage command.
- `.github/workflows/ci.yml` uploads `coverage/lcov.info` to Codecov on the Node `20.x` matrix leg.
- No Jest coverage thresholds are configured.

**View Coverage:**
```bash
npm run test:coverage
```

## Test Types

**Unit Tests:**
- Primary test type.
- Focus on pure helpers and deterministic modules such as:
  - `server/core/http.js`
  - `server/core/errorCodes.js`
  - `server/core/taskProtocol.js`

**Integration Tests:**
- Light integration tests exist where file I/O or SQLite behavior matters.
- Examples:
  - `server/core/__tests__/taskStore.test.js` exercises the real storage layer
  - `server/core/__tests__/recovery.test.js` uses a real `TaskStore` plus a mocked dependency
  - `server/services/publish/__tests__/scheduling.test.js` reads and writes job payloads on disk

**E2E Tests:**
- Not detected.
- `scripts/smoke_test.js` is the closest equivalent, but it is a manual endpoint probe script rather than a browser or end-to-end framework suite.

## Common Patterns

**Async Testing:**
```javascript
test('启动恢复应该处理所有中断的任务', async () => {
  const results = await recoveryService.recoverOnStartup();
  expect(results.length).toBeGreaterThan(0);
});

test('按更新时间倒序排列', (done) => {
  setTimeout(() => {
    done();
  }, 5);
});
```

**Error Testing:**
```javascript
expect(() => {
  taskStore.updateTask('nonexistent', { status: 'running' });
}).toThrow('Task not found');

expect(readTaskInput(testDir)).toBeNull();
```

## CI and Developer Workflow

- `scripts/ci.js` runs `npm test`, `npm run build:front`, and then `npm run lint`.
- `.github/workflows/ci.yml` runs:
  - `npm ci`
  - `npm test`
  - `npm run build:front`
  - `npm run lint || echo "Lint not configured yet"`
- `scripts/install-hooks.js` installs a `pre-commit` hook that runs `npm test` before allowing commits.

## Practical Guidance

- Add new Node tests beside the module under test in a `__tests__/` folder and name them `*.test.js`.
- Match the existing Jest style: nested `describe` blocks, local fixtures, and explicit cleanup in `afterEach`.
- Prefer real filesystem and SQLite interactions when testing persistence or serialization code under `server/core/` and `server/services/`.
- If you add frontend behavior under `frontend/src/`, add a new test harness intentionally. No current frontend unit-test pattern exists to copy.
- If you add Python verification, keep it separate from the Jest suite unless the project introduces a dedicated Python test runner; current Python scripts are manual diagnostics, not automated unit tests.

---

*Testing analysis: 2026-04-17*
