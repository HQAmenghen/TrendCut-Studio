const fs = require('fs');
const path = require('path');
const { RUNNINGHUB_INFINITETALK_3INPUT } = require('../../config/runningHub');

const TASK_STATE_FILE = 'task_state.json';

function createDefaultAvatarConfig() {
  return {
    genText: '',
    renderProvider: 'comfyui',
    serverUrl: '',
    runningHubBaseUrl: 'https://www.runninghub.cn/openapi/v2',
    runningHubWorkflowId: RUNNINGHUB_INFINITETALK_3INPUT.workflowId,
    runningHubRunPath: '',
    runningHubAccessPassword: '',
    runningHubInstanceType: '',
    runningHubUsePersonalQueue: false,
    runningHubRetainSeconds: 0,
    runningHubAudioNodeId: RUNNINGHUB_INFINITETALK_3INPUT.audioNodeId,
    runningHubAudioFieldName: RUNNINGHUB_INFINITETALK_3INPUT.audioFieldName,
    runningHubImageNodeId: RUNNINGHUB_INFINITETALK_3INPUT.imageNodeId,
    runningHubImageFieldName: RUNNINGHUB_INFINITETALK_3INPUT.imageFieldName,
    runningHubPoseNodeId: RUNNINGHUB_INFINITETALK_3INPUT.poseNodeId,
    runningHubPoseFieldName: RUNNINGHUB_INFINITETALK_3INPUT.poseFieldName,
    runningHubOutputNodeId: RUNNINGHUB_INFINITETALK_3INPUT.outputNodeId,
    poseNodeId: '',
    poseFieldName: 'pose',
    avatarMotionEnabled: false,
    avatarMotionRequired: false,
    avatarActionPresetDir: '',
    trimSeconds: 0,
    maxDuration: 30,
    audioPreset: '',
    imagePreset: '',
    audioUploadPath: '',
    imageUploadPath: ''
  };
}

function createDefaultSourceMeta() {
  return {
    sourceAuthor: '',
    sourcePostId: '',
    sourcePartitionId: '',
    sourcePartitionLabel: '',
    sourceRank: 0,
    videoUrl: '',
    postUrl: ''
  };
}

function createDefaultTaskState() {
  return {
    useSmartClip: true,
    useCache: true,
    autoGenerate: true,
    sourceMeta: createDefaultSourceMeta(),
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
    runningHubPoseNodeId: String(input?.runningHubPoseNodeId || ''),
    runningHubPoseFieldName: String(input?.runningHubPoseFieldName || base.runningHubPoseFieldName),
    runningHubOutputNodeId: String(input?.runningHubOutputNodeId || ''),
    poseNodeId: String(input?.poseNodeId || ''),
    poseFieldName: String(input?.poseFieldName || base.poseFieldName),
    avatarMotionEnabled: input?.avatarMotionEnabled === true || input?.avatarMotionEnabled === 'true',
    avatarMotionRequired: input?.avatarMotionRequired === true || input?.avatarMotionRequired === 'true',
    avatarActionPresetDir: String(input?.avatarActionPresetDir || ''),
    trimSeconds: Number(input?.trimSeconds || 0),
    maxDuration: Number(input?.maxDuration || 30),
    audioPreset: String(input?.audioPreset || ''),
    imagePreset: String(input?.imagePreset || ''),
    audioUploadPath: String(input?.audioUploadPath || ''),
    imageUploadPath: String(input?.imageUploadPath || '')
  };
}

function normalizeSourceMeta(input = {}) {
  const sourceRank = Number(input?.sourceRank || input?.source_rank || 0);
  return {
    sourceAuthor: String(input?.sourceAuthor || input?.source_author || input?.author || input?.postAuthor || '').trim(),
    sourcePostId: String(input?.sourcePostId || input?.source_post_id || input?.postId || input?.post_id || '').trim(),
    sourcePartitionId: String(input?.sourcePartitionId || input?.source_partition_id || input?.partitionId || '').trim(),
    sourcePartitionLabel: String(input?.sourcePartitionLabel || input?.source_partition_label || input?.partitionLabel || '').trim(),
    sourceRank: Number.isFinite(sourceRank) ? sourceRank : 0,
    videoUrl: String(input?.videoUrl || input?.video_url || input?.materialUrl || input?.sourceVideoUrl || '').trim(),
    postUrl: String(input?.postUrl || input?.post_url || input?.sourcePostUrl || input?.url || '').trim()
  };
}

function normalizeTaskState(input = {}) {
  const base = createDefaultTaskState();
  const sourceMetaInput = input?.sourceMeta && typeof input.sourceMeta === 'object'
    ? input.sourceMeta
    : {};
  return {
    ...base,
    ...input,
    useSmartClip: input?.useSmartClip !== false,
    useCache: input?.useCache !== false,
    autoGenerate: input?.autoGenerate !== false,
    sourceMeta: normalizeSourceMeta({ ...(input || {}), ...sourceMetaInput }),
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
  createDefaultSourceMeta,
  createDefaultTaskState,
  normalizeAvatarConfig,
  normalizeSourceMeta,
  normalizeTaskState,
  readTaskState,
  writeTaskState
};
