const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  ensureSpeechAlignment,
  isReusableSpeechAlignment,
  isSpeechAlignmentEnabled
} = require('../speechAlignment');

describe('speech alignment service', () => {
  test('enabled by default and can be disabled by config', () => {
    expect(isSpeechAlignmentEnabled({})).toBe(true);
    expect(isSpeechAlignmentEnabled({ speechAlignmentEnabled: false })).toBe(false);
    expect(isSpeechAlignmentEnabled({ speechAlignmentEnabled: 'true' })).toBe(true);
  });

  test('generates and reuses speech alignment artifacts by audio and text hash', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-alignment-'));
    const audioPath = path.join(outputDir, 'avatar_qwen3tts.wav');
    const textPath = path.join(outputDir, 'narration_speech.txt');
    fs.writeFileSync(audioPath, 'audio', 'utf8');
    fs.writeFileSync(textPath, '这是关键。', 'utf8');

    const runPython = jest.fn(async (_script, args) => {
      const alignmentPath = args[args.indexOf('--alignment-output') + 1];
      const subtitlesPath = args[args.indexOf('--subtitles-output') + 1];
      const metaPath = args[args.indexOf('--meta-output') + 1];
      fs.writeFileSync(alignmentPath, JSON.stringify({ segments: [], words: [] }), 'utf8');
      fs.writeFileSync(subtitlesPath, JSON.stringify([{ time: [0, 1], zh: '这是关键。' }]), 'utf8');
      fs.writeFileSync(metaPath, JSON.stringify({
        audioSha1: crypto.createHash('sha1').update('audio').digest('hex'),
        narrationSha1: crypto.createHash('sha1').update('这是关键。').digest('hex'),
        signature: 'alignment-sig',
        segmentCount: 1,
        wordCount: 2
      }), 'utf8');
      return {
        protocol: {
          result: {
            signature: 'alignment-sig',
            segmentCount: 1,
            wordCount: 2
          }
        }
      };
    });

    const first = await ensureSpeechAlignment({
      outputDir,
      speechAudioPath: audioPath,
      narrationTextPath: textPath,
      runPython
    });
    const second = await ensureSpeechAlignment({
      outputDir,
      speechAudioPath: audioPath,
      narrationTextPath: textPath,
      runPython
    });

    expect(first.reused).toBe(false);
    expect(first.signature).toBe('alignment-sig');
    expect(second.reused).toBe(true);
    expect(second.segmentCount).toBe(1);
    expect(runPython).toHaveBeenCalledTimes(1);
    expect(isReusableSpeechAlignment({
      metaPath: path.join(outputDir, 'speech_alignment_meta.json'),
      alignmentPath: path.join(outputDir, 'speech_alignment.json'),
      subtitlesPath: path.join(outputDir, 'speech_subtitles.json'),
      audioPath,
      narrationTextPath: textPath
    })).toBe(true);
  });
});
