#!/usr/bin/env node

const { spawnSync } = require('child_process');

const REGISTRY = 'https://registry.npmjs.org/';

const result = spawnSync(
  'npm',
  ['audit', '--omit=dev', `--registry=${REGISTRY}`],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      npm_config_registry: REGISTRY
    }
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
