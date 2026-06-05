const { execFileSync } = require('child_process');
const path = require('path');

describe('BFF boundary hardening', () => {
  test('enforces token principals, DTO validation, high-risk confirmation, and role checks', () => {
    execFileSync(process.execPath, [
      path.join(__dirname, 'bff-boundary-smoke.js')
    ], {
      cwd: path.join(__dirname, '..', '..', '..', '..'),
      stdio: 'inherit'
    });
  });
});
