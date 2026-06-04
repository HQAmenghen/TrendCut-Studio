const path = require('path');
const crypto = require('crypto');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const GENERATION_IDEMPOTENCY_TTL_MS = 12 * 60 * 60 * 1000;
const PUBLISH_CONFIRMATION_PHRASE = 'CONFIRM_PUBLISH';
const MATERIAL_JOB_DIR_PATTERN = /^material_[A-Za-z0-9_.-]+$/;
const ACTIVE_VERTICAL_STATUSES = new Set([
  'queued',
  'running',
  'preparing',
  'downloading',
  'transcribing',
  'rendering',
  'reviewing'
]);
const DOWNSTREAM_ARTIFACTS_AFTER_NARRATION = [
  'aiman.mp4',
  'avatar_manifest.json',
  'avatar_render_state.json',
  'avatar_segments.json',
  'execution_plan.json',
  'narration_speech.json',
  'narration_speech.txt',
  'output_final.mp4',
  'qwen_tts_metadata.json'
];
const AVATAR_CONFIG_KEYS = [
  'genText',
  'renderProvider',
  'avatarRenderProvider',
  'provider',
  'serverUrl',
  'runningHubApiKey',
  'runningHubBaseUrl',
  'runningHubWorkflowId',
  'runningHubRunPath',
  'runningHubAccessPassword',
  'runningHubInstanceType',
  'runningHubUsePersonalQueue',
  'runningHubRetainSeconds',
  'runningHubAudioNodeId',
  'runningHubAudioFieldName',
  'runningHubImageNodeId',
  'runningHubImageFieldName',
  'runningHubPoseNodeId',
  'runningHubPoseFieldName',
  'runningHubOutputNodeId',
  'avatarActionPresetDir',
  'trimSeconds',
  'maxDuration',
  'audioPreset',
  'imagePreset'
];

function pickString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePartitionId(value) {
  const text = String(value || '').trim().toLowerCase();
  const aliases = {
    crypto: 'crypto',
    '加密': 'crypto',
    '币圈': 'crypto',
    web3: 'crypto',
    finance: 'finance',
    '金融': 'finance',
    tech: 'tech',
    '科技': 'tech',
    ai: 'ai',
    '人工智能': 'ai'
  };
  return aliases[text] || text || 'crypto';
}

function stableHash(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex')
    .slice(0, 24);
}

function createHttpError(status, code, stage, error, details = '', hint = '') {
  const err = new Error(error);
  err.status = status;
  err.code = code;
  err.stage = stage;
  err.details = details;
  err.hint = hint;
  return err;
}

function normalizeAgentError(err, fallback = {}) {
  return {
    status: Number(err?.status || fallback.status || 500),
    code: String(err?.code || fallback.code || 'AGENT_REQUEST_FAILED'),
    stage: String(err?.stage || fallback.stage || 'agent.request'),
    error: String(err?.message || err?.error || fallback.error || 'agent 请求失败'),
    details: String(err?.details || fallback.details || ''),
    hint: String(err?.hint || fallback.hint || '')
  };
}

function normalizeLocalPathCandidate(value) {
  let text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return '';
  if (/^file:\/\//i.test(text)) {
    try {
      text = decodeURIComponent(new URL(text).pathname || text);
    } catch (_err) {}
  } else if (/%[0-9a-f]{2}/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch (_err) {}
  }

  const wslMatch = text.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
  if (wslMatch) {
    return `${wslMatch[1].toUpperCase()}:\\${wslMatch[2].replace(/\//g, '\\')}`;
  }
  const msysMatch = text.match(/^\/([a-zA-Z])\/(.+)$/);
  if (msysMatch) {
    return `${msysMatch[1].toUpperCase()}:\\${msysMatch[2].replace(/\//g, '\\')}`;
  }
  return text;
}

function getProjectsRoot(paths = {}) {
  return path.resolve(paths.PROJECTS_DIR || path.join(paths.PROJECT_ROOT || process.cwd(), 'projects'));
}

function isInsideDir(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function extractMaterialOutputDir(value, paths = {}) {
  let text = normalizeLocalPathCandidate(value);
  if (!text) return '';

  try {
    const parsed = new URL(text);
    text = decodeURIComponent(parsed.pathname || text);
  } catch (_err) {}
  text = text.split('?')[0].split('#')[0];

  const parts = text.split(/[\\/]+/).filter(Boolean);
  const materialPart = parts.find((part) => MATERIAL_JOB_DIR_PATTERN.test(part));
  if (materialPart) return materialPart;

  const projectsRoot = getProjectsRoot(paths);
  const resolved = path.isAbsolute(text) ? path.resolve(text) : '';
  if (resolved && isInsideDir(resolved, projectsRoot)) {
    const statTarget = resolved;
    const isFile = Boolean(path.extname(resolved));
    const dirPath = isFile ? path.dirname(statTarget) : statTarget;
    const outputDir = path.basename(dirPath);
    if (outputDir) return outputDir;
  }

  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (path.extname(last) && parts.length > 1) return parts[parts.length - 2];
    return last;
  }
  return text;
}

