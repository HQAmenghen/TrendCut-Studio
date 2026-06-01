import assert from 'node:assert/strict';
import {
  buildActiveAutoPilotMappings,
  buildAutoPilotAvatarPresetSummary,
  buildAutoPilotConfiguredPlans,
  buildAutoPilotSummaryItems,
  buildGeneratedAutoPilotJobs,
  formatAutoPilotJobTime,
  getAutoPilotModeSchedule,
  getAvatarPresetLabel
} from '../frontend/src/composables/publishCenter/autoPilot.mjs';
import {
  DEFAULT_AUTO_PILOT_PLATFORMS,
  buildPlatformAccountOptions,
  buildPlatformCards,
  createSauAccount,
  createWechatAccount,
  createXAccount,
  getPlatformAccounts,
  normalizeApiError,
  normalizeAutoPilotModeSchedules,
  normalizePlatformSelection,
  normalizePresetPayload,
  normalizeTags,
  normalizeXaiPartitionId,
  pickPublishTitleFromAsset,
  resolvePlatformAccountLabel
} from '../frontend/src/composables/publishCenter/domain.mjs';

assert.deepEqual(normalizeTags(' AI, ,视频 ,热点'), ['AI', '视频', '热点']);
assert.deepEqual(normalizeTags(['  one ', '', 'two']), ['one', 'two']);

assert.deepEqual(normalizePlatformSelection(['wechatChannels', 'x', 'x', 'unknown']), ['wechatChannels', 'x']);
assert.deepEqual(normalizePlatformSelection('', ['douyin']), ['douyin']);
assert.deepEqual(normalizePlatformSelection('', undefined), DEFAULT_AUTO_PILOT_PLATFORMS);

const schedules = normalizeAutoPilotModeSchedules({
  avatar: {
    accountIds: 'account-1',
    platforms: [['wechatChannels', 'x'], ['bad']],
    times: ['08:00']
  }
});
assert.deepEqual(schedules.avatar.accountIds, ['account-1']);
assert.deepEqual(schedules.avatar.platforms, [['wechatChannels', 'x'], []]);
assert.deepEqual(schedules.vertical.accountIds, []);

assert.deepEqual(normalizePresetPayload({ audio: [' a.mp3 ', ''], image: ['cover.png'] }), {
  audio: ['a.mp3'],
  image: ['cover.png']
});
assert.equal(normalizeXaiPartitionId(' AI 热点 / 01 '), 'ai-01');

assert.equal(pickPublishTitleFromAsset({
  label: 'fallback',
  metadata: { suggestedTitle: '建议标题' }
}), '建议标题');

const douyinAccount = createSauAccount('douyin', { displayName: '账号', accountId: 123 });
assert.match(douyinAccount.id, /^douyin_/);
assert.deepEqual(
  {
    displayName: douyinAccount.displayName,
    accountId: douyinAccount.accountId,
    sauAccountName: douyinAccount.sauAccountName
  },
  { displayName: '账号', accountId: '123', sauAccountName: '' }
);
assert.equal(createXAccount({ username: 'trendcut', markMadeWithAi: false }).markMadeWithAi, false);
assert.match(createWechatAccount({ helperAccount: 'helper' }).id, /^wechat_/);

const config = {
  wechatChannels: {
    enabled: true,
    accounts: [
      { id: 'w1', displayName: '', finderUserName: 'finder', helperAccount: 'helper' },
      { id: 'w2', displayName: '主账号', finderUserName: '', helperAccount: '' }
    ]
  },
  douyin: {
    enabled: true,
    accounts: [
      { id: 'd1', displayName: '', sauAccountName: 'douyin-login' },
      { id: 'd2', displayName: '', sauAccountName: '' }
    ]
  },
  x: {
    enabled: true,
    accounts: [
      { id: 'x1', username: 'trendcut', accessToken: 'token' }
    ]
  },
  youtube: {
    enabled: true,
    clientId: 'client',
    clientSecret: '',
    channelId: 'channel'
  }
};

assert.equal(getPlatformAccounts(config, 'douyin').length, 2);
assert.deepEqual(buildPlatformAccountOptions(config, 'wechatChannels'), [
  { id: 'w1', label: 'helper' },
  { id: 'w2', label: '主账号' }
]);
assert.equal(resolvePlatformAccountLabel(config, 'x', 'x1'), 'trendcut');
assert.equal(resolvePlatformAccountLabel(config, 'x', ''), '未指定账号');
assert.equal(resolvePlatformAccountLabel(config, 'x', 'missing'), 'missing');

