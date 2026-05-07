const fs = require('fs');
const path = require('path');

const TASK_STATE_FILE = 'task_state.json';

function createDefaultAvatarConfig() {
  return {
    genText: '',
    renderProvider: 'comfyui',
    serverUrl: '',
    runningHubBaseUrl: 'https://www.runninghub.cn/openapi/v2',
    runningHubWorkflowId: '2051840324212936706',
    runningHubRunPath: '',
    runningHubAccessPassword: '',
    runningHubInstanceType: '',
    runningHubUsePersonalQueue: false,
    runningHubRetainSeconds: 0,
    runningHubAudioNodeId: '6',
    runningHubAudioFieldName: 'audio',
    runningHubImageNodeId: '180',
    runningHubImageFieldName: 'image',
    runningHubOutputNodeId: '',
    trimSeconds: 0,
    maxDuration: 30,
    audioPreset: '',
    imagePreset: '',
    audioUploadPath: '',
    imageUploadPath: ''
  };
}

function createDefaultTaskState() {
  return {
    useSmartClip: true,
    useCache: true,
    autoGenerate: true,
    avatarConfig: createDefaultAvatarConfig()
  };
}

function normalizeAvatarConfig(input = {}) {
  const base = createDefaultAvatarConfig();
  const provider = String(input?.renderProvider || input?.avatarRenderProvider || input?.provider || base.renderProvider || '').trim().toLowerCase();
  return {
    ...base,
    genText: String(input?.genText || ''),
    renderProvider: provider === 'runninghub' ? 'runninghub' : 'comfyui',
    serverUrl: String(input?.serverUrl || ''),
    runningHubBaseUrl: String(input?.runningHubBaseUrl || base.runningHubBaseUrl),
    runningHubWorkflowId: String(input?.runningHubWorkflowId || base.runningHubWorkflowId),
    runningHubRunPath: String(input?.runningHubRunPath || ''),
    runningHubAccessPassword: String(input?.runningHubAccessPassword || ''),
    runningHubInstanceType: String(input?.runningHubInstanceType || ''),
    runningHubUsePersonalQueue: input?.runningHubUsePersonalQueue === true || input?.runningHubUsePersonalQueue === 'true',
    runningHubRetainSeconds: Number(input?.runningHubRetainSeconds || 0),
    runningHubAudioNodeId: String(input?.runningHubAudioNodeId || base.runningHubAudioNodeId),
    runningHubAudioFieldName: String(input?.runningHubAudioFieldName || base.runningHubAudioFieldName),
    runningHubImageNodeId: String(input?.runningHubImageNodeId || base.runningHubImageNodeId),
    runningHubImageFieldName: String(input?.runningHubImageFieldName || base.runningHubImageFieldName),
    runningHubOutputNodeId: String(input?.runningHubOutputNodeId || ''),
    trimSeconds: Number(input?.trimSeconds || 0),
    maxDuration: Number(input?.maxDuration || 30),
    audioPreset: String(input?.audioPreset || ''),
    imagePreset: String(input?.imagePreset || ''),
    audioUploadPath: String(input?.audioUploadPath || ''),
    imageUploadPath: String(input?.imageUploadPath || '')
  };
}

function normalizeTaskState(input = {}) {
  const base = createDefaultTaskState();
  return {
    ...base,
    ...input,
    useSmartClip: input?.useSmartClip !== false,
    useCache: input?.useCache !== false,
    autoGenerate: input?.autoGenerate !== false,
    avatarConfig: normalizeAvatarConfig(input?.avatarConfig || {})
  };
}

function getTaskStatePath(outputPath) {
  return path.join(outputPath, TASK_STATE_FILE);
}

function writeTaskState(outputPath, snapshot = {}) {
  const normalized = normalizeTaskState(snapshot);
  fs.writeFileSync(getTaskStatePath(outputPath), JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function readTaskState(outputPath) {
  const statePath = getTaskStatePath(outputPath);
  if (!fs.existsSync(statePath)) {
    return createDefaultTaskState();
  }
  try {
    const payload = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return normalizeTaskState(payload);
  } catch (_err) {
    return createDefaultTaskState();
  }
}

module.exports = {
  TASK_STATE_FILE,
  createDefaultAvatarConfig,
  createDefaultTaskState,
  normalizeAvatarConfig,
  normalizeTaskState,
  readTaskState,
  writeTaskState
};
