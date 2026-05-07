const {
  applyWorkflowConfig,
  extractWorkflowConfig
} = require('../workflow');

const path = require('path');

const { readWorkflow } = require('../workflow');

describe('workflow config helpers', () => {
  test('extracts audio speed from the active speech node instead of hard-coded node ids', () => {
    const workflow = {
      '27': { inputs: { steps: 6, cfg: 1.5, shift: 11, scheduler: 'dpm++_sde', seed: 9 } },
      '114': { inputs: { positive_prompt: '正向', negative_prompt: '反向' } },
      '151': { inputs: { frame_rate: 25, crf: 19, format: 'video/h264-mp4' } },
      '176': { inputs: { model: 'wan.safetensors' } },
      '186': { inputs: { value: 1024 } },
      '269': { inputs: { lora: 'reward.safetensors', strength: 0.5 } },
      '301': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          speed: 1.2,
          seed: 123,
          reference_audio: ['6', 0]
        }
      }
    };

    expect(extractWorkflowConfig(workflow).audioSpeed).toBe(1.2);
  });

  test('applies seed and audio speed to the active speech node instead of assuming node 278', () => {
    const workflow = {
      '27': { inputs: { seed: 1, steps: 4, cfg: 1, shift: 11, scheduler: 'dpm++_sde' } },
      '114': { inputs: { positive_prompt: '', negative_prompt: '' } },
      '151': { inputs: { frame_rate: 25, crf: 19, format: 'video/h264-mp4' } },
      '176': { inputs: { model: '' } },
      '186': { inputs: { value: 1024 } },
      '269': { inputs: { lora: '', strength: 0.5 } },
      '301': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          speed: 1,
          seed: 2,
          reference_audio: ['6', 0]
        }
      }
    };

    applyWorkflowConfig(workflow, {
      seed: 999,
      audioSpeed: 1.05
    });

    expect(workflow['27'].inputs.seed).toBe(999);
    expect(workflow['301'].inputs.seed).toBe(999);
    expect(workflow['301'].inputs.speed).toBe(1.05);
  });

  test('project workflow consumes uploaded speech audio directly instead of embedded TTS output', () => {
    const workflowPath = path.join(__dirname, '../../../../config/workflow_api.json');
    const workflow = readWorkflow(workflowPath);
    const classTypes = Object.values(workflow).map((node) => String(node.class_type || ''));

    expect(classTypes.some((classType) => /^FL_CosyVoice3_/u.test(classType))).toBe(false);
    expect(classTypes).not.toContain('PromptListGenerator');
    expect(classTypes).not.toContain('AudioListCombine');
    expect(workflow['9'].inputs.audio).toEqual(['6', 0]);
    expect(workflow['129'].inputs.audio).toEqual(['6', 0]);
    expect(workflow['136'].inputs.audio).toEqual(['6', 0]);
    expect(workflow['151'].inputs.audio).toEqual(['6', 0]);
  });
});
