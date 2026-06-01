const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_MOTION_IDLE_IMAGE_PATH,
  generateAvatarMotion,
  isAvatarMotionEnabled,
  resolveMotionLlmModel,
  resolveMotionLlmProvider,
  resolveMotionPlannerMode,
  resolveMotionIdleImagePath,
  resolveActionPresetDir
} = require('../avatarMotion');

describe('avatar motion service', () => {
  test('keeps avatar motion disabled unless config or env enables it', () => {
    const previous = process.env.AVATAR_MOTION_ENABLED;
    delete process.env.AVATAR_MOTION_ENABLED;
    expect(isAvatarMotionEnabled({})).toBe(false);
    expect(isAvatarMotionEnabled({ avatarMotionEnabled: true })).toBe(true);
    process.env.AVATAR_MOTION_ENABLED = 'true';
    expect(isAvatarMotionEnabled({ avatarMotionEnabled: false })).toBe(true);
    if (previous === undefined) {
      delete process.env.AVATAR_MOTION_ENABLED;
    } else {
      process.env.AVATAR_MOTION_ENABLED = previous;
    }
  });

  test('runs plan and pose builder scripts with stable artifact paths', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-motion-'));
    const narrationTextPath = path.join(outputDir, 'narration_speech.txt');
    const speechAudioPath = path.join(outputDir, 'avatar_qwen3tts.wav');
    const imagePath = path.join(outputDir, 'avatar.png');
    const idleImagePath = path.join(outputDir, 'idle.png');
    fs.writeFileSync(narrationTextPath, '这是关键。', 'utf8');
    fs.writeFileSync(speechAudioPath, 'audio', 'utf8');
    fs.writeFileSync(imagePath, 'image', 'utf8');
    fs.writeFileSync(idleImagePath, 'idle', 'utf8');
    fs.writeFileSync(path.join(outputDir, 'script_units.json'), JSON.stringify({ script_units: [] }), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'edit_plan.json'), JSON.stringify({ blocks: [] }), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'clip_matches.json'), JSON.stringify({ clip_matches: [] }), 'utf8');
    fs.writeFileSync(path.join(outputDir, 'speech_alignment.json'), JSON.stringify({ segments: [] }), 'utf8');
    const calls = [];
    const runPython = jest.fn(async (script, args) => {
      calls.push({ script: path.basename(script), args });
      return {
        protocol: {
          result: script.includes('avatar_motion_plan')
            ? { signature: 'plan-sig', segmentCount: 1 }
            : { signature: 'motion-video-sig', segmentCount: 2, poseInputPath: path.join(outputDir, 'avatar_motion_source.mp4') }
        }
      };
    });

    const result = await generateAvatarMotion({
      outputDir,
      narrationTextPath,
      speechAudioPath,
      imagePath,
      actionPresetDir: 'C:/actions',
      avatarMotionPlanner: 'llm',
      avatarMotionLlmProvider: 'qwen',
      avatarMotionLlmModel: 'qwen3.6-plus',
      idleImagePath,
      runPython
    });

    expect(calls.map((call) => call.script)).toEqual([
      'avatar_motion_plan.py',
      'avatar_motion_source_builder.py'
    ]);
    expect(calls[0].args).toContain(path.join(outputDir, 'avatar_motion_plan.json'));
    expect(calls[0].args).toContain('--action-dir');
    expect(calls[0].args).toContain('C:/actions');
    expect(calls[0].args).toContain('--planner-mode');
    expect(calls[0].args).toContain('llm');
    expect(calls[0].args).toContain('--llm-provider');
    expect(calls[0].args).toContain('qwen');
    expect(calls[0].args).toContain('--llm-model');
    expect(calls[0].args).toContain('qwen3.6-plus');
    expect(calls[0].args).toContain('--script-units');
    expect(calls[0].args).toContain(path.join(outputDir, 'script_units.json'));
    expect(calls[0].args).toContain('--edit-plan');
    expect(calls[0].args).toContain(path.join(outputDir, 'edit_plan.json'));
    expect(calls[0].args).toContain('--clip-matches');
    expect(calls[0].args).toContain(path.join(outputDir, 'clip_matches.json'));
    expect(calls[0].args).toContain('--speech-alignment');
    expect(calls[0].args).toContain(path.join(outputDir, 'speech_alignment.json'));
    expect(calls[1].args).toContain('C:/actions');
    expect(calls[1].args).toContain('--video-output');
    expect(calls[1].args).toContain(path.join(outputDir, 'avatar_motion_source.mp4'));
    expect(calls[1].args).toContain('--idle-image');
    expect(calls[1].args).toContain(idleImagePath);
    expect(calls[1].args).not.toContain('--sequence');
    expect(result.motionSignature).toBe('plan-sig:motion-video-sig');
    expect(result.poseInputPath).toBe(path.join(outputDir, 'avatar_motion_source.mp4'));
  });

  test('prefers conservative idle image for motion source still segments', () => {
    const existsSync = jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      return filePath === DEFAULT_MOTION_IDLE_IMAGE_PATH || filePath === 'C:/tmp/avatar.png';
    });

    try {
      expect(resolveMotionIdleImagePath({ imagePath: 'C:/tmp/avatar.png' })).toBe(DEFAULT_MOTION_IDLE_IMAGE_PATH);
    } finally {
      existsSync.mockRestore();
    }
  });

  test('falls back to avatar image when the conservative idle image is not installed', () => {
    const existsSync = jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
      return filePath === 'C:/tmp/avatar.png';
    });

    try {
      expect(resolveMotionIdleImagePath({ imagePath: 'C:/tmp/avatar.png' })).toBe('C:/tmp/avatar.png');
    } finally {
      existsSync.mockRestore();
    }
  });

  test('resolves custom action preset directory from config first', () => {
    expect(resolveActionPresetDir({ avatarActionPresetDir: 'C:/custom/actions' })).toBe('C:/custom/actions');
  });

  test('resolves avatar motion planner llm options from config first', () => {
    expect(resolveMotionPlannerMode({ avatarMotionPlanner: 'llm' })).toBe('llm');
    expect(resolveMotionLlmProvider({ avatarMotionLlmProvider: 'deepseek' })).toBe('deepseek');
    expect(resolveMotionLlmModel({ avatarMotionLlmModel: 'deepseek-v4-flash' })).toBe('deepseek-v4-flash');
  });
});
