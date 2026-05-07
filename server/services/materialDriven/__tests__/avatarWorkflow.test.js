const {
  prepareAvatarExternalAudioWorkflow,
  prepareAvatarSpeechWorkflow,
  prepareNarrationTextForAvatarWorkflow,
  resolveAvatarSeed,
  resolveAvatarSpeechNodeId,
  sanitizeNarrationText
} = require('../avatarWorkflow');

describe('sanitizeNarrationText', () => {
  test('removes isolated trailing end markers and normalizes multiline narration', () => {
    expect(sanitizeNarrationText('第一句\n第二句\n结束')).toBe('第一句。第二句。');
    expect(sanitizeNarrationText('第一句。 结束。')).toBe('第一句。');
  });

  test('preserves normal words that merely end with 结束', () => {
    expect(sanitizeNarrationText('这一轮拉锯即将结束')).toBe('这一轮拉锯即将结束。');
  });
});

describe('prepareNarrationTextForAvatarWorkflow', () => {
  test('keeps raw multiline text for workflow while using sanitized text only for validation', () => {
    const rawText = [
      '第一行没有句号',
      '第二行也要保留换行',
      '第三行继续保留'
    ].join('\n');

    const prepared = prepareNarrationTextForAvatarWorkflow(rawText);

    expect(prepared.workflowText).toBe(rawText);
    expect(prepared.validationText).toBe('第一行没有句号。第二行也要保留换行。第三行继续保留。');
    expect(prepared.isUsable).toBe(true);
  });
});

describe('prepareAvatarSpeechWorkflow', () => {
  test('writes sanitized narration into the upstream text node while preserving the prompt list chain', () => {
    const workflow = {
      '283': {
        class_type: 'Text Multiline',
        inputs: {
          text: '旧文案'
        }
      },
      '287': {
        class_type: 'PromptListGenerator',
        inputs: {
          text: ['283', 0],
          delimiter: '/n',
          keep_delimiter: true,
          seed: 863895365
        }
      },
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: ['287', 0],
          speed: 1.05,
          seed: 919117951,
          text_frontend: true,
          model: ['277', 0],
          reference_audio: ['6', 0]
        },
        _meta: {
          title: 'FL CosyVoice3 Zero-Shot Clone'
        }
      }
    };

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: '第一句\n结束',
      seed: 42
    });

    expect(prepared['278'].class_type).toBe('FL_CosyVoice3_ZeroShot');
    expect(prepared['278']._meta.title).toBe('FL CosyVoice3 Zero-Shot Clone');
    expect(prepared['278'].inputs.text).toEqual(['287', 0]);
    expect(prepared['283'].inputs.text).toBe('第一句。');
    expect(prepared['278'].inputs.target_language).toBeUndefined();
    expect(prepared['278'].inputs.speed).toBe(1.05);
    expect(prepared['278'].inputs.seed).toBe(919117951);
    expect(prepared['287'].inputs.delimiter).toBe('/n');
    expect(prepared['287'].inputs.keep_delimiter).toBe(true);
    expect(prepared['287'].inputs.seed).toBe(863895365);
    expect(workflow['278'].class_type).toBe('FL_CosyVoice3_ZeroShot');
    expect(workflow['283'].inputs.text).toBe('旧文案');
  });

  test('groups short sentences into <=200 character chunks before prompt-list TTS splitting', () => {
    const workflow = {
      '283': {
        class_type: 'Text Multiline',
        inputs: {
          text: '旧文案'
        }
      },
      '287': {
        class_type: 'PromptListGenerator',
        inputs: {
          text: ['283', 0],
          delimiter: '/n',
          keep_delimiter: true
        }
      },
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: ['287', 0],
          speed: 1.08,
          seed: 1,
          text_frontend: true,
          model: ['277', 0],
          reference_audio: ['6', 0]
        }
      }
    };

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: [
        'Coinbase CEO 刚刚在 Fox 直播里抛出一个重磅预测。',
        '所有 G20 国家，很快都会建立战略比特币储备。',
        '这番表态直接指向国家级资产配置。',
        'G20 一旦集体行动，资金体量完全不在一个层级。',
        '消息面上明确标记了看涨信号。',
        '主权资金进场，将带来流动性格局的显著变化。',
        '接下来关注各国政策落地的时间窗口。',
        '宏观风向转变，资产定位已经不同以往。'
      ].join('\n'),
      seed: 42
    });

    const chunks = prepared['283'].inputs.text.split('/n');
    expect(chunks.length).toBeLessThan(8);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(prepared['287'].inputs.delimiter).toBe('/n');
    expect(prepared['287'].inputs.keep_delimiter).toBe(true);
  });

  test('preserves original multiline text for prompt-list input when requested', () => {
    const workflow = {
      '283': {
        class_type: 'Text Multiline',
        inputs: {
          text: '旧文案'
        }
      },
      '287': {
        class_type: 'PromptListGenerator',
        inputs: {
          text: ['283', 0],
          delimiter: '\\n',
          keep_delimiter: true
        }
      },
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: ['287', 0],
          speed: 1.05,
          seed: 1202744912,
          text_frontend: true,
          reference_audio: ['6', 0]
        }
      }
    };
    const rawText = [
      '第一行没有句号',
      '第二行保留原样',
      '第三行继续保留'
    ].join('\n');

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: rawText,
      preservePromptListLines: true
    });

    expect(prepared['278'].inputs.text).toEqual(['287', 0]);
    expect(prepared['283'].inputs.text).toBe(rawText);
    expect(prepared['287'].inputs.delimiter).toBe('\\n');
    expect(prepared['287'].inputs.keep_delimiter).toBe(true);
  });

  test('splits 201-400 character narration into two balanced large chunks', () => {
    const workflow = {
      '283': {
        class_type: 'Text Multiline',
        inputs: {
          text: '旧文案'
        }
      },
      '287': {
        class_type: 'PromptListGenerator',
        inputs: {
          text: ['283', 0],
          delimiter: '/n',
          keep_delimiter: true
        }
      },
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: ['287', 0],
          speed: 1.08,
          seed: 1,
          text_frontend: true,
          reference_audio: ['6', 0]
        }
      }
    };
    const longSentence = `${'甲'.repeat(120)}。`;
    const mediumSentenceA = `${'乙'.repeat(70)}。`;
    const mediumSentenceB = `${'丙'.repeat(70)}。`;

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: [longSentence, mediumSentenceA, mediumSentenceB].join('\n'),
      seed: 42
    });

    const chunks = prepared['283'].inputs.text.split('/n');
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(chunks[0]).toBe(longSentence);
    expect(chunks[1]).toBe(`${mediumSentenceA}${mediumSentenceB}`);
  });

  test('falls back to writing text on the speech node when no upstream text node exists', () => {
    const workflow = {
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: '旧文案',
          speed: 1,
          seed: 1,
          text_frontend: true
        }
      }
    };

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: '第一句\n结束',
      seed: 7
    });

    expect(prepared['278'].inputs.text).toBe('第一句。');
    expect(prepared['278'].inputs.seed).toBe(1);
  });

  test('does not inject a seed when no explicit override is provided', () => {
    const workflow = {
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: '旧文案',
          speed: 1,
          text_frontend: true
        }
      }
    };

    const prepared = prepareAvatarSpeechWorkflow(workflow, {
      narrationText: '第一句'
    });

    expect(prepared['278'].inputs.text).toBe('第一句。');
    expect(prepared['278'].inputs.seed).toBeUndefined();
  });
});

