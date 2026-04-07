const fs = require('fs');
const path = require('path');
const { WORKFLOW_PATH, PIPELINE_DIR, RUNTIME_ROOT, PROJECT_ROOT } = require('./paths');
const { EDITABLE_JSON_FILES, RUNTIME_RETENTION_MS } = require('./runtime');
const { ensureDir, removeDirIfExists, readJsonIfExists, writeJsonFile } = require('../core/runtime');

/**
 * 解析可编辑 JSON 文件路径
 */
function resolveEditableJsonPath(fileName) {
  if (!EDITABLE_JSON_FILES.has(fileName)) {
    return null;
  }
  if (fileName === 'workflow_api.json') {
    return WORKFLOW_PATH;
  }
  return path.join(PIPELINE_DIR, fileName);
}

/**
 * 从字幕生成备用标题
 */
function buildFallbackTitleFromSubtitles(subtitlesPath) {
  try {
    if (!fs.existsSync(subtitlesPath)) return '这条消息可能正在改变支付格局';
    const subtitles = JSON.parse(fs.readFileSync(subtitlesPath, 'utf-8'));
    const joined = (Array.isArray(subtitles) ? subtitles : [])
      .map((item) => String(item?.zh || item?.text || '').trim())
      .filter(Boolean)
      .join('');
    if (!joined) return '这条消息可能正在改变支付格局';
    return joined.slice(0, 18) + (joined.length > 18 ? '...' : '');
  } catch (_err) {
    return '这条消息可能正在改变支付格局';
  }
}

/**
 * 创建运行时任务目录
 */
function createRuntimeJobDir(prefix, makeJobId) {
  const dirPath = path.join(RUNTIME_ROOT, `${prefix}_${makeJobId()}`);
  ensureDir(dirPath);
  cleanupRuntimeJobDirs({ currentDir: dirPath, projectRoot: PROJECT_ROOT });
  return dirPath;
}

/**
 * 写入视频元数据
 */
function writeMediaMetadata(videoPath, payload) {
  writeJsonFile(`${videoPath}.meta.json`, payload || {});
}

/**
 * 读取视频元数据
 */
function readMediaMetadata(videoPath) {
  return readJsonIfExists(`${videoPath}.meta.json`, null);
}

/**
 * 列出受保护的运行时目录
 */
function listProtectedRuntimeDirs(projectRoot) {
  const protectedDirs = new Set();
  for (const videoPath of [
    path.join(projectRoot, 'public', 'output_final.mp4'),
    path.join(projectRoot, 'public', 'standalone_output_vertical.mp4')
  ]) {
    const meta = readMediaMetadata(videoPath);
    const taskDir = String(meta?.taskDir || '').trim();
    if (taskDir) {
      protectedDirs.add(path.resolve(taskDir));
    }
  }
  return protectedDirs;
}

/**
 * 清理过期的运行时任务目录
 */
function cleanupRuntimeJobDirs(options = {}) {
  if (!fs.existsSync(RUNTIME_ROOT)) return;
  const now = Date.now();
  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : RUNTIME_RETENTION_MS;
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  const protectedDirs = options.protectedDirs instanceof Set ? options.protectedDirs : listProtectedRuntimeDirs(projectRoot);
  const currentDir = options.currentDir ? path.resolve(options.currentDir) : '';
  if (currentDir) {
    protectedDirs.add(currentDir);
  }

  const entries = fs.readdirSync(RUNTIME_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const dirPath = path.join(RUNTIME_ROOT, entry.name);
    const resolvedPath = path.resolve(dirPath);
    if (protectedDirs.has(resolvedPath)) continue;

    let stat = null;
    try {
      stat = fs.statSync(dirPath);
    } catch (_err) {
      continue;
    }
    if (!stat) continue;
    const ageMs = now - stat.mtimeMs;
    if (ageMs < maxAgeMs) continue;
    removeDirIfExists(dirPath);
  }
}

/**
 * 深度克隆对象
 */
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 清理发布描述文本
 */
function sanitizePublishDescriptionText(text, options = {}) {
  const preserveTags = options?.preserveTags === true;
  return String(text || '')
    .replace(preserveTags ? /$^/g : /\s*#[^\s#]+/g, '')
    .replace(/\n*\s*更多内容发布与分发由 AI 中台自动整理。\s*$/g, '')
    .trim();
}

module.exports = {
  resolveEditableJsonPath,
  buildFallbackTitleFromSubtitles,
  createRuntimeJobDir,
  writeMediaMetadata,
  readMediaMetadata,
  listProtectedRuntimeDirs,
  cleanupRuntimeJobDirs,
  deepClone,
  sanitizePublishDescriptionText
};
