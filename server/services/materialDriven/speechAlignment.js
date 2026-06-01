const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runPythonScript } = require('../../core/python');

const SPEECH_ALIGNMENT_FILE = 'speech_alignment.json';
const SPEECH_SUBTITLES_FILE = 'speech_subtitles.json';
const SPEECH_ALIGNMENT_META_FILE = 'speech_alignment_meta.json';
const SPEECH_ALIGNMENT_SCRIPT = path.join(__dirname, '../../../python/pipeline/build_speech_alignment.py');
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function isTruthy(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function isSpeechAlignmentEnabled(config = {}) {
  if (config.speechAlignmentEnabled !== undefined) {
    return isTruthy(config.speechAlignmentEnabled);
  }
  if (process.env.SPEECH_ALIGNMENT_ENABLED !== undefined) {
    return isTruthy(process.env.SPEECH_ALIGNMENT_ENABLED);
  }
  return true;
}

function hashFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

function hashTextFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  return crypto.createHash('sha1').update(fs.readFileSync(filePath, 'utf8')).digest('hex');
}

function readJsonIfExists(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return fallback;
  }
}

function readProtocolResult(payload = {}) {
  return payload?.protocol?.result || {};
}

function isReusableSpeechAlignment({ metaPath, alignmentPath, subtitlesPath, audioPath, narrationTextPath } = {}) {
  const meta = readJsonIfExists(metaPath, null);
  if (!meta || !fs.existsSync(alignmentPath || '') || !fs.existsSync(subtitlesPath || '')) return false;
  return String(meta.audioSha1 || '') === hashFile(audioPath) &&
    String(meta.narrationSha1 || '') === hashTextFile(narrationTextPath);
}

async function ensureSpeechAlignment({
  outputDir,
  speechAudioPath,
  narrationTextPath,
  fileUrl,
  config = {},
  runPython = runPythonScript
} = {}) {
  if (!isSpeechAlignmentEnabled(config)) {
    return { enabled: false, reused: false };
  }
  if (!outputDir) throw new Error('缺少口播对齐输出目录');
  if (!speechAudioPath || !fs.existsSync(speechAudioPath)) {
    throw new Error(`缺少口播音频文件: ${speechAudioPath || ''}`);
  }
  if (!narrationTextPath || !fs.existsSync(narrationTextPath)) {
    throw new Error(`缺少口播文本文件: ${narrationTextPath || ''}`);
  }

  const alignmentPath = path.join(outputDir, SPEECH_ALIGNMENT_FILE);
  const subtitlesPath = path.join(outputDir, SPEECH_SUBTITLES_FILE);
  const metaPath = path.join(outputDir, SPEECH_ALIGNMENT_META_FILE);

  if (isReusableSpeechAlignment({ metaPath, alignmentPath, subtitlesPath, audioPath: speechAudioPath, narrationTextPath })) {
    const meta = readJsonIfExists(metaPath, {});
    return {
      enabled: true,
      reused: true,
      alignmentPath,
      subtitlesPath,
      metaPath,
      signature: String(meta.signature || ''),
      segmentCount: Number(meta.segmentCount || 0),
      wordCount: Number(meta.wordCount || 0)
    };
  }

  const args = [
    '--audio',
    speechAudioPath,
    '--narration-text',
    narrationTextPath,
    '--alignment-output',
    alignmentPath,
    '--subtitles-output',
    subtitlesPath,
    '--meta-output',
    metaPath
  ];
  if (fileUrl) {
    args.push('--file-url', fileUrl);
  }

  const payload = await runPython(SPEECH_ALIGNMENT_SCRIPT, args, {
    cwd: outputDir,
    timeout: Number(process.env.SPEECH_ALIGNMENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  });
  const result = readProtocolResult(payload);
  return {
    enabled: true,
    reused: false,
    alignmentPath,
    subtitlesPath,
    metaPath,
    signature: String(result.signature || hashFile(alignmentPath)),
    segmentCount: Number(result.segmentCount || 0),
    wordCount: Number(result.wordCount || 0)
  };
}

module.exports = {
  SPEECH_ALIGNMENT_FILE,
  SPEECH_SUBTITLES_FILE,
  SPEECH_ALIGNMENT_META_FILE,
  SPEECH_ALIGNMENT_SCRIPT,
  ensureSpeechAlignment,
  isReusableSpeechAlignment,
  isSpeechAlignmentEnabled
};
