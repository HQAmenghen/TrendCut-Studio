const { execFileSync } = require('child_process');
const path = require('path');

describe('BFF Agent compatibility routes', () => {
  test('map MCP Agent API operations to FastAPI task, worker, and publish clients', () => {
    execFileSync(process.execPath, [
      path.join(__dirname, 'agent-compat-smoke.js')
    ], {
      cwd: path.join(__dirname, '..', '..', '..', '..'),
      stdio: 'inherit'
    });
  });
});
