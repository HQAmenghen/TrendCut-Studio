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

  if (unexpected.length > 0) {
    console.error('Legacy Express boundary violation: new route files are not allowed under server/routes.');
    for (const file of unexpected) {
      console.error(`- server/routes/${file}`);
    }
    console.error('Put new API surfaces under apps/bff and apps/api instead.');
    process.exit(1);
  }

  console.log('Legacy Express boundary check passed.');
}

main();
