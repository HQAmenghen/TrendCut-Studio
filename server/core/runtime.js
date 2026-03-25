const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_err) {
    return fallback;
  }
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf-8');
  } catch (_err) {
    return '';
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function tailLines(text, limit = 12) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-limit);
}

function slugifyText(value, fallback = 'video') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function makeJobId() {
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeProcessLogLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatElapsedSeconds(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
}

function stopProcessTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_err) {}
}

function removeDirIfExists(targetPath) {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (_err) {}
}

module.exports = {
  ensureDir,
  formatElapsedSeconds,
  makeJobId,
  readJsonIfExists,
  readTextIfExists,
  removeDirIfExists,
  sanitizeProcessLogLines,
  slugifyText,
  stopProcessTree,
  tailLines,
  writeJsonFile
};
