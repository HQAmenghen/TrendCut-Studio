#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function listRootLaunchScripts(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(bat|cmd|ps1|sh)$/i.test(entry.name))
    .map((entry) => entry.name);
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const startScript = String(packageJson?.scripts?.start || '');
  const legacyStartScript = packageJson?.scripts?.['start:legacy'];
  const composePath = path.join(projectRoot, 'docker-compose.yml');
  const composeText = fs.existsSync(composePath) ? fs.readFileSync(composePath, 'utf8') : '';
  const dockerfilePath = path.join(projectRoot, 'Dockerfile');
  const dockerfileText = fs.existsSync(dockerfilePath) ? fs.readFileSync(dockerfilePath, 'utf8') : '';

  if (fs.existsSync(path.join(projectRoot, 'server.js')) || fs.existsSync(path.join(projectRoot, 'server'))) {
    console.error('Legacy Express boundary violation: server.js and server/ have been retired from this branch.');
    console.error('Put API surfaces under apps/bff and apps/api; put long-running execution under apps/worker or python/.');
    process.exit(1);
  }

  if (/server\.js/.test(startScript)) {
    console.error('Legacy Express boundary violation: npm start must not start server.js.');
    console.error('Use npm run start:bff as the default entry.');
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

  if (/start:legacy|node\s+server\.js|EXPOSE\s+3001/i.test(dockerfileText)) {
    console.error('Legacy Express boundary violation: root Dockerfile must target the BFF runtime.');
    process.exit(1);
  }

  for (const file of listRootLaunchScripts(projectRoot)) {
    const text = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    if (/\bnode\s+server\.js\b/i.test(text)) {
      console.error(`Legacy Express boundary violation: ${file} must not start server.js.`);
      process.exit(1);
    }
  }

  console.log('Legacy Express boundary check passed.');
}

main();