describe('prepareAvatarExternalAudioWorkflow', () => {
  test('removes embedded TTS nodes and routes the uploaded speech audio to avatar consumers', () => {
    const workflow = {
      '6': {
        class_type: 'LoadAudio',
        inputs: {
          audio: 'old-reference.wav'
        }
      },
      '9': {
        class_type: 'AudioSeparation',
        inputs: {
          audio: ['291', 0]
        }
      },
      '129': {
        class_type: 'Audio Duration (mtb)',
        inputs: {
          audio: ['291', 0]
        }
      },
      '136': {
        class_type: 'PreviewAudio',
        inputs: {
          audio: ['291', 0]
        }
      },
      '151': {
        class_type: 'VHS_VideoCombine',
        inputs: {
          audio: ['291', 0]
        }
      },
      '180': {
        class_type: 'LoadImage',
        inputs: {
          image: 'old.png'
        }
      },
      '277': {
        class_type: 'FL_CosyVoice3_ModelLoader',
        inputs: {}
      },
      '278': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          text: ['287', 0],
          reference_audio: ['6', 0]
        }
      },
      '283': {
        class_type: 'Text Multiline',
        inputs: {
          text: '旧文案'
        }
      },
      '287': {
        class_type: 'PromptListGenerator',
        inputs: {
          text: ['283', 0]
        }
      },
      '291': {
        class_type: 'AudioListCombine',
        inputs: {
          audio_list: ['278', 0]
        }
      }
    };

    const prepared = prepareAvatarExternalAudioWorkflow(workflow, {
      audioName: 'qwen3tts.wav',
      imageName: 'avatar.png'
    });

    expect(prepared['6'].inputs.audio).toBe('qwen3tts.wav');
    expect(prepared['180'].inputs.image).toBe('avatar.png');
    expect(prepared['9'].inputs.audio).toEqual(['6', 0]);
    expect(prepared['129'].inputs.audio).toEqual(['6', 0]);
    expect(prepared['136'].inputs.audio).toEqual(['6', 0]);
    expect(prepared['151'].inputs.audio).toEqual(['6', 0]);
    expect(prepared['277']).toBeUndefined();
    expect(prepared['278']).toBeUndefined();
    expect(prepared['283']).toBeUndefined();
    expect(prepared['287']).toBeUndefined();
    expect(prepared['291']).toBeUndefined();
    expect(workflow['9'].inputs.audio).toEqual(['291', 0]);
  });
});

describe('resolveAvatarSeed', () => {
  test('returns undefined when no explicit override is provided', () => {
    const workflow = {
      '27': {
        inputs: {
          seed: 953714801674314
        }
      },
      '278': {
        inputs: {
          seed: 919117951
        }
      }
    };

    expect(resolveAvatarSeed(workflow)).toBeUndefined();
  });

  test('uses explicit seed override when provided', () => {
    const workflow = {
      '278': {
        inputs: {
          seed: 919117951
        }
      }
    };

    expect(resolveAvatarSeed(workflow, 12345)).toBe(12345);
  });
});

describe('resolveAvatarSpeechNodeId', () => {
  test('finds the active CosyVoice speech node even when the id changes', () => {
    const workflow = {
      '301': {
        class_type: 'FL_CosyVoice3_ZeroShot',
        inputs: {
          reference_audio: ['6', 0]
        }
      }
    };

    expect(resolveAvatarSpeechNodeId(workflow)).toBe('301');
  });
});
