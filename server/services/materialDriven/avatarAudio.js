const path = require('path');
const { spawnSync: defaultSpawnSync } = require('child_process');

const REFERENCE_AUDIO_LIMIT_SECONDS = 30;
const COSYVOICE_REFERENCE_AUDIO_LIMIT_SECONDS = REFERENCE_AUDIO_LIMIT_SECONDS;
const QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS = 20;

function parseDurationSeconds(result) {
  if (!result || result.status !== 0) return null;
  const value = Number(String(result.stdout || '').trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

function probeAudioDurationSeconds(inputPath, spawnSync = defaultSpawnSync) {
  const result = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nk=1:nw=1',
      inputPath
    ],
    { encoding: 'utf8' }
  );
  return parseDurationSeconds(result);
}

function buildTrimmedAudioPath(inputPath, outputDir) {
  const ext = path.extname(inputPath) || '.wav';
  return path.join(outputDir, `avatar_reference_audio_trimmed${ext}`);
}

function trimAudioToLimit(inputPath, outputPath, spawnSync = defaultSpawnSync, limitSeconds = REFERENCE_AUDIO_LIMIT_SECONDS) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', inputPath,
      '-t', String(limitSeconds),
      outputPath
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    const stderr = String(result.stderr || result.stdout || '').trim();
    throw new Error(stderr || 'FFmpeg 裁剪参考音频失败');
  }
  return outputPath;
}

function prepareReferenceAudio({ inputPath, outputDir, spawnSync = defaultSpawnSync, limitSeconds = REFERENCE_AUDIO_LIMIT_SECONDS }) {
  const durationSeconds = probeAudioDurationSeconds(inputPath, spawnSync);
  if (durationSeconds !== null && durationSeconds <= limitSeconds) {
    return {
      audioPath: inputPath,
      wasTrimmed: false,
      durationSeconds
    };
  }

  const trimmedPath = buildTrimmedAudioPath(inputPath, outputDir);
  trimAudioToLimit(inputPath, trimmedPath, spawnSync, limitSeconds);
  return {
    audioPath: trimmedPath,
    wasTrimmed: true,
    durationSeconds
  };
}

module.exports = {
  COSYVOICE_REFERENCE_AUDIO_LIMIT_SECONDS,
  QWEN_TTS_REFERENCE_AUDIO_LIMIT_SECONDS,
  REFERENCE_AUDIO_LIMIT_SECONDS,
  prepareReferenceAudio
};
