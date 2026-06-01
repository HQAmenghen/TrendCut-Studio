const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runPythonScript } = require('../../core/python');

const AVATAR_MOTION_PLAN_FILE = 'avatar_motion_plan.json';
const AVATAR_MOTION_MANIFEST_FILE = 'avatar_motion_manifest.json';
const AVATAR_MOTION_SOURCE_FILE = 'avatar_motion_source.mp4';
const AVATAR_MOTION_SEGMENTS_DIR = 'motion_segments';
const SCRIPT_UNITS_FILE = 'script_units.json';
const EDIT_PLAN_FILE = 'edit_plan.json';
const CLIP_MATCHES_FILE = 'clip_matches.json';
const SPEECH_ALIGNMENT_FILE = 'speech_alignment.json';
const MOTION_PLAN_SCRIPT = path.join(__dirname, '../../../python/pipeline/avatar_motion_plan.py');
const MOTION_SOURCE_BUILDER_SCRIPT = path.join(__dirname, '../../../python/pipeline/avatar_motion_source_builder.py');
const DEFAULT_ACTION_PRESET_DIR = path.join(__dirname, '../../../config/avatar_actions');
const DEFAULT_MOTION_IDLE_IMAGE_PATH = path.join(__dirname, '../../../public/presets/image/毕（保守）.png');
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

function isTruthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function isAvatarMotionEnabled(config = {}) {
  return isTruthy(config.avatarMotionEnabled) || isTruthy(process.env.AVATAR_MOTION_ENABLED);
}

function isAvatarMotionRequired(config = {}) {
  return isTruthy(config.avatarMotionRequired) || isTruthy(process.env.AVATAR_MOTION_REQUIRED);
}

