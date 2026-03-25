const fs = require('fs');
const path = require('path');

function loadProjectEnv(startDir = __dirname) {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, '.env');
    if (fs.existsSync(candidate)) {
      const lines = fs.readFileSync(candidate, 'utf-8').split(/\r?\n/);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }
    currentDir = parentDir;
  }
}

module.exports = { loadProjectEnv };
