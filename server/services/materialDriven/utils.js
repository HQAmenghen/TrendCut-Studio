const fs = require('fs');

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function firstExistingFile(candidates = []) {
  for (const file of candidates) {
    if (!file) continue;
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return file;
      }
    } catch (_err) {}
  }
  return '';
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function buildVersionedProjectFileUrl(projectDir, filePath, fileName = 'output_final.mp4') {
  const safeProjectDir = String(projectDir || '').trim();
  if (!safeProjectDir || !filePath || !fs.existsSync(filePath)) {
    return '';
  }

  try {
    const version = Math.max(0, Math.floor(fs.statSync(filePath).mtimeMs));
    return `/projects/${encodeURIComponent(safeProjectDir)}/${encodeURIComponent(fileName)}?v=${version}`;
  } catch (_err) {
    return `/projects/${encodeURIComponent(safeProjectDir)}/${encodeURIComponent(fileName)}`;
  }
}

module.exports = {
  nowIso,
  formatBytes,
  firstExistingFile,
  readJsonSafe,
  buildVersionedProjectFileUrl
};