function readProtocolResult(payload = {}) {
  return payload?.protocol?.result || {};
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveActionPresetDir(config = {}) {
  return String(config.avatarActionPresetDir || process.env.AVATAR_ACTION_PRESET_DIR || DEFAULT_ACTION_PRESET_DIR).trim();
}

function resolveMotionPlannerMode(config = {}) {
  return String(config.avatarMotionPlanner || process.env.AVATAR_MOTION_PLANNER || 'auto').trim() || 'auto';
}

function resolveMotionLlmProvider(config = {}) {
  return String(config.avatarMotionLlmProvider || process.env.AVATAR_MOTION_LLM_PROVIDER || '').trim();
}

function resolveMotionLlmModel(config = {}) {
  return String(config.avatarMotionLlmModel || process.env.AVATAR_MOTION_LLM_MODEL || '').trim();
}

function resolveMotionIdleImagePath({ idleImagePath, imagePath } = {}) {
  const candidates = [
    idleImagePath,
    process.env.AVATAR_MOTION_IDLE_IMAGE_PATH,
    DEFAULT_MOTION_IDLE_IMAGE_PATH,
    imagePath
  ];
  return candidates.map((candidate) => String(candidate || '').trim()).find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

async function generateAvatarMotion({
  outputDir,
  narrationTextPath,
  speechAudioPath,
  imagePath,
  idleImagePath,
  actionPresetDir,
  avatarMotionPlanner,
  avatarMotionLlmProvider,
  avatarMotionLlmModel,
  speechAlignmentPath,
  fps,
  runPython = runPythonScript
} = {}) {
  if (!outputDir) throw new Error('缺少数字人动作输出目录');
  if (!narrationTextPath || !fs.existsSync(narrationTextPath)) {
    throw new Error(`缺少口播文本文件: ${narrationTextPath || ''}`);
  }
  if (!speechAudioPath || !fs.existsSync(speechAudioPath)) {
    throw new Error(`缺少口播音频文件: ${speechAudioPath || ''}`);
  }
  if (imagePath && !fs.existsSync(imagePath)) {
    throw new Error(`缺少人物静态图: ${imagePath}`);
  }
  const resolvedIdleImagePath = resolveMotionIdleImagePath({ idleImagePath, imagePath });
  if (!resolvedIdleImagePath) {
    throw new Error('缺少动作源 idle 静态图');
  }

  const planPath = path.join(outputDir, AVATAR_MOTION_PLAN_FILE);
  const segmentDir = path.join(outputDir, AVATAR_MOTION_SEGMENTS_DIR);
  const motionManifestPath = path.join(outputDir, AVATAR_MOTION_MANIFEST_FILE);
  const motionSourcePath = path.join(outputDir, AVATAR_MOTION_SOURCE_FILE);
  const resolvedActionPresetDir = actionPresetDir || DEFAULT_ACTION_PRESET_DIR;
  const plannerMode = resolveMotionPlannerMode({ avatarMotionPlanner });
  const llmProvider = resolveMotionLlmProvider({ avatarMotionLlmProvider });
  const llmModel = resolveMotionLlmModel({ avatarMotionLlmModel });

  const planArgs = [
    '--narration-text',
    narrationTextPath,
    '--audio',
    speechAudioPath,
    '--output',
    planPath,
    '--fps',
    String(fps || process.env.AVATAR_MOTION_FPS || 25),
    '--action-dir',
    resolvedActionPresetDir,
    '--planner-mode',
    plannerMode
  ];
  if (llmProvider) {
    planArgs.push('--llm-provider', llmProvider);
  }
  if (llmModel) {
    planArgs.push('--llm-model', llmModel);
  }
  const resolvedSpeechAlignmentPath = speechAlignmentPath || path.join(outputDir, SPEECH_ALIGNMENT_FILE);
  if (fs.existsSync(resolvedSpeechAlignmentPath)) {
    planArgs.push('--speech-alignment', resolvedSpeechAlignmentPath);
  }
  const scriptUnitsPath = path.join(outputDir, SCRIPT_UNITS_FILE);
  const editPlanPath = path.join(outputDir, EDIT_PLAN_FILE);
  const clipMatchesPath = path.join(outputDir, CLIP_MATCHES_FILE);
  if (fs.existsSync(scriptUnitsPath)) {
    planArgs.push('--script-units', scriptUnitsPath);
  }
  if (fs.existsSync(editPlanPath)) {
    planArgs.push('--edit-plan', editPlanPath);
  }
  if (fs.existsSync(clipMatchesPath)) {
    planArgs.push('--clip-matches', clipMatchesPath);
  }

  const planPayload = await runPython(MOTION_PLAN_SCRIPT, planArgs, {
    cwd: outputDir,
    timeout: Number(process.env.AVATAR_MOTION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  });

  const posePayload = await runPython(MOTION_SOURCE_BUILDER_SCRIPT, [
    '--motion-plan',
    planPath,
    '--action-dir',
    resolvedActionPresetDir,
    '--output-dir',
    segmentDir,
    '--manifest',
    motionManifestPath,
    '--video-output',
    motionSourcePath,
    '--idle-image',
    resolvedIdleImagePath
  ], {
    cwd: outputDir,
    timeout: Number(process.env.AVATAR_MOTION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  });

  const planResult = readProtocolResult(planPayload);
  const poseResult = readProtocolResult(posePayload);
  const motionSignature = [
    String(planResult.signature || hashFile(planPath)),
    String(poseResult.signature || hashFile(motionSourcePath))
  ].filter(Boolean).join(':');

  return {
    enabled: true,
    planPath,
    poseManifestPath: motionManifestPath,
    motionManifestPath,
    motionSourcePath,
    poseInputPath: String(poseResult.poseInputPath || motionSourcePath),
    poseFrameDir: '',
    motionSignature,
    segmentCount: Number(planResult.segmentCount || 0),
    frameCount: 0
  };
}

module.exports = {
  AVATAR_MOTION_PLAN_FILE,
  AVATAR_MOTION_MANIFEST_FILE,
  AVATAR_MOTION_SOURCE_FILE,
  AVATAR_MOTION_SEGMENTS_DIR,
  DEFAULT_ACTION_PRESET_DIR,
  DEFAULT_MOTION_IDLE_IMAGE_PATH,
  SCRIPT_UNITS_FILE,
  EDIT_PLAN_FILE,
  CLIP_MATCHES_FILE,
  SPEECH_ALIGNMENT_FILE,
  generateAvatarMotion,
  isAvatarMotionEnabled,
  isAvatarMotionRequired,
  resolveActionPresetDir,
  resolveMotionLlmModel,
  resolveMotionLlmProvider,
  resolveMotionPlannerMode,
  resolveMotionIdleImagePath
};
