const fs = require('fs');
const path = require('path');

function parseEnvContent(content) {
  const values = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[key] = value;
  }
  return values;
}

function resolveProjectEnvPath(startDir = __dirname) {
  let currentDir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(currentDir, '.env');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.join(path.resolve(startDir), '.env');
    }
    currentDir = parentDir;
  }
}

function loadProjectEnv(startDir = __dirname) {
  const envPath = resolveProjectEnvPath(startDir);
  if (!fs.existsSync(envPath)) {
    return path.resolve(startDir);
  }

  const values = parseEnvContent(fs.readFileSync(envPath, 'utf-8'));
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return path.dirname(envPath);
}

function readProjectEnv(startDir = __dirname) {
  const envPath = resolveProjectEnvPath(startDir);
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  return {
    envPath,
    values: parseEnvContent(content)
  };
}

function updateProjectEnv(startDir = __dirname, updates = {}) {
  const { envPath } = readProjectEnv(startDir);
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  const updateEnvVar = (key, value) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value ?? ''}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += `${envContent.endsWith('\n') || !envContent ? '' : '\n'}${line}`;
    }
  };

  for (const [key, value] of Object.entries(updates)) {
    updateEnvVar(key, value);
    process.env[key] = String(value ?? '');
  }

  fs.writeFileSync(envPath, `${envContent.trim()}\n`, 'utf-8');
  return readProjectEnv(startDir);
}

module.exports = {
  loadProjectEnv,
  parseEnvContent,
  readProjectEnv,
  resolveProjectEnvPath,
  updateProjectEnv
};
