#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const allowedRouteFiles = new Set([
  'agent.js',
  'loginStatus.js',
  'materialDriven.js',
  'publish.js',
  'review.js',
  'standalone.js',
  'system.js',
  'vertical.js',
  'xai.js'
]);

function listRouteFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name);
}

function main() {
  const routesDir = path.join(projectRoot, 'server', 'routes');
  const routeFiles = listRouteFiles(routesDir);
  const unexpected = routeFiles.filter((file) => !allowedRouteFiles.has(file));
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const startScript = String(packageJson?.scripts?.start || '');
  const legacyStartScript = packageJson?.scripts?.['start:legacy'];
  const composePath = path.join(projectRoot, 'docker-compose.yml');
  const composeText = fs.existsSync(composePath) ? fs.readFileSync(composePath, 'utf8') : '';

  if (unexpected.length > 0) {
    console.error('Legacy Express boundary violation: new route files are not allowed under server/routes.');
    for (const file of unexpected) {
      console.error(`- server/routes/${file}`);
    }
    console.error('Put new API surfaces under apps/bff and apps/api instead.');
    process.exit(1);
  }

  if (/server\.js/.test(startScript)) {
    console.error('Legacy Express boundary violation: npm start must not start server.js.');
    console.error('Use npm run start:bff as the default entry and npm run start:legacy for archived legacy operation.');
    process.exit(1);
  }

  if (legacyStartScript) {
    console.error('Legacy Express boundary violation: start:legacy has been retired from this branch.');
    process.exit(1);
  }

  if (/legacy-express\s*:/.test(composeText)) {
    console.error('Legacy Express boundary violation: docker-compose.yml must not define a legacy-express service.');
    process.exit(1);
  }

  console.log('Legacy Express boundary check passed.');
}

main();
