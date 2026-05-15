const fs = require('fs');
const path = require('path');

const { runPythonScript } = require('../../core/python');

const DEFAULT_OUTPUT_FILENAME = 'avatar_qwen3tts.wav';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const QWEN_TTS_SCRIPT = path.join(__dirname, '../../../python/tts/qwen3_tts.py');

function readProtocolResult(payload = {}) {
  return payload?.protocol?.result || {};
}

function resolveOutputPath(outputDir, outputPath) {
  if (outputPath) return outputPath;
  return path.join(outputDir, DEFAULT_OUTPUT_FILENAME);
}

async function synthesizeQwenTtsSpeech(options = {}) {
  const text = String(options.text || '').trim();
  if (!text) throw new Error('缺少可用口播文案');

  const referenceAudioPath = String(options.referenceAudioPath || '').trim();
  if (!referenceAudioPath) throw new Error('缺少可用音色复刻参考音频');

  const outputDir = String(options.outputDir || '').trim();
  if (!outputDir) throw new Error('缺少 Qwen3TTS 输出目录');

  const outputPath = resolveOutputPath(outputDir, options.outputPath);
  const args = [
    '--text',
    text,
    '--reference-audio',
    referenceAudioPath,
    '--output',
    outputPath
  ];

  if (options.model) args.push('--model', String(options.model));
  if (options.preferredName) args.push('--preferred-name', String(options.preferredName));
  if (options.baseUrl) args.push('--base-url', String(options.baseUrl));
  if (options.languageType) args.push('--language-type', String(options.languageType));

  const run = options.runPythonScript || runPythonScript;
  const fsModule = options.fsModule || fs;
  const payload = await run(QWEN_TTS_SCRIPT, args, {
    cwd: outputDir,
    timeout: Number(process.env.QWEN_TTS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  });
  const result = readProtocolResult(payload);
  const resolvedOutputPath = String(result.outputPath || result.output_path || outputPath);

  if (!fsModule.existsSync(resolvedOutputPath)) {
    throw new Error(`Qwen3TTS 未生成音频文件: ${resolvedOutputPath}`);
  }

  return {
    outputPath: resolvedOutputPath,
    voice: String(result.voice || ''),
    model: String(result.model || options.model || process.env.QWEN_TTS_MODEL || ''),
    audioUrl: String(result.audioUrl || result.audio_url || '')
  };
}

module.exports = {
  DEFAULT_OUTPUT_FILENAME,
  synthesizeQwenTtsSpeech
};
