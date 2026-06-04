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
const DEFAULT_PLAN_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_SOURCE_TIMEOUT_MS = 4 * 60 * 1000;

function resolveTimeoutMs(primaryEnvName, fallbackEnvName, defaultValue) {
  const raw = process.env[primaryEnvName] || process.env[fallbackEnvName] || '';
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function readProtocolResult(payload = {}) {
  return payload?.protocol?.result || {};
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function isUsableFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_err) {
    return false;
  }
}

function resolveActionPresetDir(config = {}) {
  return String(config.avatarActionPresetDir || process.env.AVATAR_ACTION_PRESET_DIR || DEFAULT_ACTION_PRESET_DIR).trim();
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
    resolvedActionPresetDir
  ];
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
    timeout: resolveTimeoutMs('AVATAR_MOTION_PLAN_TIMEOUT_MS', 'AVATAR_MOTION_TIMEOUT_MS', DEFAULT_PLAN_TIMEOUT_MS)
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
    timeout: resolveTimeoutMs('AVATAR_MOTION_SOURCE_TIMEOUT_MS', 'AVATAR_MOTION_TIMEOUT_MS', DEFAULT_SOURCE_TIMEOUT_MS)
  });

  const planResult = readProtocolResult(planPayload);
  const poseResult = readProtocolResult(posePayload);
  const poseInputPath = String(poseResult.poseInputPath || motionSourcePath);
  if (!isUsableFile(motionSourcePath)) {
    throw new Error(`数字人动作参考视频未生成: ${motionSourcePath}`);
  }
  if (!isUsableFile(poseInputPath)) {
    throw new Error(`数字人姿态输入不存在: ${poseInputPath}`);
  }
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
    poseInputPath,
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
  DEFAULT_PLAN_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  DEFAULT_ACTION_PRESET_DIR,
  DEFAULT_MOTION_IDLE_IMAGE_PATH,
  SCRIPT_UNITS_FILE,
  EDIT_PLAN_FILE,
  CLIP_MATCHES_FILE,
  SPEECH_ALIGNMENT_FILE,
  generateAvatarMotion,
  resolveActionPresetDir,
  resolveMotionIdleImagePath
};
