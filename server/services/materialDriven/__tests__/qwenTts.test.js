const path = require('path');

const { synthesizeQwenTtsSpeech } = require('../qwenTts');

describe('synthesizeQwenTtsSpeech', () => {
  test('runs the Qwen3TTS Python script and returns the generated audio path', async () => {
    const outputPath = path.join('C:\\work', 'avatar_qwen3tts.wav');
    const runPythonScript = jest.fn().mockResolvedValue({
      protocol: {
        result: {
          outputPath,
          voice: 'qwen-voice-custom',
          model: 'qwen3-tts-vc-2026-01-22'
        }
      }
    });
    const existsSync = jest.fn((filePath) => filePath === outputPath);

    const result = await synthesizeQwenTtsSpeech({
      text: '今天天气怎么样？',
      referenceAudioPath: 'C:\\voice\\sample.mp3',
      outputDir: 'C:\\work',
      runPythonScript,
      fsModule: { existsSync }
    });

    expect(result.outputPath).toBe(outputPath);
    expect(result.voice).toBe('qwen-voice-custom');
    expect(runPythonScript).toHaveBeenCalledTimes(1);
    expect(runPythonScript.mock.calls[0][1]).toEqual([
      '--text',
      '今天天气怎么样？',
      '--reference-audio',
      'C:\\voice\\sample.mp3',
      '--output',
      outputPath
    ]);
  });

  test('fails before launching Python when required inputs are missing', async () => {
    await expect(synthesizeQwenTtsSpeech({
      text: '',
      referenceAudioPath: 'C:\\voice\\sample.mp3',
      outputDir: 'C:\\work'
    })).rejects.toThrow('缺少可用口播文案');
  });
});
