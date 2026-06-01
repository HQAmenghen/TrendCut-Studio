const {
  buildAutoPilotPlatformSelections,
  buildLoginCheckScheduleConfig,
  buildShanghaiIso,
  collectAutoPilotFallbackCandidates,
  createAutoPilotActiveKey,
  findExistingAutoPilotPublishJob,
  getAutoPilotModeSchedule,
  getAutoPilotRequiredPartitionIds,
  getAutoPilotSlotAvatarConfig,
  getAutoPilotSlotRetryLimit,
  getAutoPilotSlotSourceRank,
  getRankingForPartition,
  normalizeAutoPilotPlatformSelection,
  normalizeSourceVideoKey,
  normalizeXaiPartitionId
} = require('../schedulerUtils');

describe('scheduler utils', () => {
  test('normalizes login schedule and xAI partition config', () => {
    expect(buildLoginCheckScheduleConfig({
      LOGIN_CHECK_INTERVAL_MINUTES: '15',
      LOGIN_CHECK_ENABLED: 'false'
    }, {})).toEqual({
      checkInterval: 15,
      loginCheckEnabled: false
    });
    expect(normalizeXaiPartitionId(' AI News!! ')).toBe('ai-news');
    expect(normalizeXaiPartitionId('')).toBe('crypto');
  });

  test('normalizes autopilot mode schedules and slot settings', () => {
    const config = {
      global: {
        autoPilotPipelineModes: ['avatar', 'vertical', 'bad'],
        autoPilotCount: 2,
        autoPilotModeSchedules: {
          avatar: {
            accountIds: ['a', ''],
            times: ['08:00', ''],
            partitionIds: ['finance', 'ai'],
            sourceRanks: ['2', '20'],
            platforms: [['wechatChannels', 'x'], []],
            audioPresets: ['voice.mp3'],
            imagePresets: ['avatar.png']
          }
        },
        avatarPipelineConfig: {
          audioPreset: 'base.mp3',
          imagePreset: 'base.png'
        },
        autoPilotSlotRetryLimit: 3
      }
    };

    expect(getAutoPilotModeSchedule(config, 'avatar')).toEqual(expect.objectContaining({
      accountIds: ['a'],
      partitionIds: ['finance', 'ai'],
      platforms: [['wechatChannels', 'x']]
    }));
    expect(getAutoPilotRequiredPartitionIds(config)).toEqual(expect.arrayContaining(['finance', 'ai', 'crypto']));
    expect(getAutoPilotSlotSourceRank(config, 'avatar', 0)).toBe(2);
    expect(getAutoPilotSlotSourceRank(config, 'avatar', 1)).toBe(10);
    expect(getAutoPilotSlotAvatarConfig(config, 'avatar', 0)).toEqual(expect.objectContaining({
      audioPreset: 'voice.mp3',
      imagePreset: 'avatar.png'
    }));
    expect(getAutoPilotSlotRetryLimit(config)).toBe(3);
  });

  test('normalizes platform selections, dates, source keys, and active keys', () => {
    expect(normalizeAutoPilotPlatformSelection('wechatChannels,bad,x')).toEqual(['wechatChannels', 'x']);
    expect(buildShanghaiIso('2026-06-01', '08:30')).toBe('2026-06-01T00:30:00.000Z');
    expect(normalizeSourceVideoKey('https://video.twimg.com/a/b.mp4?tag=1#x')).toBe('https://video.twimg.com/a/b.mp4');
    expect(createAutoPilotActiveKey({ videoUrl: 'https://video.example/a.mp4' }, 2)).toBe('video:https://video.example/a.mp4');
  });

  test('builds account selections and finds existing publish jobs', () => {
    const config = {
      wechatChannels: {
        accounts: [{ id: 'a1', displayName: 'Account One' }]
      },
      x: {
        accounts: [{ id: 'x1', username: 'x-user' }]
      }
    };
    expect(buildAutoPilotPlatformSelections(config, ['wechatChannels', 'x'], 'a1')).toEqual({
      wechatChannels: { accountId: 'a1', accountLabel: 'Account One' }
    });

    const existing = findExistingAutoPilotPublishJob([
      {
        id: 'job1',
        autoPilot: { pipelineMode: 'vertical', sourceVideoUrl: 'https://video.twimg.com/a.mp4?tag=1' },
        asset: { path: 'public/xai_vertical_queue/q1/vertical_output.mp4' }
      }
    ], {
      pipelineMode: 'vertical',
      sourceVideoKey: 'https://video.twimg.com/a.mp4'
    });
    expect(existing.id).toBe('job1');
  });

  test('collects fallback candidates and selects ranking partition', () => {
    const candidates = collectAutoPilotFallbackCandidates({
      rankingItems: [
        { title: 'no video' },
        { title: 'with video', video_url: 'https://video.example/a.mp4', post_id: 'p1' }
      ],
      partition: { id: 'ai', label: 'AI' },
      partitionId: 'ai'
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual(expect.objectContaining({
      sourceRank: 2,
      sourcePartitionId: 'ai'
    }));
    expect(getRankingForPartition({ ai: { items: [] } }, 'ai')).toEqual({ items: [] });
  });
});