function resolveAgentLocalVideoPath(value, paths = {}) {
  const text = normalizeLocalPathCandidate(value);
  if (!text || !path.isAbsolute(text)) return '';
  const allowedRoots = [
    paths.PROJECT_ROOT,
    paths.PROJECTS_DIR,
    paths.DATA_DIR,
    paths.UPLOADS_DIR,
    paths.PUBLIC_DIR,
    paths.RUNTIME_ROOT,
    paths.VERTICAL_PUBLIC_DIR,
    paths.VERTICAL_QUEUE_ROOT
  ].map((root) => String(root || '').trim()).filter(Boolean);
  const resolved = path.resolve(text);
  if (!allowedRoots.some((root) => isInsideDir(resolved, root))) return '';
  return resolved;
}

function resolveAgentLocalImagePath(value, paths = {}) {
  const text = normalizeLocalPathCandidate(value);
  if (!text || !path.isAbsolute(text)) return '';
  const allowedRoots = [
    paths.PROJECT_ROOT,
    paths.PROJECTS_DIR,
    paths.DATA_DIR,
    paths.UPLOADS_DIR,
    paths.PUBLIC_DIR,
    paths.RUNTIME_ROOT,
    paths.PUBLISH_CENTER_DIR,
    paths.WECHAT_RPA_PROFILE_ROOT,
    paths.PLATFORM_RPA_PROFILE_ROOT
  ].map((root) => String(root || '').trim()).filter(Boolean);
  const resolved = path.resolve(text);
  if (!allowedRoots.some((root) => isInsideDir(resolved, root))) return '';
  return resolved;
}

function normalizeMaterialOutputReference(value, paths = {}) {
  return extractMaterialOutputDir(value, paths) || String(value || '').trim();
}

function normalizePost(raw = {}, context = {}) {
  const rank = Number(raw.rank || raw.sourceRank || raw.source_rank || 0) || 0;
  const postId = pickString(raw.post_id, raw.postId, raw.sourcePostId, raw.id, raw.url);
  const postUrl = pickString(raw.post_url, raw.postUrl, raw.sourcePostUrl, raw.url);
  const videoUrl = pickString(raw.video_url, raw.videoUrl, raw.materialUrl, raw.sourceVideoUrl);
  const author = pickString(raw.author, raw.sourceAuthor, raw.username, raw.account);
  const title = pickString(raw.title, raw.post_title, raw.headline);
  const summary = pickString(raw.author_summary_zh, raw.summary_zh, raw.author_summary, raw.summary, raw.text, raw.content);
  const partition = raw.partition || context.partition || {};
  const partitionId = pickString(raw.source_partition_id, raw.sourcePartitionId, partition.id, context.partitionId);
  const partitionLabel = pickString(raw.source_partition_label, raw.sourcePartitionLabel, partition.label, context.partitionLabel);
  const id = stableHash({ postId, postUrl, videoUrl, author, rank, partitionId });

  return {
    id,
    rank,
    author,
    title,
    summary,
    postId,
    postUrl,
    videoUrl,
    hotScore: Number(raw.hot_score || raw.hotScore || 0) || 0,
    views: Number(raw.views || 0) || 0,
    viewsDisplay: pickString(raw.views_display, raw.viewsDisplay),
    partition: {
      id: partitionId,
      label: partitionLabel
    },
    raw
  };
}

function postMatchesQuery(post, query) {
  const text = normalizeText([
    post.author,
    post.title,
    post.summary,
    post.postUrl,
    post.postId,
    post.partition?.label
  ].join(' ')).toLowerCase();
  return !query || text.includes(query.toLowerCase());
}

module.exports = {
  ACTIVE_VERTICAL_STATUSES,
  AVATAR_CONFIG_KEYS,
  DEFAULT_LIMIT,
  DOWNSTREAM_ARTIFACTS_AFTER_NARRATION,
  GENERATION_IDEMPOTENCY_TTL_MS,
  MATERIAL_JOB_DIR_PATTERN,
  MAX_LIMIT,
  PUBLISH_CONFIRMATION_PHRASE,
  createHttpError,
  extractMaterialOutputDir,
  getProjectsRoot,
  isInsideDir,
  normalizeAgentError,
  normalizeLocalPathCandidate,
  normalizeMaterialOutputReference,
  normalizePartitionId,
  normalizePost,
  normalizeText,
  pickString,
  postMatchesQuery,
  resolveAgentLocalImagePath,
  resolveAgentLocalVideoPath,
  stableHash
};
