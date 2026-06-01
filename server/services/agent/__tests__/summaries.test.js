const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildProjectFileInfo,
  buildQrCodeImagePayload,
  buildWorkflowNextActions,
  extractNarrationText,
  normalizeAvatarConfigPayload,
  normalizePublishJobSummary,
  normalizeVerticalJob,
  resolveJobOutputInfo,
  resolvePublicAssetUrlFromPath,
  summarizeReviewRecord
} = require('../summaries');

describe('agent summaries', () => {
  test('resolves project output info and public URLs inside project roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-summary-'));
    const paths = {
      PROJECT_ROOT: root,
      PROJECTS_DIR: path.join(root, 'projects')
    };
    const outputDir = path.join(paths.PROJECTS_DIR, 'material_job_1');
    fs.mkdirSync(outputDir, { recursive: true });
    const videoPath = path.join(outputDir, 'output_final.mp4');
    fs.writeFileSync(videoPath, 'video');

    expect(resolveJobOutputInfo({ outputDir: 'material_job_1' }, '', paths)).toEqual({
      outputDir: 'material_job_1',
      outputPath: outputDir,
      projectsRoot: paths.PROJECTS_DIR
    });
    expect(resolvePublicAssetUrlFromPath(videoPath, root)).toBe('/projects/material_job_1/output_final.mp4');
    expect(buildProjectFileInfo({ outputDir: 'material_job_1' }, '', paths, 'output_final.mp4')).toEqual(expect.objectContaining({
      exists: true,
      outputDir: 'material_job_1',
      publicUrl: '/projects/material_job_1/output_final.mp4'
    }));
  });

  test('builds workflow next actions from task stage', () => {
    expect(buildWorkflowNextActions({ status: 'failed' }).stage).toBe('failed');
    expect(buildWorkflowNextActions({ status: 'completed' }).actions.map((item) => item.name)).toContain('create_publish_draft');
    expect(buildWorkflowNextActions({ status: 'generating_avatar' }).actions.map((item) => item.name)).toContain('get_avatar_status');
    expect(buildWorkflowNextActions({ narration: { full_text: '口播完成' } }).actions.map((item) => item.name)).toContain('generate_avatar_video');
  });

  test('normalizes avatar config payload and narration text', () => {
    expect(extractNarrationText(null, [{ text: '第一句' }, { text: '第二句' }])).toBe('第一句\n\n第二句');
    expect(normalizeAvatarConfigPayload({
      avatarConfig: { provider: 'runninghub' },
      maxDuration: 12
    })).toEqual(expect.objectContaining({
      provider: 'runninghub',
      renderProvider: 'runninghub',
      maxDuration: 12
    }));
  });

  test('summarizes publish, review, vertical, and qr payloads', () => {
    const nowMs = new Date('2026-06-01T08:05:00.000Z').getTime();
    const publishSummary = normalizePublishJobSummary({
      id: 'job1',
      scheduledAt: '2026-06-01T08:00:00.000Z',
      status: 'scheduled_wait',
      publishData: { title: '标题', description: '描述' },
      platformTasks: [{ platform: 'wechatChannels', status: 'scheduled_wait' }]
    }, nowMs);
    expect(publishSummary.due).toBe(true);
    expect(publishSummary.platformTasks[0].platform).toBe('wechatChannels');

    expect(summarizeReviewRecord({
      id: 'review1',
      review_status: 'passed',
      overall_score: 88
    })).toEqual(expect.objectContaining({
      id: 'review1',
      status: 'passed',
      overallScore: 88
    }));

    expect(normalizeVerticalJob({ id: 'v1', status: 'running', logs: ['a'] })).toEqual(expect.objectContaining({
      id: 'v1',
      active: true,
      recentLogs: ['a']
    }));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-qr-'));
    const qrPath = path.join(root, 'qr.png');
    fs.writeFileSync(qrPath, 'qr');
    expect(buildQrCodeImagePayload({ qrCodePath: qrPath }, { PROJECT_ROOT: root })).toEqual(expect.objectContaining({
      hasQrCode: true,
      qrCodeBase64: Buffer.from('qr').toString('base64')
    }));
  });
});
