const { execFileSync } = require('child_process');
const path = require('path');

describe('BFF API compatibility routes', () => {
  test('translate legacy material and xAI calls into task/worker jobs', () => {
    execFileSync(process.execPath, [
      path.join(__dirname, 'api-compat-smoke.js')
    ], {
      cwd: path.join(__dirname, '..', '..', '..', '..'),
      stdio: 'inherit'
    });
  });
});
