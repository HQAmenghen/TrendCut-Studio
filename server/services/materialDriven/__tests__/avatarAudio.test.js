const path = require('path');

const { prepareReferenceAudio } = require('../avatarAudio');

describe('prepareReferenceAudio', () => {
  test('returns original audio when duration is within CosyVoice limit', () => {
    const spawnSync = jest.fn().mockReturnValue({
      status: 0,
      stdout: Buffer.from('8.98\n'),
      stderr: Buffer.from('')
    });

    const result = prepareReferenceAudio({
      inputPath: 'C:\\audio\\short.wav',
      outputDir: 'C:\\workdir',
      spawnSync
    });

    expect(result).toEqual({
      audioPath: 'C:\\audio\\short.wav',
      wasTrimmed: false,
      durationSeconds: 8.98
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  test('trims audio when duration exceeds CosyVoice limit', () => {
    const spawnSync = jest
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('298.97\n'),
        stderr: Buffer.from('')
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from('')
      });

    const result = prepareReferenceAudio({
      inputPath: 'C:\\audio\\long.mp3',
      outputDir: 'C:\\workdir',
      spawnSync
    });

    expect(result.audioPath).toBe(path.join('C:\\workdir', 'avatar_reference_audio_trimmed.mp3'));
    expect(result.wasTrimmed).toBe(true);
    expect(result.durationSeconds).toBe(298.97);
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      'ffmpeg',
      expect.arrayContaining([
        '-y',
        '-i',
        'C:\\audio\\long.mp3',
        '-t',
        '30',
        path.join('C:\\workdir', 'avatar_reference_audio_trimmed.mp3')
      ]),
      expect.any(Object)
    );
  });
});
