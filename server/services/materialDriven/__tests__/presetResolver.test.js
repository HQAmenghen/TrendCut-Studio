const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolvePresetFile } = require('../presetResolver');

describe('resolvePresetFile', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-resolver-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns exact preset file when requested name exists', () => {
    const exactPath = path.join(tempDir, 'voice.wav');
    fs.writeFileSync(exactPath, 'data');

    const result = resolvePresetFile(tempDir, 'voice.wav');

    expect(result).toEqual({
      path: exactPath,
      resolvedName: 'voice.wav',
      matchType: 'exact'
    });
  });

  test('falls back to unique same-stem file when extension changed', () => {
    const stemMatchPath = path.join(tempDir, '毕.wav');
    fs.writeFileSync(stemMatchPath, 'data');

    const result = resolvePresetFile(tempDir, '毕.mp3');

    expect(result).toEqual({
      path: stemMatchPath,
      resolvedName: '毕.wav',
      matchType: 'stem'
    });
  });

  test('returns missing when requested preset is absent and no same-stem file exists', () => {
    fs.writeFileSync(path.join(tempDir, 'a.wav'), 'data');

    const result = resolvePresetFile(tempDir, '毕.mp3');

    expect(result).toEqual({
      path: '',
      resolvedName: '',
      matchType: 'missing'
    });
  });

  test('returns first available preset when no name is requested', () => {
    fs.writeFileSync(path.join(tempDir, 'b.wav'), 'data');
    const firstPath = path.join(tempDir, 'a.wav');
    fs.writeFileSync(firstPath, 'data');

    const result = resolvePresetFile(tempDir, '');

    expect(result).toEqual({
      path: firstPath,
      resolvedName: 'a.wav',
      matchType: 'first_available'
    });
  });
});