const cards = buildPlatformCards(config);
assert.equal(cards.find((item) => item.key === 'wechatChannels').percent, 50);
assert.equal(cards.find((item) => item.key === 'douyin').accountCount, 2);
assert.equal(cards.find((item) => item.key === 'x').percent, 100);
assert.deepEqual(cards.find((item) => item.key === 'youtube').fieldKeys, ['clientId', 'clientSecret', 'channelId']);

const global = {
  autoPilotEnabled: true,
  autoPilotFetchTime: '07:30',
  autoPilotTime: '08:00',
  autoPilotPartitionId: 'crypto',
  autoPilotModeSchedules: {
    avatar: {
      accountIds: ['w1'],
      times: ['09:00'],
      partitionIds: ['ai'],
      sourceRanks: ['3'],
      platforms: [['wechatChannels', 'x']],
      audioPresets: ['voice.mp3'],
      imagePresets: ['avatar.png']
    }
  }
};
assert.equal(getAvatarPresetLabel('voice.mp3'), 'voice');
assert.equal(buildAutoPilotAvatarPresetSummary({ pipelineMode: 'avatar', audioPreset: 'voice.mp3', imagePreset: 'avatar.png' }), 'avatar / voice');
assert.deepEqual(getAutoPilotModeSchedule(global, 'avatar').platforms, [['wechatChannels', 'x']]);

const activeMappings = buildActiveAutoPilotMappings({
  activeModes: ['avatar'],
  global,
  xaiPartitionOptions: [{ id: 'ai', label: 'AI 分区' }],
  getPlatformLabel: (platformKey) => ({ wechatChannels: '微信视频号', x: 'X' }[platformKey] || platformKey),
  getPlatformLabels: (platformKeys) => platformKeys.map((platformKey) => ({ wechatChannels: '微信视频号', x: 'X' }[platformKey] || platformKey))
});
assert.deepEqual(activeMappings.map((item) => ({
  pipelineMode: item.pipelineMode,
  sourceRank: item.sourceRank,
  platformLabels: item.platformLabels,
  partitionLabel: item.partitionLabel
})), [{
  pipelineMode: 'avatar',
  sourceRank: 3,
  platformLabels: ['微信视频号', 'X'],
  partitionLabel: 'AI 分区'
}]);

const configuredPlans = buildAutoPilotConfiguredPlans({
  mappings: activeMappings,
  global,
  getPlatformAccountLabel: () => '主账号',
  getPlatformLabel: (platformKey) => ({ wechatChannels: '微信视频号', x: 'X' }[platformKey] || platformKey)
});
assert.equal(configuredPlans[0].scheduledLabel, '每天 09:00');
assert.equal(configuredPlans[0].accountLabel, '主账号');

const generatedJobs = buildGeneratedAutoPilotJobs({
  jobs: [{
    id: 'job_2',
    autoPilot: { pipelineMode: 'vertical', sourceRank: 2 },
    publishData: { title: '标题' },
    scheduledAt: '2026-01-01T08:00:00.000Z',
    platformTasks: [{ platform: 'wechatChannels', accountLabel: '账号 A', status: 'published' }],
    selectedPlatforms: ['wechatChannels']
  }],
  getJobTerminalState: () => 'published',
  getJobStatusLabel: () => '已成功发布'
});
assert.equal(generatedJobs[0].title, '标题');
assert.equal(generatedJobs[0].statusLabel, '已成功发布');

const summary = buildAutoPilotSummaryItems({
  global,
  activeModes: ['avatar'],
  activeMappings,
  getPlatformAccountLabel: () => '主账号',
  getPlatformLabel: (platformKey) => ({ wechatChannels: '微信视频号', x: 'X' }[platformKey] || platformKey),
  now: new Date('2026-01-01T06:00:00+08:00')
});
assert.equal(summary.find((item) => item.label === '托管状态').value, '已开启');
assert.match(summary.find((item) => item.label === '分发策略').value, /AI 分区 Top 3/);
assert.equal(formatAutoPilotJobTime('bad date'), 'bad date');

assert.deepEqual(normalizeApiError({
  response: {
    data: {
      error: 'failed',
      code: 'PUBLISH_FAILED',
      stage: 'publish',
      hint: 'retry',
      details: 'network'
    }
  }
}), {
  message: 'failed',
  code: 'PUBLISH_FAILED',
  stage: 'publish',
  hint: 'retry',
  details: 'network'
});

console.log('publish center domain checks passed');
